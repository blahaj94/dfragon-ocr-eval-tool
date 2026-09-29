import {
  CHARACTER_GROUPS,
  CHARACTER_GROUP_LABELS,
  type SupplementInfo,
  type SupplementOptions,
  type SupplementPreview
} from '../../../shared/supplement'

const ratio = (count: number, total: number) =>
  total ? ((100 * count) / total).toFixed(2) : '0.00'

export function SupplementDistribution({
  info,
  options,
  current,
  disabled,
  onChange
}: {
  info: SupplementInfo | null
  options: SupplementOptions
  current: SupplementPreview | null
  disabled: boolean
  onChange: (value: Partial<SupplementOptions>) => void
}): React.JSX.Element {
  return (
    <>
      <div className="supplement-table-scroll">
        <table className="supplement-table">
          <thead>
            <tr>
              <th>문자군</th>
              <th>실제</th>
              <th>목표 (%)</th>
              <th>합성에 사용할 문자</th>
              <th>최종 예상</th>
              <th>차이 (%p)</th>
            </tr>
          </thead>
          <tbody>
            {CHARACTER_GROUPS.map((group) => (
              <tr key={group}>
                <th>{CHARACTER_GROUP_LABELS[group]}</th>
                <td>
                  {info
                    ? `${info.real.groups[group]} · ${ratio(info.real.groups[group], info.real.characters)}%`
                    : '—'}
                </td>
                <td>
                  <input
                    aria-label={`${CHARACTER_GROUP_LABELS[group]} 목표 (%)`}
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={options.targets[group] ?? ''}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange({
                        targets: {
                          ...options.targets,
                          [group]: event.target.value === '' ? null : Number(event.target.value)
                        }
                      })
                    }
                  />
                </td>
                <td>
                  <textarea
                    aria-label={`${CHARACTER_GROUP_LABELS[group]} 합성 문자`}
                    rows={2}
                    value={options.characters[group]}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange({
                        characters: { ...options.characters, [group]: event.target.value }
                      })
                    }
                  />
                </td>
                <td>
                  {current
                    ? `${current.plan.final.groups[group]} · ${ratio(current.plan.final.groups[group], current.plan.final.characters)}%`
                    : '—'}
                </td>
                <td>{current?.plan.differences[group]?.toFixed(2) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-help">
        목표가 빈 문자군은 목표 검사에서 제외합니다. 문자 목록이 빈 문자군은 합성하지 않습니다. 실제
        빈도를 참고해 자주 쓰는 문자를 붙여넣으세요. 선택한 문자 사이의 편중과 닉네임 중복을
        줄입니다.
      </p>
    </>
  )
}
