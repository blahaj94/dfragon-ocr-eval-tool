import { expect, test } from '@playwright/test'
import { assignDatasetGroup, installDatasetFixture } from './dataset-fixture'

test('dataset fixture connects manual grouping, recheck after edits, confirmation and export', async ({
  page
}, testInfo) => {
  await installDatasetFixture(page, 'empty')
  await page.goto('/')
  await page.getByRole('button', { name: 'Python 실행 파일 선택', exact: true }).click()
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
  await expect(page.getByRole('button', { name: '데이터 불러오기', exact: true })).toBeDisabled()
  for (const label of [
    'Dataset Python 실행 파일 선택',
    'Dataset 캡처 루트 선택',
    'Dataset 정답 파일 선택'
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
  }
  await page.getByRole('button', { name: '데이터 불러오기', exact: true }).click()
  await assignDatasetGroup(page, 'capture-a', 'train')
  await assignDatasetGroup(page, 'capture-b', 'val')
  await assignDatasetGroup(page, 'capture-c', 'val')
  await page.getByRole('button', { name: 'Dataset 검사', exact: true }).click()
  await expect(page.getByText('검사 통과', { exact: true })).toBeVisible()
  await expect(
    page.getByText('같은 용도에 동일한 이미지가 있습니다.', { exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '배정 확정', exact: true })).toBeEnabled()

  await assignDatasetGroup(page, 'capture-c', 'train')
  await expect(page.getByRole('button', { name: '배정 확정', exact: true })).toBeDisabled()
  await expect(page.getByText('검사 통과', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Dataset 검사', exact: true }).click()
  await expect(
    page.getByText('검사 실패 · 아래 오류를 해결해 주세요.', { exact: true })
  ).toBeVisible()
  await assignDatasetGroup(page, 'capture-c', 'val')
  await page.getByRole('button', { name: 'Dataset 검사', exact: true }).click()
  await page.getByRole('button', { name: '배정 확정', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'capture-a 선택', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Dataset 내보내기 폴더 선택', exact: true }).click()
  await page.getByRole('button', { name: 'Dataset 내보내기', exact: true }).click()
  await expect(page.getByText('내보내기 완료', { exact: true })).toBeVisible()
  await expect(page.getByText('C:\\fixture\\exports\\dataset-001', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('dataset-confirmed.png'), fullPage: true })

  await page.getByRole('tab', { name: '평가', exact: true }).click()
  await expect(page.getByLabel('Python 실행 파일', { exact: true })).toHaveValue(
    'C:\\fixture\\python.exe'
  )
})

test('dataset fixture restores locked assignments and new unassigned images, blocking dirty source actions', async ({
  page
}, testInfo) => {
  await installDatasetFixture(page, 'restored')
  await page.goto('/')
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '현재 캡처 루트 이미지 수' }).locator('strong')
  ).toHaveText(['1', '1', '1', '2'])
  await expect(page.getByRole('checkbox', { name: 'capture-b 선택', exact: true })).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: 'capture-new 선택', exact: true })).toBeEnabled()
  await page.getByRole('checkbox', { name: 'capture-a 선택', exact: true }).check()
  await page.getByLabel('배정 위치', { exact: true }).selectOption('test')
  await expect(page.getByRole('button', { name: '선택 그룹 배정', exact: true })).toBeDisabled()
  await expect(
    page.getByText('확정 항목이 있는 그룹의 새 이미지는 기존 확정 위치로만 배정할 수 있습니다.', {
      exact: true
    })
  ).toBeVisible()
  await page.getByLabel('배정 위치', { exact: true }).selectOption('train')
  await page.getByRole('button', { name: '선택 그룹 배정', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '현재 캡처 루트 이미지 수' }).locator('strong')
  ).toHaveText(['2', '1', '1', '1'])
  await assignDatasetGroup(page, 'capture-a', '')
  await expect(
    page.getByRole('region', { name: '현재 캡처 루트 이미지 수' }).locator('strong')
  ).toHaveText(['1', '1', '1', '2'])
  await page.screenshot({ path: testInfo.outputPath('dataset-restored.png'), fullPage: true })

  await page.getByRole('button', { name: 'Dataset 캡처 루트 선택', exact: true }).click()
  await expect(
    page.getByText('경로가 변경되었습니다. 데이터를 다시 불러오세요.', { exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dataset 검사', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '배정 확정', exact: true })).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: 'capture-new 선택', exact: true })).toBeDisabled()
})

test('dataset fixture does not retain a pass or confirmation after the checker fails', async ({
  page
}) => {
  await installDatasetFixture(page, 'check-failure')
  await page.goto('/')
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
  await expect(page.getByText('검사 통과', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Dataset 검사', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('Python 검사 스크립트가 실패했습니다.')
  await expect(page.getByText('검사 통과', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '배정 확정', exact: true })).toBeDisabled()
})

test('dataset fixture shows export failure without presenting an old output as a new success', async ({
  page
}) => {
  await installDatasetFixture(page, 'export-failure')
  await page.goto('/')
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
  await page.getByRole('button', { name: 'Dataset 내보내기 폴더 선택', exact: true }).click()
  await page.getByRole('button', { name: 'Dataset 내보내기', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('내보내기 폴더를 만들지 못했습니다.')
  await expect(page.getByText('내보내기 완료', { exact: true })).toHaveCount(0)
  await expect(page.getByText('C:\\fixture\\old-export', { exact: true })).toHaveCount(0)
})

test('dataset fixture reports a failed confirmation recheck without a confirmation success notice', async ({
  page
}) => {
  await installDatasetFixture(page, 'confirm-check-failure')
  await page.goto('/')
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
  await page.getByRole('button', { name: '배정 확정', exact: true }).click()

  await expect(
    page.getByText('Fixture: 원본이 변경되어 확정하지 않았습니다.', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText('배정을 확정했습니다. 확정된 항목은 변경할 수 없습니다.', { exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: '배정 확정', exact: true })).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: 'capture-a 선택', exact: true })).toBeEnabled()
})

test('dataset fixture ignores a stale export path returned with a failed recheck snapshot', async ({
  page
}) => {
  await installDatasetFixture(page, 'export-check-failure')
  await page.goto('/')
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
  await page.getByRole('button', { name: 'Dataset 내보내기 폴더 선택', exact: true }).click()
  await page.getByRole('button', { name: 'Dataset 내보내기', exact: true }).click()

  await expect(
    page.getByText('Fixture: 원본이 변경되어 내보내지 않았습니다.', { exact: true })
  ).toBeVisible()
  await expect(page.getByText('내보내기 완료', { exact: true })).toHaveCount(0)
  await expect(page.getByText('C:\\fixture\\old-export', { exact: true })).toHaveCount(0)
})
