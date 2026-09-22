import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ComparisonService } from './service'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=',
  'base64'
)
const IMAGE_HASH = createHash('sha256').update(PNG).digest('hex')
const TRUTHS = ['가', ' A ', '😀', '끝']

function makeReport(datasetDirectory: string, predictions: string[]) {
  const exactMatchCount = predictions.filter(
    (prediction, index) => prediction === TRUTHS[index]
  ).length
  return {
    schemaVersion: 1,
    status: 'completed',
    totalSamples: 4,
    processedSamples: 4,
    summary: {
      cer: 1.75,
      exactMatch: exactMatchCount / 4,
      sampleCount: 4,
      characterCount: 6,
      exactMatchCount
    },
    error: null,
    startedAt: '2026-09-22T00:00:00Z',
    finishedAt: '2026-09-22T00:00:01Z',
    samples: TRUTHS.map((truth, index) => ({
      id: `sample-${index + 1}`,
      imagePath: join(datasetDirectory, `${index + 1}.png`),
      truth,
      prediction: predictions[index],
      editDistance: predictions[index] === truth ? 0 : 7,
      confidence: index === 3 ? null : 0.01,
      imageSha256: IMAGE_HASH
    })),
    reproducibility: {
      settings: { datasetDirectory, checkpointPath: 'model-A.pdparams' },
      normalization: 'none',
      sourceSha256: {
        'recognition/metrics.py': 'a'.repeat(64),
        'recognition/distance.py': 'b'.repeat(64),
        'training/preprocessing.py': 'c'.repeat(64)
      },
      dictionarySha256: 'd'.repeat(64),
      labelsSha256: 'e'.repeat(64)
    }
  }
}

type TestReport = ReturnType<typeof makeReport>

describe('saved report comparison', () => {
  let root: string
  let pathA: string
  let pathB: string
  let a: TestReport
  let b: TestReport
  let service: ComparisonService

  async function savePair(): Promise<void> {
    await Promise.all([writeFile(pathA, JSON.stringify(a)), writeFile(pathB, JSON.stringify(b))])
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'comparison-service-')))
    const captureA = join(root, 'capture-a')
    const captureB = join(root, 'capture-b')
    await Promise.all([mkdir(captureA), mkdir(captureB)])
    a = makeReport(captureA, ['가', '틀림', '😀', ''])
    b = makeReport(captureB, ['틀림', ' A ', '😀', '오답'])
    b.summary.cer = 2.5
    pathA = join(root, 'report-a.json')
    pathB = join(root, 'report-b.json')
    for (const sample of [...a.samples, ...b.samples]) {
      await writeFile(sample.imagePath, PNG)
    }
    await savePair()
    service = new ComparisonService()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('matches the complete ID set despite array order and preserves saved metrics and raw results', async () => {
    b.samples.reverse()
    b.reproducibility.settings.checkpointPath = 'model-B.pdparams'
    b.reproducibility.dictionarySha256 = 'f'.repeat(64)
    b.reproducibility.labelsSha256 = '0'.repeat(64)
    b.reproducibility.sourceSha256['training/preprocessing.py'] = '1'.repeat(64)
    await savePair()
    const before = await Promise.all([
      readFile(pathA),
      readFile(pathB),
      readFile(a.samples[0].imagePath)
    ])
    const result = await service.compare(pathA, pathB)
    expect(result.counts).toEqual({ regressed: 1, improved: 1, 'both-correct': 1, 'both-wrong': 1 })
    expect(Object.values(result.counts).reduce((sum, count) => sum + count, 0)).toBe(4)
    expect(result.samples.map((sample) => [sample.a.id, sample.b.id])).toEqual(
      a.samples.map((sample) => [sample.id, sample.id])
    )
    expect(result.summaryA).toEqual(a.summary)
    expect(result.summaryB).toEqual(b.summary)
    expect(result.summaryA.characterCount).toBe(6) // Unicode code points, not UTF-16 length.
    expect(result.samples[3]).toMatchObject({
      a: { prediction: '', editDistance: 7, confidence: null },
      group: 'both-wrong'
    })
    expect(await service.readImage(a.samples[0].imagePath)).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`
    )
    expect(
      await Promise.all([readFile(pathA), readFile(pathB), readFile(a.samples[0].imagePath)])
    ).toEqual(before)
  })

  const invalidCases: Array<[string, (a: TestReport, b: TestReport) => void, RegExp]> = [
    [
      'unfinished report',
      (_a, b) => {
        b.status = 'cancelled'
      },
      /완료된 전체/
    ],
    [
      'unsupported schema',
      (_a, b) => {
        b.schemaVersion = 2
      },
      /schemaVersion/
    ],
    [
      'different ID set',
      (_a, b) => {
        b.samples[3].id = 'other'
      },
      /ID 집합/
    ],
    [
      'empty ID',
      (_a, b) => {
        b.samples[0].id = ''
      },
      /ID가 비어/
    ],
    [
      'empty truth',
      (_a, b) => {
        b.samples[3].truth = ''
        b.summary.characterCount--
      },
      /정답이 비어/
    ],
    [
      'duplicate ID',
      (_a, b) => {
        b.samples[1].id = b.samples[0].id
      },
      /중복/
    ],
    [
      'missing image hash',
      (_a, b) => {
        Reflect.deleteProperty(b.samples[0], 'imageSha256')
      },
      /imageSha256/
    ],
    [
      'different image hash',
      (_a, b) => {
        b.samples[0].imageSha256 = '0'.repeat(64)
      },
      /이미지 해시/
    ],
    [
      'different raw truth',
      (_a, b) => {
        b.samples[3].truth += ' '
        b.summary.characterCount++
      },
      /원문 정답/
    ],
    [
      'missing exact count',
      (_a, b) => {
        Reflect.deleteProperty(b.summary, 'exactMatchCount')
      },
      /exactMatchCount/
    ],
    [
      'inconsistent exact count',
      (_a, b) => {
        b.summary.exactMatchCount = 3
      },
      /exactMatchCount/
    ],
    [
      'inconsistent character count',
      (_a, b) => {
        b.summary.characterCount = 7
      },
      /정답 문자 수/
    ],
    [
      'different scorer',
      (_a, b) => {
        b.reproducibility.sourceSha256['recognition/metrics.py'] = '9'.repeat(64)
      },
      /평가 기준/
    ],
    [
      'missing scorer',
      (_a, b) => {
        Reflect.deleteProperty(b.reproducibility.sourceSha256, 'recognition/distance.py')
      },
      /해시 정보/
    ],
    [
      'normalization changed',
      (_a, b) => {
        b.reproducibility.normalization = 'trim'
      },
      /normalization=none/
    ]
  ]

  it.each(invalidCases)(
    'refuses %s without partial or inferred comparison',
    async (_name, mutate, message) => {
      await service.compare(pathA, pathB)
      mutate(a, b)
      await savePair()
      await expect(service.compare(pathA, pathB)).rejects.toThrow(message)
      await expect(service.readImage(a.samples[0].imagePath)).rejects.toThrow('현재 비교에 등록')
    }
  )

  it('does not permit a subset even if the remaining rows match', async () => {
    b.samples.pop()
    b.totalSamples = b.processedSamples = b.summary.sampleCount = 3
    b.summary.characterCount = 5
    b.summary.exactMatch = b.summary.exactMatchCount / 3
    await savePair()
    await expect(service.compare(pathA, pathB)).rejects.toThrow('ID 집합')
  })

  it('compares foreign Windows paths and falls back to the matching local B image', async () => {
    a.reproducibility.settings.datasetDirectory = 'C:\\captures'
    for (const sample of a.samples) {
      sample.imagePath = `C:\\captures\\${sample.id}.png`
    }
    await savePair()
    const result = await service.compare(pathA, pathB)
    expect(result.samples).toHaveLength(4)
    expect(await service.readImage(a.samples[0].imagePath)).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`
    )
  })

  it('keeps score comparison available without image-root metadata or image files', async () => {
    Reflect.deleteProperty(a.reproducibility, 'settings')
    Reflect.deleteProperty(b.reproducibility, 'settings')
    await Promise.all([rm(a.samples[0].imagePath), rm(b.samples[0].imagePath)])
    await savePair()
    expect((await service.compare(pathA, pathB)).summaryA.cer).toBe(a.summary.cer)
    await expect(service.readImage(a.samples[0].imagePath)).rejects.toThrow(
      '캡처 루트 경로가 없습니다'
    )
  })

  it('falls back for a missing image and refuses changed bytes when neither stored copy matches', async () => {
    await service.compare(pathA, pathB)
    await rm(a.samples[0].imagePath)
    expect(await service.readImage(a.samples[0].imagePath)).toContain('data:image/png;base64,')
    await writeFile(b.samples[0].imagePath, Buffer.concat([PNG, Buffer.from('changed')]))
    await expect(service.readImage(a.samples[0].imagePath)).rejects.toThrow(
      'SHA256이 일치하지 않습니다'
    )
    expect((await service.compare(pathA, pathB)).samples).toHaveLength(4)
  })

  it('does not authorize arbitrary renderer paths or report paths outside their capture roots', async () => {
    const outside = join(root, 'outside.png')
    await writeFile(outside, PNG)
    await service.compare(pathA, pathB)
    await expect(service.readImage(outside)).rejects.toThrow('현재 비교에 등록')
    a.samples[0].imagePath = outside
    b.samples[0].imagePath = outside
    await savePair()
    await service.compare(pathA, pathB)
    await expect(service.readImage(outside)).rejects.toThrow('캡처 루트 밖')
  })

  it('rejects overlapping compares and invalidates an in-flight image from an earlier comparison', async () => {
    const first = service.compare(pathA, pathB)
    await expect(service.compare(pathA, pathB)).rejects.toThrow('이미 진행 중')
    await expect(first).rejects.toThrow('이전 비교가 취소')
    await expect(service.readImage(a.samples[0].imagePath)).rejects.toThrow('현재 비교에 등록')
    await service.compare(pathA, pathB)
    const image = service.readImage(a.samples[0].imagePath)
    const next = service.compare(pathA, pathB)
    await expect(image).rejects.toThrow('비교가 변경')
    await next
  })
})
