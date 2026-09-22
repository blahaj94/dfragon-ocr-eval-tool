import { useEffect, useState } from 'react'

export function SampleImage({
  imagePath,
  label,
  enlarged = false
}: {
  imagePath: string
  label: string
  enlarged?: boolean
}): React.JSX.Element {
  const [image, setImage] = useState<{
    path: string
    url: string | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    let active = true
    void window.evaluation
      .readImage(imagePath)
      .then((result) => {
        if (!active) {
          return
        }
        setImage(
          result.ok
            ? { path: imagePath, url: result.value, error: null }
            : { path: imagePath, url: null, error: result.error }
        )
      })
      .catch(() => {
        if (active) {
          setImage({ path: imagePath, url: null, error: '이미지를 읽지 못했습니다.' })
        }
      })
    return () => {
      active = false
    }
  }, [imagePath])

  if (image?.path !== imagePath) {
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
        setImage({ path: imagePath, url: null, error: 'PNG 이미지를 표시하지 못했습니다.' })
      }
    />
  )
}
