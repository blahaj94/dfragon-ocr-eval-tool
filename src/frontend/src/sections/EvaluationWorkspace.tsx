import { useRef, useState } from 'react'
import type { EvaluationRequest } from '../../../shared/contracts'
import { EvaluationSetup } from '../components/EvaluationSetup'
import { EvaluationMetrics } from '../components/EvaluationMetrics'
import { EvaluationResults } from '../components/EvaluationResults'
import { RunProgress } from '../components/RunProgress'
import { useEvaluationSnapshot } from '../hooks/useEvaluationSnapshot'

export function EvaluationWorkspace(): React.JSX.Element {
  const { snapshot, connectionError } = useEvaluationSnapshot()
  const [requestError, setRequestError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [runVersion, setRunVersion] = useState(0)
  const commandPending = useRef(false)
  const busy = starting || ['starting', 'running', 'cancelling'].includes(snapshot.status)
  const error = connectionError ?? requestError ?? snapshot.error

  async function startEvaluation(request: EvaluationRequest): Promise<void> {
    if (busy || commandPending.current) {
      return
    }
    commandPending.current = true
    setStarting(true)
    setRunVersion((version) => version + 1)
    setRequestError(null)
    try {
      const result = await window.evaluation.start(request)
      if (!result.ok) {
        setRequestError(result.error)
      }
    } catch {
      setRequestError('평가를 시작하지 못했습니다. 실행 환경과 입력 경로를 확인해 주세요.')
    } finally {
      commandPending.current = false
      setStarting(false)
    }
  }

  async function cancelEvaluation(): Promise<void> {
    if (cancelling || snapshot.status === 'cancelling') {
      return
    }
    setCancelling(true)
    setRequestError(null)
    try {
      const result = await window.evaluation.cancel()
      if (!result.ok) {
        setRequestError(result.error)
      }
    } catch {
      setRequestError('취소 요청을 전달하지 못했습니다. 현재 진행 상태를 확인해 주세요.')
    } finally {
      setCancelling(false)
    }
  }

  async function openReport(): Promise<void> {
    try {
      const result = await window.evaluation.openReport()
      if (!result.ok) {
        setRequestError(result.error)
      }
    } catch {
      setRequestError('보고서 폴더를 열지 못했습니다. 표시된 저장 경로를 확인해 주세요.')
    }
  }

  return (
    <>
      {error != null && (
        <div className="error-banner" role="alert">
          <strong>확인이 필요합니다</strong>
          <span>{error}</span>
        </div>
      )}
      <div className="workspace">
        <EvaluationSetup
          busy={busy}
          connected={connectionError == null}
          onStart={(request) => void startEvaluation(request)}
          onError={setRequestError}
        />
        <div className="results-column">
          <RunProgress
            snapshot={snapshot}
            cancelling={cancelling}
            onCancel={() => void cancelEvaluation()}
          />
          <EvaluationMetrics snapshot={snapshot} />
          <EvaluationResults key={runVersion} samples={snapshot.samples} status={snapshot.status} />
          {snapshot.reportPath != null && (
            <div className="report-panel panel">
              <div>
                <strong>보고서 저장됨</strong>
                <code>{snapshot.reportPath}</code>
              </div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void openReport()}
              >
                저장 폴더 열기 ↗
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
