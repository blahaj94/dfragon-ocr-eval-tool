import { useState } from 'react'
import type { EvaluationSample, EvaluationSnapshot, Result } from '../../../shared/contracts'
import type { DiagnosticApi, DiagnosticSnapshot } from '../../../shared/diagnostics'
import { ImageDialog } from './ImageDialog'
import { SampleImage } from './SampleImage'
import { SampleDiagnostics } from './SampleDiagnostics'

interface EvaluationDiagnostics {
  reportPath: string
  busy: boolean
  connectionError: string | null
  snapshot: DiagnosticSnapshot
  inspect: DiagnosticApi['inspect']
  cancelOwned: (reportPath: string, sampleId: string) => Promise<Result<null>>
  onError: (error: string) => void
}

export function EvaluationResults({
  samples,
  status,
  diagnostics
}: {
  samples: EvaluationSample[]
  status: EvaluationSnapshot['status']
  diagnostics?: EvaluationDiagnostics
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const [selectedSample, setSelectedSample] = useState<EvaluationSample | null>(null)
  const mismatches = samples.filter((sample) => sample.editDistance > 0)
  const visibleSamples = showAll ? samples : mismatches

  function closeSample(): void {
    if (selectedSample != null && diagnostics != null) {
      void diagnostics.cancelOwned(diagnostics.reportPath, selectedSample.id).then((result) => {
        if (!result.ok) {
          diagnostics.onError(result.error)
        }
      })
    }
    setSelectedSample(null)
  }

  return (
    <section className="samples-panel panel" aria-label="샘플별 평가 결과">
      <div className="panel-heading results-heading">
        <div>
          <span className="eyebrow">SAMPLE REVIEW</span>
          <h3>
            샘플별 결과 <span className="count-badge">{visibleSamples.length}</span>
          </h3>
        </div>
        <div className="filter-switch" aria-label="결과 필터">
          <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>
            틀린 샘플 <span>{mismatches.length}</span>
          </button>
          <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>
            전체 <span>{samples.length}</span>
          </button>
        </div>
      </div>
      {status !== 'idle' && status !== 'completed' && (
        <p className="partial-notice">
          {status === 'running' || status === 'starting' || status === 'cancelling'
            ? '진행 중인 결과입니다.'
            : '부분 결과입니다.'}{' '}
          전체 평가는 완료되지 않았습니다.
        </p>
      )}

      {visibleSamples.length === 0 ? (
        <div className="empty-state">
          <span className="empty-symbol" aria-hidden="true">
            [ a ]
          </span>
          <h4>{samples.length === 0 ? '평가 결과를 기다리고 있습니다' : '틀린 샘플이 없습니다'}</h4>
          <p>
            {samples.length === 0
              ? '평가를 시작하면 이미지와 정답, 예측 결과가 여기에 표시됩니다.'
              : '처리된 모든 샘플이 정답과 일치합니다. 전체 보기에서 확인하세요.'}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">ROI 이미지</th>
                <th scope="col">정답 / 예측</th>
                <th scope="col" className="numeric">
                  편집거리
                </th>
                <th scope="col" className="numeric">
                  Confidence
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleSamples.map((sample) => (
                <tr
                  key={sample.id}
                  className={sample.editDistance > 0 ? 'mismatch-row' : undefined}
                >
                  <td className="image-cell">
                    <button
                      type="button"
                      className="thumbnail-button"
                      aria-label={`${sample.id} 이미지 확대`}
                      onClick={() => setSelectedSample(sample)}
                    >
                      <SampleImage imagePath={sample.imagePath} label={`${sample.id} ROI`} />
                      <span className="zoom-label" aria-hidden="true">
                        확대 ↗
                      </span>
                    </button>
                    <span className="sample-id" title={sample.imagePath}>
                      {sample.id}
                    </span>
                  </td>
                  <td className="text-cell">
                    <div className="sample-text">
                      <span className="text-label">정답</span>
                      <span>
                        {sample.truth.length === 0 ? (
                          <span className="empty-value">빈 정답</span>
                        ) : (
                          sample.truth
                        )}
                      </span>
                    </div>
                    <div
                      className={`sample-text ${sample.editDistance > 0 ? 'prediction-mismatch' : ''}`}
                    >
                      <span className="text-label">예측</span>
                      <span>
                        {sample.prediction.length === 0 ? (
                          <span className="empty-value">빈 예측</span>
                        ) : (
                          sample.prediction
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="numeric">
                    <span
                      className={
                        sample.editDistance > 0 ? 'distance-badge incorrect' : 'distance-badge'
                      }
                    >
                      {sample.editDistance}
                    </span>
                  </td>
                  <td className="numeric confidence-value">
                    {sample.confidence == null ? (
                      <span className="unavailable">제공 안 됨</span>
                    ) : (
                      sample.confidence.toFixed(4)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-footer">
        <span>빈 예측과 낮은 confidence도 평가에 포함됩니다.</span>
        <span>이미지를 클릭해 확대</span>
      </div>
      {selectedSample != null && (
        <ImageDialog sample={selectedSample} onClose={closeSample}>
          {diagnostics != null && (
            <SampleDiagnostics
              key={`${diagnostics.reportPath}\u0000${selectedSample.id}`}
              reportPath={diagnostics.reportPath}
              sampleId={selectedSample.id}
              busy={diagnostics.busy}
              connectionError={diagnostics.connectionError}
              progressMessage={
                diagnostics.snapshot.reportPath === diagnostics.reportPath &&
                diagnostics.snapshot.sampleId === selectedSample.id
                  ? diagnostics.snapshot.message
                  : null
              }
              inspect={diagnostics.inspect}
            />
          )}
        </ImageDialog>
      )}
    </section>
  )
}
