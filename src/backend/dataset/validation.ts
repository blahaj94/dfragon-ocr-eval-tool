import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type {
  DatasetCheckResult,
  DatasetCounts,
  DatasetIssue,
  DatasetRecord,
  DatasetSample,
  DatasetSelection,
  DatasetSplit
} from '../../shared/dataset'

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Dataset 데이터는 JSON 객체여야 합니다.')
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new Error('Dataset 데이터 필드가 지원 형식과 다릅니다.')
  }
  return record
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error('Dataset 문자열 값이 올바르지 않습니다.')
  }
  return value
}

export function datasetPath(value: unknown): string {
  const path = text(value)
  if (!isAbsolute(path)) {
    throw new Error('Dataset에는 절대 경로를 사용하세요.')
  }
  return path
}

export function parseSelection(value: unknown): DatasetSelection {
  const record = object(value, ['pythonExecutable', 'datasetDirectory', 'labelsPath'])
  return {
    pythonExecutable: datasetPath(record.pythonExecutable),
    datasetDirectory: datasetPath(record.datasetDirectory),
    labelsPath: datasetPath(record.labelsPath)
  }
}

export function parseSplit(value: unknown): DatasetSplit | null {
  if (value !== null && value !== 'train' && value !== 'val' && value !== 'test') {
    throw new Error('Split은 train, val, test 또는 미배정이어야 합니다.')
  }
  return value
}

export function parseEventIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((id) => typeof id === 'string')) {
    throw new Error('배정할 캡처 이벤트를 선택하세요.')
  }
  if (new Set(value).size !== value.length) {
    throw new Error('같은 캡처 이벤트를 중복 선택할 수 없습니다.')
  }
  return value
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('Dataset 해시가 올바르지 않습니다.')
  }
  return value
}

export function parseSamples(value: unknown, persisted = false): DatasetSample[] {
  if (!Array.isArray(value)) {
    throw new Error('Dataset samples는 배열이어야 합니다.')
  }
  const keys = new Set<string>()
  const events = new Map<string, DatasetSplit>()
  return value.map((input) => {
    const row = object(input, [
      'key',
      'id',
      'image',
      'truth',
      'datasetDirectory',
      'eventId',
      'pixelHash',
      'originalHash',
      'split',
      'confirmedAt'
    ])
    const datasetDirectory = datasetPath(row.datasetDirectory)
    const image = text(row.image)
    const eventId = text(row.eventId)
    if (
      !/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(eventId) ||
      !new RegExp(`^${eventId}/[0-9]{3,}\\.png$`).test(image)
    ) {
      throw new Error('Dataset 이미지와 캡처 이벤트 경로가 올바르지 않습니다.')
    }
    const key = hash(row.key)
    if (
      key !== createHash('sha256').update(`${datasetDirectory}\0${image}`).digest('hex') ||
      keys.has(key)
    ) {
      throw new Error('Dataset 샘플 키가 올바르지 않거나 중복되었습니다.')
    }
    keys.add(key)
    const split = parseSplit(row.split)
    const confirmedAt = row.confirmedAt === null ? null : text(row.confirmedAt)
    if (confirmedAt !== null && (split === null || !Number.isFinite(Date.parse(confirmedAt)))) {
      throw new Error('확정한 Dataset 항목의 split 또는 시각이 올바르지 않습니다.')
    }
    if (persisted && confirmedAt === null && split !== null) {
      throw new Error('확정하지 않은 split 초안은 기록 파일에 저장할 수 없습니다.')
    }
    if (confirmedAt !== null && split !== null) {
      const eventKey = `${datasetDirectory}\0${eventId}`
      if (events.has(eventKey) && events.get(eventKey) !== split) {
        throw new Error('같은 캡처 이벤트의 확정 split이 서로 다릅니다.')
      }
      events.set(eventKey, split)
    }
    return {
      key,
      id: text(row.id),
      image,
      truth: text(row.truth),
      datasetDirectory,
      eventId,
      pixelHash: hash(row.pixelHash),
      originalHash: row.originalHash === null ? null : hash(row.originalHash),
      split,
      confirmedAt
    }
  })
}

export function parseDatasetRecord(value: unknown): DatasetRecord {
  const record = object(value, ['schemaVersion', 'selection', 'samples'])
  if (record.schemaVersion !== 1) {
    throw new Error('지원하지 않는 Dataset 기록 버전입니다.')
  }
  return {
    schemaVersion: 1,
    selection: record.selection === null ? null : parseSelection(record.selection),
    samples: parseSamples(record.samples, true)
  }
}

export function countSamples(samples: DatasetSample[], root: string): DatasetCounts {
  const counts: DatasetCounts = { train: 0, val: 0, test: 0, unassigned: 0 }
  for (const sample of samples) {
    if (sample.datasetDirectory === root) {
      counts[sample.split ?? 'unassigned']++
    }
  }
  return counts
}

export function parseCheckResult(value: unknown, root: string): DatasetCheckResult {
  const record = object(value, ['passed', 'counts', 'issues', 'samples'])
  if (typeof record.passed !== 'boolean' || !Array.isArray(record.issues)) {
    throw new Error('Dataset 검사 응답 형식이 올바르지 않습니다.')
  }
  const samples = parseSamples(record.samples)
  const counts = object(record.counts, ['train', 'val', 'test', 'unassigned'])
  const expected = countSamples(samples, root)
  for (const key of ['train', 'val', 'test', 'unassigned'] as const) {
    if (counts[key] !== expected[key]) {
      throw new Error('Dataset 검사 집계가 샘플 목록과 다릅니다.')
    }
  }
  const issues = record.issues.map((input): DatasetIssue => {
    const issue = object(input, ['severity', 'code', 'message', 'images'])
    if (
      (issue.severity !== 'error' && issue.severity !== 'warning') ||
      !Array.isArray(issue.images) ||
      !issue.images.every((image) => typeof image === 'string')
    ) {
      throw new Error('Dataset 검사 문제 목록이 올바르지 않습니다.')
    }
    return {
      severity: issue.severity,
      code: text(issue.code),
      message: text(issue.message),
      images: issue.images
    }
  })
  if (record.passed && issues.some((issue) => issue.severity === 'error')) {
    throw new Error('오류가 있는 Dataset 검사 결과는 통과할 수 없습니다.')
  }
  return { passed: record.passed, counts: expected, issues, samples }
}

export function sameSample(
  left: DatasetSample,
  right: DatasetSample,
  includeSplit = true
): boolean {
  return Object.keys(left).every(
    (field) =>
      (!includeSplit && field === 'split') ||
      left[field as keyof DatasetSample] === right[field as keyof DatasetSample]
  )
}
