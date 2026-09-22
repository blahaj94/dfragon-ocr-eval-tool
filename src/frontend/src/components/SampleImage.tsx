import { useEffect, useState } from 'react'
import type { Result } from '../../../shared/contracts'

export type ImageReader = (imagePath: string) => Promise<Result<string>>

export function SampleImage({
  imagePath,
  label,
  enlarged = false,
  readImage = window.evaluation.readImage
}: {
  imagePath: string
  label: string
  enlarged?: boolean
  readImage?: ImageReader
}): React.JSX.Element {
  const [image, setImage] = useState<{
    path: string
    url: string | null
    error: string | null
    reader: ImageReader
  } | null>(null)

  useEffect(() => {
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
  }, [imagePath, readImage])

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
