import { expect, test } from '@playwright/test'
import {
  getFixtureCounts,
  installRendererFixture,
  selectEvaluationInputs
} from './renderer-fixture'

test('Python selector shows versions and paths, disables unsupported versions and saves a selected environment', async ({
  page
}) => {
  await installRendererFixture(page, 'completed')
  await page.goto('/')
  const selector = page.getByLabel('Python 실행 파일', { exact: true })
  await expect(selector.getByRole('option', { name: /3\.13\.7/ })).toBeDisabled()
  await expect(selector.getByRole('option', { name: /3\.12\.10/ })).toContainText('gpu-env')
  await selector.selectOption('C:\\fixture\\gpu-env\\python.exe')
  await expect(selector).toHaveValue('C:\\fixture\\gpu-env\\python.exe')
})

test('settings save failure is shown and the unsaved Python choice is not presented as stored', async ({
  page
}) => {
  await installRendererFixture(page, 'settings-save-error')
  await page.goto('/')
  await page.getByRole('button', { name: 'Python 실행 파일 선택', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('평가 설정을 저장하지 못했습니다.')
  await expect(page.getByLabel('Python 실행 파일', { exact: true })).toHaveValue('')
})

test('missing saved checkpoint and settings read failures do not silently become usable settings', async ({
  page
}) => {
  await installRendererFixture(page, 'missing-checkpoint')
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('저장된 체크포인트를 찾지 못했습니다.')
  await expect(page.getByLabel('체크포인트', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '평가 시작', exact: true })).toBeDisabled()
})

test('settings read failure remains visible while manual path selection is available', async ({
  page
}) => {
  await installRendererFixture(page, 'settings-read-error')
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('설정 파일을 읽지 못했습니다.')
  await expect(
    page.getByRole('button', { name: 'Python 실행 파일 선택', exact: true })
  ).toBeEnabled()
})

test('fixture UI connects selection, metrics, mismatch review, image zoom and report action', async ({
  page
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installRendererFixture(page, 'completed')
  await page.goto('/')

  await expect(page.getByRole('button', { name: '평가 시작' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('idle.png'), fullPage: true })
  await selectEvaluationInputs(page)
  await page.getByRole('button', { name: '평가 시작' }).click()

  await expect(page.getByRole('status')).toHaveText('평가 완료')
  const metrics = page.getByRole('region', { name: '완료된 전체 평가 지표' })
  await expect(metrics).toContainText('50.00%')
  await expect(metrics).toContainText('33.33%')
  await expect(metrics.locator('.metric-card').nth(2)).toContainText('3')
  await expect(metrics.locator('.metric-card').nth(3)).toContainText('8')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.getByText('빈 예측', { exact: true })).toBeVisible()
  await expect(page.getByText('0.0000', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '틀린 샘플 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await page.getByRole('button', { name: '전체 3', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(3)
  await expect(page.getByText('제공 안 됨', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'capture/roi-01.png 이미지 확대', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '이미지 확대' })).toBeVisible()
  await expect(page.getByAltText('capture/roi-01.png ROI 확대')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await expect(
    page.getByText('C:\\fixture\\reports\\run-001\\report.json', { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '저장 폴더 열기' }).click()
  expect(await getFixtureCounts(page)).toEqual({ startCount: 1, reportOpenCount: 1 })
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('completed.png'), fullPage: true })
})

test('fixture UI locks setup during a run and labels cancellation as partial with no final score', async ({
  page
}) => {
  await installRendererFixture(page, 'running')
  await page.goto('/')
  await selectEvaluationInputs(page)
  await page.getByRole('button', { name: '평가 시작' }).click()

  await expect(page.getByRole('status')).toHaveText('평가 중')
  await expect(page.getByRole('progressbar', { name: '처리한 샘플 수' })).toHaveAttribute(
    'value',
    '1'
  )
  await expect(page.getByRole('button', { name: '평가 진행 중' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '학습 결과 폴더 선택' })).toBeDisabled()
  await page.getByRole('button', { name: '평가 취소', exact: true }).click()

  await expect(page.getByRole('status')).toHaveText('평가 취소됨')
  await expect(
    page.getByText('부분 결과입니다. 전체 평가는 완료되지 않았습니다.', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '완료된 전체 평가 지표' }).locator('strong')
  ).toHaveText(['—', '—', '—', '—'])
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '평가 시작' })).toBeEnabled()
  expect((await getFixtureCounts(page)).startCount).toBe(1)
})

test('fixture UI displays invalid input errors without claiming a completed evaluation', async ({
  page
}) => {
  await installRendererFixture(page, 'start-error')
  await page.goto('/')
  await selectEvaluationInputs(page)
  await page.getByRole('button', { name: '평가 시작' }).click()

  await expect(page.getByRole('alert')).toContainText('정답 파일의 ROI 경로가 올바르지 않습니다.')
  await expect(page.getByRole('status')).toHaveText('평가 대기')
  await expect(
    page.getByRole('region', { name: '완료된 전체 평가 지표' }).locator('strong')
  ).toHaveText(['—', '—', '—', '—'])
  await expect(page.getByRole('button', { name: '평가 시작' })).toBeEnabled()
})

test('fixture UI ignores an initial state read that arrives after a pushed progress update', async ({
  page
}) => {
  await installRendererFixture(page, 'stale-initial')
  await page.goto('/')

  await expect(page.getByRole('status')).toHaveText('평가 중')
  await expect(page.getByRole('progressbar', { name: '처리한 샘플 수' })).toHaveAttribute(
    'value',
    '1'
  )
  await expect(page.getByRole('button', { name: '학습 결과 폴더 선택' })).toBeDisabled()
})
