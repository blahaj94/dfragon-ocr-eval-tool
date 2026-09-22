import { ipcMain, type BrowserWindow } from 'electron'
import type { Result } from '../shared/contracts'
import { DIAGNOSTIC_IPC } from '../shared/diagnostics'
import type { DiagnosticsRunner } from './diagnostics/runner'
import { requireSender } from './window-security'

export function registerDiagnosticsIpc(
  window: BrowserWindow,
  documentUrl: string,
  runner: DiagnosticsRunner
): void {
  function handle(channel: string, arity: number, handler: (...args: unknown[]) => unknown): void {
    ipcMain.handle(channel, async (event, ...args): Promise<Result<unknown>> => {
      try {
        requireSender(event, window, documentUrl)
        if (args.length !== arity) {
          throw new Error('요청 인자 수가 올바르지 않습니다.')
        }
        return { ok: true, value: await handler(...args) }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '샘플을 진단하지 못했습니다.'
        }
      }
    })
  }
  handle(DIAGNOSTIC_IPC.inspect, 3, (reportPath, sampleId, includeShapes) =>
    runner.start(reportPath, sampleId, includeShapes)
  )
  handle(DIAGNOSTIC_IPC.cancel, 0, () => {
    runner.cancel()
    return null
  })
  handle(DIAGNOSTIC_IPC.getSnapshot, 0, () => runner.getSnapshot())
}
