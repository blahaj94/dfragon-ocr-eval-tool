import { ipcMain, type BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TRAINING_IPC } from '../shared/training'
import type { Result } from '../shared/contracts'
import type { TrainingService } from './training/service'
import type { LibrarySession } from './training/auth'
import type { EvaluationSettingsStore } from './evaluation/settings'
import { requireSender } from './window-security'
import { isRecord } from './evaluation/validation'

export function registerTrainingIpc(
  window: BrowserWindow,
  documentUrl: string,
  service: TrainingService,
  auth: LibrarySession,
  settings: EvaluationSettingsStore
): void {
  const actions: [string, number, (...args: unknown[]) => unknown][] = [
    [
      TRAINING_IPC.login,
      0,
      async () => {
        await auth.login(window)
        return null
      }
    ],
    [
      TRAINING_IPC.logout,
      0,
      async () => {
        if (service.isActive()) {
          throw new Error('진행 중인 자료실 작업이 끝난 뒤 로그아웃해 주세요.')
        }
        await auth.logout()
        return null
      }
    ],
    [TRAINING_IPC.supplementInfo, 0, () => service.supplementInfo()],
    [TRAINING_IPC.previewSupplement, 1, (options) => service.previewSupplement(options)],
    [TRAINING_IPC.models, 0, () => service.models()],
    [
      TRAINING_IPC.defaults,
      0,
      async () => {
        const { settings: saved } = await settings.get()
        let upstreamDirectory = ''
        if (saved.runDirectory) {
          try {
            const request: unknown = JSON.parse(
              await readFile(join(saved.runDirectory, 'request.json'), 'utf8')
            )
            if (isRecord(request) && typeof request.upstream === 'string') {
              upstreamDirectory = request.upstream
            }
          } catch {
            /* The user can select another runtime when a previous run is unavailable. */
          }
        }
        return {
          pythonExecutable: saved.pythonExecutable ?? '',
          upstreamDirectory,
          epochs: 10,
          batchSize: 8,
          learningRate: 0.00001
        }
      }
    ],
    [
      TRAINING_IPC.download,
      2,
      async (id, directory) => {
        await service.download(id, directory)
        return null
      }
    ],
    [
      TRAINING_IPC.open,
      1,
      async (directory) => {
        await service.open(directory)
        return null
      }
    ],
    [
      TRAINING_IPC.start,
      1,
      async (options) => {
        await service.start(options)
        return null
      }
    ],
    [
      TRAINING_IPC.cancel,
      0,
      async () => {
        await service.cancel()
        return null
      }
    ],
    [TRAINING_IPC.publish, 1, (name) => service.publish(name)],
    [TRAINING_IPC.readImage, 1, (path) => service.readImage(path)],
    [TRAINING_IPC.getSnapshot, 0, () => service.getSnapshot()]
  ]
  for (const [channel, count, action] of actions) {
    ipcMain.handle(channel, async (event, ...args): Promise<Result<unknown>> => {
      try {
        requireSender(event, window, documentUrl)
        if (args.length !== count) {
          throw new Error('학습 요청의 인자가 올바르지 않습니다.')
        }
        return { ok: true, value: await action(...args) }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '학습 요청을 처리하지 못했습니다.'
        }
      }
    })
  }
}
