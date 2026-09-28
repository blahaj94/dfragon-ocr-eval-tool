import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type EvaluationApi, type EvaluationSnapshot, type Result } from '../shared/contracts'
import { DATASET_IPC, type DatasetApi } from '../shared/dataset'
import { COMPARISON_IPC, type ComparisonApi } from '../shared/comparison'
import { CHARSET_IPC, type CharsetApi } from '../shared/charset'
import { DIAGNOSTIC_IPC, type DiagnosticApi, type DiagnosticSnapshot } from '../shared/diagnostics'
import { TRAINING_IPC, type TrainingApi, type TrainingSnapshot } from '../shared/training'

function invoke<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<Result<T>>
}

const api: EvaluationApi = {
  getSettings: () => invoke(IPC.getSettings),
  saveSettings: (settings) => invoke(IPC.saveSettings, settings),
  createLabels: (directory) => invoke(IPC.createLabels, directory),
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

const dataset: DatasetApi = {
  getSnapshot: () => invoke(DATASET_IPC.getSnapshot),
  load: (selection) => invoke(DATASET_IPC.load, selection),
  assign: (eventIds, split) => invoke(DATASET_IPC.assign, eventIds, split),
  check: () => invoke(DATASET_IPC.check),
  confirm: () => invoke(DATASET_IPC.confirm),
  export: (directory) => invoke(DATASET_IPC.export, directory)
}

contextBridge.exposeInMainWorld('dataset', dataset)

const comparison: ComparisonApi = {
  chooseReport: () => invoke(COMPARISON_IPC.chooseReport),
  compare: (a, b) => invoke(COMPARISON_IPC.compare, a, b),
  readImage: (path) => invoke(COMPARISON_IPC.readImage, path)
}

contextBridge.exposeInMainWorld('comparison', comparison)

const charset: CharsetApi = {
  inspect: (runDirectory, labelsPath) => invoke(CHARSET_IPC.inspect, runDirectory, labelsPath)
}

contextBridge.exposeInMainWorld('charset', charset)

const diagnostics: DiagnosticApi = {
  inspect: (reportPath, sampleId, includeShapes) =>
    invoke(DIAGNOSTIC_IPC.inspect, reportPath, sampleId, includeShapes),
  cancel: () => invoke(DIAGNOSTIC_IPC.cancel),
  getSnapshot: () => invoke(DIAGNOSTIC_IPC.getSnapshot),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DiagnosticSnapshot): void => {
      listener(snapshot)
    }
    ipcRenderer.on(DIAGNOSTIC_IPC.snapshot, handler)
    return () => ipcRenderer.removeListener(DIAGNOSTIC_IPC.snapshot, handler)
  }
}

contextBridge.exposeInMainWorld('diagnostics', diagnostics)

const training: TrainingApi = {
  login: () => invoke(TRAINING_IPC.login),
  logout: () => invoke(TRAINING_IPC.logout),
  models: () => invoke(TRAINING_IPC.models),
  defaults: () => invoke(TRAINING_IPC.defaults),
  download: (id, directory) => invoke(TRAINING_IPC.download, id, directory),
  open: (directory) => invoke(TRAINING_IPC.open, directory),
  supplementInfo: () => invoke(TRAINING_IPC.supplementInfo),
  previewSupplement: (options) => invoke(TRAINING_IPC.previewSupplement, options),
  start: (options) => invoke(TRAINING_IPC.start, options),
  cancel: () => invoke(TRAINING_IPC.cancel),
  publish: (name) => invoke(TRAINING_IPC.publish, name),
  readImage: (path) => invoke(TRAINING_IPC.readImage, path),
  getSnapshot: () => invoke(TRAINING_IPC.getSnapshot),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: TrainingSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(TRAINING_IPC.snapshot, handler)
    return () => ipcRenderer.removeListener(TRAINING_IPC.snapshot, handler)
  }
}
contextBridge.exposeInMainWorld('training', training)
