import { expect, test } from '@playwright/test'
import {
  chooseComparisonReports,
  comparisonImageReads,
  failNextComparison,
  installComparisonFixture
} from './comparison-fixture'

test('saved-report fixture shows saved summaries, all four groups and A/B image detail', async ({
  page
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installComparisonFixture(page)
  await page.goto('/')
  await page.getByRole('tab', { name: '결과 비교', exact: true }).click()
  await expect(page.getByRole('button', { name: '보고서 비교', exact: true })).toBeDisabled()
  await chooseComparisonReports(page)

  await expect(page.getByRole('region', { name: 'A 보고서 지표', exact: true })).toContainText(
    '20.00%'
  )
  await expect(page.getByRole('region', { name: 'B 보고서 지표', exact: true })).toContainText(
    '40.00%'
  )
  await expect(page.getByRole('region', { name: 'A 보고서 지표', exact: true })).toContainText(
    '50.00%'
  )
  await expect(page.getByRole('region', { name: 'A 보고서 지표', exact: true })).toContainText(
    '2 / 4'
  )
  const sampleRegion = page.getByRole('region', { name: '샘플별 결과 비교', exact: true })
  await expect(sampleRegion.locator('.comparison-filters strong')).toHaveText(['1', '1', '1', '1'])
  const countSum = (
    await sampleRegion.locator('.comparison-filters strong').allTextContents()
  ).reduce((sum, value) => sum + Number(value), 0)
  expect(countSum).toBe(4)
  await expect(sampleRegion).toContainText('전체 4개 샘플')
  await expect(page.getByRole('button', { name: '새로 틀림 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(sampleRegion.locator('tbody tr')).toHaveCount(1)
  await expect(sampleRegion.locator('tbody')).toContainText('기시')
  await page.getByRole('button', { name: 'regression 비교 이미지 확대', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '이미지 확대', exact: true })
  await expect(dialog.getByRole('group', { name: 'A 결과', exact: true })).toContainText('기사')
  await expect(dialog.getByRole('group', { name: 'A 결과', exact: true })).toContainText(
    '편집거리 0'
  )
  await expect(dialog.getByRole('group', { name: 'B 결과', exact: true })).toContainText('기시')
  await expect(dialog.getByRole('group', { name: 'B 결과', exact: true })).toContainText(
    '편집거리 1'
  )
  await expect(dialog.getByAltText('regression ROI 확대')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '새로 맞힘 1', exact: true }).click()
  await expect(sampleRegion.locator('tbody')).toContainText('마법사')
  await page.getByRole('button', { name: '둘 다 성공 1', exact: true }).click()
  await expect(sampleRegion.locator('tbody')).toContainText('검신')
  await page.getByRole('button', { name: '둘 다 실패 1', exact: true }).click()
  await expect(sampleRegion.locator('tbody')).toContainText('빈 예측')
  await page.getByRole('button', { name: '새로 틀림 1', exact: true }).click()
  const reads = await comparisonImageReads(page)
  expect(
    reads.imageReads.filter((path) => path === 'C:\\fixture\\a\\001.png').length
  ).toBeGreaterThanOrEqual(2)
  expect(reads.evaluationImageReads).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('comparison.png'), fullPage: true })
})

test('saved-report fixture clears old results after a report change and after a failed compare', async ({
  page
}) => {
  await installComparisonFixture(page)
  await page.goto('/')
  await chooseComparisonReports(page)
  await page.getByRole('button', { name: 'B 보고서 선택', exact: true }).click()

  await expect(page.getByLabel('B 보고서', { exact: true })).toHaveValue(
    'C:\\fixture\\run-c\\report.json'
  )
  await expect(page.getByRole('region', { name: '샘플별 결과 비교', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'A 보고서 지표', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '보고서 비교', exact: true }).click()
  await expect(page.getByRole('region', { name: 'A 보고서 지표', exact: true })).toBeVisible()
  await failNextComparison(page)
  await page.getByRole('button', { name: '보고서 비교', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('두 보고서의 정답이 일치하지 않습니다.')
  await expect(page.getByRole('region', { name: '샘플별 결과 비교', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'A 보고서 지표', exact: true })).toHaveCount(0)
})

test('saved-report fixture explains an empty default group and keeps other groups available', async ({
  page
}) => {
  await installComparisonFixture(page, true)
  await page.goto('/')
  await chooseComparisonReports(page)

  await expect(page.getByRole('button', { name: '새로 틀림 0', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByText('이 그룹에 해당하는 샘플이 없습니다', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '둘 다 성공 2', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '샘플별 결과 비교' }).locator('tbody tr')
  ).toHaveCount(2)
})

test('comparison tab preserves the existing evaluation and dataset selections', async ({
  page
}) => {
  await installComparisonFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Python 실행 파일 선택', exact: true }).click()
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
  await page.getByRole('checkbox', { name: 'saved-capture 선택', exact: true }).check()
  await page.getByLabel('배정 위치', { exact: true }).selectOption('test')
  await chooseComparisonReports(page)
  await page.getByRole('tab', { name: '평가', exact: true }).click()
  await expect(page.getByLabel('Python 실행 파일', { exact: true })).toHaveValue(
    'C:\\fixture\\python.exe'
  )
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
  await expect(
    page.getByRole('checkbox', { name: 'saved-capture 선택', exact: true })
  ).toBeChecked()
  await expect(page.getByLabel('배정 위치', { exact: true })).toHaveValue('test')
  await page.getByRole('tab', { name: '결과 비교', exact: true }).click()
  await expect(page.getByLabel('A 보고서', { exact: true })).toHaveValue(
    'C:\\fixture\\run-a\\report.json'
  )
  await expect(page.getByRole('region', { name: '샘플별 결과 비교', exact: true })).toBeVisible()
})
