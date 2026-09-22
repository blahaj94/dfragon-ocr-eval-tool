import { expect, test, type Page } from '@playwright/test'
import {
  diagnosticCalls,
  diagnosticCounters,
  finishDiagnosticFixture,
  installDiagnosticsFixture
} from './diagnostics-fixture'
import { selectEvaluationInputs } from './renderer-fixture'

async function openSample(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'capture/roi.png 이미지 확대', exact: true }).click()
  await page.getByRole('button', { name: '모델 입력 확인', exact: true }).click()
}

test('diagnostic fixture uses saved report after settings change, shows stages and loads shapes lazily', async ({
  page
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installDiagnosticsFixture(page)
  await page.goto('/')
  await selectEvaluationInputs(page)
  await expect(page.getByLabel('학습 결과 폴더', { exact: true })).toHaveValue(
    'C:\\fixture\\different-run'
  )
  await openSample(page)
  const diagnostics = page.getByRole('region', { name: '모델 입력 진단', exact: true })
  await expect(diagnostics.getByRole('article')).toHaveCount(5)
  await expect(diagnostics.locator('article h4')).toHaveText([
    'RGB 원본',
    '반전 회색조',
    '정규화',
    '패딩',
    '모델 입력'
  ])
  expect(await diagnosticCalls(page)).toEqual([
    {
      reportPath: 'C:\\fixture\\saved-evaluation\\report.json',
      sampleId: 'capture/roi.png',
      includeShapes: false
    }
  ])
  await expect(
    page.getByRole('region', { name: 'Train/Eval shape 비교', exact: true })
  ).toHaveCount(0)
  const normalized = diagnostics.getByRole('article', { name: '정규화', exact: true })
  await expect(normalized.locator('dd')).toHaveText(['4 × 2', '[2, 4]', 'float32', '-1', '1'])
  await expect(normalized).toContainText('표시용 미리보기')
  const padding = diagnostics.getByRole('article', { name: '패딩', exact: true })
  await expect(padding.locator('.diagnostic-content-bounds')).toHaveCSS('width', '95px')
  const reads = (await diagnosticCounters(page)).imageReadCount
  await page.getByRole('button', { name: '패딩 확대', exact: true }).click()
  await expect(page.getByAltText('패딩 확대 미리보기')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '이미지 확대', exact: true })).toHaveCount(1)
  expect((await diagnosticCounters(page)).imageReadCount).toBe(reads)
  expect((await diagnosticCounters(page)).cancelCount).toBe(0)
  await page.getByRole('button', { name: '상세 정보', exact: true }).click()
  const shapes = page.getByRole('region', { name: 'Train/Eval shape 비교', exact: true })
  await expect(shapes).toContainText('확인한 지점의 크기가 같습니다.')
  await expect(shapes).toContainText('학습 데이터 생성이나 augmentation 전체를 검증하지 않습니다.')
  await expect(shapes.locator('tbody tr')).toHaveCount(3)
  expect((await diagnosticCalls(page)).map((call) => call.includeShapes)).toEqual([false, true])
  await shapes.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('diagnostic-shapes.png') })
  expect(errors).toEqual([])
})

test('diagnostic fixture highlights only observed differences and reports failed measurements as unknown', async ({
  page
}) => {
  await installDiagnosticsFixture(page, 'mixed')
  await page.goto('/')
  await openSample(page)
  await page.getByRole('button', { name: '상세 정보', exact: true }).click()
  const shapes = page.getByRole('region', { name: 'Train/Eval shape 비교', exact: true })
  await expect(shapes.locator('.diagnostic-shape-difference')).toHaveCount(1)
  await expect(shapes.locator('.diagnostic-shape-difference')).toContainText(
    '이 지점에서 학습 모드와 평가 모드의 크기가 다릅니다.'
  )
  await expect(shapes.getByRole('row', { name: /Pooling 직후/ })).toContainText('확인하지 못함')
  await expect(shapes).toContainText('Fixture: 학습 모드 관측 실패')
  await expect(shapes).not.toContainText('확인한 지점의 크기가 같습니다.')
})

test('diagnostic fixture clears basic results when detailed input fingerprint changes', async ({
  page
}) => {
  await installDiagnosticsFixture(page, 'mismatch')
  await page.goto('/')
  await openSample(page)
  await expect(page.getByRole('article')).toHaveCount(5)
  await page.getByRole('button', { name: '상세 정보', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('기본 진단과 상세 정보의 입력이 다릅니다.')
  await expect(page.getByRole('article')).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'Train/Eval shape 비교', exact: true })
  ).toHaveCount(0)
})

test('diagnostic fixture keeps evaluation locked after modal close until owned worker finishes', async ({
  page
}) => {
  await installDiagnosticsFixture(page, 'pending')
  await page.goto('/')
  await selectEvaluationInputs(page)
  await openSample(page)
  const diagnostics = page.getByRole('region', { name: '모델 입력 진단', exact: true })
  await expect(diagnostics.getByRole('status')).toHaveText('Fixture: 모델을 읽는 중입니다.')
  await expect(
    page.getByRole('button', { name: '학습 결과 폴더 선택', exact: true, includeHidden: true })
  ).toBeDisabled()
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await diagnosticCounters(page)).cancelCount).toBe(1)
  await expect(
    page.getByText('Fixture: 진단 프로세스 종료 대기 중입니다.', { exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '모델 입력 확인 중' })).toBeDisabled()
  await finishDiagnosticFixture(page)
  await expect(page.getByRole('button', { name: '평가 시작' })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('diagnostic fixture keeps a newer progress event when the initial snapshot fails late', async ({
  page
}) => {
  await installDiagnosticsFixture(page, 'stale-initial')
  await page.goto('/')
  await expect(page.getByText('Fixture: 먼저 도착한 최신 상태', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '학습 결과 폴더 선택', exact: true })
  ).toBeDisabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await finishDiagnosticFixture(page)
  await expect(page.getByRole('button', { name: '학습 결과 폴더 선택', exact: true })).toBeEnabled()
})

test('diagnostic fixture displays backend failure without invented stage or shape results', async ({
  page
}) => {
  await installDiagnosticsFixture(page, 'error')
  await page.goto('/')
  await openSample(page)
  await expect(page.getByRole('alert')).toContainText(
    'Fixture: 보고서의 원본 파일이 변경되었습니다.'
  )
  await expect(page.getByRole('article')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '상세 정보', exact: true })).toHaveCount(0)
})
