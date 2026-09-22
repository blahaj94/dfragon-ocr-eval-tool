import { useState } from 'react'
import type {
  ComparisonGroup,
  ComparisonResult,
  ComparisonSample
} from '../../../shared/comparison'
import { ImageDialog } from './ImageDialog'
import { SampleImage, type ImageReader } from './SampleImage'

const groups: { key: ComparisonGroup; label: string; description: string }[] = [
  { key: 'regressed', label: '새로 틀림', description: 'A는 정답, B는 오답인 샘플' },
  { key: 'improved', label: '새로 맞힘', description: 'A는 오답, B는 정답인 샘플' },
  { key: 'both-correct', label: '둘 다 성공', description: 'A와 B 모두 정답인 샘플' },
  { key: 'both-wrong', label: '둘 다 실패', description: 'A와 B 모두 오답인 샘플' }
]

export function ComparisonResults({
  result,
  readImage
}: {
  result: ComparisonResult
  readImage: ImageReader
}): React.JSX.Element {
  const [group, setGroup] = useState<ComparisonGroup>('regressed')
  const [selected, setSelected] = useState<ComparisonSample | null>(null)
  const samples = result.samples.filter((sample) => sample.group === group)
  const currentGroup = groups.find((item) => item.key === group) ?? groups[0]

  return (
    <section className="panel comparison-results" aria-label="샘플별 결과 비교">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SAMPLE COMPARISON</span>
          <h3>샘플별 변화</h3>
        </div>
        <span className="subtle-badge">전체 {result.samples.length.toLocaleString()}개 샘플</span>
      </div>
      <div className="comparison-filters" aria-label="결과 비교 필터">
        {groups.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={group === item.key}
            aria-label={`${item.label} ${result.counts[item.key].toLocaleString()}`}
            onClick={() => setGroup(item.key)}
          >
            <span>{item.label}</span>
            <strong>{result.counts[item.key].toLocaleString()}</strong>
          </button>
        ))}
      </div>
      <p className="comparison-group-description">
        {currentGroup.description} · {samples.length.toLocaleString()}개
      </p>
      {samples.length === 0 ? (
        <div className="empty-state comparison-empty">
          <span className="empty-symbol" aria-hidden="true">
            [ = ]
          </span>
          <h4>이 그룹에 해당하는 샘플이 없습니다</h4>
          <p>다른 그룹을 선택해 결과를 확인하세요.</p>
        </div>
      ) : (
        <div className="table-scroll comparison-table-scroll">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">ROI 이미지</th>
                <th scope="col">정답</th>
                <th scope="col">A 예측 / 편집거리</th>
                <th scope="col">B 예측 / 편집거리</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((sample) => (
                <tr key={sample.a.id}>
                  <td>
                    <button
                      type="button"
                      className="thumbnail-button"
                      aria-label={`${sample.a.id} 비교 이미지 확대`}
                      onClick={() => setSelected(sample)}
                    >
                      <SampleImage
                        imagePath={sample.a.imagePath}
                        label={`${sample.a.id} 비교 ROI`}
                        readImage={readImage}
                      />
                      <span className="zoom-label" aria-hidden="true">
                        확대 ↗
                      </span>
                    </button>
                    <span className="sample-id" title={sample.a.imagePath}>
                      {sample.a.id}
                    </span>
                  </td>
                  <td className="comparison-truth">
                    {sample.a.truth.length === 0 ? (
                      <span className="empty-value">빈 정답</span>
                    ) : (
                      sample.a.truth
                    )}
                  </td>
                  <td>
                    <div className="comparison-prediction">
                      {sample.a.prediction.length === 0 ? (
                        <span className="empty-value">빈 예측</span>
                      ) : (
                        sample.a.prediction
                      )}
                    </div>
                    <div className="comparison-distance">
                      편집거리{' '}
                      <span
                        className={
                          sample.a.editDistance > 0 ? 'distance-badge incorrect' : 'distance-badge'
                        }
                      >
                        {sample.a.editDistance}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="comparison-prediction">
                      {sample.b.prediction.length === 0 ? (
                        <span className="empty-value">빈 예측</span>
                      ) : (
                        sample.b.prediction
                      )}
                    </div>
                    <div className="comparison-distance">
                      편집거리{' '}
                      <span
                        className={
                          sample.b.editDistance > 0 ? 'distance-badge incorrect' : 'distance-badge'
                        }
                      >
                        {sample.b.editDistance}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-footer">
        <span>보고서에 저장된 예측과 편집거리를 표시합니다.</span>
        <span>이미지를 클릭해 A / B 결과 확대</span>
      </div>
      {selected != null && (
        <ImageDialog
          sample={selected.a}
          comparisonSample={selected.b}
          readImage={readImage}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}
