import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ComparisonResult } from '../src/shared/comparison'
import type { Result } from '../src/shared/contracts'

function value<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.value
}

test('real Electron reads two reports, groups by ID, shows verified images, and leaves inputs unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comparison-electron-'))
  const captures = join(directory, 'captures')
  await mkdir(captures)
  const png = await readFile('e2e/fixtures/comparison/roi.png')
  const inputPaths: string[] = []
  const reports: string[] = []
  for (const name of ['a', 'b']) {
    const report = JSON.parse(await readFile(`e2e/fixtures/comparison/report-${name}.json`, 'utf8'))
    report.reproducibility.settings.datasetDirectory = captures
    for (const sample of report.samples) {
      sample.imagePath = join(captures, `${sample.id}.png`)
      await writeFile(sample.imagePath, png)
      inputPaths.push(sample.imagePath)
    }
    const path = join(directory, `report-${name}.json`)
    await writeFile(path, JSON.stringify(report))
    reports.push(path)
    inputPaths.push(path)
  }
  const invalid = JSON.parse(await readFile(reports[1], 'utf8'))
  invalid.samples[0].truth = '다른 정답'
  const invalidPath = join(directory, 'incompatible-report.json')
  await writeFile(invalidPath, JSON.stringify(invalid))
  for (const name of ['labels.json', 'checkpoint.pdparams']) {
    const path = join(directory, name)
    await writeFile(path, 'not used by report comparison')
    inputPaths.push(path)
  }
  inputPaths.push(invalidPath)
  const original = new Map(
    await Promise.all(
      [...new Set(inputPaths)].map(async (path) => [path, await readFile(path)] as const)
    )
  )
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
    await expect.poll(() => page.evaluate(() => typeof window.comparison)).toBe('object')
    await application.evaluate(
      ({ dialog }, paths) => {
        let index = 0
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[index++]] })
      },
      [...reports, invalidPath]
    )
    await page.getByRole('tab', { name: '결과 비교', exact: true }).click()
    await page.getByRole('button', { name: 'A 보고서 선택', exact: true }).click()
    await page.getByRole('button', { name: 'B 보고서 선택', exact: true }).click()
    await page.getByRole('button', { name: '보고서 비교', exact: true }).click()
    const panel = page.getByRole('tabpanel', { name: '결과 비교', exact: true })
    await expect(panel.getByRole('button', { name: '새로 틀림 1', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(panel.getByRole('region', { name: 'A 보고서 지표', exact: true })).toContainText(
      '40.00%'
    )
    await expect(panel.getByRole('region', { name: 'B 보고서 지표', exact: true })).toContainText(
      '20.00%'
    )
    await expect(
      panel.getByRole('button', { name: 'regressed 비교 이미지 확대', exact: true })
    ).toBeVisible()
    await expect(
      panel.getByRole('button', { name: 'improved 비교 이미지 확대', exact: true })
    ).toHaveCount(0)
    for (const [label, id] of [
      ['새로 맞힘', 'improved'],
      ['둘 다 성공', 'both-correct'],
      ['둘 다 실패', 'both-wrong'],
      ['새로 틀림', 'regressed']
    ]) {
      await panel.getByRole('button', { name: `${label} 1`, exact: true }).click()
      await expect(
        panel.getByRole('button', { name: `${id} 비교 이미지 확대`, exact: true })
      ).toBeVisible()
    }
    await panel.getByRole('button', { name: 'regressed 비교 이미지 확대', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '이미지 확대', exact: true })
    await expect(dialog.getByRole('img')).toBeVisible()
    await expect(dialog.getByText('A 예측', { exact: true })).toBeVisible()
    await expect(dialog.getByText('B 예측', { exact: true })).toBeVisible()
    await expect(dialog.getByText('검심', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '닫기' }).click()
    const image = value(
      await page.evaluate(
        (path) => window.comparison.readImage(path),
        join(captures, 'regressed.png')
      )
    )
    expect(image).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect((await page.evaluate((path) => window.comparison.readImage(path), reports[0])).ok).toBe(
      false
    )
    const evaluation = value(await page.evaluate(() => window.evaluation.getSnapshot()))
    expect(evaluation.status).toBe('idle')

    // Native file selection and actual IPC reject a different target; no subset remains on screen.
    await page.getByRole('button', { name: 'B 보고서 선택', exact: true }).click()
    await expect(panel.getByRole('region', { name: 'A 보고서 지표', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '보고서 비교', exact: true }).click()
    await expect(panel.getByRole('alert')).toBeVisible()
    await expect(panel.getByRole('button', { name: '새로 틀림 1', exact: true })).toHaveCount(0)
    expect(
      (
        await page.evaluate(
          (path) => window.comparison.readImage(path),
          join(captures, 'regressed.png')
        )
      ).ok
    ).toBe(false)
    for (const [path, bytes] of original) {
      expect(await readFile(path)).toEqual(bytes)
    }
    // Reordering is already in the fixed B report; every sample participates exactly once.
    const compared: ComparisonResult = value(
      await page.evaluate(([a, b]) => window.comparison.compare(a, b), reports)
    )
    expect(compared.counts).toEqual({
      regressed: 1,
      improved: 1,
      'both-correct': 1,
      'both-wrong': 1
    })
    expect(Object.values(compared.counts).reduce((sum, count) => sum + count, 0)).toBe(
      compared.samples.length
    )
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
