import { isAbsolute } from 'node:path'
import type {
  EvaluationRequest,
  EvaluationSample,
  EvaluationReport,
  Metrics
} from '../../shared/contracts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function readPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    !isAbsolute(value)
  ) {
    throw new Error('절대 파일 경로를 선택하세요.')
  }
  return value
}

export function parseRequest(value: unknown): EvaluationRequest {
  if (!isRecord(value)) {
    throw new Error('평가 입력 형식이 올바르지 않습니다.')
  }
  return {
    pythonExecutable: readPath(value.pythonExecutable),
    ldbOcrSourcePath: readPath(value.ldbOcrSourcePath),
    runDirectory: readPath(value.runDirectory),
    checkpointPath: readPath(value.checkpointPath),
    datasetDirectory: readPath(value.datasetDirectory),
    labelsPath: readPath(value.labelsPath),
    outputDirectory: readPath(value.outputDirectory)
  }
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isSample(
  value: unknown,
  isImagePath: (path: string) => boolean = isAbsolute
): value is EvaluationSample {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.imagePath === 'string' &&
    isImagePath(value.imagePath) &&
    typeof value.truth === 'string' &&
    typeof value.prediction === 'string' &&
    isCount(value.editDistance) &&
    (value.confidence === null ||
      (typeof value.confidence === 'number' && Number.isFinite(value.confidence)))
  )
}

function isMetrics(value: unknown): value is Metrics {
  return (
    isRecord(value) &&
    typeof value.cer === 'number' &&
    Number.isFinite(value.cer) &&
    value.cer >= 0 &&
    typeof value.exactMatch === 'number' &&
    Number.isFinite(value.exactMatch) &&
    value.exactMatch >= 0 &&
    value.exactMatch <= 1 &&
    isCount(value.sampleCount) &&
    isCount(value.characterCount)
  )
}

export function isReport(
  value: unknown,
  isImagePath: (path: string) => boolean = isAbsolute
): value is EvaluationReport {
  if (
    !isRecord(value) ||
    !['completed', 'cancelled', 'failed'].includes(String(value.status)) ||
    !isCount(value.totalSamples) ||
    !isCount(value.processedSamples) ||
    value.processedSamples > value.totalSamples ||
    !Array.isArray(value.samples) ||
    !value.samples.every((sample) => isSample(sample, isImagePath)) ||
    value.samples.length !== value.processedSamples ||
    !(value.error === null || typeof value.error === 'string') ||
    typeof value.startedAt !== 'string' ||
    typeof value.finishedAt !== 'string'
  ) {
    return false
  }
  if (value.status === 'completed') {
    return (
      value.totalSamples > 0 &&
      value.processedSamples === value.totalSamples &&
      isMetrics(value.summary) &&
      value.summary.sampleCount === value.totalSamples &&
      value.error === null
    )
  }
  return value.summary === null && (value.partialSummary == null || isMetrics(value.partialSummary))
}
