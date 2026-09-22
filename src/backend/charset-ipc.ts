import { ipcMain, type BrowserWindow } from 'electron'
import { CHARSET_IPC } from '../shared/charset'
import type { Result } from '../shared/contracts'
import type { CharsetService } from './charset/service'
import { requireSender } from './window-security'

export function registerCharsetIpc(
  window: BrowserWindow,
  documentUrl: string,
  service: CharsetService
): void {
  ipcMain.handle(CHARSET_IPC.inspect, async (event, ...args): Promise<Result<unknown>> => {
    try {
      requireSender(event, window, documentUrl)
      if (args.length !== 2) {
        throw new Error('문자 검사에는 학습 결과 폴더와 labels.json이 필요합니다.')
      }
      return { ok: true, value: await service.inspect(args[0], args[1]) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '문자 검사에 실패했습니다.'
      }
    }
  })
}
