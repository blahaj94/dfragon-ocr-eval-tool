import type { EvaluationApi } from '../../shared/contracts'

declare global {
  interface Window {
    evaluation: EvaluationApi
  }
}
