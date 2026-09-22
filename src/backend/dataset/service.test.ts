import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetSample, DatasetSelection } from '../../shared/dataset'
import { DatasetService } from './service'

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: launch }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, rename: vi.fn(original.rename) }
})
const { spawn: spawnActual } =
  await vi.importActual<typeof import('node:child_process')>('node:child_process')

const EVENT_A = '20260922-120000-1234abcd'
const EVENT_B = '20260922-120001-1234abcd'

// A tiny real subprocess checks the transport and persistence orchestration only.
// Image/content checks are independently covered by the production Python checker tests.
const CHECKER_STUB = `
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const request = JSON.parse(readFileSync(0, 'utf8'))
const control = JSON.parse(readFileSync(join(dirname(process.argv[1]), 'control.json'), 'utf8'))
if (control.malformed) { process.stdout.write('not-json'); process.exit(0) }
const samples = structuredClone(request.record.samples)
for (const row of control.rows ?? []) {
  if (row.datasetDirectory !== request.selection.datasetDirectory) continue
  const index = samples.findIndex(sample => sample.key === row.key)
  if (index === -1) samples.push(row)
  else if (samples[index].confirmedAt === null) samples[index] = row
}
if (request.mode === 'check') {
  for (const sample of samples) {
    if (sample.confirmedAt === null && sample.datasetDirectory === request.selection.datasetDirectory && sample.eventId in request.assignments) {
      sample.split = request.assignments[sample.eventId]
    }
  }
}
if (control.mutateConfirmed) {
  const sample = samples.find(sample => sample.confirmedAt !== null)
  if (sample) sample.truth = 'changed'
}
const counts = { train: 0, val: 0, test: 0, unassigned: 0 }
for (const sample of samples) if (sample.datasetDirectory === request.selection.datasetDirectory) counts[sample.split ?? 'unassigned']++
const passed = control.passed !== false
const issues = passed ? [] : [{ severity: 'error', code: 'fixture-invalid', message: 'Invalid source fixture', images: [] }]
process.stdout.write(JSON.stringify({ passed, counts, issues, samples }))
process.exit(control.exitCode ?? 0)
`

describe('Dataset records and checker boundary', () => {
  let root: string
  let recordPath: string
  let checkerPath: string
  let selection: DatasetSelection
  let service: DatasetService
  let rows: DatasetSample[]

  function sample(directory: string, eventId: string, number: number): DatasetSample {
    const image = `${eventId}/${String(number).padStart(3, '0')}.png`
    return {
      key: createHash('sha256').update(`${directory}\0${image}`).digest('hex'),
      id: `${eventId}-${number}`,
      image,
      truth: `정답${number}`,
      datasetDirectory: directory,
      eventId,
      pixelHash: createHash('sha256').update(image).digest('hex'),
      originalHash: null,
      split: null,
      confirmedAt: null
    }
  }

  async function control(extra: Record<string, unknown> = {}): Promise<void> {
    await writeFile(join(root, 'control.json'), JSON.stringify({ rows, ...extra }))
  }

  async function confirmEvent(eventId = EVENT_A): Promise<void> {
    await service.assign([eventId], 'train')
    expect((await service.check()).canConfirm).toBe(true)
    await service.confirm()
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'dataset-service-')))
    const datasetDirectory = join(root, 'captures')
    await mkdir(datasetDirectory)
    const labelsPath = join(root, 'labels.json')
    await writeFile(labelsPath, '{}')
    recordPath = join(root, 'user-data', 'dataset-splits.json')
    checkerPath = join(root, 'checker.mjs')
    await writeFile(checkerPath, CHECKER_STUB)
    selection = { pythonExecutable: process.execPath, datasetDirectory, labelsPath }
    rows = [
      sample(datasetDirectory, EVENT_A, 1),
      sample(datasetDirectory, EVENT_A, 2),
      sample(datasetDirectory, EVENT_B, 1)
    ]
    await control()
    launch.mockImplementation(
      (_python: string, args: string[], options: Parameters<typeof spawnActual>[2]) =>
        spawnActual(process.execPath, [args[1]], options)
    )
    service = new DatasetService(recordPath, checkerPath)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(root, { recursive: true, force: true })
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('keeps event drafts in memory, invalidates checks, and restores only atomic confirmations', async () => {
    const loaded = await service.load(selection)
    expect(loaded.counts.unassigned).toBe(3)
    expect(loaded.groups.map((group) => group.imageCount)).toEqual([2, 1])
    const original = await readFile(recordPath, 'utf8')
    expect((await service.assign([EVENT_A], 'train')).counts).toEqual({
      train: 2,
      val: 0,
      test: 0,
      unassigned: 1
    })
    expect(await readFile(recordPath, 'utf8')).toBe(original)
    expect((await service.check()).canConfirm).toBe(true)
    expect((await service.assign([EVENT_B], 'val')).canConfirm).toBe(false)
    await expect(service.confirm()).rejects.toThrow('검사를 통과')
    await service.check()
    const confirmed = await service.confirm()
    expect(confirmed.counts).toEqual({ train: 2, val: 1, test: 0, unassigned: 0 })
    expect(confirmed.groups.every((group) => group.pendingCount === 0)).toBe(true)
    expect(launch.mock.calls[0][1]).toEqual(['-u', checkerPath])
    expect(launch.mock.calls[0][2].shell).toBe(false)
    const restored = await new DatasetService(recordPath, checkerPath).getSnapshot()
    expect(restored.counts).toEqual(confirmed.counts)
    expect(restored.check).toBeNull()
    expect(restored.selection?.datasetDirectory).toBe(selection.datasetDirectory)
  })

  it.runIf(process.platform !== 'win32')(
    'preserves a selected venv executable symlink when spawning the checker',
    async () => {
      const executable = join(root, 'venv-python')
      await symlink(process.execPath, executable)
      const snapshot = await service.load({ ...selection, pythonExecutable: executable })
      expect(launch.mock.calls[0][0]).toBe(executable)
      expect(snapshot.selection?.pythonExecutable).toBe(executable)
    }
  )

  it('freezes confirmed event fields and constrains later ROIs in the same event', async () => {
    await service.load(selection)
    await confirmEvent()
    const before = JSON.parse(await readFile(recordPath, 'utf8')).samples.filter(
      (row: DatasetSample) => row.confirmedAt !== null
    )
    rows.push(sample(selection.datasetDirectory, EVENT_A, 3))
    await control()
    const loaded = await service.load(selection)
    expect(loaded.groups[0]).toMatchObject({
      confirmedCount: 2,
      pendingCount: 1,
      confirmedSplit: 'train'
    })
    await expect(service.assign([EVENT_A], 'test')).rejects.toThrow('기존 확정 split')
    await confirmEvent()
    const after = JSON.parse(await readFile(recordPath, 'utf8')).samples
    expect(
      after.filter((row: DatasetSample) =>
        before.some((previous: DatasetSample) => previous.key === row.key)
      )
    ).toEqual(before)
    await expect(service.assign([EVENT_A], null)).rejects.toThrow('미확정 항목')
    await control({ mutateConfirmed: true })
    const saved = await readFile(recordPath, 'utf8')
    await expect(service.check()).rejects.toThrow('확정 항목을 변경')
    expect(await readFile(recordPath, 'utf8')).toBe(saved)
  })

  it('retains every root while displaying counts for the current capture root only', async () => {
    await service.load(selection)
    await confirmEvent()
    const oldSamples = JSON.parse(await readFile(recordPath, 'utf8')).samples
    const nextRoot = join(root, 'next-captures')
    await mkdir(nextRoot)
    rows = [sample(nextRoot, EVENT_B, 4)]
    await control()
    const loaded = await service.load({ ...selection, datasetDirectory: nextRoot })
    expect(loaded.counts).toEqual({ train: 0, val: 0, test: 0, unassigned: 1 })
    const saved = JSON.parse(await readFile(recordPath, 'utf8'))
    expect(saved.samples).toHaveLength(4)
    expect(
      saved.samples.filter(
        (row: DatasetSample) => row.datasetDirectory === selection.datasetDirectory
      )
    ).toEqual(oldSamples)
  })

  it('blocks corrupt records and external changes without resetting or overwriting them', async () => {
    await mkdir(join(root, 'user-data'))
    await writeFile(recordPath, '{damaged')
    await expect(service.getSnapshot()).rejects.toThrow()
    await expect(service.load(selection)).rejects.toThrow()
    expect(await readFile(recordPath, 'utf8')).toBe('{damaged')
    await rm(recordPath)
    await service.load(selection)
    const external = `${await readFile(recordPath, 'utf8')} `
    await writeFile(recordPath, external)
    await expect(service.assign([EVENT_A], 'train')).rejects.toThrow('외부에서 변경')
    expect(await readFile(recordPath, 'utf8')).toBe(external)
  })

  it('does not publish confirmations when atomic replacement fails', async () => {
    await service.load(selection)
    await service.assign([EVENT_A], 'train')
    await service.check()
    const before = await readFile(recordPath, 'utf8')
    vi.mocked(rename).mockRejectedValueOnce(new Error('fixture save failure'))
    await expect(service.confirm()).rejects.toThrow('fixture save failure')
    expect(await readFile(recordPath, 'utf8')).toBe(before)
    const snapshot = await service.getSnapshot()
    expect(snapshot.groups.every((group) => group.confirmedCount === 0)).toBe(true)
    expect(snapshot.canConfirm).toBe(false)
    await service.check()
    expect((await service.confirm()).groups[0].confirmedCount).toBe(2)
  })

  it('rechecks sources before confirming and requires reload after source or membership changes', async () => {
    await service.load(selection)
    await service.assign([EVENT_A], 'train')
    await service.check()
    const before = await readFile(recordPath, 'utf8')
    rows[0] = { ...rows[0], truth: 'changed truth' }
    await control()
    const rejected = await service.confirm()
    expect(rejected.check?.passed).toBe(false)
    expect(rejected.check?.issues.some((issue) => issue.code === 'source-changed')).toBe(true)
    expect(rejected.canConfirm).toBe(false)
    expect(await readFile(recordPath, 'utf8')).toBe(before)
    await service.load(selection)
    await service.assign([EVENT_A], 'train')
    await service.check()
    rows.push(sample(selection.datasetDirectory, EVENT_B, 2))
    await control()
    expect((await service.confirm()).check?.passed).toBe(false)
  })

  it.each([{ malformed: true }, { exitCode: 7 }, { passed: false }])(
    'never treats checker failure as a pass: %j',
    async (failure) => {
      await service.load(selection)
      await service.assign([EVENT_A], 'train')
      await service.check()
      await control(failure)
      if ('passed' in failure) {
        expect((await service.check()).check?.passed).toBe(false)
      } else {
        await expect(service.check()).rejects.toThrow()
      }
      expect((await service.getSnapshot()).canConfirm).toBe(false)
      await expect(service.confirm()).rejects.toThrow('검사를 통과')
    }
  )

  it('times out only its own checker and rejects overlapping work', async () => {
    await service.load(selection)
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn()
    })
    launch.mockReturnValueOnce(child)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = service.check()
    const rejection = expect(pending).rejects.toThrow('시간이 초과')
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(2))
    await expect(service.assign([EVENT_A], 'train')).rejects.toThrow('작업이 진행 중')
    await vi.advanceTimersByTimeAsync(120_000)
    await rejection
    expect(child.kill).toHaveBeenCalledOnce()
    vi.useRealTimers()
    expect((await service.getSnapshot()).canConfirm).toBe(false)
  })

  it('exports only confirmed rows into fresh directories and preserves originals and earlier exports', async () => {
    await service.load(selection)
    await confirmEvent()
    await service.assign([EVENT_B], 'test')
    const originalRecord = await readFile(recordPath, 'utf8')
    const originalLabels = await readFile(selection.labelsPath, 'utf8')
    await expect(service.export(selection.datasetDirectory)).rejects.toThrow('캡처 루트 밖')
    const first = (await service.export(root)).exportDirectory!
    const train = await readFile(join(first, 'train-labels.json'), 'utf8')
    expect(JSON.parse(train).samples).toEqual(
      rows.slice(0, 2).map(({ id, image, truth }) => ({ id, image, truth }))
    )
    expect(JSON.parse(await readFile(join(first, 'test-labels.json'), 'utf8')).samples).toEqual([])
    const second = (await service.export(root)).exportDirectory!
    expect(second).not.toBe(first)
    expect(await readFile(join(first, 'train-labels.json'), 'utf8')).toBe(train)
    expect(await readFile(recordPath, 'utf8')).toBe(originalRecord)
    expect(await readFile(selection.labelsPath, 'utf8')).toBe(originalLabels)
    await control({ passed: false })
    const rejected = await service.export(root)
    expect(rejected.check?.passed).toBe(false)
    expect(rejected.exportDirectory).toBeNull()
    expect(await readFile(join(first, 'train-labels.json'), 'utf8')).toBe(train)
    expect(await readFile(join(second, 'train-labels.json'), 'utf8')).toBe(train)
  })
})
