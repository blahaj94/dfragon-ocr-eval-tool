import type { Result } from './contracts'

export type DatasetSplit = 'train' | 'val' | 'test'
export interface DatasetSelection {
  pythonExecutable: string
  datasetDirectory: string
  labelsPath: string
}
export interface DatasetSample {
  key: string
  id: string
  image: string
  truth: string
  datasetDirectory: string
  eventId: string
  pixelHash: string
  originalHash: string | null
  split: DatasetSplit | null
  confirmedAt: string | null
}
export interface DatasetRecord {
  schemaVersion: 1
  selection: DatasetSelection | null
  samples: DatasetSample[]
}
export interface DatasetCounts {
  train: number
  val: number
  test: number
  unassigned: number
}
export interface DatasetIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  images: string[]
}
export interface DatasetCheckResult {
  passed: boolean
  counts: DatasetCounts
  issues: DatasetIssue[]
  samples: DatasetSample[]
}
export interface DatasetGroup {
  eventId: string
  imageCount: number
  confirmedCount: number
  pendingCount: number
  split: DatasetSplit | null
  confirmedSplit: DatasetSplit | null
}
export interface DatasetSnapshot {
  recordPath: string
  selection: DatasetSelection | null
  groups: DatasetGroup[]
  counts: DatasetCounts
  check: DatasetCheckResult | null
  canConfirm: boolean
  exportDirectory: string | null
}
export interface DatasetApi {
  getSnapshot(): Promise<Result<DatasetSnapshot>>
  load(selection: DatasetSelection): Promise<Result<DatasetSnapshot>>
  assign(eventIds: string[], split: DatasetSplit | null): Promise<Result<DatasetSnapshot>>
  check(): Promise<Result<DatasetSnapshot>>
  confirm(): Promise<Result<DatasetSnapshot>>
  export(outputDirectory: string): Promise<Result<DatasetSnapshot>>
}
export const DATASET_IPC = {
  getSnapshot: 'dataset:get-snapshot',
  load: 'dataset:load',
  assign: 'dataset:assign',
  check: 'dataset:check',
  confirm: 'dataset:confirm',
  export: 'dataset:export'
} as const
