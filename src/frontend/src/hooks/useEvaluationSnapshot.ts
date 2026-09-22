import { useEffect, useState } from 'react'
import type { EvaluationSnapshot } from '../../../shared/contracts'

const initialSnapshot: EvaluationSnapshot = {
  status: 'idle',
  totalSamples: 0,
  processedSamples: 0,
  samples: [],
  report: null,
  reportPath: null,
  error: null
}

export function useEvaluationSnapshot(): {
  snapshot: EvaluationSnapshot
  connectionError: string | null
} {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [connectionError, setConnectionError] = useState<string | null>(() =>
    window.evaluation == null
      ? '로컬 평가 연결을 찾을 수 없습니다. Electron 앱으로 실행해 주세요.'
      : null
  )

  useEffect(() => {
    if (window.evaluation == null) {
      return
    }

    let active = true
    let receivedUpdate = false
    const unsubscribe = window.evaluation.onSnapshot((nextSnapshot) => {
      if (!active) {
        return
      }
      receivedUpdate = true
      setSnapshot(nextSnapshot)
    })

    void window.evaluation
      .getSnapshot()
      .then((result) => {
        if (!active) {
          return
        }
        if (!result.ok) {
          setConnectionError(result.error)
        } else if (!receivedUpdate) {
          setSnapshot(result.value)
        }
      })
      .catch(() => {
        if (active) {
          setConnectionError('평가 상태를 읽지 못했습니다. 앱을 다시 실행해 주세요.')
        }
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return { snapshot, connectionError }
}
