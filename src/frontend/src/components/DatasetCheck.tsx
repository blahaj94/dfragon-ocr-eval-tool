import type { DatasetCheckResult } from '../../../shared/dataset'

export function DatasetCheck({
  result,
  invalidated
}: {
  result: DatasetCheckResult | null
  invalidated: boolean
}): React.JSX.Element {
  if (invalidated || result == null) {
    return (
      <p className="dataset-check-empty">
        확정하려면 현재 배정을 검사해 주세요. 배정을 바꾸면 다시 검사해야 합니다.
      </p>
    )
  }

  return (
    <div className="dataset-check-result">
      <p
        className={`dataset-check-status ${result.passed ? 'check-passed' : 'check-failed'}`}
        role="status"
      >
        {result.passed ? '검사 통과' : '검사 실패 · 아래 오류를 해결해 주세요.'}
      </p>
      {result.issues.length > 0 && (
        <ul className="dataset-issues">
          {result.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={`issue-${issue.severity}`}>
              <span className="issue-severity">{issue.severity === 'error' ? '오류' : '경고'}</span>
              <div>
                <p>{issue.message}</p>
                {issue.images.length > 0 && (
                  <ul>
                    {issue.images.map((image) => (
                      <li key={image}>
                        <code>{image}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
