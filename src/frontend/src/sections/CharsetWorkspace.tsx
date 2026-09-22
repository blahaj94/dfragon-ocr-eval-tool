import { useRef, useState } from 'react'
import type { CharsetInspection } from '../../../shared/charset'
import { CharsetResults } from '../components/CharsetResults'
import { PathField } from '../components/PathField'

export function CharsetWorkspace(): React.JSX.Element {
  const [runDirectory, setRunDirectory] = useState('')
  const [labelsPath, setLabelsPath] = useState('')
  const [inspection, setInspection] = useState<CharsetInspection | null>(null)
  const [inspectionVersion, setInspectionVersion] = useState(0)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(() =>
    window.charset == null
      ? '문자 검사 연결을 찾을 수 없습니다. Electron 앱으로 실행해 주세요.'
      : null
  )
  const operationLock = useRef(false)
  const disabled = pending != null || window.charset == null

  async function choosePath(kind: 'run' | 'labels'): Promise<void> {
    if (disabled || operationLock.current) {
      return
    }
    operationLock.current = true
    setPending('검사 경로 선택 중…')
    setError(null)
    try {
      const result = await window.evaluation.choosePath(kind)
      if (!result.ok) {
        setError(result.error)
        setInspection(null)
        return
      }
      if (result.value == null) {
        return
      }
      if (kind === 'run') {
        setRunDirectory(result.value)
      } else {
        setLabelsPath(result.value)
      }
      setInspection(null)
    } catch {
      setInspection(null)
      setError('검사할 경로를 선택하지 못했습니다. 파일과 폴더에 접근할 수 있는지 확인해 주세요.')
    } finally {
      operationLock.current = false
      setPending(null)
    }
  }

  async function inspectCharacters(): Promise<void> {
    if (disabled || operationLock.current || runDirectory.length === 0 || labelsPath.length === 0) {
      return
    }
    operationLock.current = true
    setPending('문자 포함 여부 검사 중…')
    setError(null)
    setInspection(null)
    setInspectionVersion((version) => version + 1)
    try {
      const result = await window.charset.inspect(runDirectory, labelsPath)
      if (result.ok) {
        setInspection(result.value)
      } else {
        setError(result.error)
      }
    } catch {
      setError('문자 검사를 완료하지 못했습니다. 학습 설정·문자 사전·정답 파일을 확인해 주세요.')
    } finally {
      operationLock.current = false
      setPending(null)
    }
  }

  return (
    <div className="charset-workspace">
      {error != null && (
        <div className="error-banner" role="alert">
          <strong>검사 실패</strong>
          <span>{error}</span>
        </div>
      )}
      <section className="panel charset-source" aria-label="문자 검사 입력">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CHARSET INSPECTION</span>
            <h3>검사할 사전과 정답</h3>
          </div>
          <span className="subtle-badge">문자 포함 여부</span>
        </div>
        <div className="charset-paths">
          <PathField
            id="charset-run"
            label="문자 검사 학습 결과 폴더"
            value={runDirectory}
            placeholder="학습 설정과 문자 사전이 있는 폴더"
            disabled={disabled}
            onChoose={() => void choosePath('run')}
          />
          <PathField
            id="charset-labels"
            label="문자 검사 정답 파일"
            value={labelsPath}
            placeholder="labels.json"
            disabled={disabled}
            onChoose={() => void choosePath('labels')}
          />
        </div>
        <div className="charset-source-actions">
          <p>문자 사전의 포함 여부만 검사합니다. OCR 인식 품질을 의미하지 않습니다.</p>
          <button
            type="button"
            className="button button-primary"
            disabled={disabled || runDirectory.length === 0 || labelsPath.length === 0}
            onClick={() => void inspectCharacters()}
          >
            문자 포함 검사
          </button>
        </div>
      </section>
      {pending != null && (
        <p className="charset-operation" role="status">
          {pending}
        </p>
      )}
      {inspection != null ? (
        <CharsetResults key={inspectionVersion} inspection={inspection} />
      ) : (
        error == null && (
          <section className="panel empty-state charset-empty" aria-label="문자 검사 대기">
            <span className="empty-symbol" aria-hidden="true">
              [ 가 ]
            </span>
            <h4>문자 검사를 준비하고 있습니다</h4>
            <p>학습 결과 폴더와 정답 파일을 선택하고 문자 포함 검사를 누르세요.</p>
          </section>
        )
      )}
    </div>
  )
}
