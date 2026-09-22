import { useRef, useState } from 'react'
import type { ComparisonResult } from '../../../shared/comparison'
import { ComparisonResults } from '../components/ComparisonResults'
import { ComparisonSummary } from '../components/ComparisonSummary'
import { PathField } from '../components/PathField'

export function ComparisonWorkspace(): React.JSX.Element {
  const [reportAPath, setReportAPath] = useState('')
  const [reportBPath, setReportBPath] = useState('')
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(() =>
    window.comparison == null
      ? '결과 비교 연결을 찾을 수 없습니다. Electron 앱으로 실행해 주세요.'
      : null
  )
  const operationLock = useRef(false)
  const disabled = pending != null || window.comparison == null

  async function chooseReport(side: 'A' | 'B'): Promise<void> {
    if (disabled || operationLock.current) {
      return
    }
    operationLock.current = true
    setPending(`${side} 보고서 선택 중…`)
    setError(null)
    try {
      const chosen = await window.comparison.chooseReport()
      if (!chosen.ok) {
        setError(chosen.error)
        return
      }
      if (chosen.value == null) {
        return
      }
      if (side === 'A') {
        setReportAPath(chosen.value)
      } else {
        setReportBPath(chosen.value)
      }
      setResult(null)
    } catch {
      setError('보고서를 선택하지 못했습니다. 파일에 접근할 수 있는지 확인해 주세요.')
    } finally {
      operationLock.current = false
      setPending(null)
    }
  }

  async function compareReports(): Promise<void> {
    if (disabled || operationLock.current || reportAPath.length === 0 || reportBPath.length === 0) {
      return
    }
    operationLock.current = true
    setPending('보고서 비교 중…')
    setError(null)
    setResult(null)
    try {
      const compared = await window.comparison.compare(reportAPath, reportBPath)
      if (compared.ok) {
        setResult(compared.value)
      } else {
        setError(compared.error)
      }
    } catch {
      setError('보고서를 비교하지 못했습니다. 선택한 파일을 확인해 주세요.')
    } finally {
      operationLock.current = false
      setPending(null)
    }
  }

  return (
    <div className="comparison-workspace">
      {error != null && (
        <div className="error-banner" role="alert">
          <strong>확인이 필요합니다</strong>
          <span>{error}</span>
        </div>
      )}
      <section className="panel comparison-source" aria-label="비교할 보고서 선택">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SAVED REPORTS</span>
            <h3>비교할 보고서</h3>
          </div>
          <span className="subtle-badge">저장된 결과 비교</span>
        </div>
        <div className="comparison-paths">
          <PathField
            id="comparison-report-a"
            label="A 보고서"
            value={reportAPath}
            placeholder="완료된 평가의 report.json"
            disabled={disabled}
            onChoose={() => void chooseReport('A')}
          />
          <PathField
            id="comparison-report-b"
            label="B 보고서"
            value={reportBPath}
            placeholder="완료된 평가의 report.json"
            disabled={disabled}
            onChoose={() => void chooseReport('B')}
          />
        </div>
        <div className="comparison-source-actions">
          <p>동일한 샘플과 정답으로 평가한 두 보고서를 선택하세요.</p>
          <button
            type="button"
            className="button button-primary"
            disabled={disabled || reportAPath.length === 0 || reportBPath.length === 0}
            onClick={() => void compareReports()}
          >
            보고서 비교
          </button>
        </div>
      </section>
      {pending != null && (
        <p className="comparison-operation" role="status">
          {pending}
        </p>
      )}
      {result == null ? (
        <section className="panel empty-state comparison-empty" aria-label="비교 결과 대기">
          <span className="empty-symbol" aria-hidden="true">
            [ A B ]
          </span>
          <h4>두 보고서의 결과를 비교합니다</h4>
          <p>A와 B 보고서를 선택하고 보고서 비교를 누르세요.</p>
        </section>
      ) : (
        <>
          <ComparisonSummary result={result} />
          <ComparisonResults result={result} readImage={window.comparison.readImage} />
        </>
      )}
    </div>
  )
}
