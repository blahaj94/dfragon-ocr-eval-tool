import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, posix, win32 } from 'node:path'
import type { EvaluationSample } from '../../shared/contracts'
import type { ComparisonGroup, ComparisonMetrics, ComparisonResult } from '../../shared/comparison'
import { isInside } from '../evaluation/runner'
import { isCount, isRecord, isReport, readPath } from '../evaluation/validation'

const MAX_REPORT_BYTES = 64 * 1024 * 1024
const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const SCORERS = ['recognition/metrics.py', 'recognition/distance.py'] as const
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

interface StoredSample extends EvaluationSample {
  imageSha256: string
}

interface StoredReport {
  path: string
  summary: ComparisonMetrics
  samples: StoredSample[]
  scorerHashes: Record<(typeof SCORERS)[number], string>
  datasetRoot: string | null
}

interface ImageSource {
  path: string
  root: string | null
  hash: string
}

function storedAbsolutePath(path: string): boolean {
  return !path.includes('\0') && (posix.isAbsolute(path) || win32.isAbsolute(path))
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

async function readBounded(path: string, limit: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size <= 0 || before.size > limit) {
      throw new Error(`파일이 비어 있거나 허용 크기(${limit} bytes)를 초과했습니다.`)
    }
    const data = Buffer.alloc(before.size)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset)
      if (bytesRead === 0) {
        throw new Error('읽는 중 파일 크기가 변경되었습니다.')
      }
      offset += bytesRead
    }
    const after = await handle.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('읽는 중 파일 내용이 변경되었습니다.')
    }
    return data
  } finally {
    await handle.close()
  }
}

function parseStoredReport(value: unknown, path: string, name: string): StoredReport {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error(`${name}: schemaVersion 1 평가 보고서만 지원합니다.`)
  }
  if (value.status !== 'completed') {
    throw new Error(`${name}: 완료된 전체 평가 보고서만 비교할 수 있습니다.`)
  }
  if (!isReport(value, storedAbsolutePath) || !isRecord(value.summary)) {
    throw new Error(`${name}: 보고서 샘플·집계 정보가 부족하거나 형식이 올바르지 않습니다.`)
  }
  const ids = new Set<string>()
  let exactMatchCount = 0
  let characterCount = 0
  const samples: StoredSample[] = value.samples.map((sample) => {
    const raw = sample as unknown as Record<string, unknown>
    if (sample.id.length === 0 || ids.has(sample.id)) {
      throw new Error(`${name}: 샘플 ID가 비어 있거나 중복되었습니다.`)
    }
    if (sample.truth.length === 0) {
      throw new Error(`${name}: 샘플 ${sample.id}의 정답이 비어 있습니다.`)
    }
    if (!isHash(raw.imageSha256)) {
      throw new Error(`${name}: 샘플 ${sample.id}의 imageSha256이 없거나 올바르지 않습니다.`)
    }
    ids.add(sample.id)
    characterCount += Array.from(sample.truth).length
    if (sample.truth === sample.prediction) {
      exactMatchCount++
    }
    return { ...sample, imageSha256: raw.imageSha256 }
  })
  const summary = value.summary
  if (!isCount(summary.exactMatchCount) || summary.exactMatchCount !== exactMatchCount) {
    throw new Error(`${name}: 저장된 exactMatchCount가 없거나 실제 정답 여부와 다릅니다.`)
  }
  if (
    summary.characterCount <= 0 ||
    summary.characterCount !== characterCount ||
    summary.sampleCount !== samples.length ||
    Math.abs(summary.exactMatch - exactMatchCount / samples.length) > Number.EPSILON * 4
  ) {
    throw new Error(`${name}: 저장된 샘플 수·정답 문자 수·Exact Match 집계가 서로 다릅니다.`)
  }
  const reproducibility = (value as unknown as Record<string, unknown>).reproducibility
  if (
    !isRecord(reproducibility) ||
    reproducibility.normalization !== 'none' ||
    !isRecord(reproducibility.sourceSha256)
  ) {
    throw new Error(`${name}: normalization=none 및 평가 코드 해시 정보가 필요합니다.`)
  }
  const scorerHashes = {} as StoredReport['scorerHashes']
  for (const scorer of SCORERS) {
    const hash = reproducibility.sourceSha256[scorer]
    if (!isHash(hash)) {
      throw new Error(`${name}: 평가 코드 ${scorer}의 해시 정보가 부족합니다.`)
    }
    scorerHashes[scorer] = hash
  }
  const root = isRecord(reproducibility.settings) ? reproducibility.settings.datasetDirectory : null
  return {
    path,
    summary: {
      cer: summary.cer,
      exactMatch: summary.exactMatch,
      sampleCount: summary.sampleCount,
      characterCount: summary.characterCount,
      exactMatchCount: summary.exactMatchCount
    },
    samples,
    scorerHashes,
    datasetRoot: typeof root === 'string' && storedAbsolutePath(root) ? root : null
  }
}

export class ComparisonService {
  private images = new Map<string, ImageSource[]>()
  private generation = 0
  private comparing = false

  async compare(reportAPath: unknown, reportBPath: unknown): Promise<ComparisonResult> {
    const generation = ++this.generation
    this.images.clear()
    if (this.comparing) {
      throw new Error('보고서 비교가 이미 진행 중입니다.')
    }
    this.comparing = true
    try {
      const [a, b] = await Promise.all([
        this.readReport(reportAPath, '보고서 A'),
        this.readReport(reportBPath, '보고서 B')
      ])
      if (SCORERS.some((scorer) => a.scorerHashes[scorer] !== b.scorerHashes[scorer])) {
        throw new Error('평가 기준이 다릅니다. CER·편집거리 계산 코드가 같은 보고서만 비교하세요.')
      }
      const bById = new Map(b.samples.map((sample) => [sample.id, sample]))
      if (
        a.samples.length !== b.samples.length ||
        a.samples.some((sample) => !bById.has(sample.id))
      ) {
        throw new Error('동일한 전체 데이터셋이 아닙니다. 두 보고서의 샘플 ID 집합이 다릅니다.')
      }
      const counts: Record<ComparisonGroup, number> = {
        regressed: 0,
        improved: 0,
        'both-correct': 0,
        'both-wrong': 0
      }
      const images = new Map<string, ImageSource[]>()
      const samples = a.samples.map((sampleA) => {
        const sampleB = bById.get(sampleA.id)!
        if (sampleA.imageSha256 !== sampleB.imageSha256 || sampleA.truth !== sampleB.truth) {
          throw new Error(
            `동일한 전체 데이터셋이 아닙니다. 샘플 ${sampleA.id}의 이미지 해시 또는 원문 정답이 다릅니다.`
          )
        }
        const correctA = sampleA.truth === sampleA.prediction
        const correctB = sampleB.truth === sampleB.prediction
        const group: ComparisonGroup = correctA
          ? correctB
            ? 'both-correct'
            : 'regressed'
          : correctB
            ? 'improved'
            : 'both-wrong'
        counts[group]++
        const sources: ImageSource[] = [
          { path: sampleA.imagePath, root: a.datasetRoot, hash: sampleA.imageSha256 },
          { path: sampleB.imagePath, root: b.datasetRoot, hash: sampleB.imageSha256 }
        ]
        for (const source of sources) {
          const previous = images.get(source.path)
          if (previous?.some((image) => image.hash !== source.hash)) {
            throw new Error('동일 이미지 경로에 서로 다른 해시가 기록되어 있습니다.')
          }
          images.set(source.path, [...(previous ?? []), ...sources])
        }
        return { a: sampleA, b: sampleB, group }
      })
      if (generation !== this.generation) {
        throw new Error('새 비교 요청으로 이전 비교가 취소되었습니다.')
      }
      this.images = images
      return {
        reportAPath: a.path,
        reportBPath: b.path,
        summaryA: a.summary,
        summaryB: b.summary,
        counts,
        samples
      }
    } finally {
      this.comparing = false
    }
  }

  async readImage(input: unknown): Promise<string> {
    const generation = this.generation
    const sources = typeof input === 'string' ? this.images.get(input) : undefined
    if (this.comparing || sources === undefined) {
      throw new Error('현재 비교에 등록된 이미지만 열 수 있습니다.')
    }
    const reasons: string[] = []
    for (const source of sources) {
      try {
        if (source.root === null) {
          throw new Error('보고서에 캡처 루트 경로가 없습니다.')
        }
        if (!isAbsolute(source.path) || !isAbsolute(source.root)) {
          throw new Error('다른 운영체제에 기록된 이미지 경로는 이 PC에서 열 수 없습니다.')
        }
        const root = await realpath(source.root)
        const path = await realpath(source.path)
        if (!isInside(root, path) || extname(path).toLowerCase() !== '.png') {
          throw new Error('이미지가 보고서의 캡처 루트 밖에 있습니다.')
        }
        if (!(await stat(root)).isDirectory()) {
          throw new Error('캡처 루트를 찾을 수 없습니다.')
        }
        const bytes = await readBounded(path, MAX_IMAGE_BYTES)
        if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
          throw new Error('PNG 이미지가 아닙니다.')
        }
        if (createHash('sha256').update(bytes).digest('hex') !== source.hash) {
          throw new Error('이미지가 평가 당시와 달라졌습니다. SHA256이 일치하지 않습니다.')
        }
        if ((await realpath(source.path)) !== path || (await realpath(source.root)) !== root) {
          throw new Error('이미지 경로가 읽는 중 변경되었습니다.')
        }
        if (generation !== this.generation) {
          throw new Error('비교가 변경되어 이전 이미지를 열 수 없습니다.')
        }
        return `data:image/png;base64,${bytes.toString('base64')}`
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : String(error))
      }
    }
    throw new Error(
      `이미지를 표시할 수 없습니다. A/B 원본을 확인하세요. ${[...new Set(reasons)].join(' / ')}`
    )
  }

  private async readReport(input: unknown, name: string): Promise<StoredReport> {
    const path = await realpath(readPath(input))
    let value: unknown
    try {
      value = JSON.parse((await readBounded(path, MAX_REPORT_BYTES)).toString('utf8'))
    } catch (error) {
      throw new Error(
        `${name}: JSON 보고서를 읽을 수 없습니다. ${error instanceof Error ? error.message : String(error)}`
      )
    }
    return parseStoredReport(value, path, name)
  }
}
