import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, isAbsolute, relative } from 'node:path'
import { createInterface } from 'node:readline'
import {
  CHARACTER_GROUPS,
  characterDistribution,
  characterGroup,
  type CharacterDistribution,
  type SupplementInfo,
  type SupplementOptions,
  type SupplementPlan
} from '../../shared/supplement'
import { isRecord, readPath } from '../evaluation/validation'
import { parseDataset } from './library'

function isDistribution(value: unknown): value is CharacterDistribution {
  if (!isRecord(value) || !isRecord(value.groups) || !Array.isArray(value.frequencies)) {
    return false
  }
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0
  if (
    !count(value.images) ||
    !count(value.nicknames) ||
    !count(value.characters) ||
    value.nicknames > value.images ||
    CHARACTER_GROUPS.some((group) => !count((value.groups as Record<string, unknown>)[group]))
  ) {
    return false
  }
  const seen = new Set<string>()
  const groups = Object.fromEntries(CHARACTER_GROUPS.map((group) => [group, 0]))
  for (const row of value.frequencies) {
    if (
      !isRecord(row) ||
      typeof row.character !== 'string' ||
      [...row.character].length !== 1 ||
      !count(row.count) ||
      row.count === 0 ||
      row.group !== characterGroup(row.character) ||
      seen.has(row.character)
    ) {
      return false
    }
    seen.add(row.character)
    groups[row.group as string] += row.count
  }
  return (
    Object.values(groups).reduce((sum, n) => sum + n, 0) === value.characters &&
    CHARACTER_GROUPS.every(
      (group) => groups[group] === (value.groups as Record<string, unknown>)[group]
    )
  )
}

function isPlan(value: unknown): value is SupplementPlan {
  return (
    isRecord(value) &&
    isDistribution(value.real) &&
    isDistribution(value.synthetic) &&
    isDistribution(value.final) &&
    isRecord(value.differences) &&
    CHARACTER_GROUPS.every((group) => {
      const delta = (value.differences as Record<string, unknown>)[group]
      return (
        delta === null ||
        (typeof delta === 'number' && Number.isFinite(delta) && Math.abs(delta) <= 100)
      )
    }) &&
    Number.isSafeInteger(value.requestedCharacters) &&
    Number(value.requestedCharacters) >= 0 &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === 'string') &&
    value.final.images === value.real.images + value.synthetic.images &&
    value.final.characters === value.real.characters + value.synthetic.characters
  )
}

export function parseSupplementOptions(value: unknown): SupplementOptions {
  if (
    !isRecord(value) ||
    !isRecord(value.targets) ||
    !isRecord(value.characters) ||
    !isRecord(value.fonts)
  ) {
    throw new Error('합성 설정을 확인해 주세요.')
  }
  const number = (input: unknown, min: number, max: number, integer = false): number => {
    if (
      typeof input !== 'number' ||
      !Number.isFinite(input) ||
      input < min ||
      input > max ||
      (integer && !Number.isInteger(input))
    ) {
      throw new Error('합성 설정의 숫자 범위를 확인해 주세요.')
    }
    return input
  }
  const rgb = (input: unknown) => {
    if (!Array.isArray(input) || input.length !== 3) {
      throw new Error('RGB 색상을 확인해 주세요.')
    }
    return input.map((channel) => number(channel, 0, 255, true))
  }
  if (
    typeof value.additionalCharacters !== 'string' ||
    value.additionalCharacters.length > 20_000
  ) {
    throw new Error('모델에 추가할 문자를 확인해 주세요.')
  }
  const targets = {} as SupplementOptions['targets']
  const characters = {} as SupplementOptions['characters']
  for (const group of CHARACTER_GROUPS) {
    targets[group] = value.targets[group] === null ? null : number(value.targets[group], 0, 100)
    const text = value.characters[group]
    if (typeof text !== 'string' || text.length > 20_000) {
      throw new Error('합성 문자 목록을 확인해 주세요.')
    }
    characters[group] = text
  }
  if (Object.values(targets).reduce<number>((sum, target) => sum + (target ?? 0), 0) > 100 + 1e-8) {
    throw new Error('목표 비율 합계가 100%를 넘습니다.')
  }
  if (
    !['dotum', 'nanum-neo'].includes(String(value.profile)) ||
    !['solid', 'images'].includes(String(value.backgroundMode))
  ) {
    throw new Error('글꼴 모드·배경 종류를 확인해 주세요.')
  }
  const fonts = {} as SupplementOptions['fonts']
  for (const name of ['gulim', 'batang', 'nanum', 'uttum'] as const) {
    fonts[name] = value.fonts[name] === '' ? '' : readPath(value.fonts[name])
  }
  const width = number(value.width, 4, 2048, true)
  const height = number(value.height, 4, 2048, true)
  return {
    additionalCharacters: value.additionalCharacters,
    pythonExecutable: readPath(value.pythonExecutable),
    targets,
    characters,
    tolerance: number(value.tolerance, 0, 100),
    maxImages: number(value.maxImages, 1, 100_000, true),
    seed: number(value.seed, 0, 2 ** 32 - 1, true),
    profile: value.profile as SupplementOptions['profile'],
    fonts,
    scale: number(value.scale, Number.MIN_VALUE, 16),
    width,
    height,
    padding: number(value.padding, 0, Math.floor((Math.min(width, height) - 1) / 2), true),
    color: rgb(value.color),
    backgroundMode: value.backgroundMode as SupplementOptions['backgroundMode'],
    backgroundColor: rgb(value.backgroundColor),
    backgroundDirectory:
      value.backgroundMode === 'images' ? readPath(value.backgroundDirectory) : ''
  }
}

export async function supplementInfo(root: string): Promise<SupplementInfo> {
  const bytes = await readFile(join(root, 'dataset.json'))
  const ready: unknown = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8'))
  if (
    !isRecord(ready) ||
    ready.datasetSha256 !== createHash('sha256').update(bytes).digest('hex')
  ) {
    throw new Error('저장된 실제 데이터가 변경되었습니다.')
  }
  const dataset = parseDataset(JSON.parse(bytes.toString('utf8')))
  const dictionary = new Set(
    (await readFile(join(root, 'model/characters.txt'), 'utf8')).trimEnd().split(/\r?\n/)
  )
  dictionary.add(' ')
  const train = dataset.samples.filter((row) => row.split === 'train' && row.text !== null)
  const all = characterDistribution(
    dataset.samples.flatMap((row) => (row.text === null ? [] : [row.text]))
  )
  return {
    real: characterDistribution(train.map((row) => row.text!)),
    missing: all.frequencies.filter((item) => !dictionary.has(item.character)),
    dictionarySize: dictionary.size - 1,
    width: [...train].sort((a, b) => a.width - b.width)[Math.floor(train.length / 2)]?.width ?? 160,
    height:
      [...train].sort((a, b) => a.height - b.height)[Math.floor(train.length / 2)]?.height ?? 32
  }
}

export async function runSupplementWorker(
  python: string,
  worker: string,
  request: string,
  cancelFile: string,
  onChild: (child: ChildProcess | null) => void,
  onMessage: (message: string) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      python,
      ['-B', '-u', worker, '--request', request, '--cancel-file', cancelFile],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }
      }
    )
    onChild(child)
    let terminal: 'finished' | 'cancelled' | null = null
    let failure: string | null = null
    let stderr = ''
    child.stderr!.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString('utf8')).slice(-4000)
    })
    const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity })
    lines.on('line', (line) => {
      try {
        if (line.length > 64 * 1024 || terminal !== null) {
          throw new Error('합성 프로세스 응답이 올바르지 않습니다.')
        }
        const event: unknown = JSON.parse(line)
        if (!isRecord(event)) {
          throw new Error('합성 프로세스 응답이 올바르지 않습니다.')
        }
        if (event.type === 'message' && typeof event.message === 'string') {
          onMessage(event.message)
        } else if (event.type === 'finished' || event.type === 'cancelled') {
          terminal = event.type
        } else if (event.type === 'error' && typeof event.message === 'string') {
          failure = event.message
        } else {
          throw new Error('합성 프로세스 응답이 올바르지 않습니다.')
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
        child.kill()
      }
    })
    child.once('error', (error) => {
      failure = error.message
    })
    child.once('close', (code) => {
      onChild(null)
      if (terminal === 'cancelled' && failure === null) {
        reject(new Error('합성 준비를 취소했습니다.'))
      } else if (failure !== null || code !== 0 || terminal !== 'finished') {
        reject(new Error(failure ?? (stderr || '합성 프로세스가 완료되지 않았습니다.')))
      } else {
        resolve()
      }
    })
  })
}

export async function readSupplement(
  root: string,
  directory: string,
  examples: boolean
): Promise<{
  plan: SupplementPlan
  options: SupplementOptions
  examples: { text: string; image: string }[]
  sha256: string
}> {
  const file = join(directory, 'supplement.json')
  if ((await stat(file)).size > 256 * 1024 * 1024) {
    throw new Error('합성 결과 파일이 너무 큽니다.')
  }
  const bytes = await readFile(file)
  const value: unknown = JSON.parse(bytes.toString('utf8'))
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isPlan(value.plan) ||
    !Array.isArray(value.samples)
  ) {
    throw new Error('합성 결과 형식이 올바르지 않습니다.')
  }
  const result = {
    plan: value.plan,
    options: parseSupplementOptions(value.options),
    examples: [] as { text: string; image: string }[],
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
  if (examples) {
    for (const row of value.samples.slice(0, 6)) {
      if (!isRecord(row) || typeof row.text !== 'string' || typeof row.image !== 'string') {
        throw new Error('합성 예시가 올바르지 않습니다.')
      }
      const path = await realpath(join(root, row.image))
      const rel = relative(join(directory, 'images'), path)
      if (
        isAbsolute(rel) ||
        !/^\d{6}\.png$/.test(rel) ||
        (await stat(path)).size > 16 * 1024 * 1024
      ) {
        throw new Error('합성 예시 경로가 올바르지 않습니다.')
      }
      const image = await readFile(path)
      if (createHash('sha256').update(image).digest('hex') !== row.sha256) {
        throw new Error('합성 예시가 변경되었습니다.')
      }
      result.examples.push({
        text: row.text,
        image: `data:image/png;base64,${image.toString('base64')}`
      })
    }
  }
  return result
}
