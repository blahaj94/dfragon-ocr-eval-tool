export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export type PathKind = 'python' | 'source' | 'run' | 'dataset' | 'labels' | 'output'

export interface EvaluationRequest {
  pythonExecutable: string
  ldbOcrSourcePath: string
  runDirectory: string
  checkpointPath: string
  datasetDirectory: string
  labelsPath: string
  outputDirectory: string
}

export type EvaluationSettings = Partial<EvaluationRequest>

export interface PythonRuntime {
  executable: string
  version: string
  supported: boolean
}

export interface EvaluationPreferences {
  settings: EvaluationSettings
  pythons: PythonRuntime[]
}

export interface LabelTransferResult {
  output: string
  events: number
  samples: number
  unanswered: number
}

export interface EvaluationSample {
  id: string
  imagePath: string
  truth: string
  prediction: string
  editDistance: number
  confidence: number | null
}

export interface Metrics {
  cer: number
  exactMatch: number
  sampleCount: number
  characterCount: number
}

export interface EvaluationReport {
  status: 'completed' | 'cancelled' | 'failed'
  totalSamples: number
  processedSamples: number
  summary: Metrics | null
  partialSummary?: Metrics | null
  samples: EvaluationSample[]
  error: string | null
  startedAt: string
  finishedAt: string
}

export interface EvaluationSnapshot {
  status: 'idle' | 'starting' | 'running' | 'cancelling' | EvaluationReport['status']
  totalSamples: number
  processedSamples: number
  samples: EvaluationSample[]
  report: EvaluationReport | null
  reportPath: string | null
  error: string | null
}

export interface EvaluationApi {
  getSettings(): Promise<Result<EvaluationPreferences>>
  saveSettings(settings: EvaluationSettings): Promise<Result<null>>
  createLabels(datasetDirectory: string): Promise<Result<LabelTransferResult | null>>
  choosePath(kind: PathKind): Promise<Result<string | null>>
  inspectRun(runDirectory: string): Promise<Result<{ checkpoints: string[] }>>
  start(request: EvaluationRequest): Promise<Result<null>>
  cancel(): Promise<Result<null>>
  readImage(imagePath: string): Promise<Result<string>>
  getSnapshot(): Promise<Result<EvaluationSnapshot>>
  onSnapshot(listener: (snapshot: EvaluationSnapshot) => void): () => void
  openReport(): Promise<Result<null>>
}

export const IPC = {
  getSettings: 'evaluation:get-settings',
  saveSettings: 'evaluation:save-settings',
  createLabels: 'evaluation:create-labels',
  choosePath: 'evaluation:choose-path',
  inspectRun: 'evaluation:inspect-run',
  start: 'evaluation:start',
  cancel: 'evaluation:cancel',
  readImage: 'evaluation:read-image',
  getSnapshot: 'evaluation:get-snapshot',
  snapshot: 'evaluation:snapshot',
  openReport: 'evaluation:open-report'
} as const
