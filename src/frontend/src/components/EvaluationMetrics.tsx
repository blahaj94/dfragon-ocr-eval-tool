import type { EvaluationSnapshot } from '../../../shared/contracts'

export function EvaluationMetrics({
  snapshot
}: {
  snapshot: EvaluationSnapshot
}): React.JSX.Element {
  const summary =
    snapshot.status === 'completed' && snapshot.report?.status === 'completed'
      ? snapshot.report.summary
      : null

  return (
    <section className="metrics-grid" aria-label="완료된 전체 평가 지표">
      <div className="metric-card">
        <span>CER</span>
        <strong>{summary == null ? '—' : `${(summary.cer * 100).toFixed(2)}%`}</strong>
        <small>문자 오류율 · 낮을수록 좋음</small>
      </div>
      <div className="metric-card">
        <span>Exact Match</span>
        <strong>{summary == null ? '—' : `${(summary.exactMatch * 100).toFixed(2)}%`}</strong>
        <small>정답과 완전히 일치한 비율</small>
      </div>
      <div className="metric-card">
        <span>샘플 수</span>
        <strong>{summary == null ? '—' : summary.sampleCount.toLocaleString()}</strong>
        <small>평가에 포함된 ROI 이미지</small>
      </div>
      <div className="metric-card">
        <span>정답 문자 수</span>
        <strong>{summary == null ? '—' : summary.characterCount.toLocaleString()}</strong>
        <small>CER 계산에 사용된 문자</small>
      </div>
    </section>
  )
}
