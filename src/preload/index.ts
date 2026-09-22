import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type EvaluationApi, type EvaluationSnapshot, type Result } from '../shared/contracts'

function invoke<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<Result<T>>
}

const api: EvaluationApi = {
  choosePath: (kind) => invoke(IPC.choosePath, kind),
  inspectRun: (directory) => invoke(IPC.inspectRun, directory),
  start: (request) => invoke(IPC.start, request),
  cancel: () => invoke(IPC.cancel),
  readImage: (path) => invoke(IPC.readImage, path),
  getSnapshot: () => invoke(IPC.getSnapshot),
  openReport: () => invoke(IPC.openReport),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: EvaluationSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(IPC.snapshot, handler)
    return () => {
      ipcRenderer.removeListener(IPC.snapshot, handler)
    }
  }
}

contextBridge.exposeInMainWorld('evaluation', api)
