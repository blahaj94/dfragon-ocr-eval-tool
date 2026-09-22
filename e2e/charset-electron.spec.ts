import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('real Electron inspects only run text files and labels, counts code points and preserves inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'charset-electron-'))
  const run = join(directory, 'copied-run')
  await cp('e2e/fixtures/charset', run, { recursive: true })
  await rm(join(run, 'README.md'))
  const labels = join(run, 'labels.json')
  const inputs = new Map(
    await Promise.all(
      (await readdir(run)).map(async (name) => [name, await readFile(join(run, name))] as const)
    )
  )
  const empty = join(directory, 'empty-labels.json')
  const missing = join(directory, 'does-not-exist.json')
  await writeFile(empty, JSON.stringify({ schemaVersion: 1, samples: [] }))
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null)
  )
  delete env.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(directory, 'profile')}`],
    env
  })
  try {
    const page = await application.firstWindow()
    await expect.poll(() => page.evaluate(() => typeof window.charset)).toBe('object')
    await application.evaluate(
      ({ dialog }, paths) => {
        let index = 0
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[index++]] })
      },
      [run, labels, empty, missing]
    )
    await page.getByRole('tab', { name: '문자 검사', exact: true }).click()
    const panel = page.getByRole('tabpanel', { name: '문자 검사', exact: true })
    await panel.getByRole('button', { name: '문자 검사 학습 결과 폴더 선택', exact: true }).click()
    await panel.getByRole('button', { name: '문자 검사 정답 파일 선택', exact: true }).click()
    await panel.getByRole('button', { name: '문자 포함 검사', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText('누락 문자 있음')
    await expect(panel.getByRole('region', { name: '문자 포함 집계' })).toContainText('71.43%')
    await expect(panel.getByRole('button', { name: '누락 문자 2', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const table = panel.getByRole('region', { name: '문자별 검사 결과' })
    await expect(table.locator('tbody tr')).toHaveCount(2)
    await expect(table).toContainText('U+1F600')
    await expect(table).toContainText('U+200B')
    await panel.getByRole('button', { name: '전체 문자 7', exact: true }).click()
    await expect(table.locator('tbody tr')).toHaveCount(7)
    const korean = table.getByRole('row').filter({ hasText: 'U+AC00' })
    await expect(korean.getByRole('cell', { name: '3', exact: true })).toBeVisible()
    await expect(table.getByRole('row').filter({ hasText: 'U+0020' })).toContainText('포함')

    const actual = await page.evaluate(
      ([run, labels]) => window.charset.inspect(run, labels),
      [run, labels]
    )
    expect(actual.ok).toBe(true)
    if (!actual.ok) {
      throw new Error(actual.error)
    }
    expect(actual.value).toMatchObject({
      status: 'missing',
      uniqueCount: 7,
      includedCount: 5,
      missingCount: 2,
      coverage: 5 / 7,
      sampleCount: 2,
      useSpace: true
    })
    expect(actual.value.characters.find((entry) => entry.character === '가')?.count).toBe(3)
    expect(actual.value.characters.find((entry) => entry.character === '\u200b')?.included).toBe(
      false
    )

    await panel.getByRole('button', { name: '문자 검사 정답 파일 선택', exact: true }).click()
    await expect(panel.getByRole('region', { name: '문자 포함 집계' })).toHaveCount(0)
    await panel.getByRole('button', { name: '문자 포함 검사', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText('검사 대상 없음')
    await panel.getByRole('button', { name: '문자 검사 정답 파일 선택', exact: true }).click()
    await panel.getByRole('button', { name: '문자 포함 검사', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('검사 실패')
    await expect(panel.getByRole('region', { name: '문자 포함 집계' })).toHaveCount(0)
    await expect(panel.getByText('누락 없음', { exact: true })).toHaveCount(0)
    const evaluation = await page.evaluate(() => window.evaluation.getSnapshot())
    expect(evaluation.ok && evaluation.value.status).toBe('idle')
    expect((await readdir(run)).sort()).toEqual([...inputs.keys()].sort())
    for (const [name, bytes] of inputs) {
      expect(await readFile(join(run, name))).toEqual(bytes)
    }
    expect(await readFile(empty, 'utf8')).toBe(JSON.stringify({ schemaVersion: 1, samples: [] }))
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
