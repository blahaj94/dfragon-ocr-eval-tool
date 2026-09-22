import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { Result } from '../shared/contracts'
import { COMPARISON_IPC } from '../shared/comparison'
import type { ComparisonService } from './comparison/service'
import { requireSender } from './window-security'

export function registerComparisonIpc(
  window: BrowserWindow,
  documentUrl: string,
  service: ComparisonService
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
          error: error instanceof Error ? error.message : '보고서를 비교하지 못했습니다.'
        }
      }
    })
  }

  handle(COMPARISON_IPC.chooseReport, 0, async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '비교할 report.json 선택',
      properties: ['openFile'],
      filters: [{ name: 'OCR 평가 보고서', extensions: ['json'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle(COMPARISON_IPC.compare, 2, (a, b) => service.compare(a, b))
  handle(COMPARISON_IPC.readImage, 1, (path) => service.readImage(path))
}
