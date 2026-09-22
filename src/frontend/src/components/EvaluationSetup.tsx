import { useState } from 'react'
import type { EvaluationRequest, PathKind } from '../../../shared/contracts'
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
  const [checkpoints, setCheckpoints] = useState<string[]>([])
  const [choosing, setChoosing] = useState(false)
  const disabled = busy || choosing || !connected
  const complete = Object.values(request).every((value) => value.length > 0)

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
        setRequest((current) => ({ ...current, [requestFields[kind]]: selectedPath }))
        return
      }

      setRequest((current) => ({ ...current, runDirectory: selectedPath, checkpointPath: '' }))
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
    } catch {
      onError('경로를 읽지 못했습니다. 파일과 폴더에 접근할 수 있는지 확인해 주세요.')
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
        <PathField
          id="python-path"
          label="Python 실행 파일"
          value={request.pythonExecutable}
          placeholder="Paddle GPU 환경의 python.exe"
          disabled={disabled}
          onChoose={() => void choosePath('python')}
        />
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
            onChange={(event) =>
              setRequest((current) => ({ ...current, checkpointPath: event.target.value }))
            }
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
        {busy ? busyLabel : choosing ? '파일 확인 중…' : '평가 시작'}
        <span aria-hidden="true">→</span>
      </button>
      {!complete && (
        <p className="setup-hint">모든 경로와 체크포인트를 선택하면 시작할 수 있습니다.</p>
      )}
    </form>
  )
}
