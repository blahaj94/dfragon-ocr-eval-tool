import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { DatasetRecord, DatasetSelection, DatasetSnapshot } from '../src/shared/dataset'
import type { Result } from '../src/shared/contracts'

const events = [1, 2, 3, 4, 5].map((id) => `20260101-120000-${String(id).padStart(8, '0')}`)
const fixtureScript = `
import hashlib, json, sys
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(sys.argv[1])
(root / 'captures').mkdir(exist_ok=True)
(root / 'exports').mkdir(exist_ok=True)
rows = []
colors = [(210, 30, 30), (30, 30, 210), (30, 210, 30), (100, 100, 100), (150, 60, 90)]
count = 5 if len(sys.argv) > 2 else 3
for index in range(count):
    event = f'20260101-120000-{index + 1:08d}'
    directory = root / 'captures' / event
    directory.mkdir(exist_ok=True)
    source = Image.new('RGB', (40, 20), colors[index])
    draw = ImageDraw.Draw(source)
    regions = []
    for number in range(1, 3 if index == 0 else 2):
        x = (number - 1) * 8
        color = colors[0] if index == 3 else tuple(min(255, channel + number - 1) for channel in colors[index])
        draw.rectangle((x, 0, x + 7, 3), fill=color)
        source.crop((x, 0, x + 8, 4)).save(directory / f'{number:03d}.png')
        regions.append(dict(id=number, file=f'{number:03d}.png', x=x, y=0, width=8, height=4))
        rows.append(dict(id=f'{event}-{number}', image=f'{event}/{number:03d}.png', truth='검신'))
    metadata = dict(schemaVersion=1, eventId=event, coordinateSpace='primary-monitor-physical-pixels',
        source=dict(width=40, height=20, pixelFormat='rgba8', rgbaSha256=hashlib.sha256(source.convert('RGBA').tobytes()).hexdigest(), file=None),
        regions=regions)
    (directory / 'metadata.json').write_text(json.dumps(metadata), encoding='utf-8')
(root / 'labels.json').write_text(json.dumps(dict(schemaVersion=1, samples=rows), ensure_ascii=False), encoding='utf-8')
`

function value<T>(result: Result<T>): T {
  expect(result.ok, result.ok ? undefined : result.error).toBe(true)
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.value
}

test('real Dataset checker confirms, survives app restart, and exports only frozen splits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dataset-electron-'))
  const pythonExecutable =
    process.env.OCR_EVAL_TEST_PYTHON ??
    execFileSync(
      'uv',
      ['run', '--project', 'python', 'python', '-c', 'import sys; print(sys.executable)'],
      {
        encoding: 'utf8'
      }
    ).trim()
  execFileSync(pythonExecutable, ['-c', fixtureScript, directory])
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null)
  )
  delete env.ELECTRON_RUN_AS_NODE
  const launch = () =>
    electron.launch({
      args: [resolve('.'), `--user-data-dir=${join(directory, 'profile')}`],
      env
    })
  const selection: DatasetSelection = {
    pythonExecutable,
    datasetDirectory: join(directory, 'captures'),
    labelsPath: join(directory, 'labels.json')
  }
  let application = await launch()
  try {
    let page = await application.firstWindow()
    await expect.poll(() => page.evaluate(() => typeof window.dataset)).toBe('object')
    await application.evaluate(
      ({ dialog }, paths) => {
        let index = 0
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[index++]] })
      },
      [pythonExecutable, selection.datasetDirectory, selection.labelsPath]
    )
    await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
    for (const name of [
      'Dataset Python 실행 파일 선택',
      'Dataset 캡처 루트 선택',
      'Dataset 정답 파일 선택'
    ]) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await page.getByRole('button', { name: '데이터 불러오기', exact: true }).click()
    await expect(
      page.getByRole('checkbox', { name: `${events[0]} 선택`, exact: true })
    ).toBeVisible()
    const loaded = value(await page.evaluate(() => window.dataset.getSnapshot()))
    expect(loaded.counts).toEqual({ train: 0, val: 0, test: 0, unassigned: 4 })
    for (const [eventId, split] of [
      [events[0], 'train'],
      [events[1], 'val'],
      [events[2], 'test']
    ] as const) {
      await page.getByRole('checkbox', { name: `${eventId} 선택`, exact: true }).check()
      await page.getByLabel('배정 위치', { exact: true }).selectOption(split)
      await page.getByRole('button', { name: '선택 그룹 배정', exact: true }).click()
      await expect(
        page.getByRole('checkbox', { name: `${eventId} 선택`, exact: true })
      ).not.toBeChecked()
    }
    await page.getByRole('button', { name: 'Dataset 검사', exact: true }).click()
    await expect(page.getByText('검사 통과', { exact: true })).toBeVisible()
    const checked = value(await page.evaluate(() => window.dataset.getSnapshot()))
    expect(checked.check?.passed).toBe(true)
    expect(checked.canConfirm).toBe(true)
    await page.getByRole('button', { name: '배정 확정', exact: true }).click()
    await expect(
      page.getByRole('checkbox', { name: `${events[0]} 선택`, exact: true })
    ).toBeDisabled()
    await expect(page.getByText('확정 4개', { exact: true })).toBeVisible()
    const confirmed = value(await page.evaluate(() => window.dataset.getSnapshot()))
    expect(confirmed.groups.every((group) => group.pendingCount === 0)).toBe(true)
    const persisted: DatasetRecord = JSON.parse(await readFile(confirmed.recordPath, 'utf8'))
    expect(persisted.samples.every((sample) => sample.confirmedAt != null)).toBe(true)
    const originalLabels = await readFile(selection.labelsPath, 'utf8')
    const originalPng = await readFile(join(selection.datasetDirectory, events[0], '001.png'))
    await application.close()

    application = await launch()
    page = await application.firstWindow()
    await expect.poll(() => page.evaluate(() => typeof window.dataset)).toBe('object')
    const restored = value(await page.evaluate(() => window.dataset.getSnapshot()))
    expect(restored.counts).toEqual({ train: 2, val: 1, test: 1, unassigned: 0 })
    expect(restored.groups).toEqual(confirmed.groups)
    expect(
      (await page.evaluate((event) => window.dataset.assign([event], 'test'), events[0])).ok
    ).toBe(false)
    await page.getByRole('tab', { name: 'Dataset', exact: true }).click()
    await expect(
      page.getByRole('checkbox', { name: `${events[0]} 선택`, exact: true })
    ).toBeVisible()
    await expect(page.getByText(/확정/, { exact: false }).first()).toBeVisible()

    execFileSync(pythonExecutable, ['-c', fixtureScript, directory, 'expanded'])
    const expanded = value(await page.evaluate((input) => window.dataset.load(input), selection))
    expect(expanded.counts).toEqual({ train: 2, val: 1, test: 1, unassigned: 2 })
    value(await page.evaluate((event) => window.dataset.assign([event], 'test'), events[3]))
    const blocked = value(await page.evaluate(() => window.dataset.check()))
    expect(blocked.check?.passed).toBe(false)
    expect(blocked.canConfirm).toBe(false)
    expect((await page.evaluate(() => window.dataset.confirm())).ok).toBe(false)
    value(await page.evaluate((event) => window.dataset.assign([event], 'train'), events[3]))
    expect((await page.evaluate(() => window.dataset.confirm())).ok).toBe(false)
    expect(value(await page.evaluate(() => window.dataset.check())).check?.passed).toBe(true)
    value(await page.evaluate(() => window.dataset.confirm()))
    const exported: DatasetSnapshot = value(
      await page.evaluate((output) => window.dataset.export(output), join(directory, 'exports'))
    )
    expect(exported.exportDirectory).not.toBeNull()
    for (const [split, expectedEvents] of [
      ['train', [events[0], events[0], events[3]]],
      ['val', [events[1]]],
      ['test', [events[2]]]
    ] as const) {
      const labels = JSON.parse(
        await readFile(join(exported.exportDirectory!, `${split}-labels.json`), 'utf8')
      )
      expect(labels.schemaVersion).toBe(1)
      expect(
        labels.samples.map((sample: { image: string }) => sample.image.split('/')[0]).sort()
      ).toEqual([...expectedEvents].sort())
      expect(labels.samples.every((sample: { truth: string }) => sample.truth === '검신')).toBe(
        true
      )
    }
    const finalRecord: DatasetRecord = JSON.parse(await readFile(exported.recordPath, 'utf8'))
    for (const frozen of persisted.samples) {
      expect(finalRecord.samples.find((sample) => sample.key === frozen.key)).toEqual(frozen)
    }
    expect(finalRecord.samples.filter((sample) => sample.confirmedAt == null)).toHaveLength(1)
    expect(await readFile(join(selection.datasetDirectory, events[0], '001.png'))).toEqual(
      originalPng
    )
    expect(JSON.parse(originalLabels).samples).toHaveLength(4)
    // A previous export is immutable; a second export gets a different directory.
    const exportedAgain = value(
      await page.evaluate((output) => window.dataset.export(output), join(directory, 'exports'))
    )
    expect(exportedAgain.exportDirectory).not.toBe(exported.exportDirectory)
  } finally {
    await application.close()
    await rm(directory, { recursive: true, force: true })
  }
})
