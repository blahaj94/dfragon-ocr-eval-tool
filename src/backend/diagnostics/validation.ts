import type {
  DiagnosticResult,
  DiagnosticShapeRow,
  DiagnosticStage,
  ShapeMeasurement
} from '../../shared/diagnostics'
import { isRecord } from '../evaluation/validation'

const MAX_PREVIEW_BYTES = 16 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function text(value: unknown, maximum = 8000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error('진단 응답의 문자열이 올바르지 않습니다.')
  }
  return value
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function shape(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 8 ||
    !value.every(positiveInteger)
  ) {
    throw new Error('진단 응답의 tensor shape가 올바르지 않습니다.')
  }
  return value
}

function measurement(value: unknown): ShapeMeasurement {
  if (!isRecord(value)) {
    throw new Error('진단 shape 측정 응답이 올바르지 않습니다.')
  }
  if (value.shape === null) {
    return { shape: null, error: text(value.error) }
  }
  if (value.error !== null) {
    throw new Error('측정에 실패한 shape를 성공한 값으로 표시할 수 없습니다.')
  }
  return { shape: shape(value.shape), error: null }
}

function stage(value: unknown): DiagnosticStage {
  if (
    !isRecord(value) ||
    !positiveInteger(value.imageWidth) ||
    !positiveInteger(value.imageHeight) ||
    typeof value.minimum !== 'number' ||
    !Number.isFinite(value.minimum) ||
    typeof value.maximum !== 'number' ||
    !Number.isFinite(value.maximum) ||
    value.minimum > value.maximum
  ) {
    throw new Error('진단 이미지 크기 또는 tensor 값 범위가 올바르지 않습니다.')
  }
  const previewUrl = text(value.previewUrl, Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 + 32)
  const prefix = 'data:image/png;base64,'
  const encoded = previewUrl.slice(prefix.length)
  if (
    !previewUrl.startsWith(prefix) ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new Error('진단 미리보기는 PNG data URL이어야 합니다.')
  }
  const png = Buffer.from(encoded, 'base64')
  if (
    png.length < 24 ||
    png.length > MAX_PREVIEW_BYTES ||
    png.toString('base64') !== encoded ||
    !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
    png.toString('ascii', 12, 16) !== 'IHDR' ||
    png.readUInt32BE(16) !== value.imageWidth ||
    png.readUInt32BE(20) !== value.imageHeight
  ) {
    throw new Error('진단 PNG 미리보기의 실제 크기와 응답이 다릅니다.')
  }
  let contentBounds: DiagnosticStage['contentBounds'] = null
  if (value.contentBounds !== null) {
    const bounds = value.contentBounds
    if (
      !isRecord(bounds) ||
      typeof bounds.x !== 'number' ||
      !Number.isSafeInteger(bounds.x) ||
      bounds.x < 0 ||
      typeof bounds.y !== 'number' ||
      !Number.isSafeInteger(bounds.y) ||
      bounds.y < 0 ||
      !positiveInteger(bounds.width) ||
      !positiveInteger(bounds.height) ||
      bounds.x + bounds.width > value.imageWidth ||
      bounds.y + bounds.height > value.imageHeight
    ) {
      throw new Error('진단 이미지의 원본 영역이 미리보기 범위를 벗어납니다.')
    }
    contentBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  }
  return {
    id: text(value.id, 200),
    name: text(value.name),
    description: text(value.description),
    previewUrl,
    previewNote: text(value.previewNote),
    imageWidth: value.imageWidth,
    imageHeight: value.imageHeight,
    shape: shape(value.shape),
    dtype: text(value.dtype, 200),
    minimum: value.minimum,
    maximum: value.maximum,
    contentBounds
  }
}

export function parseDiagnosticResult(
  value: unknown,
  reportPath: string,
  sampleId: string,
  includeShapes: boolean
): DiagnosticResult {
  if (
    !isRecord(value) ||
    value.reportPath !== reportPath ||
    value.sampleId !== sampleId ||
    typeof value.inputFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.inputFingerprint) ||
    !Array.isArray(value.stages) ||
    value.stages.length === 0 ||
    value.stages.length > 8
  ) {
    throw new Error('진단 결과가 선택한 보고서·샘플과 다르거나 응답 형식이 올바르지 않습니다.')
  }
  const stages = value.stages.map(stage)
  if (new Set(stages.map((item) => item.id)).size !== stages.length) {
    throw new Error('진단 전처리 단계가 중복되었습니다.')
  }
  let shapes: DiagnosticShapeRow[] | null = null
  if (includeShapes) {
    const points = ['input', 'before-pooling', 'after-pooling'] as const
    if (!Array.isArray(value.shapes) || value.shapes.length !== points.length) {
      throw new Error('추가 진단에는 세 지점의 shape 측정 결과가 필요합니다.')
    }
    shapes = value.shapes.map((row) => {
      if (!isRecord(row) || !points.includes(row.point as (typeof points)[number])) {
        throw new Error('지원하지 않는 shape 측정 지점입니다.')
      }
      return {
        point: row.point as (typeof points)[number],
        label: text(row.label),
        train: measurement(row.train),
        evaluation: measurement(row.evaluation)
      }
    })
    if (new Set(shapes.map((row) => row.point)).size !== points.length) {
      throw new Error('shape 측정 지점이 중복되거나 빠져 있습니다.')
    }
  } else if (value.shapes !== null) {
    throw new Error('요청하지 않은 추가 shape 진단 응답입니다.')
  }
  return {
    reportPath,
    sampleId,
    poolingPolicy: text(value.poolingPolicy),
    inputFingerprint: value.inputFingerprint,
    stages,
    shapes
  }
}
