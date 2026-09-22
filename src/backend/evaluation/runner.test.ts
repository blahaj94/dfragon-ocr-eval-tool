import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EvaluationRunner } from './runner'
import { isReport, parseRequest } from './validation'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))

describe('evaluation process boundary', () => {
  let root: string
  let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough }

  beforeEach(async () => {
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
    await rm(root, { recursive: true, force: true })
    vi.clearAllMocks()
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
    expect(child.stdin.read().toString()).toBe('{"type":"cancel"}\n')
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
