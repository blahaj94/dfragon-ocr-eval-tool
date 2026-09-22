import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { EvaluationSample } from '../../../shared/contracts'
import { SampleImage, type ImagePreview, type ImageReader } from './SampleImage'

type ImageDialogProps = {
  onClose: () => void
  children?: ReactNode
} & (
  | {
      sample: EvaluationSample
      readImage?: ImageReader
      comparisonSample?: EvaluationSample
      preview?: never
    }
  | {
      sample?: never
      readImage?: never
      comparisonSample?: never
      preview: ImagePreview & { label: string; note: string }
    }
)

export function ImageDialog({
  sample,
  onClose,
  readImage,
  comparisonSample,
  preview,
  children
}: ImageDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="image-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="image-dialog-content">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              {preview == null ? 'ROI PREVIEW' : 'MODEL INPUT PREVIEW'}
            </span>
            <h3 id={titleId}>이미지 확대</h3>
          </div>
          <button type="button" className="button button-secondary" onClick={onClose}>
            닫기 <span aria-hidden="true">×</span>
          </button>
        </div>
        <p className="image-path">{preview == null ? sample.imagePath : preview.label}</p>
        <div className="image-stage">
          {preview != null ? (
            <SampleImage preview={preview} label={`${preview.label} 확대 미리보기`} enlarged />
          ) : (
            <SampleImage
              imagePath={sample.imagePath}
              label={`${sample.id} ROI 확대`}
              enlarged
              readImage={readImage}
            />
          )}
        </div>
        {preview != null && (
          <p className="diagnostic-preview-note">표시용 미리보기 · {preview.note}</p>
        )}
        {sample != null && (
          <dl
            className={`image-comparison ${comparisonSample == null ? '' : 'comparison-image-details'}`}
          >
            <div className={comparisonSample == null ? undefined : 'comparison-image-truth'}>
              <dt>정답</dt>
              <dd>
                {sample.truth.length === 0 ? (
                  <span className="empty-value">빈 정답</span>
                ) : (
                  sample.truth
                )}
              </dd>
            </div>
            <div
              role={comparisonSample == null ? undefined : 'group'}
              aria-label={comparisonSample == null ? undefined : 'A 결과'}
            >
              <dt>{comparisonSample == null ? '예측' : 'A 예측'}</dt>
              <dd>
                {sample.prediction.length === 0 ? (
                  <span className="empty-value">빈 예측</span>
                ) : (
                  sample.prediction
                )}
              </dd>
              {comparisonSample != null && (
                <dd className="comparison-image-distance">
                  편집거리 <strong>{sample.editDistance}</strong>
                </dd>
              )}
            </div>
            {comparisonSample != null && (
              <div role="group" aria-label="B 결과">
                <dt>B 예측</dt>
                <dd>
                  {comparisonSample.prediction.length === 0 ? (
                    <span className="empty-value">빈 예측</span>
                  ) : (
                    comparisonSample.prediction
                  )}
                </dd>
                <dd className="comparison-image-distance">
                  편집거리 <strong>{comparisonSample.editDistance}</strong>
                </dd>
              </div>
            )}
          </dl>
        )}
        {children}
      </div>
    </dialog>
  )
}
