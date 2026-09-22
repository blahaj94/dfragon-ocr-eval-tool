import { useEffect, useState } from 'react'
import type { EvaluationRequest, PathKind, PythonRuntime } from '../../../shared/contracts'
import { PathField } from './PathField'

const emptyRequest: EvaluationRequest = {
  pythonExecutable: '',
  ldbOcrSourcePath: '',
  runDirectory: '',
  checkpointPath: '',
  datasetDirectory: '',
  labelsPath: '',
  outputDirectory: ''
}

const requestFields: Record<PathKind, keyof EvaluationRequest> = {
  python: 'pythonExecutable',
  source: 'ldbOcrSourcePath',
  run: 'runDirectory',
  dataset: 'datasetDirectory',
  labels: 'labelsPath',
  output: 'outputDirectory'
}

export function EvaluationSetup({
  busy,
  busyLabel = '평가 진행 중',
  connected,
  onStart,
  onError
}: {
  busy: boolean
  busyLabel?: string
  connected: boolean
  onStart: (request: EvaluationRequest) => void
  onError: (error: string | null) => void
}): React.JSX.Element {
  const [request, setRequest] = useState(emptyRequest)
  const [pythons, setPythons] = useState<PythonRuntime[]>([])
  const [checkpoints, setCheckpoints] = useState<string[]>([])
  const [choosing, setChoosing] = useState(false)
  const [initializing, setInitializing] = useState(window.evaluation != null)
  const disabled = busy || choosing || initializing || !connected
  const selectedPython = pythons.find((python) => python.executable === request.pythonExecutable)
  const complete =
    Object.values(request).every((value) => value.length > 0) && selectedPython?.supported === true

  useEffect(() => {
    if (window.evaluation == null) {
      return
    }
    let active = true
    async function restore(): Promise<void> {
      try {
        const saved = await window.evaluation.getSettings()
        if (!active) {
          return
        }
        if (!saved.ok) {
          onError(saved.error)
          return
        }
        setPythons(saved.value.pythons)
        const next = { ...emptyRequest, ...saved.value.settings }
        if (next.runDirectory) {
          const inspection = await window.evaluation.inspectRun(next.runDirectory)
          if (!active) {
            return
          }
          if (inspection.ok) {
            setCheckpoints(inspection.value.checkpoints)
            if (
              next.checkpointPath &&
              !inspection.value.checkpoints.includes(next.checkpointPath)
            ) {
              next.checkpointPath = ''
              onError('저장된 체크포인트를 찾지 못했습니다. 다시 선택하세요.')
            }
          } else {
            next.checkpointPath = ''
            onError(inspection.error)
          }
        }
        setRequest(next)
      } catch {
        if (active) {
          onError('저장된 평가 설정을 읽지 못했습니다.')
        }
      } finally {
        if (active) {
          setInitializing(false)
        }
      }
    }
    void restore()
    return () => {
      active = false
    }
  }, [onError])

  async function save(next: EvaluationRequest): Promise<void> {
    const result = await window.evaluation.saveSettings(next)
    if (!result.ok) {
      throw new Error(`평가 설정을 저장하지 못했습니다. ${result.error}`)
    }
  }

  async function selectCheckpoint(path: string): Promise<void> {
    if (disabled) {
      return
    }
    setChoosing(true)
    onError(null)
    const next = { ...request, checkpointPath: path }
    try {
      await save(next)
      setRequest(next)
    } catch (error) {
      onError(error instanceof Error ? error.message : '평가 설정을 저장하지 못했습니다.')
    } finally {
      setChoosing(false)
    }
  }

  async function selectPython(path: string): Promise<void> {
    if (disabled) {
      return
    }
    setChoosing(true)
    onError(null)
    try {
      const next = { ...request, pythonExecutable: path }
      await save(next)
      setRequest(next)
    } catch (error) {
      onError(error instanceof Error ? error.message : '평가 설정을 저장하지 못했습니다.')
    } finally {
      setChoosing(false)
    }
  }

  async function choosePath(kind: PathKind): Promise<void> {
    if (disabled) {
      return
    }
    setChoosing(true)
    onError(null)

    try {
      const result = await window.evaluation.choosePath(kind)
      if (!result.ok) {
        onError(result.error)
        return
      }
      if (result.value == null) {
        return
      }

      const selectedPath = result.value
      if (kind !== 'run') {
        const next = { ...request, [requestFields[kind]]: selectedPath }
        await save(next)
        setRequest(next)
        if (kind === 'python') {
          const refreshed = await window.evaluation.getSettings()
          if (!refreshed.ok) {
            onError(refreshed.error)
          } else {
            setPythons(refreshed.value.pythons)
          }
        }
        return
      }

      const next = { ...request, runDirectory: selectedPath, checkpointPath: '' }
      await save(next)
      setRequest(next)
      setCheckpoints([])
      const inspection = await window.evaluation.inspectRun(selectedPath)
      if (!inspection.ok) {
        onError(inspection.error)
        return
      }

      setCheckpoints(inspection.value.checkpoints)
      if (inspection.value.checkpoints.length === 0) {
        onError('이 학습 결과 폴더에서 지원하는 체크포인트를 찾지 못했습니다.')
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : '경로를 읽거나 설정을 저장하지 못했습니다.')
    } finally {
      setChoosing(false)
    }
  }

  return (
    <form
      className="setup-panel panel"
      aria-label="평가 설정"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && complete) {
          onStart(request)
        }
      }}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">EVALUATION SETUP</span>
          <h3>평가 설정</h3>
        </div>
        <span className="subtle-badge">단일 체크포인트</span>
      </div>

      <fieldset disabled={disabled}>
        <legend>
          <span className="step-number">01</span>실행 환경
        </legend>
        <div className="field">
          <label htmlFor="python-path">Python 실행 파일</label>
          <div className="path-control">
            <select
              id="python-path"
              value={request.pythonExecutable}
              disabled={disabled}
              title={request.pythonExecutable}
              onChange={(event) => void selectPython(event.target.value)}
            >
              <option value="">
                {initializing ? '설치된 Python 확인 중…' : 'Python 버전 선택'}
              </option>
              {request.pythonExecutable && !selectedPython && (
                <option value={request.pythonExecutable} disabled>
                  확인 불가 · {request.pythonExecutable}
                </option>
              )}
              {pythons.map((python) => (
                <option
                  key={python.executable}
                  value={python.executable}
                  disabled={!python.supported}
                >
                  Python {python.version}
                  {python.supported ? '' : ' · 미지원'} — {python.executable}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button button-secondary"
              disabled={disabled}
              aria-label="Python 실행 파일 선택"
              onClick={() => void choosePath('python')}
            >
              찾아보기
            </button>
          </div>
          <p className="field-help">Python 3.12 지원 · 목록에 없는 가상환경은 찾아보기로 추가</p>
        </div>
        <PathField
          id="source-path"
          label="ldb-ocr 소스 폴더"
          value={request.ldbOcrSourcePath}
          placeholder="기존 ldb-ocr 저장소"
          disabled={disabled}
          onChoose={() => void choosePath('source')}
        />
        <p className="field-help">이미 준비된 GPU 환경과 기존 모델 코드를 사용합니다.</p>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>
          <span className="step-number">02</span>모델
        </legend>
        <PathField
          id="run-path"
          label="학습 결과 폴더"
          value={request.runDirectory}
          placeholder="config와 checkpoints가 있는 실행 폴더"
          disabled={disabled}
          onChoose={() => void choosePath('run')}
        />
        <div className="field">
          <label htmlFor="checkpoint">체크포인트</label>
          <select
            id="checkpoint"
            value={request.checkpointPath}
            disabled={disabled || checkpoints.length === 0}
            onChange={(event) => void selectCheckpoint(event.target.value)}
          >
            <option value="">
              {request.runDirectory.length === 0
                ? '학습 결과 폴더를 먼저 선택하세요'
                : '평가할 체크포인트를 선택하세요'}
            </option>
            {checkpoints.map((checkpoint) => (
              <option key={checkpoint} value={checkpoint}>
                {checkpoint.split(/[\\/]/).at(-1)}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>
          <span className="step-number">03</span>Real dataset
        </legend>
        <PathField
          id="dataset-path"
          label="Cropper 캡처 루트"
          value={request.datasetDirectory}
          placeholder="캡처 결과의 최상위 폴더"
          disabled={disabled}
          onChoose={() => void choosePath('dataset')}
        />
        <PathField
          id="labels-path"
          label="정답 파일"
          value={request.labelsPath}
          placeholder="labels.json"
          disabled={disabled}
          onChoose={() => void choosePath('labels')}
        />
        <p className="field-help">정답 목록에 등록된 ROI PNG만 평가합니다.</p>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>
          <span className="step-number">04</span>보고서
        </legend>
        <PathField
          id="output-path"
          label="보고서 저장 폴더"
          value={request.outputDirectory}
          placeholder="평가 보고서를 모아둘 폴더"
          disabled={disabled}
          onChoose={() => void choosePath('output')}
        />
        <p className="field-help">실행마다 새 폴더에 report.json을 자동 저장합니다.</p>
      </fieldset>

      <button
        type="submit"
        className="button button-primary start-button"
        disabled={disabled || !complete}
      >
        {busy
          ? busyLabel
          : initializing
            ? '설정 불러오는 중…'
            : choosing
              ? '파일 확인 중…'
              : '평가 시작'}
        <span aria-hidden="true">→</span>
      </button>
      {!complete && (
        <p className="setup-hint">모든 경로와 체크포인트를 선택하면 시작할 수 있습니다.</p>
      )}
    </form>
  )
}
