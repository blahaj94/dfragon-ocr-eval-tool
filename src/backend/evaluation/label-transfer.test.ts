import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LabelTransferService } from './label-transfer'

const execute = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => undefined, {
    [Symbol.for('nodejs.util.promisify.custom')]: execute
  })
}))

describe('app label transfer', () => {
  let directory: string
  let captures: string
  let output: string
  beforeEach(async () => {
    vi.resetAllMocks()
    directory = await mkdtemp(join(tmpdir(), 'label-transfer-'))
    captures = join(directory, 'captures')
    output = join(directory, 'labels.json')
    await mkdir(captures)
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  function service(
    choose: () => Promise<string | null> = async () => output
  ): LabelTransferService {
    return new LabelTransferService(
      join(directory, 'transfer.py'),
      async () => ({
        settings: {},
        pythons: [{ executable: join(directory, 'python'), version: '3.14.4', supported: false }]
      }),
      choose
    )
  }
  it('allows cancellation without running Python and releases its lock', async () => {
    const converter = service(async () => null)
    expect(await converter.create(captures)).toBeNull()
    expect(converter.isActive()).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })
  it('refuses an existing file before invoking the converter', async () => {
    await writeFile(output, 'original')
    await expect(service().create(captures)).rejects.toThrow('덮어쓰지 않습니다')
    expect(await readFile(output, 'utf8')).toBe('original')
    expect(execute).not.toHaveBeenCalled()
  })
  it('keeps the dialog and conversion exclusive', async () => {
    let finish!: (value: null) => void
    const converter = service(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = converter.create(captures)
    await expect(converter.create(captures)).rejects.toThrow('만드는 중')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish(null)
    await pending
    expect(converter.isActive()).toBe(false)
  })
  it.each(['failure', 'invalid-json', 'wrong-path', 'missing-output'])(
    'does not turn %s into successful creation',
    async (mode) => {
      if (mode === 'failure') {
        execute.mockRejectedValue({ stderr: 'fixture: invalid ROI' })
      } else {
        execute.mockResolvedValue({
          stdout:
            mode === 'invalid-json'
              ? 'invalid'
              : JSON.stringify({
                  output: mode === 'wrong-path' ? join(directory, 'other.json') : output,
                  events: 1,
                  samples: 1,
                  unanswered: 0
                })
        })
      }
      const converter = service()
      await expect(converter.create(captures)).rejects.toThrow()
      expect(converter.isActive()).toBe(false)
    }
  )
})
