import type { DiagnosticShapeRow, ShapeMeasurement } from '../../../shared/diagnostics'

function observed(measurement: ShapeMeasurement): boolean {
  return measurement.shape != null && measurement.error === null
}

function differs(row: DiagnosticShapeRow): boolean {
  return (
    observed(row.train) &&
    observed(row.evaluation) &&
    (row.train.shape?.length !== row.evaluation.shape?.length ||
      row.train.shape?.some((dimension, index) => dimension !== row.evaluation.shape?.[index]) ===
        true)
  )
}

export function DiagnosticShapes({ rows }: { rows: DiagnosticShapeRow[] }): React.JSX.Element {
  const allObserved =
    rows.length === 3 &&
    ['input', 'before-pooling', 'after-pooling'].every((point) =>
      rows.some((row) => row.point === point && observed(row.train) && observed(row.evaluation))
    )
  const anyDifference = rows.some(differs)

  return (
    <section className="diagnostic-shapes" aria-label="Train/Eval shape 비교">
      <h4>학습 모드 / 평가 모드 크기</h4>
      <p className="diagnostic-shape-note">
        동일 입력의 학습·평가 모드 shape 비교입니다. 학습 데이터 생성이나 augmentation 전체를
        검증하지 않습니다.
      </p>
      {allObserved && !anyDifference ? (
        <p className="diagnostic-shape-status">확인한 지점의 크기가 같습니다.</p>
      ) : !allObserved ? (
        <p className="diagnostic-shape-unknown">확인하지 못함</p>
      ) : null}
      <div className="table-scroll">
        <table className="diagnostic-shape-table">
          <thead>
            <tr>
              <th scope="col">확인 지점</th>
              <th scope="col">학습 모드</th>
              <th scope="col">평가 모드</th>
              <th scope="col">결과</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.point}
                className={differs(row) ? 'diagnostic-shape-difference' : undefined}
              >
                <th scope="row">{row.label}</th>
                {[row.train, row.evaluation].map((measurement, index) => (
                  <td key={index}>
                    <code>
                      {observed(measurement)
                        ? `[${measurement.shape?.join(', ')}]`
                        : '확인하지 못함'}
                    </code>
                    {measurement.error != null && <small>{measurement.error}</small>}
                  </td>
                ))}
                <td>
                  {differs(row)
                    ? '이 지점에서 학습 모드와 평가 모드의 크기가 다릅니다.'
                    : observed(row.train) && observed(row.evaluation)
                      ? '크기 같음'
                      : '확인하지 못함'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
