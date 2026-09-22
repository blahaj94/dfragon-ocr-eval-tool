import type { EvaluationSample, Metrics, Result } from './contracts'

export type ComparisonGroup = 'regressed' | 'improved' | 'both-correct' | 'both-wrong'

export interface ComparisonMetrics extends Metrics {
  exactMatchCount: number
}

export interface ComparisonSample {
  a: EvaluationSample
  b: EvaluationSample
  group: ComparisonGroup
}

export interface ComparisonResult {
  reportAPath: string
  reportBPath: string
  summaryA: ComparisonMetrics
  summaryB: ComparisonMetrics
  counts: Record<ComparisonGroup, number>
  samples: ComparisonSample[]
}

export interface ComparisonApi {
  chooseReport(): Promise<Result<string | null>>
  compare(reportAPath: string, reportBPath: string): Promise<Result<ComparisonResult>>
  readImage(imagePath: string): Promise<Result<string>>
}

export const COMPARISON_IPC = {
  chooseReport: 'comparison:choose-report',
  compare: 'comparison:compare',
  readImage: 'comparison:read-image'
} as const
