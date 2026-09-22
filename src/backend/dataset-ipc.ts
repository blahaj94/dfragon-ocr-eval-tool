import { ipcMain, type BrowserWindow } from 'electron'
import type { Result } from '../shared/contracts'
import { DATASET_IPC } from '../shared/dataset'
import type { DatasetService } from './dataset/service'
import { requireSender } from './window-security'

export function registerDatasetIpc(
  window: BrowserWindow,
  documentUrl: string,
  service: DatasetService
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
          error: error instanceof Error ? error.message : 'Dataset 요청을 처리하지 못했습니다.'
        }
      }
    })
  }

  handle(DATASET_IPC.getSnapshot, 0, () => service.getSnapshot())
  handle(DATASET_IPC.load, 1, (selection) => service.load(selection))
  handle(DATASET_IPC.assign, 2, (events, split) => service.assign(events, split))
  handle(DATASET_IPC.check, 0, () => service.check())
  handle(DATASET_IPC.confirm, 0, () => service.confirm())
  handle(DATASET_IPC.export, 1, (directory) => service.export(directory))
}
