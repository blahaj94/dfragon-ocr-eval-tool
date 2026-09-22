import type { EvaluationApi } from '../../shared/contracts'
import type { DatasetApi } from '../../shared/dataset'

declare global {
  interface Window {
    evaluation: EvaluationApi
    dataset: DatasetApi
  }
}
