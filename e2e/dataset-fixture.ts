import type { Page } from '@playwright/test'
import type {
  DatasetApi,
  DatasetCounts,
  DatasetGroup,
  DatasetSnapshot
} from '../src/shared/dataset'
import type { EvaluationApi, PathKind } from '../src/shared/contracts'

type FixtureMode =
  | 'empty'
  | 'restored'
  | 'check-failure'
  | 'confirm-check-failure'
  | 'export-failure'
  | 'export-check-failure'
interface DatasetFixtureWindow extends Window {
  dataset: DatasetApi
  evaluation: EvaluationApi
}

// UI state fixtures are independent of the real filesystem and Python checker integration tests.
export async function installDatasetFixture(page: Page, mode: FixtureMode): Promise<void> {
  await page.addInitScript(
    ({ mode }) => {
      const fixtureWindow = window as unknown as DatasetFixtureWindow
      const selection = {
        pythonExecutable: 'C:\\fixture\\python.exe',
        datasetDirectory: 'C:\\fixture\\captures',
        labelsPath: 'C:\\fixture\\labels.json'
      }
      const groups: DatasetGroup[] = ['capture-a', 'capture-b', 'capture-c'].map((eventId) => ({
        eventId,
        imageCount: eventId === 'capture-a' ? 2 : 1,
        pendingCount: eventId === 'capture-a' ? 2 : 1,
        confirmedCount: 0,
        split: null,
        confirmedSplit: null
      }))
      let snapshot: DatasetSnapshot = {
        recordPath: 'C:\\fixture\\appdata\\dataset.json',
        selection: mode === 'empty' ? null : selection,
        groups: mode === 'empty' ? [] : groups,
        counts: { train: 0, val: 0, test: 0, unassigned: 0 },
        check: null,
        canConfirm: false,
        exportDirectory: null
      }

      function updateCounts(): void {
        const counts: DatasetCounts = { train: 0, val: 0, test: 0, unassigned: 0 }
        for (const group of snapshot.groups) {
          if (group.confirmedSplit != null) {
            counts[group.confirmedSplit] += group.confirmedCount
          }
          counts[group.split ?? 'unassigned'] += group.pendingCount
        }
        snapshot = { ...snapshot, counts }
      }

      function checkResult(): void {
        updateCounts()
        // In the manual-flow fixture, captures b and c represent identical decoded ROIs.
        const firstSplit = snapshot.groups.find((group) => group.eventId === 'capture-b')?.split
        const secondSplit = snapshot.groups.find((group) => group.eventId === 'capture-c')?.split
        const passed = !(
          mode === 'empty' &&
          firstSplit != null &&
          secondSplit != null &&
          firstSplit !== secondSplit
        )
        snapshot = {
          ...snapshot,
          check: {
            passed,
            counts: snapshot.counts,
            samples: [],
            issues: passed
              ? [
                  {
                    severity: 'warning',
                    code: 'same-split-duplicate',
                    message: '같은 용도에 동일한 이미지가 있습니다.',
                    images: ['capture-a/001.png', 'capture-a/002.png']
                  }
                ]
              : [
                  {
                    severity: 'error',
                    code: 'PIXEL_SPLIT_LEAKAGE',
                    message: '동일한 ROI 이미지가 서로 다른 용도에 배정되어 있습니다.',
                    images: ['capture-b/001.png', 'capture-c/001.png']
                  }
                ]
          },
          canConfirm: passed
        }
      }

      if (mode === 'restored') {
        snapshot.groups = [
          {
            eventId: 'capture-a',
            imageCount: 2,
            pendingCount: 1,
            confirmedCount: 1,
            split: null,
            confirmedSplit: 'train'
          },
          {
            eventId: 'capture-b',
            imageCount: 1,
            pendingCount: 0,
            confirmedCount: 1,
            split: 'val',
            confirmedSplit: 'val'
          },
          {
            eventId: 'capture-c',
            imageCount: 1,
            pendingCount: 0,
            confirmedCount: 1,
            split: 'test',
            confirmedSplit: 'test'
          },
          {
            eventId: 'capture-new',
            imageCount: 1,
            pendingCount: 1,
            confirmedCount: 0,
            split: null,
            confirmedSplit: null
          }
        ]
        updateCounts()
      }
      if (
        mode === 'check-failure' ||
        mode === 'confirm-check-failure' ||
        mode === 'export-failure' ||
        mode === 'export-check-failure'
      ) {
        snapshot.groups = groups.map((group, index) => ({
          ...group,
          split: (['train', 'val', 'test'] as const)[index],
          ...(mode === 'export-failure' || mode === 'export-check-failure'
            ? {
                confirmedCount: group.imageCount,
                pendingCount: 0,
                confirmedSplit: (['train', 'val', 'test'] as const)[index]
              }
            : {})
        }))
        checkResult()
        if (mode === 'export-failure' || mode === 'export-check-failure') {
          snapshot = { ...snapshot, canConfirm: false, exportDirectory: 'C:\\fixture\\old-export' }
        }
      }

      fixtureWindow.dataset = {
        getSnapshot: async () => ({ ok: true, value: structuredClone(snapshot) }),
        load: async (nextSelection) => {
          snapshot = {
            ...snapshot,
            selection: nextSelection,
            groups: snapshot.groups.length === 0 ? groups : snapshot.groups,
            check: null,
            canConfirm: false,
            exportDirectory: null
          }
          updateCounts()
          return { ok: true, value: structuredClone(snapshot) }
        },
        assign: async (eventIds, split) => {
          snapshot = {
            ...snapshot,
            groups: snapshot.groups.map((group) =>
              eventIds.includes(group.eventId) ? { ...group, split } : group
            ),
            check: null,
            canConfirm: false
          }
          updateCounts()
          return { ok: true, value: structuredClone(snapshot) }
        },
        check: async () => {
          if (mode === 'check-failure') {
            return { ok: false, error: 'Fixture: Python 검사 스크립트가 실패했습니다.' }
          }
          checkResult()
          return { ok: true, value: structuredClone(snapshot) }
        },
        confirm: async () => {
          if (mode === 'confirm-check-failure') {
            snapshot = {
              ...snapshot,
              canConfirm: false,
              check: {
                passed: false,
                counts: snapshot.counts,
                samples: [],
                issues: [
                  {
                    severity: 'error',
                    code: 'source-changed',
                    message: 'Fixture: 원본이 변경되어 확정하지 않았습니다.',
                    images: []
                  }
                ]
              }
            }
            return { ok: true, value: structuredClone(snapshot) }
          }
          snapshot = {
            ...snapshot,
            groups: snapshot.groups.map((group) => ({
              ...group,
              pendingCount: 0,
              confirmedCount: group.imageCount,
              confirmedSplit: group.split
            })),
            canConfirm: false
          }
          updateCounts()
          return { ok: true, value: structuredClone(snapshot) }
        },
        export: async () => {
          if (mode === 'export-failure') {
            return { ok: false, error: 'Fixture: 내보내기 폴더를 만들지 못했습니다.' }
          }
          if (mode === 'export-check-failure') {
            snapshot = {
              ...snapshot,
              canConfirm: false,
              check: {
                passed: false,
                counts: snapshot.counts,
                samples: [],
                issues: [
                  {
                    severity: 'error',
                    code: 'source-changed',
                    message: 'Fixture: 원본이 변경되어 내보내지 않았습니다.',
                    images: []
                  }
                ]
              }
            }
            return { ok: true, value: structuredClone(snapshot) }
          }
          snapshot = { ...snapshot, exportDirectory: 'C:\\fixture\\exports\\dataset-001' }
          return { ok: true, value: structuredClone(snapshot) }
        }
      }

      let datasetPathChoices = 0
      const paths: Record<PathKind, string> = {
        python: selection.pythonExecutable,
        dataset: selection.datasetDirectory,
        labels: selection.labelsPath,
        output: 'C:\\fixture\\exports',
        source: 'C:\\fixture\\ldb-ocr',
        run: 'C:\\fixture\\run'
      }
      fixtureWindow.evaluation = {
        choosePath: async (kind) => {
          if (kind === 'dataset') {
            datasetPathChoices += 1
            if (datasetPathChoices > 1 || mode !== 'empty') {
              return { ok: true, value: 'C:\\fixture\\different-captures' }
            }
          }
          return { ok: true, value: paths[kind] }
        },
        inspectRun: async () => ({ ok: true, value: { checkpoints: [] } }),
        getSnapshot: async () => ({
          ok: true,
          value: {
            status: 'idle',
            processedSamples: 0,
            totalSamples: 0,
            samples: [],
            report: null,
            reportPath: null,
            error: null
          }
        }),
        onSnapshot: () => () => {},
        start: async () => ({ ok: false, error: 'Evaluation is outside this dataset fixture.' }),
        cancel: async () => ({ ok: true, value: null }),
        readImage: async () => ({ ok: false, error: 'Images are outside this dataset fixture.' }),
        openReport: async () => ({ ok: true, value: null })
      }
    },
    { mode }
  )
}

export async function assignDatasetGroup(
  page: Page,
  eventId: string,
  split: 'train' | 'val' | 'test' | ''
): Promise<void> {
  await page.getByRole('checkbox', { name: `${eventId} 선택`, exact: true }).check()
  await page.getByLabel('배정 위치', { exact: true }).selectOption(split)
  await page.getByRole('button', { name: '선택 그룹 배정', exact: true }).click()
}
