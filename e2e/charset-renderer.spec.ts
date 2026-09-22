import { expect, test } from '@playwright/test'
import {
  failNextCharsetInspection,
  getCharsetFixtureCalls,
  inspectCharsetFixture,
  installCharsetFixture
} from './charset-fixture'

test('charset fixture checks only run and labels, showing missing characters and raw character details', async ({
  page
}, testInfo) => {
  await installCharsetFixture(page)
  await page.goto('/')
  await page.getByRole('tab', { name: '문자 검사', exact: true }).click()
  await expect(page.getByRole('button', { name: '문자 포함 검사', exact: true })).toBeDisabled()
  await expect(page.getByRole('region', { name: '문자 검사 입력' }).locator('input')).toHaveCount(2)
  await inspectCharsetFixture(page)

  await expect(page.getByRole('status')).toHaveText('누락 문자 있음')
  await expect(page.getByRole('region', { name: '문자 포함 집계' }).locator('strong')).toHaveText([
    '8',
    '4',
    '4',
    '50.00%'
  ])
  await expect(page.getByRole('button', { name: '누락 문자 4', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  const result = page.getByRole('region', { name: '문자별 검사 결과' })
  await expect(result.locator('tbody tr')).toHaveCount(4)
  await expect(result).toContainText('ZERO WIDTH SPACE (너비 없는 공백)')
  await expect(result).toContainText('U+200B')
  await expect(result).toContainText('한자')
  await expect(result).toContainText('히라가나')
  await expect(result).toContainText('가타카나')
  await page.getByRole('button', { name: '전체 문자 8', exact: true }).click()
  await expect(result.locator('tbody tr')).toHaveCount(8)
  const spaceRow = result.getByRole('row').filter({ hasText: 'U+0020' })
  await expect(spaceRow).toContainText('SPACE (공백)')
  await expect(spaceRow.locator('td').nth(3)).toHaveText('4')
  await expect(
    page.getByText('문자 사전의 포함 여부만 검사합니다. OCR 인식 품질을 의미하지 않습니다.', {
      exact: true
    })
  ).toBeVisible()
  expect(await getCharsetFixtureCalls(page)).toEqual({
    choices: ['run', 'labels'],
    inspectRunCalls: 0,
    inspections: [['C:/fixture/run', 'C:/fixture/labels.json']]
  })
  await page.screenshot({ path: testInfo.outputPath('charset-missing.png'), fullPage: true })
  await page.getByRole('tab', { name: '평가', exact: true }).click()
  await page.getByRole('tab', { name: '문자 검사', exact: true }).click()
  await expect(page.getByLabel('문자 검사 학습 결과 폴더', { exact: true })).toHaveValue(
    'C:/fixture/run'
  )
  await expect(page.getByRole('button', { name: '전체 문자 8', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

test('charset fixture distinguishes full coverage from OCR quality', async ({ page }) => {
  await installCharsetFixture(page, 'covered')
  await page.goto('/')
  await inspectCharsetFixture(page)

  await expect(page.getByRole('status')).toHaveText('누락 없음')
  await expect(page.getByRole('region', { name: '문자 포함 집계' }).locator('strong')).toHaveText([
    '8',
    '8',
    '0',
    '100.00%'
  ])
  await expect(page.getByText('누락된 문자가 없습니다', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '전체 문자 8', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '문자별 검사 결과' }).locator('tbody tr')
  ).toHaveCount(8)
})

test('charset fixture presents empty input as no target with no percentage', async ({ page }) => {
  await installCharsetFixture(page, 'empty')
  await page.goto('/')
  await inspectCharsetFixture(page)

  await expect(page.getByRole('status')).toHaveText('검사 대상 없음')
  await expect(page.getByRole('region', { name: '문자 포함 집계' }).locator('strong')).toHaveText([
    '0',
    '0',
    '0',
    '—'
  ])
  await expect(page.getByText('검사할 문자가 없습니다', { exact: true })).toBeVisible()
  await expect(page.getByText('100.00%', { exact: true })).toHaveCount(0)
})

test('charset fixture clears a prior result after a path change or inspection error', async ({
  page
}) => {
  await installCharsetFixture(page)
  await page.goto('/')
  await inspectCharsetFixture(page)
  await page.getByRole('button', { name: '문자 검사 정답 파일 선택', exact: true }).click()

  await expect(page.getByLabel('문자 검사 정답 파일', { exact: true })).toHaveValue(
    'C:/fixture/labels-new.json'
  )
  await expect(page.getByRole('region', { name: '문자 포함 집계' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '문자별 검사 결과' })).toHaveCount(0)
  await page.getByRole('button', { name: '문자 포함 검사', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('누락 문자 있음')
  await failNextCharsetInspection(page)
  await page.getByRole('button', { name: '문자 포함 검사', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('검사 실패')
  await expect(page.getByRole('alert')).toContainText('문자 사전을 읽지 못했습니다.')
  await expect(page.getByRole('region', { name: '문자 포함 집계' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '문자별 검사 결과' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '문자 포함 검사', exact: true })).toBeEnabled()
})
