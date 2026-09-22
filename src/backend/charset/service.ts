import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import type { CharsetInspection } from '../../shared/charset'
import { isRecord, readPath } from '../evaluation/validation'
import { describeCharacter } from './characters'
import { parseConfig, parseJsonObject, parseLabels } from './validation'

const MAX_TEXT_BYTES = 32 * 1024 * 1024

async function readText(path: string): Promise<{ bytes: Buffer; text: string }> {
  const file = await open(path, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > MAX_TEXT_BYTES) {
      throw new Error('문자 검사에는 32 MiB 이하의 일반 텍스트 파일이 필요합니다.')
    }
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) {
        throw new Error('읽는 중 파일 크기가 변경되었습니다. 다시 검사하세요.')
      }
      offset += bytesRead
    }
    const after = await file.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('읽는 중 파일 내용이 변경되었습니다. 다시 검사하세요.')
    }
    try {
      return {
        bytes,
        text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      }
    } catch {
      throw new Error(`UTF-8 텍스트 파일이 아닙니다: ${path}`)
    }
  } finally {
    await file.close()
  }
}

function recordedPath(value: unknown): { identity: string; path: string; windows: boolean } {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new Error('학습 설정에 기록된 절대 경로가 올바르지 않습니다.')
  }
  const windows = /^[a-z]:[\\/]/i.test(value) || /^(?:\\\\|\/\/)[^\\/]/.test(value)
  const paths = windows ? win32 : posix
  if (!paths.isAbsolute(value)) {
    throw new Error('학습 설정에 기록된 절대 경로가 올바르지 않습니다.')
  }
  const path = paths.normalize(value)
  return {
    identity: `${windows ? 'windows' : 'posix'}:${windows ? path.toLowerCase() : path}`,
    path,
    windows
  }
}

function readDictionary(text: string, useSpace: boolean): Set<string> {
  if (text.startsWith('\uFEFF')) {
    throw new Error('characters.txt: 파일 첫머리 BOM은 지원하지 않습니다.')
  }
  // ldb-ocr keeps every token verbatim: only line terminators are removed.
  const tokens = text.replace(/\r\n/g, '\n').split('\n')
  if (tokens.at(-1) === '') {
    tokens.pop()
  }
  if (tokens.length === 0 || tokens.some((token) => Array.from(token).length !== 1)) {
    throw new Error('characters.txt: 비어 있지 않은 한 코드포인트씩 줄마다 기록해야 합니다.')
  }
  if (tokens.some((token) => /[\p{Control}\p{Surrogate}]/u.test(token))) {
    throw new Error('characters.txt: 제어·서로게이트 문자는 지원하지 않습니다.')
  }
  if (useSpace) {
    tokens.push(' ')
  }
  if (new Set(tokens).size !== tokens.length) {
    throw new Error(
      'characters.txt: useSpace로 추가되는 공백을 포함하여 중복 문자는 허용하지 않습니다.'
    )
  }
  // CTC blank is not text and is deliberately absent from this membership set.
  return new Set(tokens)
}

export class CharsetService {
  async inspect(runInput: unknown, labelsInput: unknown): Promise<CharsetInspection> {
    const run = readPath(runInput)
    const labelsPath = readPath(labelsInput)
    const [requestFile, configFile, dictionaryFile, labelsFile] = await Promise.all([
      readText(join(run, 'request.json')),
      readText(join(run, 'config.yml')),
      readText(join(run, 'characters.txt')),
      readText(labelsPath)
    ])
    const request = parseJsonObject(requestFile.text, 'request.json')
    const config = parseConfig(configFile.text)
    const modelNames: Record<string, string> = {
      'v5-korean': 'korean_PP-OCRv5_mobile_rec',
      'v6-small-ko': 'PP-OCRv6_small_rec'
    }
    if (
      request.schemaVersion !== 1 ||
      typeof request.model !== 'string' ||
      !Object.hasOwn(modelNames, request.model) ||
      request.modelName !== modelNames[request.model] ||
      !['smoke', 'korean'].includes(String(request.profile)) ||
      request.imageStage !== 'raw-nickname-crop'
    ) {
      throw new Error('request.json: 지원되는 ldb-ocr 학습 결과 형식이 아닙니다.')
    }
    const globalConfig = config.Global
    if (
      typeof request.useSpace !== 'boolean' ||
      !isRecord(globalConfig) ||
      globalConfig.use_space_char !== request.useSpace ||
      !isRecord(config.PostProcess) ||
      config.PostProcess.name !== 'CTCLabelDecode'
    ) {
      throw new Error('request.json과 config.yml의 useSpace 또는 CTCLabelDecode 설정을 확인하세요.')
    }
    const recordedRun = recordedPath(request.run)
    const recordedDictionary = recordedPath(request.dictionary)
    const expectedDictionary = recordedPath(
      (recordedRun.windows ? win32 : posix).join(recordedRun.path, 'characters.txt')
    )
    if (recordedDictionary.identity !== expectedDictionary.identity) {
      throw new Error('request.json: 사전은 기록된 학습 폴더의 characters.txt여야 합니다.')
    }
    if (recordedDictionary.identity !== recordedPath(globalConfig.character_dict_path).identity) {
      throw new Error('request.json과 config.yml의 사전 경로가 다릅니다.')
    }
    if (
      typeof request.dictionarySha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(request.dictionarySha256) ||
      createHash('sha256').update(dictionaryFile.bytes).digest('hex') !== request.dictionarySha256
    ) {
      throw new Error('characters.txt의 SHA256이 request.json의 학습 사전 기록과 다릅니다.')
    }
    const dictionary = readDictionary(dictionaryFile.text, request.useSpace)
    const samples = parseLabels(labelsFile.text)
    const counts = new Map<string, number>()
    for (const sample of samples) {
      for (const character of sample.truth) {
        counts.set(character, (counts.get(character) ?? 0) + 1)
      }
    }
    const characters = [...counts.entries()]
      .sort(([left], [right]) => left.codePointAt(0)! - right.codePointAt(0)!)
      .map(([character, count]) => describeCharacter(character, count, dictionary.has(character)))
    const uniqueCount = characters.length
    const includedCount = characters.filter((character) => character.included).length
    const missingCount = uniqueCount - includedCount
    return {
      status: uniqueCount === 0 ? 'empty' : missingCount === 0 ? 'covered' : 'missing',
      sampleCount: samples.length,
      uniqueCount,
      includedCount,
      missingCount,
      coverage: uniqueCount === 0 ? null : includedCount / uniqueCount,
      useSpace: request.useSpace,
      characters
    }
  }
}
