import type { EvaluationSnapshot } from '../../../shared/contracts'

const statusLabels: Record<EvaluationSnapshot['status'], string> = {
  idle: '평가 대기',
  starting: '평가 준비 중',
  running: '평가 중',
  cancelling: '취소 처리 중',
  completed: '평가 완료',
  cancelled: '평가 취소됨',
  failed: '평가 실패'
}

export function RunProgress({
  snapshot,
  onCancel,
  cancelling
}: {
  snapshot: EvaluationSnapshot
  onCancel: () => void
  cancelling: boolean
}): React.JSX.Element {
  const active = ['starting', 'running', 'cancelling'].includes(snapshot.status)
  const progress =
    snapshot.totalSamples > 0 ? (snapshot.processedSamples / snapshot.totalSamples) * 100 : 0

  return (
    <section
      className={`progress-panel panel status-${snapshot.status}`}
      aria-label="평가 진행 상황"
    >
      <div className="progress-top">
        <div className="status-label" role="status">
          <span className="status-dot" />
          {statusLabels[snapshot.status]}
        </div>
        {active && (
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={cancelling || snapshot.status === 'cancelling'}
            onClick={onCancel}
          >
            {cancelling || snapshot.status === 'cancelling' ? '취소 처리 중…' : '평가 취소'}
          </button>
        )}
        {!active && (
          <span className="progress-count">
            {snapshot.processedSamples.toLocaleString()} / {snapshot.totalSamples.toLocaleString()}{' '}
            샘플
          </span>
        )}
      </div>
      <progress
        max={Math.max(snapshot.totalSamples, 1)}
        value={snapshot.processedSamples}
        aria-label="처리한 샘플 수"
      />
      <div className="progress-bottom">
        <span>
          {active
            ? `${snapshot.processedSamples.toLocaleString()} / ${snapshot.totalSamples.toLocaleString()} 샘플 처리`
            : snapshot.status === 'idle'
              ? '왼쪽에서 평가할 모델과 데이터를 선택하세요.'
              : snapshot.status === 'completed'
                ? '등록된 모든 샘플의 평가가 완료되었습니다.'
                : '전체 평가가 완료되지 않았습니다. 처리된 샘플만 표시합니다.'}
        </span>
        {active && <span>{progress.toFixed(0)}%</span>}
      </div>
    </section>
  )
}
