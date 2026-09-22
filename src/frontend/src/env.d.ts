import type { EvaluationApi } from '../../shared/contracts'
import type { DatasetApi } from '../../shared/dataset'
import type { ComparisonApi } from '../../shared/comparison'
import type { CharsetApi } from '../../shared/charset'
import type { DiagnosticApi } from '../../shared/diagnostics'

declare global {
  interface Window {
    evaluation: EvaluationApi
    dataset: DatasetApi
    comparison: ComparisonApi
    charset: CharsetApi
    diagnostics: DiagnosticApi
  }
}
