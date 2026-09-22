import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import type { EvaluationSnapshot } from '../../shared/contracts'
import { isCount, isRecord, isReport, isSample, parseRequest, readPath } from './validation'

export function emptySnapshot(): EvaluationSnapshot {
  return {
    status: 'idle',
    totalSamples: 0,
    processedSamples: 0,
    samples: [],
    report: null,
    reportPath: null,
    error: null
  }
}

export function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

export class EvaluationRunner {
  private snapshot = emptySnapshot()
  private cancelFile: string | null = null
  private busy = false
  private cancelRequested = false
  private imagePaths = new Set<string>()
  private datasetRoot: string | null = null
  private outputRoot: string | null = null
  private pythonExecutable: string | null = null
  private reportSha256: string | null = null

  constructor(
    private readonly workerPath: string,
    private readonly publish: (snapshot: EvaluationSnapshot) => void,
    private readonly isDiagnosticActive: () => boolean = () => false
  ) {}

  getSnapshot(): EvaluationSnapshot {
    const snapshot = structuredClone(this.snapshot)
    // A final report can arrive before GPU teardown and temporary-file cleanup finish.
    if (this.busy && ['completed', 'cancelled', 'failed'].includes(snapshot.status)) {
      snapshot.status = this.cancelRequested ? 'cancelling' : 'running'
    }
    return snapshot
  }
  isActive(): boolean {
    return this.busy
  }

  getDiagnosticContext(
    reportInput: unknown,
    sampleInput: unknown
  ): { pythonExecutable: string; reportPath: string; reportSha256: string; sampleId: string } {
    if (this.busy) {
      throw new Error('평가가 끝난 뒤 샘플을 진단할 수 있습니다.')
    }
    const reportPath = readPath(reportInput)
    const report = this.snapshot.report
    const provenance =
      report == null ? null : (report as unknown as Record<string, unknown>).reproducibility
    if (
      report == null ||
      reportPath !== this.snapshot.reportPath ||
      this.pythonExecutable == null ||
      this.reportSha256 == null ||
      typeof sampleInput !== 'string' ||
      sampleInput.length === 0 ||
      report.samples.filter((sample) => sample.id === sampleInput).length !== 1 ||
      !isRecord(provenance) ||
      !isRecord(provenance.settings)
    ) {
      throw new Error(
        '현재 저장된 평가 보고서에 포함된 샘플과 실행 정보가 있어야 진단할 수 있습니다.'
      )
    }
    return {
      pythonExecutable: this.pythonExecutable,
      reportPath,
      reportSha256: this.reportSha256,
      sampleId: sampleInput
    }
  }

  private update(patch: Partial<EvaluationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.publish(this.getSnapshot())
  }

  async start(input: unknown): Promise<void> {
    if (this.busy) {
      throw new Error('이미 평가가 실행 중입니다.')
    }
    if (this.isDiagnosticActive()) {
      throw new Error('샘플 진단이 끝난 뒤 평가를 시작하세요.')
    }
    const request = parseRequest(input)
    this.busy = true
    this.cancelRequested = false
    this.cancelFile = null
    this.imagePaths.clear()
    this.datasetRoot = null
    this.outputRoot = null
    this.pythonExecutable = request.pythonExecutable
    this.reportSha256 = null
    this.snapshot = emptySnapshot()
    this.update({ status: 'starting' })
    let temporaryDirectory: string | null = null

    try {
      for (const path of [
        request.pythonExecutable,
        request.checkpointPath,
        request.labelsPath,
        this.workerPath
      ]) {
        if (!(await stat(path)).isFile()) {
          throw new Error(`파일이 아닙니다: ${path}`)
        }
      }
      for (const path of [
        request.ldbOcrSourcePath,
        request.runDirectory,
        request.datasetDirectory,
        request.outputDirectory
      ]) {
        if (!(await stat(path)).isDirectory()) {
          throw new Error(`폴더가 아닙니다: ${path}`)
        }
      }
      this.datasetRoot = await realpath(request.datasetDirectory)
      this.outputRoot = await realpath(request.outputDirectory)
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'ocr-evaluation-'))
      this.cancelFile = join(temporaryDirectory, 'cancel')
      const requestPath = join(temporaryDirectory, 'request.json')
      const { pythonExecutable, ...workerRequest } = request
      await writeFile(requestPath, JSON.stringify(workerRequest), { flag: 'wx', mode: 0o600 })
      if (this.cancelRequested) {
        this.signalCancellation()
      }
      const child = spawn(
        pythonExecutable,
        ['-u', this.workerPath, '--request', requestPath, '--cancel-file', this.cancelFile],
        {
          windowsHide: true,
          shell: false,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONIOENCODING: 'utf-8'
          },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      let stderr = ''
      let finished = false
      let protocolError: Error | null = null
      let pending = Promise.resolve()
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (text: string) => {
        stderr = (stderr + text).slice(-12000)
      })
      lines.on('line', (line) => {
        pending = pending.then(async () => {
          if (protocolError != null) {
            return
          }
          try {
            if (finished || line.length > 32 * 1024 * 1024) {
              throw new Error('평가 프로세스 응답 순서 또는 크기가 올바르지 않습니다.')
            }
            const event: unknown = JSON.parse(line)
            if (!isRecord(event)) {
              throw new Error('평가 프로세스 응답이 올바르지 않습니다.')
            }
            if (event.type === 'started' && isCount(event.totalSamples) && event.totalSamples > 0) {
              this.update({
                status: this.cancelRequested ? 'cancelling' : 'running',
                totalSamples: event.totalSamples
              })
            } else if (
              event.type === 'progress' &&
              isSample(event.sample) &&
              event.totalSamples === this.snapshot.totalSamples &&
              event.processedSamples === this.snapshot.processedSamples + 1 &&
              Number(event.processedSamples) <= this.snapshot.totalSamples
            ) {
              await this.allowImage(event.sample.imagePath)
              this.update({
                processedSamples: Number(event.processedSamples),
                samples: [...this.snapshot.samples, event.sample]
              })
            } else if (
              event.type === 'finished' &&
              typeof event.reportPath === 'string' &&
              isReport(event.report)
            ) {
              const reportPath = await realpath(event.reportPath)
              if (
                this.outputRoot == null ||
                !isInside(this.outputRoot, reportPath) ||
                basename(reportPath) !== 'report.json'
              ) {
                throw new Error('보고서 저장 경로가 올바르지 않습니다.')
              }
              const reportBytes = await readFile(reportPath)
              const saved: unknown = JSON.parse(reportBytes.toString('utf8'))
              if (!isReport(saved) || JSON.stringify(saved) !== JSON.stringify(event.report)) {
                throw new Error('저장된 보고서와 평가 응답이 일치하지 않습니다.')
              }
              for (const sample of saved.samples) {
                await this.allowImage(sample.imagePath)
              }
              this.reportSha256 = createHash('sha256').update(reportBytes).digest('hex')
              finished = true
              this.update({
                status: saved.status,
                totalSamples: saved.totalSamples,
                processedSamples: saved.processedSamples,
                samples: saved.samples,
                report: saved,
                reportPath,
                error: saved.error
              })
            } else if (event.type === 'error' && typeof event.message === 'string') {
              throw new Error(event.message)
            } else {
              throw new Error('평가 프로세스 응답 형식이 올바르지 않습니다.')
            }
          } catch (error) {
            protocolError = error instanceof Error ? error : new Error(String(error))
            this.cancelRequested = true
            try {
              this.signalCancellation()
            } catch (cancelError) {
              protocolError.message += `; 취소 전달 실패: ${String(cancelError)}`
            }
          }
        })
      })
      const ownedTemporaryDirectory = temporaryDirectory
      child.once('error', (error) => {
        protocolError = error
      })
      child.once('close', (code, signal) => {
        void pending
          .then(() => {
            if (
              protocolError != null ||
              !finished ||
              (code !== 0 && this.snapshot.status === 'completed')
            ) {
              const detail = protocolError?.message ?? stderr.trim() ?? ''
              this.update({
                status: 'failed',
                report: null,
                error: detail || `평가 프로세스가 보고서 없이 종료되었습니다 (${code ?? signal}).`
              })
            }
          })
          .catch((error: unknown) => {
            this.update({ status: 'failed', error: String(error), report: null })
          })
          .finally(() => this.releaseRun(ownedTemporaryDirectory))
      })
    } catch (error) {
      this.update({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
      await this.releaseRun(temporaryDirectory)
      throw error
    }
  }

  private async releaseRun(temporaryDirectory: string | null): Promise<void> {
    this.cancelFile = null
    try {
      if (temporaryDirectory != null) {
        await rm(temporaryDirectory, { recursive: true, force: true })
      }
    } catch (error) {
      // Cleanup must not invalidate the saved report or a subsequent evaluation.
      console.warn('평가 임시 폴더를 정리하지 못했습니다.', error)
    } finally {
      this.busy = false
      this.publish(this.getSnapshot())
    }
  }

  cancel(): void {
    if (!this.busy || ['completed', 'cancelled', 'failed'].includes(this.snapshot.status)) {
      return
    }
    try {
      this.signalCancellation()
    } catch (error) {
      const message = `취소 요청을 전달하지 못했습니다. 평가는 계속 실행 중입니다. 다시 시도하세요. ${error instanceof Error ? error.message : String(error)}`
      this.update({ error: message })
      throw new Error(message)
    }
    this.cancelRequested = true
    this.update({ status: 'cancelling', error: null })
  }

  private signalCancellation(): void {
    if (this.cancelFile != null) {
      writeFileSync(this.cancelFile, '', { flag: 'a', mode: 0o600 })
    }
  }

  private async allowImage(imagePath: string): Promise<void> {
    const canonical = await realpath(readPath(imagePath))
    if (
      this.datasetRoot == null ||
      !isInside(this.datasetRoot, canonical) ||
      extname(canonical).toLowerCase() !== '.png'
    ) {
      throw new Error('평가 이미지가 선택한 캡처 폴더 밖에 있습니다.')
    }
    this.imagePaths.add(canonical)
  }

  async readImage(input: unknown): Promise<string> {
    const canonical = await realpath(readPath(input))
    if (
      !this.imagePaths.has(canonical) ||
      this.datasetRoot == null ||
      !isInside(this.datasetRoot, canonical)
    ) {
      throw new Error('이번 평가에 포함된 이미지만 열 수 있습니다.')
    }
    const info = await stat(canonical)
    if (!info.isFile() || info.size > 16 * 1024 * 1024) {
      throw new Error('이미지 파일 크기가 올바르지 않습니다.')
    }
    const buffer = await readFile(canonical)
    if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('PNG 파일이 아닙니다.')
    }
    return `data:image/png;base64,${buffer.toString('base64')}`
  }
}
