import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import type { DiagnosticResult, DiagnosticSnapshot } from '../../shared/diagnostics'
import type { EvaluationRunner } from '../evaluation/runner'
import { isRecord } from '../evaluation/validation'
import { parseDiagnosticResult } from './validation'

type DiagnosticChild = ChildProcessByStdio<null, Readable, Readable>
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

function idleSnapshot(): DiagnosticSnapshot {
  return { status: 'idle', reportPath: null, sampleId: null, message: null }
}

export class DiagnosticsRunner {
  private snapshot = idleSnapshot()
  private child: DiagnosticChild | null = null
  private busy = false
  private finishing = false
  private cancelRequested = false

  constructor(
    private readonly workerPath: string,
    private readonly evaluation: EvaluationRunner,
    private readonly publish: (snapshot: DiagnosticSnapshot) => void
  ) {}

  isActive(): boolean {
    return this.busy
  }

  getSnapshot(): DiagnosticSnapshot {
    return structuredClone(this.snapshot)
  }

  private update(patch: Partial<DiagnosticSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.publish(this.getSnapshot())
  }

  async start(
    reportPath: unknown,
    sampleId: unknown,
    includeShapes: unknown
  ): Promise<DiagnosticResult> {
    if (this.busy) {
      throw new Error('이미 샘플 진단이 진행 중입니다.')
    }
    if (typeof includeShapes !== 'boolean') {
      throw new Error('추가 shape 진단 여부는 boolean이어야 합니다.')
    }
    // Reserve the GPU before the first await; EvaluationRunner checks this same active flag.
    this.busy = true
    this.finishing = false
    this.cancelRequested = false
    let temporaryDirectory: string | null = null
    try {
      const context = this.evaluation.getDiagnosticContext(reportPath, sampleId)
      this.update({
        status: 'running',
        reportPath: context.reportPath,
        sampleId: context.sampleId,
        message: '저장된 실행 정보로 샘플 진단을 준비합니다.'
      })
      for (const path of [this.workerPath, context.pythonExecutable]) {
        if (!(await stat(path)).isFile()) {
          throw new Error(`진단에 필요한 파일이 없습니다: ${path}`)
        }
      }
      if (this.cancelRequested) {
        throw new Error('샘플 진단을 취소했습니다.')
      }
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'ocr-diagnostic-'))
      const requestPath = join(temporaryDirectory, 'request.json')
      await writeFile(
        requestPath,
        JSON.stringify({
          reportPath: context.reportPath,
          reportSha256: context.reportSha256,
          sampleId: context.sampleId,
          includeShapes
        }),
        { flag: 'wx', mode: 0o600 }
      )
      if (this.cancelRequested) {
        throw new Error('샘플 진단을 취소했습니다.')
      }
      return await this.runChild(
        context.pythonExecutable,
        requestPath,
        context.reportPath,
        context.sampleId,
        includeShapes
      )
    } finally {
      this.finishing = true
      this.child = null
      try {
        if (temporaryDirectory !== null) {
          await rm(temporaryDirectory, { recursive: true, force: true })
        }
      } catch (error) {
        console.warn('진단 임시 폴더를 정리하지 못했습니다.', error)
      } finally {
        this.busy = false
        this.snapshot = idleSnapshot()
        this.publish(this.getSnapshot())
      }
    }
  }

  cancel(): void {
    if (!this.busy || this.finishing || this.cancelRequested) {
      return
    }
    try {
      if (this.child !== null && !this.child.kill()) {
        throw new Error('진단 프로세스에 종료 요청을 전달하지 못했습니다.')
      }
    } catch (error) {
      const message = `진단 취소에 실패했습니다. 다시 시도하세요. ${error instanceof Error ? error.message : String(error)}`
      this.update({ message })
      throw new Error(message)
    }
    this.cancelRequested = true
    this.update({ status: 'cancelling', message: '샘플 진단을 취소합니다.' })
  }

  private runChild(
    pythonExecutable: string,
    requestPath: string,
    reportPath: string,
    sampleId: string,
    includeShapes: boolean
  ): Promise<DiagnosticResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable, ['-u', this.workerPath, '--request', requestPath], {
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONIOENCODING: 'utf-8'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.child = child
      let buffered = ''
      let receivedBytes = 0
      let stderr = ''
      let result: DiagnosticResult | null = null
      let failure: Error | null = null
      const fail = (error: unknown): void => {
        failure ??= error instanceof Error ? error : new Error(String(error))
        try {
          child.kill()
        } catch (killError) {
          this.update({
            message: `진단 응답 오류 후 종료 요청에 실패했습니다. ${String(killError)}`
          })
        }
      }
      const processLine = (line: string): void => {
        if (failure !== null || this.cancelRequested) {
          return
        }
        try {
          const event: unknown = JSON.parse(line)
          if (!isRecord(event) || result !== null) {
            throw new Error('진단 응답 형식 또는 순서가 올바르지 않습니다.')
          }
          if (
            event.type === 'status' &&
            typeof event.message === 'string' &&
            event.message.length > 0 &&
            event.message.length <= 8000
          ) {
            this.update({ message: event.message })
          } else if (event.type === 'result') {
            result = parseDiagnosticResult(event.result, reportPath, sampleId, includeShapes)
          } else if (event.type === 'error' && typeof event.message === 'string') {
            throw new Error(event.message.slice(0, 12000))
          } else {
            throw new Error('지원하지 않는 진단 프로세스 응답입니다.')
          }
        } catch (error) {
          fail(error)
        }
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (text: string) => {
        stderr = (stderr + text).slice(-12000)
      })
      child.stdout.on('data', (text: string) => {
        receivedBytes += Buffer.byteLength(text)
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          fail(new Error('진단 응답이 허용 크기를 초과했습니다.'))
          return
        }
        buffered += text
        let newline: number
        while ((newline = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, newline)
          buffered = buffered.slice(newline + 1)
          processLine(line)
        }
      })
      child.once('error', (error) => {
        failure = error
      })
      child.once('close', (code, signal) => {
        if (buffered.length > 0) {
          processLine(buffered)
        }
        if (this.cancelRequested) {
          reject(new Error('샘플 진단을 취소했습니다.'))
        } else if (failure !== null || code !== 0 || result === null) {
          reject(
            failure ??
              new Error(
                stderr.trim() || `진단 프로세스가 결과 없이 종료되었습니다 (${code ?? signal}).`
              )
          )
        } else {
          resolve(result)
        }
      })
    })
  }
}
