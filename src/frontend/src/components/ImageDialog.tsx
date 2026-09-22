import { useEffect, useRef } from 'react'
import type { EvaluationSample } from '../../../shared/contracts'
import { SampleImage } from './SampleImage'

export function ImageDialog({
  sample,
  onClose
}: {
  sample: EvaluationSample
  onClose: () => void
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="image-dialog"
      aria-labelledby="image-dialog-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="image-dialog-content">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ROI PREVIEW</span>
            <h3 id="image-dialog-title">이미지 확대</h3>
          </div>
          <button type="button" className="button button-secondary" onClick={onClose}>
            닫기 <span aria-hidden="true">×</span>
          </button>
        </div>
        <p className="image-path">{sample.imagePath}</p>
        <div className="image-stage">
          <SampleImage imagePath={sample.imagePath} label={`${sample.id} ROI 확대`} enlarged />
        </div>
        <dl className="image-comparison">
          <div>
            <dt>정답</dt>
            <dd>
              {sample.truth.length === 0 ? (
                <span className="empty-value">빈 정답</span>
              ) : (
                sample.truth
              )}
            </dd>
          </div>
          <div>
            <dt>예측</dt>
            <dd>
              {sample.prediction.length === 0 ? (
                <span className="empty-value">빈 예측</span>
              ) : (
                sample.prediction
              )}
            </dd>
          </div>
        </dl>
      </div>
    </dialog>
  )
}
