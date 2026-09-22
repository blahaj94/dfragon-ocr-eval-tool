import type { Result } from './contracts'

export interface DiagnosticStage {
  id: string
  name: string
  description: string
  previewUrl: string
  previewNote: string
  imageWidth: number
  imageHeight: number
  shape: number[]
  dtype: string
  minimum: number
  maximum: number
  contentBounds: { x: number; y: number; width: number; height: number } | null
}

export interface ShapeMeasurement {
  shape: number[] | null
  error: string | null
}

export interface DiagnosticShapeRow {
  point: 'input' | 'before-pooling' | 'after-pooling'
  label: string
  train: ShapeMeasurement
  evaluation: ShapeMeasurement
}

export interface DiagnosticResult {
  reportPath: string
  sampleId: string
  poolingPolicy: string
  inputFingerprint: string
  stages: DiagnosticStage[]
  shapes: DiagnosticShapeRow[] | null
}

export interface DiagnosticSnapshot {
  status: 'idle' | 'running' | 'cancelling'
  reportPath: string | null
  sampleId: string | null
  message: string | null
}

export interface DiagnosticApi {
  inspect(
    reportPath: string,
    sampleId: string,
    includeShapes: boolean
  ): Promise<Result<DiagnosticResult>>
  cancel(): Promise<Result<null>>
  getSnapshot(): Promise<Result<DiagnosticSnapshot>>
  onSnapshot(listener: (snapshot: DiagnosticSnapshot) => void): () => void
}

export const DIAGNOSTIC_IPC = {
  inspect: 'diagnostics:inspect',
  cancel: 'diagnostics:cancel',
  getSnapshot: 'diagnostics:get-snapshot',
  snapshot: 'diagnostics:snapshot'
} as const
