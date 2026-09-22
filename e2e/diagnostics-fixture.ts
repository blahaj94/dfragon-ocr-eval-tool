import type { Page } from '@playwright/test'
import type { EvaluationApi, EvaluationSample, PathKind, Result } from '../src/shared/contracts'
import type {
  DiagnosticApi,
  DiagnosticResult,
  DiagnosticShapeRow,
  DiagnosticSnapshot,
  DiagnosticStage
} from '../src/shared/diagnostics'

type DiagnosticMode = 'same' | 'mixed' | 'mismatch' | 'pending' | 'stale-initial' | 'error'
interface DiagnosticFixtureWindow extends Window {
  evaluation: EvaluationApi
  diagnostics: DiagnosticApi
  diagnosticFixture: {
    calls: { reportPath: string; sampleId: string; includeShapes: boolean }[]
    cancelCount: number
    imageReadCount: number
    finish: () => void
  }
}

// These fixed browser values test presentation and lifecycle, not model execution.
export async function installDiagnosticsFixture(
  page: Page,
  mode: DiagnosticMode = 'same'
): Promise<void> {
  await page.addInitScript(
    ({ mode }) => {
      const fixture = window as unknown as DiagnosticFixtureWindow
      const savedReport = 'C:\\fixture\\saved-evaluation\\report.json'
      const sample: EvaluationSample = {
        id: 'capture/roi.png',
        imagePath: 'C:\\fixture\\capture\\roi.png',
        truth: '기사',
        prediction: '기시',
        editDistance: 1,
        confidence: 0.8
      }
      const previewUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6SIAAAAASUVORK5CYII='
      const stages: DiagnosticStage[] = [
        {
          id: 'rgb',
          name: 'RGB 원본',
          description: 'Fixture RGB 데이터',
          previewUrl,
          previewNote: 'Fixture 원본 표시',
          imageWidth: 4,
          imageHeight: 2,
          shape: [2, 4, 3],
          dtype: 'uint8',
          minimum: 0,
          maximum: 255,
          contentBounds: null
        },
        {
          id: 'inverted',
          name: '반전 회색조',
          description: 'Fixture 반전 데이터',
          previewUrl,
          previewNote: 'Fixture 회색조 표시',
          imageWidth: 4,
          imageHeight: 2,
          shape: [2, 4],
          dtype: 'float32',
          minimum: 0,
          maximum: 255,
          contentBounds: null
        },
        {
          id: 'normalized',
          name: '정규화',
          description: 'Fixture 정규화 데이터',
          previewUrl,
          previewNote: '표시 범위로 변환한 이미지입니다. 실제 텐서 값은 아래 수치를 확인하세요.',
          imageWidth: 4,
          imageHeight: 2,
          shape: [2, 4],
          dtype: 'float32',
          minimum: -1,
          maximum: 1,
          contentBounds: null
        },
        {
          id: 'padded',
          name: '패딩',
          description: 'Fixture 패딩 데이터',
          previewUrl,
          previewNote: 'Fixture 패딩 표시',
          imageWidth: 8,
          imageHeight: 8,
          shape: [1, 8, 8],
          dtype: 'float32',
          minimum: -1,
          maximum: 1,
          contentBounds: { x: 0, y: 0, width: 4, height: 2 }
        },
        {
          id: 'batch',
          name: '모델 입력',
          description: 'Fixture batch 데이터',
          previewUrl,
          previewNote: 'Fixture batch 채널 표시',
          imageWidth: 8,
          imageHeight: 8,
          shape: [1, 1, 8, 8],
          dtype: 'float32',
          minimum: -1,
          maximum: 1,
          contentBounds: { x: 0, y: 0, width: 4, height: 2 }
        }
      ]
      const shapes: DiagnosticShapeRow[] = [
        {
          point: 'input',
          label: '모델 입력',
          train: { shape: [1, 1, 8, 8], error: null },
          evaluation: { shape: [1, 1, 8, 8], error: null }
        },
        {
          point: 'before-pooling',
          label: 'Pooling 직전',
          train: { shape: [1, 8, 2, 4], error: null },
          evaluation: { shape: mode === 'mixed' ? [1, 8, 1, 4] : [1, 8, 2, 4], error: null }
        },
        {
          point: 'after-pooling',
          label: 'Pooling 직후',
          train:
            mode === 'mixed'
              ? { shape: null, error: 'Fixture: 학습 모드 관측 실패' }
              : { shape: [1, 8, 1, 4], error: null },
          evaluation: { shape: [1, 8, 1, 4], error: null }
        }
      ]
      const paths: Record<PathKind, string> = {
        python: 'C:\\fixture\\python.exe',
        source: 'C:\\fixture\\ldb-ocr',
        run: 'C:\\fixture\\different-run',
        dataset: 'C:\\fixture\\capture',
        labels: 'C:\\fixture\\labels.json',
        output: 'C:\\fixture\\reports'
      }
      fixture.diagnosticFixture = { calls: [], cancelCount: 0, imageReadCount: 0, finish: () => {} }
      fixture.evaluation = {
        getSettings: async () => ({
          ok: true,
          value: {
            settings: {},
            pythons: [{ executable: paths.python, version: '3.12.14', supported: true }]
          }
        }),
        saveSettings: async () => ({ ok: true, value: null }),
        choosePath: async (kind) => ({ ok: true, value: paths[kind] }),
        inspectRun: async () => ({
          ok: true,
          value: { checkpoints: ['C:\\fixture\\different-run\\checkpoints\\latest.pdparams'] }
        }),
        start: async () => ({ ok: true, value: null }),
        cancel: async () => ({ ok: true, value: null }),
        readImage: async () => {
          fixture.diagnosticFixture.imageReadCount += 1
          return { ok: true, value: previewUrl }
        },
        getSnapshot: async () => ({
          ok: true,
          value: {
            status: 'completed',
            totalSamples: 1,
            processedSamples: 1,
            samples: [sample],
            reportPath: savedReport,
            error: null,
            report: {
              status: 'completed',
              totalSamples: 1,
              processedSamples: 1,
              summary: { cer: 0.5, exactMatch: 0, sampleCount: 1, characterCount: 2 },
              samples: [sample],
              error: null,
              startedAt: '2026-01-01T00:00:00Z',
              finishedAt: '2026-01-01T00:00:01Z'
            }
          }
        }),
        onSnapshot: () => () => {},
        openReport: async () => ({ ok: true, value: null })
      }
      let snapshot: DiagnosticSnapshot = {
        status: 'idle',
        reportPath: null,
        sampleId: null,
        message: null
      }
      const listeners = new Set<(value: DiagnosticSnapshot) => void>()
      let resolvePending: ((value: Result<DiagnosticResult>) => void) | null = null
      function publish(value: DiagnosticSnapshot): void {
        snapshot = value
        for (const listener of listeners) {
          listener(snapshot)
        }
      }
      fixture.diagnosticFixture.finish = () => {
        publish({ status: 'idle', reportPath: null, sampleId: null, message: null })
        resolvePending?.({ ok: false, error: 'Fixture: 진단을 취소했습니다.' })
        resolvePending = null
      }
      fixture.diagnostics = {
        inspect: async (reportPath, sampleId, includeShapes) => {
          fixture.diagnosticFixture.calls.push({ reportPath, sampleId, includeShapes })
          publish({
            status: 'running',
            reportPath,
            sampleId,
            message: 'Fixture: 모델을 읽는 중입니다.'
          })
          if (mode === 'pending') {
            return new Promise<Result<DiagnosticResult>>((resolve) => {
              resolvePending = resolve
            })
          }
          publish({ status: 'idle', reportPath: null, sampleId: null, message: null })
          if (mode === 'error') {
            return { ok: false, error: 'Fixture: 보고서의 원본 파일이 변경되었습니다.' }
          }
          return {
            ok: true,
            value: {
              reportPath,
              sampleId,
              poolingPolicy: 'global-height',
              inputFingerprint:
                mode === 'mismatch' && includeShapes ? 'different-input' : 'same-input',
              stages,
              shapes: includeShapes ? shapes : null
            }
          }
        },
        cancel: async () => {
          fixture.diagnosticFixture.cancelCount += 1
          publish({
            ...snapshot,
            status: 'cancelling',
            message: 'Fixture: 진단 프로세스 종료 대기 중입니다.'
          })
          return { ok: true, value: null }
        },
        getSnapshot: async () => {
          if (mode === 'stale-initial') {
            publish({
              status: 'running',
              reportPath: savedReport,
              sampleId: sample.id,
              message: 'Fixture: 먼저 도착한 최신 상태'
            })
            return { ok: false, error: 'Fixture: 무시해야 하는 이전 상태 오류' }
          }
          return { ok: true, value: snapshot }
        },
        onSnapshot: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        }
      }
    },
    { mode }
  )
}

export async function diagnosticCalls(
  page: Page
): Promise<DiagnosticFixtureWindow['diagnosticFixture']['calls']> {
  return page.evaluate(() => (window as unknown as DiagnosticFixtureWindow).diagnosticFixture.calls)
}

export async function finishDiagnosticFixture(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as DiagnosticFixtureWindow).diagnosticFixture.finish()
  )
}

export async function diagnosticCounters(
  page: Page
): Promise<{ cancelCount: number; imageReadCount: number }> {
  return page.evaluate(() => {
    const fixture = (window as unknown as DiagnosticFixtureWindow).diagnosticFixture
    return { cancelCount: fixture.cancelCount, imageReadCount: fixture.imageReadCount }
  })
}
