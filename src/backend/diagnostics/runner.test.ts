import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticResult } from '../../shared/diagnostics'
import type { EvaluationRunner } from '../evaluation/runner'
import { DiagnosticsRunner } from './runner'
import { parseDiagnosticResult } from './validation'

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

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII='

describe('report-bound diagnostic process', () => {
  let root: string
  let reportPath: string
  let pythonExecutable: string
  let child: EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  let runner: DiagnosticsRunner
  let getDiagnosticContext: ReturnType<typeof vi.fn>
  let result: DiagnosticResult

  beforeEach(async () => {
    removeDirectory.mockImplementation(removeActualDirectory)
    root = await mkdtemp(join(tmpdir(), 'diagnostics-test-'))
    reportPath = join(root, 'report.json')
    pythonExecutable = join(root, 'original-python.exe')
    await Promise.all([
      writeFile(pythonExecutable, 'fixture'),
      writeFile(join(root, 'diagnostic_worker.py'), 'fixture'),
      writeFile(reportPath, 'unchanged original report')
    ])
    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true)
    })
    spawn.mockReturnValue(child)
    getDiagnosticContext = vi.fn(() => ({
      pythonExecutable,
      reportPath,
      reportSha256: 'a'.repeat(64),
      sampleId: 'roi'
    }))
    runner = new DiagnosticsRunner(
      join(root, 'diagnostic_worker.py'),
      { getDiagnosticContext } as unknown as EvaluationRunner,
      () => {}
    )
    result = {
      reportPath,
      sampleId: 'roi',
      poolingPolicy: 'adaptive40',
      inputFingerprint: 'b'.repeat(64),
      stages: [
        {
          id: 'original',
          name: 'Original',
          description: 'Original pixels',
          previewUrl: `data:image/png;base64,${PNG}`,
          previewNote: 'Original pixels',
          imageWidth: 1,
          imageHeight: 1,
          shape: [1, 1, 4],
          dtype: 'uint8',
          minimum: 0,
          maximum: 255,
          contentBounds: null
        }
      ],
      shapes: null
    }
  })

  afterEach(async () => {
    await removeActualDirectory(root, { recursive: true, force: true })
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  async function begin(
    includeShapes = false
  ): Promise<{ pending: Promise<DiagnosticResult>; requestPath: string }> {
    const pending = runner.start(reportPath, 'roi', includeShapes)
    // Attach a rejection handler immediately while inspecting the live child.
    void pending.catch(() => {})
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    return { pending, requestPath: spawn.mock.calls[0][1][3] }
  }

  function finish(value: DiagnosticResult = result, code = 0): void {
    child.stdout.write(`${JSON.stringify({ type: 'result', result: value })}\n`)
    child.emit('close', code, null)
  }

  it('uses only the original Python and hash-bound report request, leaving the report unchanged', async () => {
    const { pending, requestPath } = await begin()
    expect(getDiagnosticContext).toHaveBeenCalledWith(reportPath, 'roi')
    expect(spawn.mock.calls[0][0]).toBe(pythonExecutable)
    expect(spawn.mock.calls[0][2]).toMatchObject({
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    expect(JSON.parse(await readFile(requestPath, 'utf8'))).toEqual({
      reportPath,
      reportSha256: 'a'.repeat(64),
      sampleId: 'roi',
      includeShapes: false
    })
    child.stdout.write('{"type":"status","message":"기록된 입력 확인 중"}\n')
    expect(runner.getSnapshot()).toMatchObject({
      status: 'running',
      message: '기록된 입력 확인 중'
    })
    finish()
    await expect(pending).resolves.toEqual(result)
    expect(runner.isActive()).toBe(false)
    expect(runner.getSnapshot().status).toBe('idle')
    await expect(readFile(requestPath)).rejects.toHaveProperty('code', 'ENOENT')
    expect(await readFile(reportPath, 'utf8')).toBe('unchanged original report')
  })

  it('holds a synchronous single-job lock and cancels only its owned child until close', async () => {
    const { pending, requestPath } = await begin()
    await expect(runner.start(reportPath, 'roi', false)).rejects.toThrow('이미 샘플 진단')
    runner.cancel()
    expect(child.kill).toHaveBeenCalledOnce()
    expect(runner.isActive()).toBe(true)
    expect(runner.getSnapshot().status).toBe('cancelling')
    expect(await readFile(requestPath, 'utf8')).toContain('includeShapes')
    finish()
    await expect(pending).rejects.toThrow('취소했습니다')
    expect(runner.isActive()).toBe(false)
    await expect(readFile(requestPath)).rejects.toHaveProperty('code', 'ENOENT')
  })

  it('keeps cancellation failures recoverable', async () => {
    const { pending } = await begin()
    child.kill.mockReturnValueOnce(false)
    expect(() => runner.cancel()).toThrow('진단 취소에 실패')
    expect(runner.getSnapshot()).toMatchObject({
      status: 'running',
      message: expect.stringContaining('다시 시도')
    })
    runner.cancel()
    child.emit('close', null, 'SIGTERM')
    await expect(pending).rejects.toThrow('취소했습니다')
    expect(runner.isActive()).toBe(false)
  })

  it('rejects evaluation-active or unknown-report context before spawning', async () => {
    getDiagnosticContext.mockImplementation(() => {
      throw new Error('평가가 끝난 뒤 진단하세요.')
    })
    await expect(runner.start(reportPath, 'roi', false)).rejects.toThrow('평가가 끝난 뒤')
    expect(runner.isActive()).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
    await expect(runner.start(reportPath, 'roi', 'false')).rejects.toThrow('boolean')
  })

  it('retains the lock through cleanup and does not erase a valid result on cleanup failure', async () => {
    const { pending, requestPath } = await begin()
    let rejectCleanup!: (error: Error) => void
    removeDirectory.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCleanup = reject
        })
    )
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    finish()
    await vi.waitFor(() => expect(removeDirectory).toHaveBeenCalled())
    expect(runner.isActive()).toBe(true)
    await expect(runner.start(reportPath, 'roi', false)).rejects.toThrow('이미 샘플 진단')
    runner.cancel()
    expect(child.kill).not.toHaveBeenCalled()
    rejectCleanup(new Error('fixture cleanup failure'))
    await expect(pending).resolves.toEqual(result)
    expect(warning).toHaveBeenCalledWith('진단 임시 폴더를 정리하지 못했습니다.', expect.any(Error))
    expect(runner.isActive()).toBe(false)
    await removeActualDirectory(dirname(requestPath), { recursive: true, force: true })
  })

  it.each(['malformed', 'wrong-sample', 'duplicate-result', 'nonzero-exit', 'missing-result'])(
    'rejects %s without presenting success',
    async (mode) => {
      const { pending } = await begin()
      if (mode === 'malformed') {
        child.stdout.write('model log must not be on stdout\n')
        child.emit('close', 0, null)
      } else if (mode === 'wrong-sample') {
        finish({ ...result, sampleId: 'different' })
      } else if (mode === 'duplicate-result') {
        child.stdout.write(`${JSON.stringify({ type: 'result', result })}\n`)
        finish()
      } else if (mode === 'nonzero-exit') {
        finish(result, 1)
      } else {
        child.emit('close', 0, null)
      }
      await expect(pending).rejects.toThrow()
      expect(runner.isActive()).toBe(false)
    }
  )

  it('preserves unavailable shape measurements as errors instead of fabricating values', async () => {
    result.shapes = ['input', 'before-pooling', 'after-pooling'].map((point) => ({
      point: point as 'input' | 'before-pooling' | 'after-pooling',
      label: point,
      train: { shape: null, error: 'Hook unavailable' },
      evaluation: { shape: [1, 1, 48, 384], error: null }
    }))
    const { pending } = await begin(true)
    finish()
    await expect(pending).resolves.toMatchObject({ shapes: result.shapes })
  })

  it('validates stage ranges, preview dimensions, content bounds and measured shape points', () => {
    const invalid: DiagnosticResult[] = [
      { ...result, reportPath: join(root, 'other-report.json') },
      { ...result, inputFingerprint: '' },
      { ...result, stages: [{ ...result.stages[0], minimum: Number.NaN }] },
      { ...result, stages: [{ ...result.stages[0], imageWidth: 2 }] },
      { ...result, stages: [{ ...result.stages[0], previewUrl: 'file:///private/image.png' }] },
      { ...result, stages: [{ ...result.stages[0], shape: [1, -1] }] },
      {
        ...result,
        stages: [{ ...result.stages[0], contentBounds: { x: 1, y: 0, width: 1, height: 1 } }]
      }
    ]
    for (const value of invalid) {
      expect(() => parseDiagnosticResult(value, reportPath, 'roi', false)).toThrow()
    }
    expect(() => parseDiagnosticResult(result, reportPath, 'roi', true)).toThrow('세 지점')
    result.shapes = Array.from({ length: 3 }, () => ({
      point: 'input',
      label: 'input',
      train: { shape: [1], error: null },
      evaluation: { shape: [1], error: null }
    }))
    expect(() => parseDiagnosticResult(result, reportPath, 'roi', true)).toThrow('중복')
    result.shapes[0].train = { shape: [1], error: 'unavailable' }
    expect(() => parseDiagnosticResult(result, reportPath, 'roi', true)).toThrow('실패한 shape')
  })
})
