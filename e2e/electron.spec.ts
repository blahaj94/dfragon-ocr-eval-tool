import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { EvaluationApi, EvaluationRequest } from '../src/shared/contracts'

test('real Electron IPC starts Python and preserves a failed run report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ocr-electron-test-'))
  const pythonExecutable =
    process.env.OCR_EVAL_TEST_PYTHON ??
    execFileSync(
      'uv',
      ['run', '--project', 'python', 'python', '-c', 'import sys; print(sys.executable)'],
      { encoding: 'utf8' }
    ).trim()
  const request: EvaluationRequest = {
    pythonExecutable,
    ldbOcrSourcePath: join(directory, 'source'),
    runDirectory: join(directory, 'run'),
    checkpointPath: join(directory, 'run', 'latest.pdparams'),
    datasetDirectory: join(directory, 'captures'),
    labelsPath: join(directory, 'labels.json'),
    outputDirectory: join(directory, 'reports')
  }
  for (const name of ['source', 'run', 'captures', 'reports']) {
    await mkdir(join(directory, name))
  }
  await writeFile(request.checkpointPath, 'invalid checkpoint; never reaches inference')
  await writeFile(request.labelsPath, JSON.stringify({ schemaVersion: 1, samples: [] }))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value != null) {
      env[key] = value
    }
  }
  delete env.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(directory, 'profile')}`],
    env
  })
  try {
    const page = await application.firstWindow()
    await expect.poll(() => page.evaluate(() => typeof window.evaluation)).toBe('object')
    expect(
      await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)
    ).toBe('undefined')
    const result = await page.evaluate(async (input) => {
      const api = (window as unknown as { evaluation: EvaluationApi }).evaluation
      return api.start(input)
    }, request)
    expect(result).toEqual({ ok: true, value: null })
    await expect
      .poll(async () => {
        const snapshot = await page.evaluate(() => window.evaluation.getSnapshot())
        return snapshot.ok ? snapshot.value.status : snapshot.error
      })
      .toBe('failed')
    const resultSnapshot = await page.evaluate(() => window.evaluation.getSnapshot())
    expect(resultSnapshot.ok).toBe(true)
    if (!resultSnapshot.ok) {
      throw new Error(resultSnapshot.error)
    }
    const { reportPath, report, error } = resultSnapshot.value
    expect(error).toContain('samples')
    expect(reportPath).not.toBeNull()
    expect(report?.summary).toBeNull()
    const saved = JSON.parse(await readFile(reportPath!, 'utf8'))
    expect(saved.status).toBe('failed')
    expect(saved.processedSamples).toBe(0)
    expect(await readFile(request.checkpointPath, 'utf8')).toBe(
      'invalid checkpoint; never reaches inference'
    )
    const denied = await page.evaluate(
      (path) => window.evaluation.readImage(path),
      request.labelsPath
    )
    expect(denied.ok).toBe(false)
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
