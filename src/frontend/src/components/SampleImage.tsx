import { useEffect, useState } from 'react'
import type { Result } from '../../../shared/contracts'

export type ImageReader = (imagePath: string) => Promise<Result<string>>

export interface ImagePreview {
  url: string
  width: number
  height: number
  contentBounds: { x: number; y: number; width: number; height: number } | null
}

type SampleImageProps = {
  label: string
  enlarged?: boolean
  readImage?: ImageReader
} & ({ imagePath: string; preview?: never } | { imagePath?: never; preview: ImagePreview })

export function SampleImage({
  imagePath,
  preview,
  label,
  enlarged = false,
  readImage = window.evaluation.readImage
}: SampleImageProps): React.JSX.Element {
  const [failedPreview, setFailedPreview] = useState<string | null>(null)
  const [image, setImage] = useState<{
    path: string
    url: string | null
    error: string | null
    reader: ImageReader
  } | null>(null)

  useEffect(() => {
    if (preview != null || imagePath == null) {
      return
    }
    let active = true
    void readImage(imagePath)
      .then((result) => {
        if (!active) {
          return
        }
        setImage(
          result.ok
            ? { path: imagePath, url: result.value, error: null, reader: readImage }
            : { path: imagePath, url: null, error: result.error, reader: readImage }
        )
      })
      .catch(() => {
        if (active) {
          setImage({
            path: imagePath,
            url: null,
            error: '이미지를 읽지 못했습니다.',
            reader: readImage
          })
        }
      })
    return () => {
      active = false
    }
  }, [imagePath, preview, readImage])

  if (preview != null) {
    if (failedPreview === preview.url) {
      return (
        <span className="image-placeholder image-error">표시용 미리보기를 열지 못했습니다.</span>
      )
    }
    const bounds = preview.contentBounds
    return (
      <span
        className={`diagnostic-preview-frame ${enlarged ? 'preview-enlarged' : ''}`}
        style={{
          aspectRatio: `${preview.width} / ${preview.height}`,
          width: enlarged ? '100%' : `min(100%, ${(190 * preview.width) / preview.height}px)`
        }}
      >
        <img
          src={preview.url}
          alt={label}
          draggable={false}
          onError={() => setFailedPreview(preview.url)}
        />
        {bounds != null && (
          <span
            className="diagnostic-content-bounds"
            title="실제 이미지 영역"
            style={{
              left: `${(bounds.x / preview.width) * 100}%`,
              top: `${(bounds.y / preview.height) * 100}%`,
              width: `${(bounds.width / preview.width) * 100}%`,
              height: `${(bounds.height / preview.height) * 100}%`
            }}
          />
        )}
      </span>
    )
  }

  if (image?.path !== imagePath || image.reader !== readImage) {
    return <span className="image-placeholder">불러오는 중…</span>
  }
  if (image.url == null) {
    return (
      <span className="image-placeholder image-error" title={image.error ?? undefined}>
        {enlarged ? image.error : '이미지 읽기 실패'}
      </span>
    )
  }

  return (
    <img
      className={enlarged ? 'enlarged-image' : 'sample-thumbnail'}
      src={image.url}
      alt={label}
      draggable={false}
      onError={() =>
        setImage({
          path: imagePath,
          url: null,
          error: 'PNG 이미지를 표시하지 못했습니다.',
          reader: readImage
        })
      }
    />
  )
}
