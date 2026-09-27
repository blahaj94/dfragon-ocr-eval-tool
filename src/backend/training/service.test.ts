import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LibraryClient, parseModel } from './library'
import { TrainingService } from './service'
import { ComparisonService } from '../comparison/service'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
const id = '00000000-0000-4000-8000-000000000001'
const checksum = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
let root: string
let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough }
let service: TrainingService
let library: LibraryClient
let model: ReturnType<typeof parseModel>
let rows: Record<string, unknown>[]
const options = () => ({
  pythonExecutable: join(root, 'python.exe'),
  upstreamDirectory: root,
  epochs: 1,
  batchSize: 2,
  learningRate: 0.00001
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ocr-training-service-'))
  await mkdir(join(root, 'images'))
  await mkdir(join(root, 'model'))
  const files = [
    ['weights.pdparams', 'synthetic weights'],
    ['characters.txt', '가\n나\n다\n']
  ]
  for (const [name, bytes] of files) {
    await writeFile(join(root, 'model', name), bytes)
  }
  model = parseModel({
    id,
    name: '합성 모델',
    kind: 'pretrained',
    preset: 'korean-ppocrv5',
    parentId: null,
    registeredAt: '2026-09-27T00:00:00Z',
    files: files.map(([name, value]) => ({
      name,
      bytes: Buffer.byteLength(value),
      sha256: checksum(value)
    }))
  })
  await writeFile(join(root, 'model/model.json'), JSON.stringify(model))
  rows = ['train', 'val', 'test'].map((split, index) => ({
    id: `${id}-${index + 1}`,
    captureId: id,
    slot: index + 1,
    image: `images/${id}-${index + 1}.png`,
    width: 4,
    height: 2,
    excluded: false,
    text: ['가', '나', '다'][index],
    split,
    sha256: checksum(`synthetic PNG ${index}`)
  }))
  for (const [index, row] of rows.entries()) {
    await writeFile(join(root, String(row.image)), `synthetic PNG ${index}`)
  }
  const dataset = JSON.stringify({
    schemaVersion: 1,
    exportedAt: '2026-09-27T00:00:00Z',
    modelId: id,
    counts: { train: 1, val: 1, test: 1, skipped: 0 },
    samples: rows
  })
  await writeFile(join(root, 'dataset.json'), dataset)
  await writeFile(join(root, 'ready.json'), JSON.stringify({ datasetSha256: checksum(dataset) }))
  child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough()
  })
  spawn.mockReturnValue(child)
  library = new LibraryClient(vi.fn())
  service = new TrainingService(
    library,
    join(root, 'training.py'),
    () => undefined,
    () => false
  )
  await service.open(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

async function completedRun(run: string) {
  await mkdir(run, { recursive: true })
  const sample = {
    id: rows[2].id,
    imagePath: join(root, String(rows[2].image)),
    truth: '다',
    prediction: '다',
    confidence: 0.9,
    editDistance: 0,
    imageSha256: rows[2].sha256
  }
  const summary = {
    cer: 0,
    exactMatch: 1,
    sampleCount: 1,
    characterCount: 1,
    exactMatchCount: 1,
    editDistance: 0
  }
  await writeFile(join(run, 'weights.pdparams'), 'trained weights')
  const datasetSha256 = checksum(await readFile(join(root, 'dataset.json')))
  const checkpointSha256 = checksum('trained weights')
  const report = {
    schemaVersion: 1,
    status: 'completed',
    totalSamples: 1,
    processedSamples: 1,
    samples: [sample],
    summary,
    error: null,
    startedAt: '2026-09-27T00:00:00Z',
    finishedAt: '2026-09-27T00:00:01Z',
    reproducibility: {
      normalization: 'none',
      settings: { datasetDirectory: root },
      datasetSha256,
      checkpointSha256,
      sourceSha256: {
        'recognition/metrics.py': 'a'.repeat(64),
        'recognition/distance.py': 'b'.repeat(64)
      }
    }
  }
  await writeFile(join(run, 'report.json'), JSON.stringify(report))
  await writeFile(
    join(run, 'evaluation.json'),
    JSON.stringify({
      schemaVersion: 1,
      sourceModelId: id,
      datasetSha256,
      checkpointSha256,
      summary
    })
  )
  return report
}

test('cancel during preparation prevents process spawn, and concurrent GPU work is rejected', async () => {
  const starting = service.start(options())
  await service.cancel()
  await starting
  expect(spawn).not.toHaveBeenCalled()
  expect(service.getSnapshot().status).toBe('cancelled')
  expect(service.isActive()).toBe(false)
  const busy = new TrainingService(
    library,
    'worker',
    () => undefined,
    () => true
  )
  await busy.open(root)
  await expect(busy.start(options())).rejects.toThrow('진행 중')
})

test('process exit without final event cannot publish a successful result', async () => {
  await service.start(options())
  await expect(service.start(options())).rejects.toThrow('진행 중')
  child.emit('close', 0)
  await vi.waitFor(() => expect(service.isActive()).toBe(false))
  expect(service.getSnapshot()).toMatchObject({ status: 'failed', metrics: null })
  await expect(service.publish('새 모델')).rejects.toThrow('완료된')
})

test('completed training can reopen after restart, compare reports and restrict images to unchanged test data', async () => {
  await service.start(options())
  const args: string[] = spawn.mock.calls[0][1]
  const run = dirname(args[args.indexOf('--request') + 1])
  const report = await completedRun(run)
  child.stdout.write(JSON.stringify({ type: 'sample', sample: report.samples[0] }) + '\n')
  child.stdout.write(
    JSON.stringify({ type: 'finished', reportPath: join(run, 'report.json') }) + '\n'
  )
  child.emit('close', 0)
  await vi.waitFor(() => expect(service.isActive()).toBe(false))
  expect(service.getSnapshot()).toMatchObject({ status: 'completed', metrics: report.summary })
  const reopened = new TrainingService(
    library,
    'worker',
    () => undefined,
    () => false
  )
  await reopened.open(run)
  expect(reopened.getSnapshot().samples).toEqual(report.samples)
  expect(await reopened.readImage(report.samples[0].imagePath)).toMatch(/^data:image\/png/)
  await expect(reopened.readImage(join(root, String(rows[0].image)))).rejects.toThrow()
  await expect(
    new ComparisonService().compare(join(run, 'report.json'), join(run, 'report.json'))
  ).resolves.toMatchObject({ counts: { 'both-correct': 1 } })
  await writeFile(report.samples[0].imagePath, 'changed')
  await expect(reopened.readImage(report.samples[0].imagePath)).rejects.toThrow('변경')
  await expect(reopened.open(run)).rejects.toThrow('다릅니다')
})

test('cancelled worker preserves cancellation and never accepts a final score', async () => {
  await service.start(options())
  await service.cancel()
  const args: string[] = spawn.mock.calls[0][1]
  expect(await readFile(args[args.indexOf('--cancel-file') + 1], 'utf8')).toBe('cancel')
  child.stdout.write('{"type":"cancelled"}\n')
  child.emit('close', 0)
  await vi.waitFor(() => expect(service.isActive()).toBe(false))
  expect(service.getSnapshot()).toMatchObject({ status: 'cancelled', metrics: null })
})

test('publication verifies bytes and reuses the same model ID after an ambiguous network failure', async () => {
  const run = join(root, 'runs', 'completed')
  await completedRun(run)
  const sent: string[] = []
  const request: typeof fetch = async (_url, init) => {
    const body = init!.body as FormData
    const metadata = JSON.parse(String(body.get('metadata')))
    sent.push(metadata.id)
    const files = await Promise.all(
      (body.getAll('files') as File[]).map(async (file) => ({
        name: file.name,
        bytes: file.size,
        sha256: checksum(Buffer.from(await file.arrayBuffer()))
      }))
    )
    expect(files.map((file) => file.name)).toEqual([
      'weights.pdparams',
      'characters.txt',
      'evaluation.json'
    ])
    if (sent.length === 1) {
      throw new Error('connection lost after commit')
    }
    return Response.json({
      model: { ...metadata, registeredAt: model.registeredAt, files },
      duplicate: true
    })
  }
  const client = new LibraryClient(request)
  await expect(
    client.publish(root, run, model, '학습 결과', new AbortController().signal)
  ).rejects.toThrow('connection lost')
  const registered = await client.publish(
    root,
    run,
    model,
    '학습 결과',
    new AbortController().signal
  )
  expect(registered.id).toBe(sent[0])
  expect(sent[1]).toBe(sent[0])
  await writeFile(join(run, 'weights.pdparams'), 'changed weights')
  await expect(
    client.publish(root, run, model, '학습 결과', new AbortController().signal)
  ).rejects.toThrow('다르거나')
  expect(sent).toHaveLength(2)
})
