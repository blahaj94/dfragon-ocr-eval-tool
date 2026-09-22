import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('real Electron detects PATH Python and restores all browsed settings and checkpoint after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ocr-settings-electron-'))
  const python =
    process.env.OCR_EVAL_TEST_PYTHON ??
    execFileSync(
      'uv',
      ['run', '--project', 'python', 'python', '-c', 'import sys; print(sys.executable)'],
      { encoding: 'utf8' }
    ).trim()
  const environment = join(directory, 'PATH environment')
  await mkdir(environment)
  const detected = process.platform === 'win32' ? python : join(environment, 'python3.12')
  if (process.platform !== 'win32') {
    await symlink(python, detected)
  }
  const run = join(directory, 'run')
  const checkpoint = join(run, 'checkpoints', 'latest.pdparams')
  for (const name of ['source', 'run/checkpoints', 'captures', 'reports']) {
    await mkdir(join(directory, name), { recursive: true })
  }
  for (const name of [
    'request.json',
    'training.json',
    'config.yml',
    'characters.txt',
    'manifest.jsonl'
  ]) {
    await writeFile(join(run, name), 'inspection fixture only')
  }
  await writeFile(checkpoint, 'fixture: no inference')
  const labels = join(directory, 'labels.json')
  await writeFile(labels, '{"schemaVersion":1,"samples":[]}')
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null)
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.PATH = `${process.platform === 'win32' ? dirname(python) : environment}${delimiter}${env.PATH ?? ''}`
  const options = { args: [resolve('.'), `--user-data-dir=${join(directory, 'profile')}`], env }
  let application = await electron.launch(options)
  try {
    let page = await application.firstWindow()
    await expect(page.getByLabel('Python 실행 파일', { exact: true })).toHaveValue(detected)
    await expect(page.locator('.intro')).toHaveCount(0)
    await expect(page.locator('footer')).toHaveCount(0)
    const chosen = [
      python,
      join(directory, 'source'),
      run,
      join(directory, 'captures'),
      labels,
      join(directory, 'reports')
    ]
    await application.evaluate(({ dialog }, paths) => {
      let index = 0
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[index++]] })
    }, chosen)
    for (const label of [
      'Python 실행 파일',
      'ldb-ocr 소스 폴더',
      '학습 결과 폴더',
      'Cropper 캡처 루트',
      '정답 파일',
      '보고서 저장 폴더'
    ]) {
      await page.getByRole('button', { name: `${label} 선택`, exact: true }).click()
    }
    await page.getByLabel('체크포인트', { exact: true }).selectOption(checkpoint)
    await expect(page.getByRole('button', { name: '평가 시작', exact: true })).toBeEnabled()
    await page.getByLabel('Python 실행 파일', { exact: true }).selectOption(detected)
    await expect(page.getByRole('button', { name: '평가 시작', exact: true })).toBeEnabled()
    chosen[0] = detected
    const profile = await application.evaluate(({ app }) => app.getPath('userData'))
    const savedPath = join(profile, 'evaluation-settings.json')
    const saved = await readFile(savedPath, 'utf8')
    expect(JSON.parse(saved).settings.pythonExecutable).toBe(detected)
    await application.close()
    // A changed PATH must not replace the explicitly selected environment.
    options.env.PATH = ''
    application = await electron.launch(options)
    page = await application.firstWindow()
    for (const [index, label] of [
      'Python 실행 파일',
      'ldb-ocr 소스 폴더',
      '학습 결과 폴더',
      'Cropper 캡처 루트',
      '정답 파일',
      '보고서 저장 폴더'
    ].entries()) {
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(chosen[index])
    }
    await expect(page.getByLabel('체크포인트', { exact: true })).toHaveValue(checkpoint)
    await expect(page.getByRole('button', { name: '평가 시작', exact: true })).toBeEnabled()
    expect(await readFile(savedPath, 'utf8')).toBe(saved)
    expect(await readFile(checkpoint, 'utf8')).toBe('fixture: no inference')
    expect(await readFile(labels, 'utf8')).toBe('{"schemaVersion":1,"samples":[]}')
    expect(
      (await page.evaluate(() => window.evaluation.saveSettings({ pythonExecutable: 'relative' })))
        .ok
    ).toBe(false)
    expect(await readFile(savedPath, 'utf8')).toBe(saved)
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
