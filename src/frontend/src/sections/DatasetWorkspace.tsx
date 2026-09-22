import { useEffect, useRef, useState } from 'react'
import type { Result } from '../../../shared/contracts'
import type { DatasetSelection, DatasetSnapshot, DatasetSplit } from '../../../shared/dataset'
import { DatasetCheck } from '../components/DatasetCheck'
import { DatasetGroups } from '../components/DatasetGroups'
import { PathField } from '../components/PathField'

const emptySelection: DatasetSelection = {
  pythonExecutable: '',
  datasetDirectory: '',
  labelsPath: ''
}
const splitLabels: Record<DatasetSplit, string> = {
  train: 'train · 공부',
  val: 'val · 연습시험',
  test: 'test · 최종시험'
}
const pathFields = {
  python: 'pythonExecutable',
  dataset: 'datasetDirectory',
  labels: 'labelsPath'
} as const

export function DatasetWorkspace(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<DatasetSnapshot | null>(null)
  const [selection, setSelection] = useState<DatasetSelection>(emptySelection)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [targetSplit, setTargetSplit] = useState<DatasetSplit | ''>('train')
  const [outputDirectory, setOutputDirectory] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(window.dataset != null)
  const [error, setError] = useState<string | null>(() =>
    window.dataset == null
      ? 'Dataset 연결을 찾을 수 없습니다. Electron 앱으로 실행해 주세요.'
      : null
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [checkInvalidated, setCheckInvalidated] = useState(false)
  const [exportedDirectory, setExportedDirectory] = useState<string | null>(null)
  const operationLock = useRef(false)
  const operationVersion = useRef(0)
  const busy = initializing || pending != null
  const connected = window.dataset != null
  const loadedSelection = snapshot?.selection
  const selectionChanged =
    loadedSelection != null &&
    Object.keys(emptySelection).some(
      (key) =>
        selection[key as keyof DatasetSelection] !== loadedSelection[key as keyof DatasetSelection]
    )
  const hasGroups = (snapshot?.groups.length ?? 0) > 0
  const canEdit = connected && !busy && hasGroups && !selectionChanged
  const confirmedCount = snapshot?.groups.reduce((sum, group) => sum + group.confirmedCount, 0) ?? 0
  const selectedGroups =
    snapshot?.groups.filter((group) => selectedIds.includes(group.eventId)) ?? []
  const incompatibleSplit = selectedGroups.some(
    (group) =>
      targetSplit !== '' && group.confirmedSplit != null && group.confirmedSplit !== targetSplit
  )

  useEffect(() => {
    if (window.dataset == null) {
      return
    }
    let active = true
    const initialVersion = operationVersion.current
    void window.dataset
      .getSnapshot()
      .then((result) => {
        if (!active || initialVersion !== operationVersion.current) {
          return
        }
        if (result.ok) {
          setSnapshot(result.value)
          if (result.value.selection != null) {
            setSelection(result.value.selection)
          }
        } else {
          setError(result.error)
        }
        setInitializing(false)
      })
      .catch(() => {
        if (active && initialVersion === operationVersion.current) {
          setError('저장된 Dataset 상태를 읽지 못했습니다.')
          setInitializing(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  async function runOperation(
    label: string,
    operation: () => Promise<Result<DatasetSnapshot>>,
    kind: 'load' | 'assign' | 'check' | 'confirm' | 'export'
  ): Promise<void> {
    if (operationLock.current || initializing || !connected) {
      return
    }
    operationLock.current = true
    operationVersion.current += 1
    setPending(label)
    setError(null)
    setNotice(null)
    if (kind === 'export') {
      setExportedDirectory(null)
    }

    try {
      const result = await operation()
      if (!result.ok) {
        setError(result.error)
        if (kind !== 'export') {
          setCheckInvalidated(true)
        }
        return
      }
      setSnapshot(result.value)
      if (kind !== 'export') {
        setCheckInvalidated(false)
        setExportedDirectory(null)
      }
      if (kind === 'load' || kind === 'assign' || kind === 'confirm') {
        setSelectedIds([])
      }
      if (kind === 'load' && result.value.selection != null) {
        setSelection(result.value.selection)
      }
      const nextConfirmedCount = result.value.groups.reduce(
        (sum, group) => sum + group.confirmedCount,
        0
      )
      if (
        kind === 'confirm' &&
        result.value.check?.passed !== false &&
        nextConfirmedCount > confirmedCount
      ) {
        setNotice('배정을 확정했습니다. 확정된 항목은 변경할 수 없습니다.')
      }
      if (
        kind === 'export' &&
        result.value.check?.passed !== false &&
        result.value.exportDirectory != null
      ) {
        setExportedDirectory(result.value.exportDirectory)
      }
    } catch {
      setError(`${label} 작업을 완료하지 못했습니다. 경로와 Python 실행 환경을 확인해 주세요.`)
      if (kind !== 'export') {
        setCheckInvalidated(true)
      }
    } finally {
      operationLock.current = false
      setPending(null)
    }
  }

  async function choosePath(kind: 'python' | 'dataset' | 'labels' | 'output'): Promise<void> {
    if (operationLock.current || busy || !connected) {
      return
    }
    operationLock.current = true
    setPending('경로 선택 중')
    setError(null)
    try {
      const result = await window.evaluation.choosePath(kind)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.value == null) {
        return
      }
      const selectedPath = result.value
      if (kind === 'output') {
        setOutputDirectory(selectedPath)
      } else {
        setSelection((current) => ({ ...current, [pathFields[kind]]: selectedPath }))
      }
    } catch {
      setError('경로를 선택하지 못했습니다. 파일과 폴더에 접근할 수 있는지 확인해 주세요.')
    } finally {
      operationLock.current = false
      setPending(null)
    }
  }

  return (
    <div className="dataset-workspace">
      {error != null && (
        <div className="error-banner" role="alert">
          <strong>확인이 필요합니다</strong>
          <span>{error}</span>
        </div>
      )}
      <section className="panel dataset-source" aria-label="Dataset 불러오기">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DATASET SOURCE</span>
            <h3>데이터 불러오기</h3>
          </div>
          <span className="subtle-badge">수동 그룹 배정</span>
        </div>
        <div className="dataset-inputs">
          <PathField
            id="dataset-python"
            label="Dataset Python 실행 파일"
            value={selection.pythonExecutable}
            placeholder="Pillow가 설치된 python.exe"
            disabled={busy || !connected}
            onChoose={() => void choosePath('python')}
          />
          <PathField
            id="dataset-capture-root"
            label="Dataset 캡처 루트"
            value={selection.datasetDirectory}
            placeholder="Cropper 캡처 결과의 최상위 폴더"
            disabled={busy || !connected}
            onChoose={() => void choosePath('dataset')}
          />
          <PathField
            id="dataset-labels"
            label="Dataset 정답 파일"
            value={selection.labelsPath}
            placeholder="labels.json"
            disabled={busy || !connected}
            onChoose={() => void choosePath('labels')}
          />
        </div>
        <div className="dataset-source-actions">
          <p>기존 Python과 Pillow로 검사합니다. GPU는 사용하지 않습니다.</p>
          <button
            type="button"
            className="button button-primary"
            disabled={
              busy || !connected || Object.values(selection).some((value) => value.length === 0)
            }
            onClick={() =>
              void runOperation('데이터 불러오기', () => window.dataset.load(selection), 'load')
            }
          >
            데이터 불러오기
          </button>
        </div>
        {selectionChanged && (
          <p className="dataset-path-notice">경로가 변경되었습니다. 데이터를 다시 불러오세요.</p>
        )}
      </section>

      <div className="dataset-state-line">
        <span role="status">
          {initializing
            ? '저장된 상태 불러오는 중…'
            : (pending ??
              notice ??
              (snapshot?.selection == null
                ? '캡처 루트와 정답 파일을 선택해 주세요.'
                : '현재 캡처 루트의 등록된 이미지입니다.'))}
        </span>
        {snapshot?.recordPath != null && (
          <span className="dataset-record-path">
            배정 기록: <code>{snapshot.recordPath}</code>
          </span>
        )}
      </div>
      {snapshot?.selection != null && (
        <p className="dataset-active-path">
          로드된 캡처 루트 <code>{snapshot.selection.datasetDirectory}</code>
        </p>
      )}
      <section className="metrics-grid dataset-counts" aria-label="현재 캡처 루트 이미지 수">
        {(['train', 'val', 'test', 'unassigned'] as const).map((split) => (
          <div className="metric-card" key={split}>
            <span>{split === 'unassigned' ? '미배정' : splitLabels[split]}</span>
            <strong>{snapshot == null ? '—' : snapshot.counts[split].toLocaleString()}</strong>
            <small>이미지 수</small>
          </div>
        ))}
      </section>

      <section className="panel dataset-groups" aria-label="캡처 그룹 배정">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CAPTURE GROUPS</span>
            <h3>
              그룹별 배정 <span className="count-badge">{snapshot?.groups.length ?? 0}</span>
            </h3>
          </div>
          <span className="subtle-badge">확정된 항목은 잠금</span>
        </div>
        <div className="dataset-assignment">
          <span>{selectedIds.length}개 그룹 선택</span>
          <label htmlFor="dataset-target-split">배정 위치</label>
          <select
            id="dataset-target-split"
            value={targetSplit}
            disabled={!canEdit}
            onChange={(event) => setTargetSplit(event.target.value as DatasetSplit | '')}
          >
            <option value="train">train · 공부</option>
            <option value="val">val · 연습시험</option>
            <option value="test">test · 최종시험</option>
            <option value="">미배정</option>
          </select>
          <button
            type="button"
            className="button button-secondary"
            disabled={!canEdit || selectedIds.length === 0 || incompatibleSplit}
            onClick={() =>
              void runOperation(
                '선택 그룹 배정',
                () => window.dataset.assign(selectedIds, targetSplit === '' ? null : targetSplit),
                'assign'
              )
            }
          >
            선택 그룹 배정
          </button>
        </div>
        {incompatibleSplit && (
          <p className="dataset-path-notice">
            확정 항목이 있는 그룹의 새 이미지는 기존 확정 위치로만 배정할 수 있습니다.
          </p>
        )}
        {hasGroups && snapshot != null ? (
          <DatasetGroups
            groups={snapshot.groups}
            selectedIds={selectedIds}
            busy={!canEdit}
            onSelectionChange={setSelectedIds}
          />
        ) : (
          <div className="empty-state dataset-empty">
            <span className="empty-symbol" aria-hidden="true">
              [ + ]
            </span>
            <h4>배정할 캡처 그룹이 없습니다</h4>
            <p>정답 파일에 등록된 이미지를 불러오면 캡처 단위로 표시됩니다.</p>
          </div>
        )}
        <p className="dataset-table-note">
          같은 캡처 그룹의 이미지는 함께 배정합니다. 다시 불러올 때 기존 확정은 유지되고 새 이미지만
          미배정으로 추가됩니다.
        </p>
      </section>

      <section className="panel dataset-validation" aria-label="Dataset 검사 및 확정">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CHECK & CONFIRM</span>
            <h3>검사 후 확정</h3>
          </div>
          <div className="dataset-action-buttons">
            <button
              type="button"
              className="button button-secondary"
              disabled={!canEdit}
              onClick={() =>
                void runOperation('Dataset 검사', () => window.dataset.check(), 'check')
              }
            >
              Dataset 검사
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={!canEdit || checkInvalidated || snapshot?.canConfirm !== true}
              onClick={() =>
                void runOperation('배정 확정', () => window.dataset.confirm(), 'confirm')
              }
            >
              배정 확정
            </button>
          </div>
        </div>
        <DatasetCheck
          result={snapshot?.check ?? null}
          invalidated={checkInvalidated || selectionChanged}
        />
      </section>

      <section className="panel dataset-export" aria-label="확정 Dataset 내보내기">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EXPORT</span>
            <h3>확정 데이터 내보내기</h3>
          </div>
          <span className="subtle-badge">확정 {confirmedCount.toLocaleString()}개</span>
        </div>
        <p className="dataset-export-help">현재 캡처 루트의 확정된 항목만 새 폴더로 내보냅니다.</p>
        <div className="dataset-export-controls">
          <PathField
            id="dataset-output"
            label="Dataset 내보내기 폴더"
            value={outputDirectory}
            placeholder="새 내보내기 폴더를 만들 위치"
            disabled={busy || !connected}
            onChoose={() => void choosePath('output')}
          />
          <button
            type="button"
            className="button button-primary"
            disabled={!canEdit || confirmedCount === 0 || outputDirectory.length === 0}
            onClick={() =>
              void runOperation(
                'Dataset 내보내기',
                () => window.dataset.export(outputDirectory),
                'export'
              )
            }
          >
            Dataset 내보내기
          </button>
        </div>
        {exportedDirectory != null && (
          <div className="dataset-export-success" role="status">
            <strong>내보내기 완료</strong>
            <code>{exportedDirectory}</code>
          </div>
        )}
      </section>
    </div>
  )
}
