import { useCallback, useEffect, useRef, useState } from 'react'
import type { Result } from '../../../shared/contracts'
import type { DiagnosticApi, DiagnosticSnapshot } from '../../../shared/diagnostics'

const idleSnapshot: DiagnosticSnapshot = {
  status: 'idle',
  reportPath: null,
  sampleId: null,
  message: null
}

export function useDiagnosticSession(): {
  busy: boolean
  available: boolean
  connectionError: string | null
  snapshot: DiagnosticSnapshot
  inspect: DiagnosticApi['inspect']
  cancelOwned: (reportPath: string, sampleId: string) => Promise<Result<null>>
} {
  const [snapshot, setSnapshot] = useState(idleSnapshot)
  const [initializing, setInitializing] = useState(window.diagnostics != null)
  const [requestPending, setRequestPending] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const snapshotRef = useRef(idleSnapshot)
  const requestRef = useRef<{ reportPath: string; sampleId: string } | null>(null)

  useEffect(() => {
    if (window.diagnostics == null) {
      return
    }
    let active = true
    let receivedUpdate = false
    const unsubscribe = window.diagnostics.onSnapshot((next) => {
      if (!active) {
        return
      }
      receivedUpdate = true
      snapshotRef.current = next
      setSnapshot(next)
      setConnectionError(null)
      setInitializing(false)
    })
    void window.diagnostics
      .getSnapshot()
      .then((result) => {
        if (!active || receivedUpdate) {
          return
        }
        if (!result.ok) {
          setConnectionError(result.error)
        } else {
          snapshotRef.current = result.value
          setSnapshot(result.value)
        }
        setInitializing(false)
      })
      .catch(() => {
        if (active && !receivedUpdate) {
          setConnectionError('모델 입력 진단 상태를 읽지 못했습니다.')
          setInitializing(false)
        }
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const inspect = useCallback<DiagnosticApi['inspect']>(
    async (reportPath, sampleId, includeShapes) => {
      if (window.diagnostics == null) {
        return { ok: false, error: '모델 입력 진단 연결이 없습니다.' }
      }
      if (requestRef.current != null || snapshotRef.current.status !== 'idle') {
        return { ok: false, error: '모델 입력 진단 작업이 진행 중입니다.' }
      }
      requestRef.current = { reportPath, sampleId }
      setRequestPending(true)
      try {
        return await window.diagnostics.inspect(reportPath, sampleId, includeShapes)
      } catch {
        return { ok: false, error: '모델 입력 진단을 완료하지 못했습니다.' }
      } finally {
        requestRef.current = null
        setRequestPending(false)
      }
    },
    []
  )

  const cancelOwned = useCallback(
    async (reportPath: string, sampleId: string): Promise<Result<null>> => {
      const owner =
        requestRef.current ?? (snapshotRef.current.status === 'idle' ? null : snapshotRef.current)
      if (
        owner?.reportPath !== reportPath ||
        owner.sampleId !== sampleId ||
        window.diagnostics == null
      ) {
        return { ok: true, value: null }
      }
      try {
        return await window.diagnostics.cancel()
      } catch {
        return { ok: false, error: '모델 입력 진단 취소 요청을 전달하지 못했습니다.' }
      }
    },
    []
  )

  return {
    busy: initializing || requestPending || snapshot.status !== 'idle',
    available: window.diagnostics != null,
    connectionError,
    snapshot,
    inspect,
    cancelOwned
  }
}
