import { useEffect, useRef, useState } from 'react'
import type { DiagnosticApi, DiagnosticResult, DiagnosticStage } from '../../../shared/diagnostics'
import { DiagnosticShapes } from './DiagnosticShapes'
import { ImageDialog } from './ImageDialog'
import { SampleImage } from './SampleImage'

export function SampleDiagnostics({
  reportPath,
  sampleId,
  busy,
  connectionError,
  progressMessage,
  inspect
}: {
  reportPath: string
  sampleId: string
  busy: boolean
  connectionError: string | null
  progressMessage: string | null
  inspect: DiagnosticApi['inspect']
}): React.JSX.Element {
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [preview, setPreview] = useState<DiagnosticStage | null>(null)
  const active = useRef(false)
  const pending = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  async function inspectInput(includeShapes: boolean): Promise<void> {
    if (busy || pending.current || connectionError != null || (includeShapes && result == null)) {
      return
    }
    pending.current = true
    setRequesting(true)
    setError(null)
    setPreview(null)
    const previous = result
    if (!includeShapes) {
      setResult(null)
    }
    try {
      const response = await inspect(reportPath, sampleId, includeShapes)
      if (!active.current) {
        return
      }
      if (!response.ok) {
        setError(response.error)
        if (includeShapes) {
          setResult(null)
        }
        return
      }
      if (
        response.value.reportPath !== reportPath ||
        response.value.sampleId !== sampleId ||
        (includeShapes && response.value.inputFingerprint !== previous?.inputFingerprint)
      ) {
        setResult(null)
        setError('기본 진단과 상세 정보의 입력이 다릅니다. 모델 입력을 다시 확인해 주세요.')
        return
      }
      setResult(response.value)
    } finally {
      pending.current = false
      if (active.current) {
        setRequesting(false)
      }
    }
  }

  return (
    <section className="sample-diagnostics" aria-label="모델 입력 진단">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">MODEL INPUT</span>
          <h3>모델 입력 확인</h3>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy || requesting || connectionError != null}
          onClick={() => void inspectInput(false)}
        >
          모델 입력 확인
        </button>
      </div>
      <p className="diagnostic-source-note">
        선택한 샘플의 평가 보고서에 연결된 입력과 전처리를 확인합니다.
      </p>
      {connectionError != null || error != null ? (
        <div className="error-banner" role="alert">
          <strong>진단 실패</strong>
          <span>{connectionError ?? error}</span>
        </div>
      ) : null}
      {(requesting || (busy && progressMessage != null)) && (
        <p className="diagnostic-operation" role="status">
          {progressMessage ?? '모델 입력 확인 중…'}
        </p>
      )}
      {result != null && (
        <>
          <p className="diagnostic-policy">
            Pooling 정책 <code>{result.poolingPolicy}</code>
          </p>
          <div className="diagnostic-stage-list">
            {result.stages.map((stage) => (
              <article className="diagnostic-stage" key={stage.id} aria-label={stage.name}>
                <h4>{stage.name}</h4>
                <p>{stage.description}</p>
                <button
                  type="button"
                  className="diagnostic-preview-button"
                  aria-label={`${stage.name} 확대`}
                  onClick={() => setPreview(stage)}
                >
                  <SampleImage
                    preview={{
                      url: stage.previewUrl,
                      width: stage.imageWidth,
                      height: stage.imageHeight,
                      contentBounds: stage.contentBounds
                    }}
                    label={`${stage.name} 표시용 미리보기`}
                  />
                </button>
                <p className="diagnostic-preview-note">표시용 미리보기 · {stage.previewNote}</p>
                {stage.contentBounds != null && (
                  <p className="diagnostic-bound-note">점선: 실제 이미지 영역 · 바깥: 패딩 영역</p>
                )}
                <dl>
                  <div>
                    <dt>크기</dt>
                    <dd>
                      {stage.imageWidth} × {stage.imageHeight}
                    </dd>
                  </div>
                  <div>
                    <dt>shape</dt>
                    <dd>
                      <code>[{stage.shape.join(', ')}]</code>
                    </dd>
                  </div>
                  <div>
                    <dt>dtype</dt>
                    <dd>
                      <code>{stage.dtype}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>최솟값</dt>
                    <dd>{String(stage.minimum)}</dd>
                  </div>
                  <div>
                    <dt>최댓값</dt>
                    <dd>{String(stage.maximum)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          <div className="diagnostic-detail-action">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || requesting || result.shapes != null}
              onClick={() => void inspectInput(true)}
            >
              상세 정보
            </button>
            <span>학습 모드와 평가 모드의 실제 shape를 확인합니다.</span>
          </div>
          {result.shapes != null && <DiagnosticShapes rows={result.shapes} />}
        </>
      )}
      {preview != null && (
        <ImageDialog
          preview={{
            url: preview.previewUrl,
            width: preview.imageWidth,
            height: preview.imageHeight,
            contentBounds: preview.contentBounds,
            label: preview.name,
            note: preview.previewNote
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  )
}
