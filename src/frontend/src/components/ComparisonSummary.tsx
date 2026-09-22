import type { ComparisonResult } from '../../../shared/comparison'

export function ComparisonSummary({ result }: { result: ComparisonResult }): React.JSX.Element {
  return (
    <div className="comparison-summaries">
      {(
        [
          { label: 'A', summary: result.summaryA },
          { label: 'B', summary: result.summaryB }
        ] as const
      ).map(({ label, summary }) => (
        <section
          className="panel comparison-summary"
          aria-label={`${label} 보고서 지표`}
          key={label}
        >
          <div className="panel-heading">
            <h3>
              <span className="report-letter">{label}</span>저장된 평가 지표
            </h3>
          </div>
          <dl>
            <div>
              <dt>CER</dt>
              <dd>
                {(summary.cer * 100).toFixed(2)}
                <span>%</span>
              </dd>
            </div>
            <div>
              <dt>완전 일치율</dt>
              <dd>
                {(summary.exactMatch * 100).toFixed(2)}
                <span>%</span>
              </dd>
            </div>
            <div>
              <dt>완전 일치 샘플</dt>
              <dd className="comparison-match-count">
                {summary.exactMatchCount.toLocaleString()}
                <span> / {summary.sampleCount.toLocaleString()}</span>
              </dd>
            </div>
          </dl>
        </section>
      ))}
    </div>
  )
}
