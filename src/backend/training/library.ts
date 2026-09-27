import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryModel, LibrarySample } from '../../shared/training'
import { isRecord, isReport } from '../evaluation/validation'

export const LIBRARY_ORIGIN = 'https://ocr.dfragon.com'
export const PADDLEOCR_REVISION = 'b03f46425e8ff4442b268ce449e3eef758146cd4'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const sha = /^[0-9a-f]{64}$/
const fileNames = new Set(['weights.pdparams', 'characters.txt', 'evaluation.json'])

export function parseModel(value: unknown): LibraryModel {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !uuid.test(value.id) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 100 ||
    value.preset !== 'korean-ppocrv5' ||
    !['pretrained', 'finetuned'].includes(String(value.kind)) ||
    !(
      value.parentId === null ||
      (typeof value.parentId === 'string' && uuid.test(value.parentId))
    ) ||
    typeof value.registeredAt !== 'string' ||
    !Number.isFinite(Date.parse(value.registeredAt)) ||
    !Array.isArray(value.files) ||
    value.files.length < 2 ||
    value.files.length > 3
  ) {
    throw new Error('자료실 모델 목록 형식이 올바르지 않습니다.')
  }
  const names = new Set<string>()
  let total = 0
  for (const file of value.files) {
    if (
      !isRecord(file) ||
      typeof file.name !== 'string' ||
      !fileNames.has(file.name) ||
      names.has(file.name) ||
      typeof file.bytes !== 'number' ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 1 ||
      file.bytes > 128 * 1024 * 1024 ||
      (file.name !== 'weights.pdparams' && file.bytes > 1024 * 1024) ||
      typeof file.sha256 !== 'string' ||
      !sha.test(file.sha256)
    ) {
      throw new Error('모델 파일의 크기·이름·해시가 올바르지 않습니다.')
    }
    names.add(file.name)
    total += file.bytes
  }
  if (!names.has('weights.pdparams') || !names.has('characters.txt') || total > 128 * 1024 * 1024) {
    throw new Error('모델에 필요한 파일이 없거나 너무 큽니다.')
  }
  return value as unknown as LibraryModel
}

export function parseDataset(value: unknown): { exportedAt: string; samples: LibrarySample[] } {
  if (
    !isRecord(value) ||
    typeof value.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    !Array.isArray(value.samples) ||
    value.samples.length > 100_000
  ) {
    throw new Error('자료실 데이터 목록 형식이 올바르지 않습니다.')
  }
  const ids = new Set<string>()
  const samples: LibrarySample[] = []
  for (const row of value.samples) {
    if (
      !isRecord(row) ||
      typeof row.captureId !== 'string' ||
      !uuid.test(row.captureId) ||
      typeof row.slot !== 'number' ||
      !Number.isInteger(row.slot) ||
      row.slot < 1 ||
      row.slot > 12 ||
      row.id !== `${row.captureId}-${row.slot}` ||
      ids.has(String(row.id)) ||
      typeof row.width !== 'number' ||
      !Number.isInteger(row.width) ||
      row.width < 1 ||
      row.width > 8192 ||
      typeof row.height !== 'number' ||
      !Number.isInteger(row.height) ||
      row.height < 1 ||
      row.height > 8192 ||
      !(
        row.text === null ||
        (typeof row.text === 'string' && row.text.length > 0 && row.text.length <= 100)
      ) ||
      typeof row.excluded !== 'boolean' ||
      !['train', 'val', 'test', 'unassigned'].includes(String(row.split))
    ) {
      throw new Error('자료실 샘플의 식별자·정답·분할·크기를 확인해 주세요.')
    }
    ids.add(String(row.id))
    samples.push({
      id: String(row.id),
      captureId: row.captureId,
      slot: row.slot,
      width: row.width,
      height: row.height,
      text: row.text,
      excluded: row.excluded,
      split: row.split as LibrarySample['split']
    })
  }
  return { exportedAt: value.exportedAt, samples }
}

export async function readResponse(
  response: Response,
  limit: number,
  signal: AbortSignal
): Promise<Buffer> {
  if (!response.ok || response.body === null) {
    await response.body?.cancel()
    if (response.status === 401) {
      throw new Error('자료실 로그인이 필요합니다.')
    }
    if (response.status === 404) {
      throw new Error('자료실 API가 없습니다. 모델 보관 기능의 서버 배포를 확인해 주세요.')
    }
    throw new Error(`자료실 요청에 실패했습니다. (HTTP ${response.status})`)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      length += value.length
      if (length > limit) {
        throw new Error('자료실 응답이 허용 크기를 넘었습니다.')
      }
      chunks.push(value)
    }
    signal.throwIfAborted()
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export class LibraryClient {
  constructor(private readonly request: typeof fetch) {}

  async bytes(path: string, limit: number, signal: AbortSignal): Promise<Buffer> {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    const response = await this.request(`${LIBRARY_ORIGIN}${path}`, {
      credentials: 'include',
      redirect: 'error',
      cache: 'no-store',
      signal: timeout
    })
    return readResponse(response, limit, timeout)
  }

  async models(signal: AbortSignal): Promise<LibraryModel[]> {
    const value: unknown = JSON.parse(
      (await this.bytes('/api/models', 4 * 1024 * 1024, signal)).toString('utf8')
    )
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.models)) {
      throw new Error('모델 목록이 올바르지 않습니다.')
    }
    const models = value.models.map(parseModel)
    if (new Set(models.map((model) => model.id)).size !== models.length) {
      throw new Error('중복된 모델 ID가 있습니다.')
    }
    return models
  }

  async download(
    id: string,
    parent: string,
    signal: AbortSignal,
    progress: (message: string) => void
  ) {
    if (!uuid.test(id)) {
      throw new Error('모델 ID가 올바르지 않습니다.')
    }
    const model = parseModel(
      JSON.parse((await this.bytes(`/api/models/${id}`, 32768, signal)).toString('utf8'))
    )
    if (model.id !== id) {
      throw new Error('요청한 모델과 응답이 다릅니다.')
    }
    const raw = await this.bytes('/api/export/manifest', 64 * 1024 * 1024, signal)
    const dataset = parseDataset(JSON.parse(raw.toString('utf8')))
    const selected = dataset.samples.filter(
      (row) => row.text !== null && !row.excluded && row.split !== 'unassigned'
    )
    const counts = { train: 0, val: 0, test: 0, skipped: dataset.samples.length - selected.length }
    for (const row of selected) {
      counts[row.split as 'train' | 'val' | 'test']++
    }
    if (!counts.train || !counts.val || !counts.test) {
      throw new Error('train·val·test에 정답이 있는 미제외 샘플이 각각 필요합니다.')
    }
    const folder = join(parent, `experiment-${randomUUID()}`)
    await mkdir(join(folder, 'images'), { recursive: true })
    await mkdir(join(folder, 'model'))
    await writeFile(join(folder, 'incomplete.json'), JSON.stringify({ status: 'downloading' }), {
      flag: 'wx'
    })
    await writeFile(join(folder, 'source-manifest.json'), raw, { flag: 'wx' })
    for (const file of model.files) {
      progress(`모델 다운로드: ${file.name}`)
      const bytes = await this.bytes(`/api/models/${id}/files/${file.name}`, file.bytes, signal)
      if (
        bytes.length !== file.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== file.sha256
      ) {
        throw new Error('내려받은 모델 파일의 해시가 다릅니다.')
      }
      await writeFile(join(folder, 'model', file.name), bytes, { flag: 'wx' })
    }
    await writeFile(join(folder, 'model', 'model.json'), JSON.stringify(model, null, 2), {
      flag: 'wx'
    })
    const samples = []
    for (const row of selected) {
      progress(`크롭 다운로드: ${samples.length + 1} / ${selected.length}`)
      const bytes = await this.bytes(`/api/samples/${row.id}/image`, 16 * 1024 * 1024, signal)
      if (
        bytes.length < 24 ||
        bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.readUInt32BE(16) !== row.width ||
        bytes.readUInt32BE(20) !== row.height
      ) {
        throw new Error('크롭 PNG의 크기와 자료실 기록이 다릅니다.')
      }
      const image = `images/${row.id}.png`
      await writeFile(join(folder, image), bytes, { flag: 'wx' })
      samples.push({ ...row, image, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    signal.throwIfAborted()
    const snapshot = {
      schemaVersion: 1,
      exportedAt: dataset.exportedAt,
      modelId: id,
      counts,
      samples
    }
    const metadata = JSON.stringify(snapshot, null, 2)
    await writeFile(join(folder, 'dataset.json'), metadata, { flag: 'wx' })
    await writeFile(
      join(folder, 'incomplete.json'),
      JSON.stringify({ datasetSha256: createHash('sha256').update(metadata).digest('hex') })
    )
    await rename(join(folder, 'incomplete.json'), join(folder, 'ready.json'))
    return { folder, model, counts }
  }

  async publish(
    directory: string,
    runDirectory: string,
    model: LibraryModel,
    name: string,
    signal: AbortSignal
  ): Promise<LibraryModel> {
    if (!name.trim() || name.length > 100) {
      throw new Error('모델 이름을 1~100자로 입력해 주세요.')
    }
    const metadataFile = join(runDirectory, 'publish.json')
    let metadata: { id: string; name: string; preset: string; kind: string; parentId: string }
    try {
      metadata = JSON.parse(await readFile(metadataFile, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      metadata = {
        id: randomUUID(),
        name,
        preset: model.preset,
        kind: 'finetuned',
        parentId: model.id
      }
      await writeFile(metadataFile, JSON.stringify(metadata), { flag: 'wx' })
    }
    if (
      !isRecord(metadata) ||
      !uuid.test(metadata.id) ||
      metadata.parentId !== model.id ||
      metadata.preset !== model.preset ||
      metadata.kind !== 'finetuned' ||
      typeof metadata.name !== 'string' ||
      !metadata.name.trim() ||
      metadata.name.length > 100
    ) {
      throw new Error('저장된 모델 등록 정보가 올바르지 않습니다.')
    }
    if (metadata.name !== name) {
      throw new Error(`등록 재시도에는 처음 입력한 이름 “${metadata.name}”을 사용해 주세요.`)
    }
    const report: unknown = JSON.parse(await readFile(join(runDirectory, 'report.json'), 'utf8'))
    const provenance = isRecord(report) ? report.reproducibility : null
    const evaluationBytes = await readFile(join(runDirectory, 'evaluation.json'))
    const evaluation: unknown = JSON.parse(evaluationBytes.toString('utf8'))
    const checkpoint = await readFile(join(runDirectory, 'weights.pdparams'))
    const dictionary = await readFile(join(directory, 'model/characters.txt'))
    const checksum = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
    if (
      !isReport(report) ||
      report.status !== 'completed' ||
      !isRecord(provenance) ||
      !isRecord(evaluation) ||
      evaluation.schemaVersion !== 1 ||
      evaluation.sourceModelId !== model.id ||
      evaluation.checkpointSha256 !== checksum(checkpoint) ||
      evaluation.checkpointSha256 !== provenance.checkpointSha256 ||
      evaluation.datasetSha256 !== checksum(await readFile(join(directory, 'dataset.json'))) ||
      evaluation.datasetSha256 !== provenance.datasetSha256 ||
      JSON.stringify(evaluation.summary) !== JSON.stringify(report.summary) ||
      checksum(dictionary) !== model.files.find((file) => file.name === 'characters.txt')?.sha256 ||
      evaluationBytes.length > 1024 * 1024 ||
      checkpoint.length + dictionary.length + evaluationBytes.length > 128 * 1024 * 1024
    ) {
      throw new Error('완료된 평가 결과와 모델 파일이 다르거나 등록 크기를 넘었습니다.')
    }
    const body = new FormData()
    body.set('metadata', JSON.stringify(metadata))
    const files: [string, Buffer][] = [
      ['weights.pdparams', checkpoint],
      ['characters.txt', dictionary],
      ['evaluation.json', evaluationBytes]
    ]
    for (const [filename, bytes] of files) {
      body.append('files', new Blob([new Uint8Array(bytes)]), filename)
    }
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(180_000)])
    const response = await this.request(`${LIBRARY_ORIGIN}/api/models`, {
      method: 'POST',
      body,
      credentials: 'include',
      redirect: 'error',
      signal: timeout,
      headers: { Origin: LIBRARY_ORIGIN }
    })
    const result: unknown = JSON.parse(
      (await readResponse(response, 32768, timeout)).toString('utf8')
    )
    if (!isRecord(result)) {
      throw new Error('모델 등록 응답이 올바르지 않습니다.')
    }
    const registered = parseModel(result.model)
    if (
      registered.id !== metadata.id ||
      registered.parentId !== metadata.parentId ||
      registered.name !== metadata.name ||
      registered.kind !== 'finetuned' ||
      registered.files.length !== files.length ||
      files.some(([name, bytes]) => {
        const file = registered.files.find((item) => item.name === name)
        return file?.bytes !== bytes.length || file.sha256 !== checksum(bytes)
      })
    ) {
      throw new Error('등록 응답의 모델 정보가 보낸 파일과 다릅니다. 같은 ID로 다시 확인해 주세요.')
    }
    return registered
  }
}
