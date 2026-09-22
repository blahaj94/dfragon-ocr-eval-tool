import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type {
  DatasetCheckResult,
  DatasetGroup,
  DatasetRecord,
  DatasetSample,
  DatasetSelection,
  DatasetSnapshot,
  DatasetSplit
} from '../../shared/dataset'
import {
  countSamples,
  datasetPath,
  parseCheckResult,
  parseDatasetRecord,
  parseEventIds,
  parseSelection,
  parseSplit,
  sameSample
} from './validation'

const CHECK_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

export class DatasetService {
  private record: DatasetRecord = { schemaVersion: 1, selection: null, samples: [] }
  private diskText: string | null = null
  private initialized = false
  private busy = false
  private assignments: Record<string, DatasetSplit | null> = {}
  private checked: DatasetCheckResult | null = null
  private exportDirectory: string | null = null

  constructor(
    private readonly recordPath: string,
    private readonly checkerPath: string
  ) {}

  getSnapshot(): Promise<DatasetSnapshot> {
    return this.operate(async () => this.snapshot())
  }

  load(input: unknown): Promise<DatasetSnapshot> {
    return this.operate(async () => {
      const requested = parseSelection(input)
      const selection: DatasetSelection = {
        // A venv executable may be a symlink; resolving it loses that environment.
        pythonExecutable: requested.pythonExecutable,
        datasetDirectory: await realpath(requested.datasetDirectory),
        labelsPath: await realpath(requested.labelsPath)
      }
      for (const path of [selection.pythonExecutable, selection.labelsPath, this.checkerPath]) {
        if (!(await stat(path)).isFile()) {
          throw new Error(`파일이 아닙니다: ${path}`)
        }
      }
      if (!(await stat(selection.datasetDirectory)).isDirectory()) {
        throw new Error('캡처 루트가 폴더가 아닙니다.')
      }
      this.checked = null
      const result = await this.runChecker('load', selection, {})
      this.preserveRecordedSamples(result.samples, selection.datasetDirectory)
      const samples = result.samples.map((sample) =>
        sample.confirmedAt === null ? { ...sample, split: null } : sample
      )
      await this.save({ schemaVersion: 1, selection, samples })
      this.assignments = {}
      this.checked = result.passed ? null : result
      this.exportDirectory = null
      return this.snapshot()
    })
  }

  assign(input: unknown, requestedSplit: unknown): Promise<DatasetSnapshot> {
    return this.operate(async () => {
      this.requireSelection()
      const eventIds = parseEventIds(input)
      const split = parseSplit(requestedSplit)
      const groups = this.groups()
      for (const eventId of eventIds) {
        const group = groups.find((candidate) => candidate.eventId === eventId)
        if (group == null || group.pendingCount === 0) {
          throw new Error('미확정 항목이 있는 캡처 이벤트만 배정할 수 있습니다.')
        }
        if (split !== null && group.confirmedSplit !== null && split !== group.confirmedSplit) {
          throw new Error('같은 캡처 이벤트의 기존 확정 split과 같아야 합니다.')
        }
      }
      for (const eventId of eventIds) {
        this.assignments[eventId] = split
      }
      this.checked = null
      this.exportDirectory = null
      return this.snapshot()
    })
  }

  check(): Promise<DatasetSnapshot> {
    return this.operate(async () => {
      this.checked = null
      this.checked = await this.checkCurrent(this.assignments)
      return this.snapshot()
    })
  }

  confirm(): Promise<DatasetSnapshot> {
    return this.operate(async () => {
      const previous = this.checked
      if (!this.snapshot().canConfirm || previous == null) {
        throw new Error('배정 후 검사를 통과해야 확정할 수 있습니다.')
      }
      this.checked = null
      const result = await this.checkCurrent(this.assignments)
      if (!result.passed) {
        this.checked = result
        return this.snapshot()
      }
      const previousSamples = new Map(previous.samples.map((sample) => [sample.key, sample]))
      if (
        result.samples.length !== previous.samples.length ||
        result.samples.some((sample) => {
          const before = previousSamples.get(sample.key)
          return before == null || !sameSample(before, sample)
        })
      ) {
        this.checked = this.sourceChanged(result)
        return this.snapshot()
      }
      const selection = this.requireSelection()
      const confirmedAt = new Date().toISOString()
      const samples = result.samples.map((sample) => {
        if (
          sample.confirmedAt === null &&
          sample.datasetDirectory === selection.datasetDirectory &&
          sample.split !== null
        ) {
          return { ...sample, confirmedAt }
        }
        return sample
      })
      await this.save({ ...this.record, samples })
      this.assignments = {}
      this.checked = null
      this.exportDirectory = null
      return this.snapshot()
    })
  }

  export(input: unknown): Promise<DatasetSnapshot> {
    return this.operate(async () => {
      this.exportDirectory = null
      const selection = this.requireSelection()
      const output = await realpath(datasetPath(input))
      if (!(await stat(output)).isDirectory()) {
        throw new Error('내보낼 위치가 폴더가 아닙니다.')
      }
      for (const root of new Set(this.record.samples.map((sample) => sample.datasetDirectory))) {
        const path = relative(root, output)
        if (path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))) {
          throw new Error('캡처 루트 밖의 폴더로 내보내세요.')
        }
      }
      this.checked = null
      const result = await this.checkCurrent({})
      if (!result.passed) {
        this.checked = result
        return this.snapshot()
      }
      const confirmed = this.record.samples.filter(
        (sample) =>
          sample.datasetDirectory === selection.datasetDirectory && sample.confirmedAt !== null
      )
      if (confirmed.length === 0) {
        throw new Error('내보낼 확정 샘플이 없습니다.')
      }
      await this.assertDiskUnchanged()
      const directory = join(output, `dataset-export-${Date.now()}-${randomUUID()}`)
      await mkdir(directory)
      try {
        for (const split of ['train', 'val', 'test'] as const) {
          const samples = confirmed
            .filter((sample) => sample.split === split)
            .map(({ id, image, truth }) => ({ id, image, truth }))
          await writeFile(
            join(directory, `${split}-labels.json`),
            `${JSON.stringify({ schemaVersion: 1, samples }, null, 2)}\n`,
            { flag: 'wx' }
          )
        }
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
      this.exportDirectory = directory
      return this.snapshot()
    })
  }

  private async operate(action: () => Promise<DatasetSnapshot>): Promise<DatasetSnapshot> {
    if (this.busy) {
      throw new Error('Dataset 작업이 진행 중입니다.')
    }
    this.busy = true
    try {
      if (!this.initialized) {
        const text = await this.readDisk()
        if (text !== null) {
          this.record = parseDatasetRecord(JSON.parse(text))
        }
        this.diskText = text
        this.initialized = true
      }
      await this.assertDiskUnchanged()
      return await action()
    } finally {
      this.busy = false
    }
  }

  private async readDisk(): Promise<string | null> {
    try {
      const info = await lstat(this.recordPath)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error('Dataset 기록은 일반 JSON 파일이어야 합니다.')
      }
      return await readFile(this.recordPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  private async assertDiskUnchanged(): Promise<void> {
    if ((await this.readDisk()) !== this.diskText) {
      this.checked = null
      throw new Error(
        'Dataset 기록이 외부에서 변경되었습니다. 원본을 보존하고 앱을 다시 실행하세요.'
      )
    }
  }

  private async save(record: DatasetRecord): Promise<void> {
    const validated = parseDatasetRecord(record)
    await mkdir(dirname(this.recordPath), { recursive: true })
    const temporary = join(dirname(this.recordPath), `.dataset-splits-${randomUUID()}.tmp`)
    const text = `${JSON.stringify(validated, null, 2)}\n`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(text, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await this.assertDiskUnchanged()
      await rename(temporary, this.recordPath)
      this.diskText = text
      this.record = validated
    } finally {
      await rm(temporary, { force: true }).catch((error: unknown) => {
        console.warn('Dataset 임시 기록 파일을 정리하지 못했습니다.', error)
      })
    }
  }

  private requireSelection(): DatasetSelection {
    if (this.record.selection === null) {
      throw new Error('Cropper 캡처 루트와 labels.json을 먼저 불러오세요.')
    }
    return this.record.selection
  }

  private effectiveSamples(): DatasetSample[] {
    const root = this.record.selection?.datasetDirectory
    return this.record.samples.map((sample) =>
      sample.datasetDirectory === root &&
      sample.confirmedAt === null &&
      sample.eventId in this.assignments
        ? { ...sample, split: this.assignments[sample.eventId] }
        : sample
    )
  }

  private groups(): DatasetGroup[] {
    const groups = new Map<string, DatasetGroup>()
    for (const sample of this.effectiveSamples()) {
      if (sample.datasetDirectory !== this.record.selection?.datasetDirectory) {
        continue
      }
      const group = groups.get(sample.eventId) ?? {
        eventId: sample.eventId,
        imageCount: 0,
        confirmedCount: 0,
        pendingCount: 0,
        split: null,
        confirmedSplit: null
      }
      group.imageCount++
      if (sample.confirmedAt !== null) {
        group.confirmedCount++
        group.confirmedSplit = sample.split
      } else {
        group.pendingCount++
        group.split = sample.split
      }
      groups.set(sample.eventId, group)
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        split: group.pendingCount ? group.split : group.confirmedSplit
      }))
      .sort((left, right) => left.eventId.localeCompare(right.eventId))
  }

  private snapshot(): DatasetSnapshot {
    const samples = this.effectiveSamples()
    return structuredClone({
      recordPath: this.recordPath,
      selection: this.record.selection,
      groups: this.groups(),
      counts: countSamples(samples, this.record.selection?.datasetDirectory ?? ''),
      check: this.checked,
      canConfirm:
        this.checked?.passed === true &&
        samples.some(
          (sample) =>
            sample.datasetDirectory === this.record.selection?.datasetDirectory &&
            sample.confirmedAt === null &&
            sample.split !== null
        ),
      exportDirectory: this.exportDirectory
    })
  }

  private preserveRecordedSamples(samples: DatasetSample[], activeRoot: string): void {
    const returned = new Map(samples.map((sample) => [sample.key, sample]))
    for (const previous of this.record.samples) {
      const next = returned.get(previous.key)
      if (
        next === undefined ||
        (previous.confirmedAt === null && next.confirmedAt !== null) ||
        ((previous.confirmedAt !== null || previous.datasetDirectory !== activeRoot) &&
          !sameSample(previous, next))
      ) {
        throw new Error(
          '검사기가 기존 Dataset 기록 또는 확정 항목을 변경했습니다. 저장하지 않았습니다.'
        )
      }
    }
    const known = new Set(this.record.samples.map((sample) => sample.key))
    if (
      samples.some(
        (sample) =>
          !known.has(sample.key) &&
          (sample.confirmedAt !== null || sample.datasetDirectory !== activeRoot)
      )
    ) {
      throw new Error('검사기가 허용되지 않은 Dataset 항목을 추가했습니다.')
    }
  }

  private sourceChanged(result: DatasetCheckResult): DatasetCheckResult {
    return {
      ...result,
      passed: false,
      issues: [
        ...result.issues,
        {
          severity: 'error',
          code: 'source-changed',
          images: [],
          message: '불러온 뒤 원본 또는 라벨 목록이 변경되었습니다. 다시 불러온 뒤 배정·검사하세요.'
        }
      ]
    }
  }

  private async checkCurrent(
    assignments: Record<string, DatasetSplit | null>
  ): Promise<DatasetCheckResult> {
    const selection = this.requireSelection()
    const result = await this.runChecker('check', selection, assignments)
    this.preserveRecordedSamples(result.samples, selection.datasetDirectory)
    const previous = new Map(this.record.samples.map((sample) => [sample.key, sample]))
    for (const sample of result.samples) {
      const before = previous.get(sample.key)
      if (before === undefined || !sameSample(before, sample, false)) {
        return this.sourceChanged(result)
      }
      const expectedSplit =
        before.confirmedAt === null && before.datasetDirectory === selection.datasetDirectory
          ? (assignments[before.eventId] ?? before.split)
          : before.split
      if (sample.split !== expectedSplit) {
        throw new Error('검사 결과 split이 요청한 초안과 다릅니다.')
      }
    }
    return result
  }

  private runChecker(
    mode: 'load' | 'check',
    selection: DatasetSelection,
    assignments: Record<string, DatasetSplit | null>
  ): Promise<DatasetCheckResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(selection.pythonExecutable, ['-u', this.checkerPath], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' }
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const fail = (error: Error): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        child.kill()
        reject(error)
      }
      const timer = setTimeout(
        () => fail(new Error('Dataset 검사 시간이 초과되었습니다.')),
        CHECK_TIMEOUT_MS
      )
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (text: string) => {
        stdout += text
        if (Buffer.byteLength(stdout) > MAX_RESPONSE_BYTES) {
          fail(new Error('Dataset 검사 응답이 너무 큽니다.'))
        }
      })
      child.stderr.on('data', (text: string) => {
        stderr = (stderr + text).slice(-8000)
      })
      child.on('error', fail)
      child.stdin.on('error', fail)
      child.once('close', (code) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        try {
          if (code !== 0) {
            throw new Error(`Dataset 검사 프로세스가 실패했습니다 (${code}). ${stderr.trim()}`)
          }
          resolve(parseCheckResult(JSON.parse(stdout), selection.datasetDirectory))
        } catch (error) {
          reject(error)
        }
      })
      child.stdin.end(JSON.stringify({ mode, record: this.record, selection, assignments }))
    })
  }
}
