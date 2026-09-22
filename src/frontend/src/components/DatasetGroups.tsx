import type { DatasetGroup, DatasetSplit } from '../../../shared/dataset'

const splitNames: Record<DatasetSplit, string> = {
  train: 'train · 공부',
  val: 'val · 연습시험',
  test: 'test · 최종시험'
}

export function DatasetGroups({
  groups,
  selectedIds,
  busy,
  onSelectionChange
}: {
  groups: DatasetGroup[]
  selectedIds: string[]
  busy: boolean
  onSelectionChange: (ids: string[]) => void
}): React.JSX.Element {
  return (
    <div className="table-scroll dataset-table-scroll">
      <table className="dataset-table">
        <thead>
          <tr>
            <th scope="col">선택</th>
            <th scope="col">캡처 그룹</th>
            <th scope="col" className="numeric">
              이미지
            </th>
            <th scope="col" className="numeric">
              확정
            </th>
            <th scope="col" className="numeric">
              미확정
            </th>
            <th scope="col">현재 배정</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.eventId}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${group.eventId} 선택`}
                  checked={selectedIds.includes(group.eventId)}
                  disabled={busy || group.pendingCount === 0}
                  onChange={(event) =>
                    onSelectionChange(
                      event.target.checked
                        ? [...selectedIds, group.eventId]
                        : selectedIds.filter((id) => id !== group.eventId)
                    )
                  }
                />
              </td>
              <th scope="row" title={group.eventId}>
                {group.eventId}
                {group.confirmedCount > 0 && (
                  <small className="dataset-lock">
                    {group.pendingCount === 0
                      ? '확정됨 · 변경 불가'
                      : `확정 항목 ${group.confirmedSplit == null ? '' : splitNames[group.confirmedSplit]} 유지`}
                  </small>
                )}
              </th>
              <td className="numeric">{group.imageCount.toLocaleString()}</td>
              <td className="numeric">{group.confirmedCount.toLocaleString()}</td>
              <td className="numeric">{group.pendingCount.toLocaleString()}</td>
              <td>
                {group.split == null ? (
                  group.confirmedSplit == null ? (
                    <span className="unassigned-label">미배정</span>
                  ) : (
                    <>
                      <span>{splitNames[group.confirmedSplit]}</span>
                      <small className="dataset-lock">새 항목 미배정</small>
                    </>
                  )
                ) : (
                  splitNames[group.split]
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
