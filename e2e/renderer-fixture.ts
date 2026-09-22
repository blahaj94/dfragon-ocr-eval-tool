import type { Page } from '@playwright/test'
import type {
  EvaluationApi,
  EvaluationReport,
  EvaluationSample,
  EvaluationSnapshot,
  PathKind
} from '../src/shared/contracts'

export type FixtureMode =
  | 'completed'
  | 'running'
  | 'start-error'
  | 'stale-initial'
  | 'settings-save-error'
  | 'settings-read-error'
  | 'missing-checkpoint'

interface FixtureWindow extends Window {
  evaluation: EvaluationApi
  fixtureState: { startCount: number; reportOpenCount: number }
}

// Browser fixtures exercise presentation only. They never represent real model inference.
export async function installRendererFixture(page: Page, mode: FixtureMode): Promise<void> {
  await page.addInitScript(
    ({ mode }) => {
      const fixtureWindow = window as unknown as FixtureWindow
      const listeners = new Set<(snapshot: EvaluationSnapshot) => void>()
      const samples: EvaluationSample[] = [
        {
          id: 'capture/roi-01.png',
          imagePath: 'C:\\fixture\\capture\\roi-01.png',
          truth: '나이트',
          prediction: '나이즈',
          editDistance: 1,
          confidence: 0.9345
        },
        {
          id: 'capture/roi-02.png',
          imagePath: 'C:\\fixture\\capture\\roi-02.png',
          truth: '박물관',
          prediction: '',
          editDistance: 3,
          confidence: 0
        },
        {
          id: 'capture/roi-03.png',
          imagePath: 'C:\\fixture\\capture\\roi-03.png',
          truth: '검신',
          prediction: '검신',
          editDistance: 0,
          confidence: null
        }
      ]
      let snapshot: EvaluationSnapshot = {
        status: 'idle',
        totalSamples: 0,
        processedSamples: 0,
        samples: [],
        report: null,
        reportPath: null,
        error: null
      }
      fixtureWindow.fixtureState = { startCount: 0, reportOpenCount: 0 }

      function publish(next: EvaluationSnapshot): void {
        snapshot = next
        for (const listener of listeners) {
          listener(snapshot)
        }
      }

      function report(status: EvaluationReport['status']): EvaluationReport {
        return {
          status,
          totalSamples: 3,
          processedSamples: status === 'completed' ? 3 : 1,
          samples: status === 'completed' ? samples : samples.slice(0, 1),
          summary:
            status === 'completed'
              ? { cer: 0.5, exactMatch: 1 / 3, sampleCount: 3, characterCount: 8 }
              : null,
          partialSummary:
            status === 'completed'
              ? null
              : { cer: 1 / 3, exactMatch: 0, sampleCount: 1, characterCount: 3 },
          error: null,
          startedAt: '2026-01-01T00:00:00Z',
          finishedAt: '2026-01-01T00:00:01Z'
        }
      }

      const running: EvaluationSnapshot = {
        ...snapshot,
        status: 'running',
        totalSamples: 3,
        processedSamples: 1,
        samples: samples.slice(0, 1)
      }
      const paths: Record<PathKind, string> = {
        python: 'C:\\fixture\\python.exe',
        source: 'C:\\fixture\\ldb-ocr',
        run: 'C:\\fixture\\run',
        dataset: 'C:\\fixture\\captures',
        labels: 'C:\\fixture\\labels.json',
        output: 'C:\\fixture\\reports'
      }

      fixtureWindow.evaluation = {
        createLabels: async () => ({ ok: true, value: null }),
        getSettings: async () =>
          mode === 'settings-read-error'
            ? { ok: false, error: 'Fixture: 설정 파일을 읽지 못했습니다.' }
            : {
                ok: true,
                value: {
                  settings:
                    mode === 'missing-checkpoint'
                      ? {
                          runDirectory: paths.run,
                          checkpointPath: 'C:\\fixture\\run\\deleted.pdparams'
                        }
                      : {},
                  pythons: [
                    { executable: paths.python, version: '3.12.14', supported: true },
                    {
                      executable: 'C:\\fixture\\Python313\\python.exe',
                      version: '3.13.7',
                      supported: false
                    },
                    {
                      executable: 'C:\\fixture\\gpu-env\\python.exe',
                      version: '3.12.10',
                      supported: true
                    }
                  ]
                }
              },
        saveSettings: async () =>
          mode === 'settings-save-error'
            ? { ok: false, error: 'Fixture: 디스크 저장 실패' }
            : { ok: true, value: null },
        choosePath: async (kind) => ({ ok: true, value: paths[kind] }),
        inspectRun: async () => ({
          ok: true,
          value: {
            checkpoints: [
              'C:\\fixture\\run\\checkpoints\\latest.pdparams',
              'C:\\fixture\\run\\checkpoints\\epoch-1.pdparams'
            ]
          }
        }),
        start: async () => {
          fixtureWindow.fixtureState.startCount += 1
          if (mode === 'start-error') {
            return { ok: false, error: 'Fixture: 정답 파일의 ROI 경로가 올바르지 않습니다.' }
          }
          if (mode === 'completed') {
            const completed = report('completed')
            publish({
              status: 'completed',
              totalSamples: 3,
              processedSamples: 3,
              samples,
              report: completed,
              reportPath: 'C:\\fixture\\reports\\run-001\\report.json',
              error: null
            })
          } else {
            publish(running)
          }
          return { ok: true, value: null }
        },
        cancel: async () => {
          const cancelled = report('cancelled')
          publish({
            ...running,
            status: 'cancelled',
            report: cancelled,
            reportPath: 'C:\\fixture\\reports\\run-001\\report.json'
          })
          return { ok: true, value: null }
        },
        readImage: async () => ({
          ok: true,
          value:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6SIAAAAASUVORK5CYII='
        }),
        getSnapshot: async () => {
          if (mode === 'stale-initial') {
            const stale = snapshot
            publish(running)
            return { ok: true, value: stale }
          }
          return { ok: true, value: snapshot }
        },
        onSnapshot: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        openReport: async () => {
          fixtureWindow.fixtureState.reportOpenCount += 1
          return { ok: true, value: null }
        }
      }
    },
    { mode }
  )
}

export async function selectEvaluationInputs(page: Page): Promise<void> {
  for (const label of [
    'Python 실행 파일',
    'ldb-ocr 소스 폴더',
    '학습 결과 폴더',
    'Cropper 캡처 루트',
    '정답 파일',
    '보고서 저장 폴더'
  ]) {
    await page.getByRole('button', { name: `${label} 선택`, exact: true }).click()
  }
  await page.getByLabel('체크포인트', { exact: true }).selectOption({ label: 'latest.pdparams' })
}

export async function getFixtureCounts(
  page: Page
): Promise<{ startCount: number; reportOpenCount: number }> {
  return page.evaluate(() => (window as unknown as FixtureWindow).fixtureState)
}
