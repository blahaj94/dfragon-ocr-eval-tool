import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discoverPythons,
  EvaluationSettingsStore,
  parseLauncherPaths,
  pythonCandidates
} from './settings'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, rename: vi.fn(original.rename) }
})

describe('evaluation settings', () => {
  it('reads legacy and current Windows launcher paths including vendor tags and spaces', () => {
    expect(
      parseLauncherPaths(
        'Installed Pythons\n -V:3.14 * C:\\Users\\Tester\\Python314\\python.exe\n -3.12-64 "C:\\Program Files\\Python312\\python.exe"\n -V:Astral/CPython3.12.14 D:\\환경\\python.exe\n not a runtime'
      )
    ).toEqual([
      'C:\\Users\\Tester\\Python314\\python.exe',
      'C:\\Program Files\\Python312\\python.exe',
      'D:\\환경\\python.exe'
    ])
  })
  let directory: string
  let file: string
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'ocr-settings-test-'))
    file = join(directory, 'evaluation-settings.json')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('uses PATH only when no Python has been saved and preserves a manual environment across restart', async () => {
    const auto = vi.fn(async () => [
      { executable: join(directory, 'path-python'), version: '3.12.14', supported: true }
    ])
    const store = new EvaluationSettingsStore(file, auto)
    expect((await store.get()).settings).toEqual({
      pythonExecutable: join(directory, 'path-python')
    })
    const saved = {
      pythonExecutable: join(directory, 'manual-python'),
      runDirectory: join(directory, 'run'),
      checkpointPath: join(directory, 'run', 'checkpoints', 'latest.pdparams'),
      labelsPath: join(directory, 'labels.json')
    }
    await store.save(saved)
    const noFallback = vi.fn(async () => [])
    expect((await new EvaluationSettingsStore(file, noFallback).get()).settings).toEqual(saved)
    expect(noFallback).toHaveBeenCalledWith(saved.pythonExecutable)
    expect(await fs.readdir(directory)).toEqual(['evaluation-settings.json'])
  })

  it('leaves Python unset if PATH has no compatible interpreter', async () => {
    expect(await new EvaluationSettingsStore(file, async () => []).get()).toEqual({
      settings: {},
      pythons: []
    })
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the last saved settings on a failed atomic replacement and accepts a later save', async () => {
    const store = new EvaluationSettingsStore(file, async () => [])
    await store.save({ labelsPath: join(directory, 'old.json') })
    const previous = await fs.readFile(file, 'utf8')
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('disk failure'))
    await expect(store.save({ labelsPath: join(directory, 'new.json') })).rejects.toThrow(
      'disk failure'
    )
    expect(await fs.readFile(file, 'utf8')).toBe(previous)
    expect(await fs.readdir(directory)).toEqual(['evaluation-settings.json'])
    await store.save({ labelsPath: join(directory, 'new.json') })
    expect((await store.get()).settings).toEqual({ labelsPath: join(directory, 'new.json') })
  })

  it('rejects corrupt settings and invalid paths without overwriting the file', async () => {
    await fs.writeFile(file, '{broken')
    const store = new EvaluationSettingsStore(file, async () => [])
    await expect(store.get()).rejects.toThrow()
    await expect(store.save({ pythonExecutable: join(directory, 'python') })).rejects.toThrow()
    expect(() => store.save({ pythonExecutable: 'relative-python' })).toThrow()
    expect(() => store.save({ injected: true })).toThrow()
    expect(await fs.readFile(file, 'utf8')).toBe('{broken')
  })

  it('serializes saves so the last selection survives', async () => {
    const store = new EvaluationSettingsStore(file, async () => [])
    await Promise.all([
      store.save({ outputDirectory: join(directory, 'first') }),
      store.save({ outputDirectory: join(directory, 'second') })
    ])
    expect((await store.get()).settings).toEqual({ outputDirectory: join(directory, 'second') })
  })

  it('searches Windows PATH in order without current-directory entries, duplicates or Store aliases', () => {
    expect(
      pythonCandidates(
        'relative;;"C:\\GPU env";C:\\Users\\User\\AppData\\Local\\Microsoft\\WindowsApps;c:\\gpu env;D:\\Python',
        'win32'
      )
    ).toEqual([
      'C:\\GPU env\\python.exe',
      'C:\\GPU env\\python3.exe',
      'C:\\GPU env\\python3.12.exe',
      'D:\\Python\\python.exe',
      'D:\\Python\\python3.exe',
      'D:\\Python\\python3.12.exe'
    ])
  })

  it.skipIf(process.platform === 'win32')(
    'lists actual version responses including unsupported versions without resolving environment paths',
    async () => {
      const first = join(directory, 'old')
      const second = join(directory, 'environment with spaces')
      await fs.mkdir(first)
      await fs.mkdir(second)
      // These executable fixtures only simulate version output; no GPU or interpreter is claimed.
      await fs.writeFile(
        join(first, 'python3'),
        `#!/bin/sh
printf '%s\\n' '{"version":"3.11.9","executable":"/fixture/python311"}'
`,
        { mode: 0o700 }
      )
      await fs.writeFile(
        join(second, 'python3'),
        `#!/bin/sh
printf '%s\\n' '{"version":"3.12.14","executable":"/fixture/python312"}'
`,
        {
          mode: 0o700
        }
      )
      await fs.copyFile(join(second, 'python3'), join(second, 'python'))
      expect(
        await discoverPythons(undefined, { PATH: `${first}:${second}` }, process.platform)
      ).toEqual([
        { executable: join(first, 'python3'), version: '3.11.9', supported: false },
        { executable: join(second, 'python3'), version: '3.12.14', supported: true }
      ])
      expect(await discoverPythons(undefined, { PATH: directory }, process.platform)).toEqual([])
    }
  )
})
