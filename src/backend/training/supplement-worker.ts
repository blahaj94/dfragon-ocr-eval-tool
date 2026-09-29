import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { isRecord } from '../evaluation/validation'

export async function runSupplementWorker({
  python,
  worker,
  request,
  cancelFile,
  onChild,
  onMessage
}: {
  python: string
  worker: string
  request: string
  cancelFile: string
  onChild: (child: ChildProcess | null) => void
  onMessage: (message: string) => void
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      python,
      ['-B', '-u', worker, '--request', request, '--cancel-file', cancelFile],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }
      }
    )
    onChild(child)
    let terminal: 'finished' | 'cancelled' | null = null
    let failure: string | null = null
    let stderr = ''
    child.stderr!.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString('utf8')).slice(-4000)
    })
    const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity })
    lines.on('line', (line) => {
      try {
        if (line.length > 64 * 1024 || terminal !== null) {
          throw new Error('합성 프로세스 응답이 올바르지 않습니다.')
        }
        const event: unknown = JSON.parse(line)
        if (!isRecord(event)) {
          throw new Error('합성 프로세스 응답이 올바르지 않습니다.')
        }
        if (event.type === 'message' && typeof event.message === 'string') {
          onMessage(event.message)
        } else if (event.type === 'finished' || event.type === 'cancelled') {
          terminal = event.type
        } else if (event.type === 'error' && typeof event.message === 'string') {
          failure = event.message
        } else {
          throw new Error('합성 프로세스 응답이 올바르지 않습니다.')
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
        child.kill()
      }
    })
    child.once('error', (error) => {
      failure = error.message
    })
    child.once('close', (code) => {
      onChild(null)
      if (terminal === 'cancelled' && failure === null) {
        reject(new Error('합성 준비를 취소했습니다.'))
      } else if (failure !== null || code !== 0 || terminal !== 'finished') {
        reject(new Error(failure ?? (stderr || '합성 프로세스가 완료되지 않았습니다.')))
      } else {
        resolve()
      }
    })
  })
}
