import { execFile } from 'node:child_process'
import { lstat, readFile, stat } from 'node:fs/promises'
import { extname, normalize } from 'node:path'
import { promisify } from 'node:util'
import type { EvaluationPreferences, LabelTransferResult } from '../../shared/contracts'
import { parseLabels } from '../charset/validation'
import { isCount, isRecord, readPath } from './validation'

const execute = promisify(execFile)

export class LabelTransferService {
  private busy = false

  constructor(
    private readonly scriptPath: string,
    private readonly preferences: () => Promise<EvaluationPreferences>,
    private readonly chooseOutput: (directory: string) => Promise<string | null>,
    private readonly settled: () => void = () => undefined
  ) {}

  isActive(): boolean {
    return this.busy
  }

  async create(input: unknown): Promise<LabelTransferResult | null> {
    if (this.busy) {
      throw new Error('정답 목록을 만드는 중입니다. 완료 후 다시 시도하세요.')
    }
    const directory = readPath(input)
    this.busy = true
    try {
      if (!(await stat(directory)).isDirectory()) {
        throw new Error('Cropper 캡처 루트를 선택하세요.')
      }
      const selected = await this.chooseOutput(directory)
      if (selected === null) {
        return null
      }
      const output = readPath(selected)
      if (extname(output).toLowerCase() !== '.json') {
        throw new Error('정답 목록은 새 JSON 파일로 저장하세요.')
      }
      try {
        await lstat(output)
        throw new Error('이미 있는 파일은 덮어쓰지 않습니다. 다른 이름으로 저장하세요.')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
      const { settings, pythons } = await this.preferences()
      const python = settings.pythonExecutable
        ? pythons.find((item) => item.executable === settings.pythonExecutable)
        : pythons.find((item) => /^3\.(1[0-9]|[2-9][0-9])\./.test(item.version))
      if (!python || !/^3\.(1[0-9]|[2-9][0-9])\./.test(python.version)) {
        throw new Error(
          '정답 목록 생성에 사용할 Python 3.10 이상을 찾지 못했습니다. 실행 환경을 확인하세요.'
        )
      }
      let stdout: string
      try {
        const result = await execute(
          python.executable,
          ['-B', this.scriptPath, directory, '--output', output],
          {
            timeout: 120_000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
            encoding: 'utf8',
            env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
          }
        )
        stdout = result.stdout
      } catch (error) {
        const failure = error as { stderr?: string; killed?: boolean; message?: string }
        const detail = failure.killed
          ? '제한 시간 안에 변환을 끝내지 못했습니다. 저장 위치를 확인하세요.'
          : (failure.stderr?.trim() || failure.message || 'Python 실행 실패').slice(0, 2000)
        throw new Error(`정답 목록을 만들지 못했습니다. ${detail}`)
      }
      const result: unknown = JSON.parse(stdout)
      if (
        !isRecord(result) ||
        result.output !== normalize(output) ||
        !isCount(result.events) ||
        result.events === 0 ||
        !isCount(result.samples) ||
        result.samples === 0 ||
        !isCount(result.unanswered)
      ) {
        throw new Error('정답 목록 생성 응답이 올바르지 않습니다. 저장 위치를 확인하세요.')
      }
      const info = await lstat(output)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) {
        throw new Error('생성된 정답 파일을 확인하지 못했습니다.')
      }
      if (parseLabels(await readFile(output, 'utf8')).length !== result.samples) {
        throw new Error('생성된 정답 파일의 샘플 수가 응답과 다릅니다.')
      }
      return {
        output,
        events: result.events,
        samples: result.samples,
        unanswered: result.unanswered
      }
    } finally {
      this.busy = false
      this.settled()
    }
  }
}
