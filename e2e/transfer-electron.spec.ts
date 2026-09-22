import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('app creates labels with real Python, connects and restores selection, and refuses overwrite and missing ROIs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ocr-transfer-app-'))
  const python =
    process.env.OCR_EVAL_TEST_PYTHON ??
    execFileSync(
      'uv',
      ['run', '--project', 'python', 'python', '-c', 'import sys; print(sys.executable)'],
      { encoding: 'utf8' }
    ).trim()
  const captures = join(directory, 'captures')
  const eventId = '20260922-120000-abcdef12'
  const event = join(captures, eventId)
  await mkdir(event, { recursive: true })
  const metadata = JSON.stringify({
    schemaVersion: 1,
    eventId,
    coordinateSpace: 'primary-monitor-physical-pixels',
    source: { width: 1, height: 1 },
    regions: [
      { id: 1, file: '001.png', x: 0, y: 0, width: 1, height: 1 },
      { id: 2, file: '002.png', x: 0, y: 0, width: 1, height: 1 }
    ],
    groundTruth: { schemaVersion: 1, regions: { '1': ' 가😀 ', '2': null } }
  })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=',
    'base64'
  )
  await writeFile(join(event, 'metadata.json'), metadata)
  await writeFile(join(event, '001.png'), png)
  const profile = join(directory, 'profile')
  await mkdir(profile)
  await writeFile(
    join(profile, 'evaluation-settings.json'),
    JSON.stringify({
      schemaVersion: 1,
      settings: { pythonExecutable: python }
    })
  )
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      PATH: `${dirname(python)}${delimiter}${process.env.PATH ?? ''}`
    }).filter((entry): entry is [string, string] => entry[1] != null)
  )
  delete env.ELECTRON_RUN_AS_NODE
  const options = { args: [resolve('.'), `--user-data-dir=${profile}`], env }
  let application = await electron.launch(options)
  const output = join(captures, 'labels.json')
  try {
    let page = await application.firstWindow()
    const create = page.getByRole('button', { name: '정답 목록 만들기', exact: true })
    await expect(create).toBeDisabled()
    await application.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
    }, captures)
    await page.getByRole('button', { name: 'Cropper 캡처 루트 선택' }).click()
    await create.click()
    await expect(create).toBeEnabled()
    await expect(page.getByLabel('정답 파일', { exact: true })).toHaveValue('')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await application.evaluate(({ dialog }, selected) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected })
    }, output)
    await create.click()
    await expect(page.getByRole('form', { name: '평가 설정' }).getByRole('status')).toContainText(
      '정답 1개 저장 · 미작성 1개'
    )
    await expect(page.getByLabel('정답 파일', { exact: true })).toHaveValue(output)
    const text = await readFile(output, 'utf8')
    expect(JSON.parse(text).samples).toEqual([
      { id: `${eventId}/001`, image: `${eventId}/001.png`, truth: ' 가😀 ' }
    ])
    expect(await readFile(join(event, 'metadata.json'), 'utf8')).toBe(metadata)
    expect(await readFile(join(event, '001.png'))).toEqual(png)
    await create.click()
    await expect(page.getByRole('alert')).toContainText('덮어쓰지 않습니다')
    expect(await readFile(output, 'utf8')).toBe(text)
    await rm(join(event, '001.png'))
    await application.evaluate(
      ({ dialog }, selected) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected })
      },
      join(captures, 'missing-image.json')
    )
    await create.click()
    await expect(page.getByRole('alert')).toContainText('정답 목록을 만들지 못했습니다')
    await expect(page.getByRole('form', { name: '평가 설정' }).getByRole('status')).toHaveCount(0)
    await expect(page.getByLabel('정답 파일', { exact: true })).toHaveValue(output)
    await expect(readFile(join(captures, 'missing-image.json'))).rejects.toThrow()
    await application.close()
    application = await electron.launch(options)
    page = await application.firstWindow()
    await expect(page.getByLabel('정답 파일', { exact: true })).toHaveValue(output)
    await expect(page.getByLabel('Cropper 캡처 루트', { exact: true })).toHaveValue(captures)
    expect(await readFile(output, 'utf8')).toBe(text)
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
