import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC, type PathKind, type Result } from '../shared/contracts'
import { EvaluationRunner } from './evaluation/runner'
import { readPath } from './evaluation/validation'
import { requireSender } from './window-security'

const pathKinds: readonly PathKind[] = ['python', 'source', 'run', 'dataset', 'labels', 'output']

export function registerEvaluationIpc(
  window: BrowserWindow,
  documentUrl: string,
  runner: EvaluationRunner
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
          error: error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'
        }
      }
    })
  }

  handle(IPC.choosePath, 1, async (kind) => {
    if (!pathKinds.includes(kind as PathKind)) {
      throw new Error('선택 항목이 올바르지 않습니다.')
    }
    const file = kind === 'python' || kind === 'labels'
    const result = await dialog.showOpenDialog(window, {
      title:
        kind === 'python'
          ? '기존 GPU Python 실행 파일 선택'
          : kind === 'labels'
            ? 'labels.json 선택'
            : '폴더 선택',
      properties: file ? ['openFile'] : ['openDirectory'],
      ...(kind === 'labels' ? { filters: [{ name: 'JSON', extensions: ['json'] }] } : {}),
      ...(kind === 'python' && process.platform === 'win32'
        ? { filters: [{ name: 'Python', extensions: ['exe'] }] }
        : {})
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle(IPC.inspectRun, 1, async (input) => {
    const directory = readPath(input)
    // The existing ldb-ocr checkpoint loader supports this one recorded checkpoint.
    const checkpoint = join(directory, 'checkpoints', 'latest.pdparams')
    for (const name of [
      'request.json',
      'config.yml',
      'characters.txt',
      'training.json',
      'manifest.jsonl'
    ]) {
      if (!(await stat(join(directory, name))).isFile()) {
        throw new Error(`학습 결과에 ${name} 파일이 필요합니다.`)
      }
    }
    if (!(await stat(checkpoint)).isFile()) {
      throw new Error('지원되는 latest.pdparams 체크포인트가 없습니다.')
    }
    return { checkpoints: [checkpoint] }
  })
  handle(IPC.start, 1, async (request) => {
    await runner.start(request)
    return null
  })
  handle(IPC.cancel, 0, () => {
    runner.cancel()
    return null
  })
  handle(IPC.getSnapshot, 0, () => runner.getSnapshot())
  handle(IPC.readImage, 1, (path) => runner.readImage(path))
  handle(IPC.openReport, 0, async () => {
    const path = runner.getSnapshot().reportPath
    if (path == null) {
      throw new Error('저장된 보고서가 없습니다.')
    }
    if (!(await stat(path)).isFile()) {
      throw new Error('저장된 보고서를 찾을 수 없습니다.')
    }
    shell.showItemInFolder(path)
    return null
  })
}
