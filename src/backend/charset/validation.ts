import { parseDocument } from 'yaml'
import { isRecord } from '../evaluation/validation'

export interface LabelRow {
  id: string
  image: string
  truth: string
}

export function parseJsonObject(text: string, name: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${name}: 올바른 JSON 파일이 아닙니다.`)
  }
  // JSON.parse keeps the last duplicate key. Reject ambiguous input, as read_object does.
  const document = parseDocument(text, { schema: 'json', uniqueKeys: true })
  if (document.errors.length > 0) {
    throw new Error(`${name}: 중복 키 또는 지원하지 않는 JSON 구조가 있습니다.`)
  }
  if (!isRecord(value)) {
    throw new Error(`${name}: JSON 객체여야 합니다.`)
  }
  return value
}

export function parseConfig(text: string): Record<string, unknown> {
  const document = parseDocument(text, { version: '1.1', uniqueKeys: true })
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new Error('config.yml: 중복 키가 있거나 올바른 YAML 파일이 아닙니다.')
  }
  let value: unknown
  try {
    value = document.toJS({ maxAliasCount: 100 })
  } catch {
    throw new Error('config.yml: YAML 참조 구조를 안전하게 읽을 수 없습니다.')
  }
  if (!isRecord(value)) {
    throw new Error('config.yml: YAML 객체여야 합니다.')
  }
  return value
}

export function parseLabels(text: string): LabelRow[] {
  const labels = parseJsonObject(text, 'labels.json')
  if (
    Object.keys(labels).length !== 2 ||
    labels.schemaVersion !== 1 ||
    !Array.isArray(labels.samples)
  ) {
    throw new Error('labels.json: schemaVersion 1과 samples 배열만 있는 형식이 필요합니다.')
  }
  const ids = new Set<string>()
  const images = new Set<string>()
  return labels.samples.map((value, index) => {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 3 ||
      !['id', 'image', 'truth'].every(
        (key) => typeof value[key] === 'string' && value[key].length > 0
      )
    ) {
      throw new Error(
        `labels.json: ${index + 1}번째 항목의 id, image, truth는 빈 문자열일 수 없습니다.`
      )
    }
    const { id, image, truth } = value as unknown as LabelRow
    if (!/^[0-9]{8}-[0-9]{6}-[a-f0-9]{8}\/[0-9]{3,}\.png$/.test(image)) {
      throw new Error(`labels.json: ${id}의 image는 <eventId>/<ROI 번호>.png 상대경로여야 합니다.`)
    }
    if (ids.has(id) || images.has(image)) {
      throw new Error('labels.json: 중복된 id 또는 image가 있습니다.')
    }
    ids.add(id)
    images.add(image)
    return { id, image, truth }
  })
}
