import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('training IPC is exposed only through validated main-process actions', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ocr-training-ipc-'))
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  delete env.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
    env
  })
  try {
    const page = await application.firstWindow()
    await expect.poll(() => page.evaluate(() => typeof window.training)).toBe('object')
    expect(await page.evaluate(() => window.training.getSnapshot())).toMatchObject({
      ok: true,
      value: { status: 'idle' }
    })
    expect(await page.evaluate(() => window.training.open('../outside'))).toMatchObject({
      ok: false
    })
    expect(await page.evaluate(() => window.training.publish('unfinished'))).toMatchObject({
      ok: false
    })
    expect(
      await page.evaluate(() => window.training.readImage('C:\\unselected.png'))
    ).toMatchObject({ ok: false })
    await page.getByRole('tab', { name: '학습', exact: true }).click()
    await expect(page.getByRole('button', { name: '학습 후 test 평가' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '자료실 로그인' })).toBeVisible()
  } finally {
    await application.close()
    await rm(profile, { recursive: true, force: true })
  }
})

test('opt-in actual GPU training creates a reusable test report through Electron IPC', async () => {
  const info = test.info()
  const directory = process.env.OCR_TRAINING_SMOKE_EXPERIMENT
  const pythonExecutable = process.env.OCR_TRAINING_SMOKE_PYTHON
  const upstreamDirectory = process.env.OCR_TRAINING_SMOKE_UPSTREAM
  test.skip(
    !directory || !pythonExecutable || !upstreamDirectory,
    'Requires an explicit synthetic experiment and an existing GPU runtime'
  )
  test.setTimeout(180_000)
  const profile = await mkdtemp(join(tmpdir(), 'ocr-training-gpu-'))
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  delete env.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
    env
  })
  try {
    const page = await application.firstWindow()
    await expect.poll(() => page.evaluate(() => typeof window.training)).toBe('object')
    expect(await page.evaluate((path) => window.training.open(path), directory!)).toMatchObject({
      ok: true
    })
    const result = await page.evaluate((options) => window.training.start(options), {
      pythonExecutable: pythonExecutable!,
      upstreamDirectory: upstreamDirectory!,
      epochs: 1,
      batchSize: 2,
      learningRate: 0.00001
    })
    expect(result).toMatchObject({ ok: true })
    await expect
      .poll(
        async () => {
          const snapshot = await page.evaluate(() => window.training.getSnapshot())
          if (!snapshot.ok) {
            throw new Error(snapshot.error)
          }
          if (snapshot.value.status === 'failed') {
            throw new Error(snapshot.value.error ?? 'Training failed')
          }
          return snapshot.value.status
        },
        { timeout: 150_000, intervals: [1000] }
      )
      .toBe('completed')
    const resultState = await page.evaluate(() => window.training.getSnapshot())
    if (!resultState.ok) {
      throw new Error(resultState.error)
    }
    expect(resultState.value.samples).toHaveLength(resultState.value.counts!.test)
    expect(resultState.value.publishedModelId).toBeNull()
    const reportPath = resultState.value.message.split(' · ').at(-1)!
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(report.reproducibility.gpu).toContain('NVIDIA')
    const originalSha = createHash('sha256')
      .update(await readFile(join(directory!, 'model/weights.pdparams')))
      .digest('hex')
    expect(report.reproducibility.checkpointSha256).not.toBe(originalSha)
    await page.getByRole('tab', { name: '학습', exact: true }).click()
    await page
      .getByRole('button', { name: `전체 ${resultState.value.samples.length}`, exact: true })
      .click()
    await expect(page.getByRole('region', { name: '학습 모델의 test 성적' })).toContainText('%')
    await page.screenshot({ path: info.outputPath('gpu-training-completed.png'), fullPage: true })
  } finally {
    await application.close()
    await rm(profile, { recursive: true, force: true })
  }
})
