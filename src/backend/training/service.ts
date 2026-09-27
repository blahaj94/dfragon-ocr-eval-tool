import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, isAbsolute, basename, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import type { LibraryModel, TrainingOptions, TrainingSnapshot } from '../../shared/training'
import { isRecord, isSample, isReport, readPath } from '../evaluation/validation'
import { LibraryClient, parseDataset, parseModel } from './library'

export function parseTrainingOptions(value: unknown): TrainingOptions {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !==
      'batchSize,epochs,learningRate,pythonExecutable,upstreamDirectory' ||
    typeof value.epochs !== 'number' ||
    !Number.isInteger(value.epochs) ||
    value.epochs < 1 ||
    value.epochs > 1000 ||
    typeof value.batchSize !== 'number' ||
    !Number.isInteger(value.batchSize) ||
    value.batchSize < 1 ||
    value.batchSize > 128 ||
    typeof value.learningRate !== 'number' ||
    !Number.isFinite(value.learningRate) ||
    value.learningRate < 1e-8 ||
    value.learningRate > 0.1
  ) {
    throw new Error('학습 횟수·배치 크기·학습률을 확인해 주세요.')
  }
  return {
    pythonExecutable: readPath(value.pythonExecutable),
    upstreamDirectory: readPath(value.upstreamDirectory),
    epochs: value.epochs,
    batchSize: value.batchSize,
    learningRate: value.learningRate
  }
}

export class TrainingService {
  private snapshot: TrainingSnapshot = {
    status: 'idle',
    message: '',
    error: null,
    directory: null,
    counts: null,
    model: null,
    epoch: 0,
    epochs: 0,
    metrics: null,
    samples: [],
    publishedModelId: null
  }
  private controller: AbortController | null = null
  private child: ChildProcess | null = null
  private cancelFile: string | null = null
  private runDirectory: string | null = null
  private preparing = false
  private cancelRequested = false
  private readonly images = new Map<string, string>()

  constructor(
    private readonly library: LibraryClient,
    private readonly worker: string,
    private readonly publishSnapshot: (snapshot: TrainingSnapshot) => void,
    private readonly gpuBusy: () => boolean
  ) {}

  isActive(): boolean {
    return this.preparing || this.controller !== null || this.child !== null
  }
  getSnapshot(): TrainingSnapshot {
    return structuredClone(this.snapshot)
  }
  private update(value: Partial<TrainingSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...value }
    this.publishSnapshot(this.getSnapshot())
  }
  private requireFree(): void {
    if (this.isActive()) {
      throw new Error('진행 중인 작업이 끝난 뒤 실행해 주세요.')
    }
  }

  async models(): Promise<LibraryModel[]> {
    return this.library.models(AbortSignal.timeout(15_000))
  }

  async open(value: unknown): Promise<void> {
    this.requireFree()
    this.preparing = true
    try {
      const selected = await realpath(readPath(value))
      const run = basename(dirname(selected)) === 'runs' ? selected : null
      const root = run === null ? selected : dirname(dirname(selected))
      const bytes = await readFile(join(root, 'dataset.json'))
      const ready: unknown = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8'))
      if (
        !isRecord(ready) ||
        ready.datasetSha256 !== createHash('sha256').update(bytes).digest('hex')
      ) {
        throw new Error('완료된 다운로드가 아니거나 데이터가 변경되었습니다.')
      }
      const metadata: unknown = JSON.parse(bytes.toString('utf8'))
      const dataset = parseDataset(metadata)
      const model = parseModel(JSON.parse(await readFile(join(root, 'model/model.json'), 'utf8')))
      if (
        !isRecord(metadata) ||
        metadata.modelId !== model.id ||
        metadata.schemaVersion !== 1 ||
        !isRecord(metadata.counts)
      ) {
        throw new Error('실험의 모델 정보가 올바르지 않습니다.')
      }
      const counts = { train: 0, val: 0, test: 0, skipped: Number(metadata.counts.skipped) }
      for (const row of dataset.samples) {
        if (row.split === 'unassigned' || row.excluded || row.text === null) {
          throw new Error('실험 데이터의 선별 정보가 올바르지 않습니다.')
        }
        counts[row.split]++
      }
      if (
        !Number.isSafeInteger(counts.skipped) ||
        counts.skipped < 0 ||
        !counts.train ||
        !counts.val ||
        !counts.test ||
        ['train', 'val', 'test'].some(
          (split) =>
            counts[split as 'train'] !== (metadata.counts as Record<string, unknown>)[split]
        )
      ) {
        throw new Error('실험 데이터 개수가 올바르지 않습니다.')
      }
      let report: unknown = null
      const images = new Map<string, string>()
      if (run !== null) {
        report = JSON.parse(await readFile(join(run, 'report.json'), 'utf8'))
        if (
          !isReport(report) ||
          report.status !== 'completed' ||
          report.totalSamples !== counts.test
        ) {
          throw new Error('완료된 결과 폴더를 선택해 주세요. 다시 학습하려면 실험 폴더를 여세요.')
        }
        const rows = (metadata.samples as Record<string, unknown>[]).filter(
          (row) => row.split === 'test'
        )
        for (const sample of report.samples) {
          const row = rows.find((item) => item.id === sample.id)
          const raw = sample as unknown as Record<string, unknown>
          const expectedPath = join(root, 'images', `${sample.id}.png`)
          if (
            !row ||
            sample.truth !== row.text ||
            raw.imageSha256 !== row.sha256 ||
            typeof row.sha256 !== 'string' ||
            !/^[0-9a-f]{64}$/.test(row.sha256) ||
            sample.imagePath !== expectedPath ||
            images.has(expectedPath) ||
            (await realpath(expectedPath)) !== expectedPath ||
            createHash('sha256')
              .update(await readFile(expectedPath))
              .digest('hex') !== row.sha256
          ) {
            throw new Error('평가 보고서와 고정된 test 이미지가 다릅니다.')
          }
          images.set(expectedPath, row.sha256)
        }
      }
      this.images.clear()
      for (const [path, hash] of images) {
        this.images.set(path, hash)
      }
      this.runDirectory = run
      this.update({
        status: run === null ? 'ready' : 'completed',
        directory: root,
        counts,
        model,
        error: null,
        epoch: 0,
        epochs: 0,
        publishedModelId: null,
        samples: isReport(report) ? report.samples : [],
        metrics: isReport(report) ? report.summary : null,
        message:
          run === null
            ? '저장한 실험을 열었습니다. 학습 때 입력 파일의 해시를 다시 검사합니다.'
            : `저장한 학습 결과를 열었습니다. · ${join(run, 'report.json')}`
      })
    } finally {
      this.preparing = false
      this.update({})
    }
  }

  async download(modelId: unknown, directory: unknown): Promise<void> {
    this.requireFree()
    if (typeof modelId !== 'string') {
      throw new Error('모델을 선택해 주세요.')
    }
    const root = readPath(directory)
    this.controller = new AbortController()
    this.runDirectory = null
    this.images.clear()
    this.update({
      status: 'downloading',
      message: '자료실 목록을 가져옵니다.',
      error: null,
      directory: null,
      model: null,
      counts: null,
      metrics: null,
      samples: [],
      publishedModelId: null
    })
    try {
      const result = await this.library.download(modelId, root, this.controller.signal, (message) =>
        this.update({ message })
      )
      this.update({
        status: 'ready',
        directory: result.folder,
        model: result.model,
        counts: result.counts,
        message: '모델과 데이터가 준비되었습니다. 학습 설정을 확인해 주세요.'
      })
    } catch (error) {
      this.update({
        status: this.controller.signal.aborted ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    } finally {
      this.controller = null
      this.update({})
    }
  }

  async start(value: unknown): Promise<void> {
    this.requireFree()
    if (this.gpuBusy()) {
      throw new Error('평가 또는 모델 진단이 진행 중입니다.')
    }
    const options = parseTrainingOptions(value)
    const root = this.snapshot.directory
    if (root === null || this.snapshot.model === null) {
      throw new Error('모델과 데이터를 먼저 가져와 주세요.')
    }
    this.preparing = true
    this.cancelRequested = false
    this.images.clear()
    this.update({
      status: 'training',
      message: '학습 환경을 확인합니다.',
      error: null,
      epoch: 0,
      epochs: options.epochs,
      samples: [],
      metrics: null,
      publishedModelId: null
    })
    try {
      const run = join(root, 'runs', randomUUID())
      await mkdir(run, { recursive: true })
      this.runDirectory = run
      const request = join(run, 'request.json')
      this.cancelFile = join(run, 'cancel')
      await writeFile(
        request,
        JSON.stringify({
          directory: root,
          runDirectory: run,
          upstreamDirectory: options.upstreamDirectory,
          epochs: options.epochs,
          batchSize: options.batchSize,
          learningRate: options.learningRate
        }),
        { flag: 'wx' }
      )
      if (this.cancelRequested) {
        this.cancelFile = null
        this.update({ status: 'cancelled', message: '학습 시작을 취소했습니다.' })
        return
      }
      const child = spawn(
        options.pythonExecutable,
        ['-B', '-u', this.worker, '--request', request, '--cancel-file', this.cancelFile],
        {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }
        }
      )
      this.child = child
      let terminal: 'finished' | 'cancelled' | null = null
      let failure: string | null = null
      let stderr = ''
      let pending = Promise.resolve()
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-12000)
      })
      const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity })
      lines.on('line', (line) => {
        pending = pending.then(async () => {
          if (failure !== null) {
            return
          }
          try {
            if (line.length > 512 * 1024 || terminal !== null) {
              throw new Error('학습 프로세스 응답이 올바르지 않습니다.')
            }
            const event: unknown = JSON.parse(line)
            if (!isRecord(event)) {
              throw new Error('학습 프로세스 응답이 올바르지 않습니다.')
            }
            if (event.type === 'message' && typeof event.message === 'string') {
              this.update({ message: event.message })
            } else if (
              event.type === 'progress' &&
              Number.isInteger(event.epoch) &&
              event.epochs === options.epochs &&
              Number(event.epoch) >= 1 &&
              Number(event.epoch) <= options.epochs &&
              typeof event.message === 'string'
            ) {
              this.update({ epoch: Number(event.epoch), message: event.message })
            } else if (event.type === 'evaluating' && typeof event.message === 'string') {
              this.update({
                status: this.snapshot.status === 'cancelling' ? 'cancelling' : 'evaluating',
                message: event.message
              })
            } else if (
              event.type === 'sample' &&
              isSample(event.sample) &&
              this.snapshot.samples.length < (this.snapshot.counts?.test ?? 0)
            ) {
              const image = await realpath(event.sample.imagePath)
              const rel = relative(join(root, 'images'), image)
              if (
                rel.startsWith('..') ||
                isAbsolute(rel) ||
                !/^[0-9a-f-]+\.png$/.test(rel) ||
                this.images.has(image)
              ) {
                throw new Error('평가 이미지 경로가 올바르지 않습니다.')
              }
              const raw = event.sample as unknown as Record<string, unknown>
              if (typeof raw.imageSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.imageSha256)) {
                throw new Error('평가 이미지 해시가 없습니다.')
              }
              this.images.set(image, raw.imageSha256)
              this.update({ samples: [...this.snapshot.samples, event.sample] })
            } else if (event.type === 'finished' && event.reportPath === join(run, 'report.json')) {
              terminal = 'finished'
            } else if (event.type === 'cancelled') {
              terminal = 'cancelled'
            } else if (event.type === 'error' && typeof event.message === 'string') {
              throw new Error(event.message)
            } else {
              throw new Error('학습 프로세스 응답 형식이 올바르지 않습니다.')
            }
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error)
            await this.cancel().catch(() => undefined)
          }
        })
      })
      child.once('error', (error) => {
        failure = error.message
      })
      child.once('close', (code) => {
        void pending
          .then(async () => {
            if (failure !== null || code !== 0 || terminal === null) {
              throw new Error(
                failure || stderr.trim() || '학습 프로세스가 완료 보고서 없이 종료되었습니다.'
              )
            }
            if (terminal === 'cancelled' || this.snapshot.status === 'cancelling') {
              this.update({
                status: 'cancelled',
                message: '학습·평가를 취소했습니다.',
                metrics: null
              })
              return
            }
            const report: unknown = JSON.parse(await readFile(join(run, 'report.json'), 'utf8'))
            if (
              !isReport(report) ||
              report.status !== 'completed' ||
              report.totalSamples !== this.snapshot.counts?.test ||
              JSON.stringify(report.samples) !== JSON.stringify(this.snapshot.samples)
            ) {
              throw new Error('저장된 평가 보고서와 실행 결과가 다릅니다.')
            }
            this.update({
              status: 'completed',
              metrics: report.summary,
              message: `학습·test 평가 완료 · ${join(run, 'report.json')}`
            })
          })
          .catch((error: unknown) =>
            this.update({
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
              metrics: null
            })
          )
          .finally(() => {
            this.child = null
            this.cancelFile = null
            this.update({})
          })
      })
    } catch (error) {
      this.update({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    } finally {
      this.preparing = false
      this.update({})
    }
  }

  async cancel(): Promise<void> {
    this.cancelRequested = true
    this.controller?.abort()
    if (this.cancelFile !== null) {
      await writeFile(this.cancelFile, 'cancel')
      this.update({ status: 'cancelling', message: '현재 GPU 작업이 끝나면 중단합니다.' })
    }
  }

  async publish(name: unknown): Promise<LibraryModel> {
    this.requireFree()
    if (
      typeof name !== 'string' ||
      this.snapshot.status !== 'completed' ||
      this.snapshot.directory === null ||
      this.snapshot.model === null ||
      this.runDirectory === null
    ) {
      throw new Error('완료된 학습·평가 결과만 등록할 수 있습니다.')
    }
    this.controller = new AbortController()
    this.update({
      status: 'publishing',
      error: null,
      message: '미니PC에 모델과 평가 결과를 올립니다.'
    })
    try {
      const model = await this.library.publish(
        this.snapshot.directory,
        this.runDirectory,
        this.snapshot.model,
        name,
        this.controller.signal
      )
      this.update({
        publishedModelId: model.id,
        message: '미니PC에 새 모델과 평가 결과를 등록했습니다.'
      })
      return model
    } catch (error) {
      this.update({
        error: error instanceof Error ? error.message : String(error),
        message: '등록 완료 여부를 확인하지 못했습니다. 다시 올리기는 같은 모델 ID를 사용합니다.'
      })
      throw error
    } finally {
      this.controller = null
      this.update({ status: 'completed' })
    }
  }

  async readImage(value: unknown): Promise<string> {
    const path = await realpath(readPath(value))
    const expected = this.images.get(path)
    if (expected === undefined) {
      throw new Error('현재 평가 결과의 이미지만 열 수 있습니다.')
    }
    const bytes = await readFile(path)
    if (
      bytes.length > 16 * 1024 * 1024 ||
      createHash('sha256').update(bytes).digest('hex') !== expected
    ) {
      throw new Error('평가 후 이미지가 변경되었습니다.')
    }
    return `data:image/png;base64,${bytes.toString('base64')}`
  }
}
