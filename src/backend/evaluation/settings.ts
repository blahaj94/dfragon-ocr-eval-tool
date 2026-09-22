import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, win32 } from 'node:path'
import { promisify } from 'node:util'
import type {
  EvaluationPreferences,
  EvaluationSettings,
  PythonRuntime
} from '../../shared/contracts'
import { isRecord, readPath } from './validation'

const execute = promisify(execFile)
const fields = new Set([
  'pythonExecutable',
  'ldbOcrSourcePath',
  'runDirectory',
  'checkpointPath',
  'datasetDirectory',
  'labelsPath',
  'outputDirectory'
])

function parseSettings(input: unknown): EvaluationSettings {
  if (!isRecord(input) || Object.keys(input).some((key) => !fields.has(key))) {
    throw new Error('저장된 평가 설정 형식이 올바르지 않습니다.')
  }
  const settings: EvaluationSettings = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== '' && (typeof value !== 'string' || value.length > 32768)) {
      throw new Error('평가 설정의 경로가 올바르지 않습니다.')
    }
    settings[key as keyof EvaluationSettings] = value === '' ? '' : readPath(value)
  }
  return settings
}

export function pythonCandidates(searchPath: string, platform: NodeJS.Platform): string[] {
  return pathCandidates(
    searchPath,
    platform,
    platform === 'win32'
      ? ['python.exe', 'python3.exe', 'python3.12.exe']
      : ['python3.12', 'python3', 'python']
  )
}

function pathCandidates(searchPath: string, platform: NodeJS.Platform, names: string[]): string[] {
  const paths = platform === 'win32' ? win32 : posix
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const entry of searchPath.split(paths.delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, '$1')
    if (!paths.isAbsolute(directory) || /(^|[\\/])WindowsApps([\\/]|$)/i.test(directory)) {
      continue
    }
    for (const name of names) {
      const candidate = paths.join(directory, name)
      const key = platform === 'win32' ? candidate.toLowerCase() : candidate
      if (!seen.has(key)) {
        seen.add(key)
        candidates.push(candidate)
      }
    }
  }
  return candidates
}

export function parseLauncherPaths(output: string): string[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*-(?:V:)?\S+\s+(?:\*\s+)?(.+?\.exe"?)\s*$/i.exec(line)
    const path = match?.[1].replace(/^"(.*)"$/, '$1')
    return path && win32.isAbsolute(path) ? [path] : []
  })
}

export async function discoverPythons(
  savedExecutable?: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<PythonRuntime[]> {
  const env = (name: string): string =>
    Object.entries(environment).find(([key]) => key.toLowerCase() === name)?.[1] ?? ''
  const searchPath = env('path')
  const candidates = [
    ...(savedExecutable ? [savedExecutable] : []),
    ...pythonCandidates(searchPath, platform)
  ]
  if (platform === 'win32') {
    const launchers = pathCandidates(searchPath, platform, ['py.exe'])
    if (win32.isAbsolute(env('systemroot'))) {
      launchers.push(win32.join(env('systemroot'), 'py.exe'))
    }
    for (const launcher of new Set(launchers)) {
      try {
        if (!(await stat(launcher)).isFile()) {
          continue
        }
        const { stdout, stderr } = await execute(launcher, ['--list-paths'], {
          timeout: 2000,
          maxBuffer: 64 * 1024,
          windowsHide: true,
          encoding: 'utf8',
          env: { ...environment, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
        })
        candidates.push(...parseLauncherPaths(`${stdout}\n${stderr}`))
        break
      } catch {
        // The launcher is optional. PATH and a previously selected environment still work.
      }
    }
  }
  const seen = new Set<string>()
  const runtimes: PythonRuntime[] = []
  const interpreters = new Set<string>()
  for (const candidate of candidates) {
    const key = platform === 'win32' ? win32.normalize(candidate).toLowerCase() : candidate
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    try {
      if (!(await stat(candidate)).isFile()) {
        continue
      }
      const { stdout } = await execute(
        candidate,
        [
          '-I',
          '-S',
          '-c',
          'import json,sys; print(json.dumps({"version":"%d.%d.%d" % sys.version_info[:3],"executable":sys.executable}))'
        ],
        { timeout: 1500, maxBuffer: 64 * 1024, windowsHide: true, encoding: 'utf8' }
      )
      const result: unknown = JSON.parse(stdout)
      const paths = platform === 'win32' ? win32 : posix
      if (
        isRecord(result) &&
        typeof result.version === 'string' &&
        /^\d+\.\d+\.\d+$/.test(result.version) &&
        typeof result.executable === 'string' &&
        paths.isAbsolute(result.executable)
      ) {
        const identity =
          platform === 'win32'
            ? paths.normalize(result.executable).toLowerCase()
            : paths.normalize(result.executable)
        if (interpreters.has(identity)) {
          continue
        }
        interpreters.add(identity)
        // Preserve the executable: realpath would escape symlink-based virtual environments.
        runtimes.push({
          executable: candidate,
          version: result.version,
          supported: result.version.startsWith('3.12.')
        })
      }
    } catch {
      // A missing, non-Python, incompatible or unresponsive PATH entry is not a usable runtime.
    }
  }
  return runtimes
}

export class EvaluationSettingsStore {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly findPythons: (
      savedExecutable?: string
    ) => Promise<PythonRuntime[]> = discoverPythons
  ) {
    if (!isAbsolute(filePath)) {
      throw new Error('설정 저장 경로는 절대 경로여야 합니다.')
    }
  }

  private async read(): Promise<EvaluationSettings> {
    try {
      const info = await lstat(this.filePath)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) {
        throw new Error('평가 설정 파일을 읽을 수 없습니다.')
      }
      const value: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!isRecord(value) || value.schemaVersion !== 1) {
        throw new Error('지원하지 않는 평가 설정 파일입니다.')
      }
      return parseSettings(value.settings)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }
      throw error
    }
  }

  async get(): Promise<EvaluationPreferences> {
    await this.pending
    const settings = await this.read()
    const pythons = await this.findPythons(settings.pythonExecutable)
    if (!settings.pythonExecutable) {
      const python = pythons.find((runtime) => runtime.supported)
      if (python !== undefined) {
        settings.pythonExecutable = python.executable
      }
    }
    return { settings, pythons }
  }

  save(input: unknown): Promise<void> {
    const settings = parseSettings(input)
    const text = `${JSON.stringify({ schemaVersion: 1, settings }, null, 2)}\n`
    if (Buffer.byteLength(text) > 64 * 1024) {
      throw new Error('평가 설정이 허용 크기를 초과했습니다.')
    }
    const operation = this.pending.then(async () => {
      await this.read()
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporary = join(dirname(this.filePath), `.evaluation-settings-${randomUUID()}.tmp`)
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try {
          await handle.writeFile(text)
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, this.filePath)
      } finally {
        await rm(temporary, { force: true })
      }
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }
}
