import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EvaluationRunner } from './runner'
import { isReport, parseRequest } from './validation'

const { spawn, removeDirectory } = vi.hoisted(() => ({
  spawn: vi.fn(),
  removeDirectory: vi.fn()
}))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, rm: removeDirectory }
})
const { rm: removeActualDirectory } =
  await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

describe('evaluation process boundary', () => {
  let root: string
  let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough }

  beforeEach(async () => {
    removeDirectory.mockImplementation(removeActualDirectory)
    root = await mkdtemp(join(tmpdir(), 'evaluation-test-'))
    await mkdir(join(root, 'dataset'))
    await mkdir(join(root, 'reports'))
    for (const name of ['python.exe', 'latest.pdparams', 'labels.json', 'worker.py']) {
      await writeFile(join(root, name), 'fixture')
    }
    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough()
    })
    spawn.mockReturnValue(child)
  })
  afterEach(async () => {
    await removeActualDirectory(root, { recursive: true, force: true })
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  function request() {
    return {
      pythonExecutable: join(root, 'python.exe'),
      ldbOcrSourcePath: root,
      runDirectory: root,
      checkpointPath: join(root, 'latest.pdparams'),
      datasetDirectory: join(root, 'dataset'),
      labelsPath: join(root, 'labels.json'),
      outputDirectory: join(root, 'reports')
    }
  }

  it('rejects a second run and delivers cancellation only to its own child', async () => {
    const runner = new EvaluationRunner(join(root, 'worker.py'), () => {})
    await runner.start(request())
    await expect(runner.start(request())).rejects.toThrow('이미 평가')
    runner.cancel()
    const args = spawn.mock.calls[0][1] as string[]
    expect(await readFile(args[args.indexOf('--cancel-file') + 1], 'utf8')).toBe('')
    expect(spawn.mock.calls[0][2].stdio[0]).toBe('ignore')
    expect(spawn.mock.calls[0][2].shell).toBe(false)
    child.emit('close', 0, null)
    await vi.waitFor(() => expect(runner.isActive()).toBe(false))
    expect(runner.getSnapshot().status).toBe('failed')
    expect(runner.getSnapshot().report).toBeNull()
  })

  it('keeps empty predictions and zero confidence and requires a matching saved report', async () => {
    const imagePath = join(root, 'dataset', '001.png')
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const runner = new EvaluationRunner(join(root, 'worker.py'), () => {})
    await runner.start(request())
    const sample = {
      id: 'roi',
      imagePath,
      truth: '가',
      prediction: '',
      editDistance: 1,
      confidence: 0
    }
    const report = {
      status: 'completed',
      totalSamples: 1,
      processedSamples: 1,
      samples: [sample],
      summary: { cer: 1, exactMatch: 0, sampleCount: 1, characterCount: 1 },
      error: null,
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:00:01Z'
    }
    const reportPath = join(root, 'reports', 'report.json')
    await writeFile(reportPath, JSON.stringify(report))
    child.stdout.write(JSON.stringify({ type: 'started', totalSamples: 1 }) + '\n')
    child.stdout.write(
      JSON.stringify({ type: 'progress', totalSamples: 1, processedSamples: 1, sample }) + '\n'
    )
    child.stdout.write(JSON.stringify({ type: 'finished', reportPath, report }) + '\n')
    child.emit('close', 0, null)
    await vi.waitFor(() => expect(runner.isActive()).toBe(false))
    expect(runner.getSnapshot().status).toBe('completed')
    expect(runner.getSnapshot().samples[0]).toEqual(sample)
    expect(await runner.readImage(imagePath)).toContain('data:image/png;base64,')
    await expect(runner.readImage(join(root, 'labels.json'))).rejects.toThrow('이번 평가')
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(report)
  })

  it('rejects an image outside the selected dataset', async () => {
    const runner = new EvaluationRunner(join(root, 'worker.py'), () => {})
    await runner.start(request())
    const outside = join(root, 'outside.png')
    await writeFile(outside, 'fixture')
    child.stdout.write('{"type":"started","totalSamples":1}\n')
    child.stdout.write(
      JSON.stringify({
        type: 'progress',
        totalSamples: 1,
        processedSamples: 1,
        sample: {
          id: 'outside',
          imagePath: outside,
          truth: '가',
          prediction: '',
          editDistance: 1,
          confidence: null
        }
      }) + '\n'
    )
    child.emit('close', 0, null)
    await vi.waitFor(() => expect(runner.isActive()).toBe(false))
    expect(runner.getSnapshot().status).toBe('failed')
    expect(runner.getSnapshot().samples).toEqual([])
  })

  it('keeps the run locked through cleanup failure and preserves its completed report', async () => {
    const imagePath = join(root, 'dataset', '001.png')
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const runner = new EvaluationRunner(join(root, 'worker.py'), () => {})
    await runner.start(request())
    const args = spawn.mock.calls[0][1] as string[]
    const temporaryDirectory = dirname(args[args.indexOf('--request') + 1])
    const report = {
      status: 'completed',
      totalSamples: 1,
      processedSamples: 1,
      samples: [
        { id: 'roi', imagePath, truth: '가', prediction: '가', editDistance: 0, confidence: null }
      ],
      summary: { cer: 0, exactMatch: 1, sampleCount: 1, characterCount: 1 },
      error: null,
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:00:01Z'
    }
    const reportPath = join(root, 'reports', 'report.json')
    await writeFile(reportPath, JSON.stringify(report))
    let rejectCleanup!: (error: Error) => void
    const cleanup = new Promise<void>((_resolve, reject) => {
      rejectCleanup = reject
    })
    removeDirectory.mockImplementationOnce(() => cleanup)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    child.stdout.write(JSON.stringify({ type: 'finished', reportPath, report }) + '\n')
    child.emit('close', 0, null)

    await vi.waitFor(() =>
      expect(removeDirectory).toHaveBeenCalledWith(temporaryDirectory, {
        recursive: true,
        force: true
      })
    )
    expect(runner.isActive()).toBe(true)
    await expect(runner.start(request())).rejects.toThrow('이미 평가')
    runner.cancel()
    expect(runner.getSnapshot().status).toBe('completed')
    rejectCleanup(new Error('fixture cleanup failure'))
    await vi.waitFor(() => expect(runner.isActive()).toBe(false))
    expect(runner.getSnapshot()).toMatchObject({
      status: 'completed',
      report,
      reportPath: await realpath(reportPath),
      error: null
    })
    expect(warning).toHaveBeenCalledWith('평가 임시 폴더를 정리하지 못했습니다.', expect.any(Error))
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(report)

    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough()
    })
    spawn.mockReturnValue(child)
    await runner.start(request())
    runner.cancel()
    const nextArgs = spawn.mock.calls[1][1] as string[]
    expect(await readFile(nextArgs[nextArgs.indexOf('--cancel-file') + 1], 'utf8')).toBe('')
    expect(runner.isActive()).toBe(true)
    child.emit('close', 0, null)
    await vi.waitFor(() => expect(runner.isActive()).toBe(false))
    await removeActualDirectory(temporaryDirectory, { recursive: true, force: true })
  })

  it('publishes cancellation-write failures while leaving the active worker usable for retry', async () => {
    const published = vi.fn()
    const runner = new EvaluationRunner(join(root, 'worker.py'), published)
    await runner.start(request())
    child.stdout.write('{"type":"started","totalSamples":1}\n')
    await vi.waitFor(() => expect(runner.getSnapshot().status).toBe('running'))
    const args = spawn.mock.calls[0][1] as string[]
    const cancelPath = args[args.indexOf('--cancel-file') + 1]
    // A directory at the marker path provokes a real filesystem write failure on every OS.
    await mkdir(cancelPath)
    expect(() => runner.cancel()).toThrow('취소 요청을 전달하지 못했습니다.')
    expect(runner.isActive()).toBe(true)
    expect(published).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'running',
        error: expect.stringContaining('평가는 계속 실행 중입니다.')
      })
    )
    await rm(cancelPath, { recursive: true, force: true })
    runner.cancel()
    expect(await readFile(cancelPath, 'utf8')).toBe('')
    expect(runner.getSnapshot()).toMatchObject({ status: 'cancelling', error: null })
    child.emit('close', 0, null)
    await vi.waitFor(() => expect(runner.isActive()).toBe(false))
  })

  it('validates runtime inputs and never accepts a partial report as completed', () => {
    expect(() => parseRequest({ ...request(), labelsPath: '../labels.json' })).toThrow('절대')
    expect(
      isReport({
        status: 'completed',
        totalSamples: 2,
        processedSamples: 1,
        samples: [],
        summary: null
      })
    ).toBe(false)
  })
})
