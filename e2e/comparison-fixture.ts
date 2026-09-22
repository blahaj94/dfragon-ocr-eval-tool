import type { Page } from '@playwright/test'
import type { ComparisonApi, ComparisonResult, ComparisonSample } from '../src/shared/comparison'
import type { DatasetApi, DatasetSnapshot } from '../src/shared/dataset'
import type { EvaluationApi, PathKind } from '../src/shared/contracts'

interface ComparisonFixtureWindow extends Window {
  comparison: ComparisonApi
  evaluation: EvaluationApi
  dataset: DatasetApi
  comparisonFixture: {
    imageReads: string[]
    evaluationImageReads: string[]
    failNextCompare: boolean
    comparisons: number
  }
}

// Fixed saved-report UI fixtures do not load a model or perform inference.
export async function installComparisonFixture(page: Page, emptyRegression = false): Promise<void> {
  await page.addInitScript(
    ({ emptyRegression }) => {
      const fixtureWindow = window as unknown as ComparisonFixtureWindow
      fixtureWindow.comparisonFixture = {
        imageReads: [],
        evaluationImageReads: [],
        failNextCompare: false,
        comparisons: 0
      }
      const samples: ComparisonSample[] = [
        {
          a: {
            id: 'regression',
            imagePath: 'C:\\fixture\\a\\001.png',
            truth: '기사',
            prediction: '기사',
            editDistance: 0,
            confidence: 0.99
          },
          b: {
            id: 'regression',
            imagePath: 'C:\\fixture\\b\\001.png',
            truth: '기사',
            prediction: '기시',
            editDistance: 1,
            confidence: 0.9
          },
          group: 'regressed'
        },
        {
          a: {
            id: 'improvement',
            imagePath: 'C:\\fixture\\a\\002.png',
            truth: '마법사',
            prediction: '마법',
            editDistance: 1,
            confidence: 0.8
          },
          b: {
            id: 'improvement',
            imagePath: 'C:\\fixture\\b\\002.png',
            truth: '마법사',
            prediction: '마법사',
            editDistance: 0,
            confidence: 0.98
          },
          group: 'improved'
        },
        {
          a: {
            id: 'correct',
            imagePath: 'C:\\fixture\\a\\003.png',
            truth: '검신',
            prediction: '검신',
            editDistance: 0,
            confidence: null
          },
          b: {
            id: 'correct',
            imagePath: 'C:\\fixture\\b\\003.png',
            truth: '검신',
            prediction: '검신',
            editDistance: 0,
            confidence: null
          },
          group: 'both-correct'
        },
        {
          a: {
            id: 'wrong',
            imagePath: 'C:\\fixture\\a\\004.png',
            truth: '사냥꾼',
            prediction: '사냥',
            editDistance: 1,
            confidence: 0.5
          },
          b: {
            id: 'wrong',
            imagePath: 'C:\\fixture\\b\\004.png',
            truth: '사냥꾼',
            prediction: '',
            editDistance: 3,
            confidence: 0
          },
          group: 'both-wrong'
        }
      ]
      if (emptyRegression) {
        samples[0] = {
          ...samples[0],
          group: 'both-correct',
          b: { ...samples[0].b, prediction: '기사', editDistance: 0 }
        }
      }
      let chosenReports = 0
      fixtureWindow.comparison = {
        chooseReport: async () => {
          const paths = [
            'C:\\fixture\\run-a\\report.json',
            'C:\\fixture\\run-b\\report.json',
            'C:\\fixture\\run-c\\report.json'
          ]
          const path = paths[Math.min(chosenReports, paths.length - 1)]
          chosenReports += 1
          return { ok: true, value: path }
        },
        compare: async (reportAPath, reportBPath) => {
          fixtureWindow.comparisonFixture.comparisons += 1
          if (fixtureWindow.comparisonFixture.failNextCompare) {
            return { ok: false, error: 'Fixture: 두 보고서의 정답이 일치하지 않습니다.' }
          }
          const result: ComparisonResult = {
            reportAPath,
            reportBPath,
            summaryA: {
              cer: 0.2,
              exactMatch: 0.5,
              exactMatchCount: 2,
              sampleCount: 4,
              characterCount: 10
            },
            summaryB: {
              cer: emptyRegression ? 0.3 : 0.4,
              exactMatch: emptyRegression ? 0.75 : 0.5,
              exactMatchCount: emptyRegression ? 3 : 2,
              sampleCount: 4,
              characterCount: 10
            },
            counts: {
              regressed: emptyRegression ? 0 : 1,
              improved: 1,
              'both-correct': emptyRegression ? 2 : 1,
              'both-wrong': 1
            },
            samples
          }
          return { ok: true, value: structuredClone(result) }
        },
        readImage: async (imagePath) => {
          fixtureWindow.comparisonFixture.imageReads.push(imagePath)
          return {
            ok: true,
            value:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6SIAAAAASUVORK5CYII='
          }
        }
      }

      const paths: Record<PathKind, string> = {
        python: 'C:\\fixture\\python.exe',
        source: 'C:\\fixture\\ldb-ocr',
        run: 'C:\\fixture\\run',
        dataset: 'C:\\fixture\\captures',
        labels: 'C:\\fixture\\labels.json',
        output: 'C:\\fixture\\output'
      }
      fixtureWindow.evaluation = {
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
          value: { checkpoints: ['C:\\fixture\\run\\latest.pdparams'] }
        }),
        getSnapshot: async () => ({
          ok: true,
          value: {
            status: 'idle',
            totalSamples: 0,
            processedSamples: 0,
            samples: [],
            report: null,
            reportPath: null,
            error: null
          }
        }),
        onSnapshot: () => () => {},
        start: async () => ({
          ok: false,
          error: 'Evaluation is outside this saved-report fixture.'
        }),
        cancel: async () => ({ ok: true, value: null }),
        readImage: async (imagePath) => {
          fixtureWindow.comparisonFixture.evaluationImageReads.push(imagePath)
          return { ok: false, error: 'Comparison must use its own image reader.' }
        },
        openReport: async () => ({ ok: true, value: null })
      }
      const dataset: DatasetSnapshot = {
        recordPath: 'C:\\fixture\\appdata\\dataset.json',
        selection: {
          pythonExecutable: paths.python,
          datasetDirectory: paths.dataset,
          labelsPath: paths.labels
        },
        groups: [
          {
            eventId: 'saved-capture',
            imageCount: 1,
            confirmedCount: 0,
            pendingCount: 1,
            split: null,
            confirmedSplit: null
          }
        ],
        counts: { train: 0, val: 0, test: 0, unassigned: 1 },
        check: null,
        canConfirm: false,
        exportDirectory: null
      }
      fixtureWindow.dataset = {
        getSnapshot: async () => ({ ok: true, value: structuredClone(dataset) }),
        load: async () => ({ ok: true, value: structuredClone(dataset) }),
        assign: async () => ({
          ok: false,
          error: 'Dataset assignment is outside this saved-report fixture.'
        }),
        check: async () => ({
          ok: false,
          error: 'Dataset check is outside this saved-report fixture.'
        }),
        confirm: async () => ({
          ok: false,
          error: 'Dataset confirmation is outside this saved-report fixture.'
        }),
        export: async () => ({
          ok: false,
          error: 'Dataset export is outside this saved-report fixture.'
        })
      }
    },
    { emptyRegression }
  )
}

export async function chooseComparisonReports(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '결과 비교', exact: true }).click()
  await page.getByRole('button', { name: 'A 보고서 선택', exact: true }).click()
  await page.getByRole('button', { name: 'B 보고서 선택', exact: true }).click()
  await page.getByRole('button', { name: '보고서 비교', exact: true }).click()
}

export async function failNextComparison(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as ComparisonFixtureWindow).comparisonFixture.failNextCompare = true
  })
}

export async function comparisonImageReads(
  page: Page
): Promise<{ imageReads: string[]; evaluationImageReads: string[] }> {
  return page.evaluate(() => {
    const { imageReads, evaluationImageReads } = (window as unknown as ComparisonFixtureWindow)
      .comparisonFixture
    return { imageReads, evaluationImageReads }
  })
}
