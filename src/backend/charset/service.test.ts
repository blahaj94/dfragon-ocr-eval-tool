import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CharsetService } from './service'

const EVENT = '20260922-120000-1234abcd'

describe('dictionary character inspection', () => {
  let root: string
  let labelsPath: string
  let dictionary: string
  let request: Record<string, unknown>
  let config: { Global: Record<string, unknown>; PostProcess: { name: string } }
  let service: CharsetService

  async function saveRun(): Promise<void> {
    request.dictionarySha256 = createHash('sha256').update(dictionary).digest('hex')
    await Promise.all([
      writeFile(join(root, 'request.json'), JSON.stringify(request)),
      writeFile(join(root, 'config.yml'), JSON.stringify(config)),
      writeFile(join(root, 'characters.txt'), dictionary)
    ])
  }

  async function saveLabels(truths: string[]): Promise<void> {
    await writeFile(
      labelsPath,
      JSON.stringify({
        schemaVersion: 1,
        samples: truths.map((truth, index) => ({
          id: `sample-${index + 1}`,
          image: `${EVENT}/${String(index + 1).padStart(3, '0')}.png`,
          truth
        }))
      })
    )
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'charset-service-'))
    labelsPath = join(root, 'labels.json')
    dictionary = '가\nA\n1\n漢\nあ\nア\n!\n'
    request = {
      schemaVersion: 1,
      run: 'C:\\unavailable-training\\run',
      dictionary: 'C:\\unavailable-training\\run\\characters.txt',
      dictionarySha256: '',
      useSpace: true,
      model: 'v5-korean',
      modelName: 'korean_PP-OCRv5_mobile_rec',
      profile: 'korean',
      imageStage: 'raw-nickname-crop'
    }
    config = {
      Global: { character_dict_path: request.dictionary, use_space_char: true },
      PostProcess: { name: 'CTCLabelDecode' }
    }
    service = new CharsetService()
    await saveRun()
    await saveLabels(['가가A1漢あア! 😀', '가\u200b'])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('counts raw code points with categories using only four unchanged text files', async () => {
    const paths = ['request.json', 'config.yml', 'characters.txt', 'labels.json'].map((name) =>
      join(root, name)
    )
    const before = await Promise.all(paths.map((path) => readFile(path)))
    const result = await service.inspect(root, labelsPath)
    expect(result).toMatchObject({
      status: 'missing',
      sampleCount: 2,
      uniqueCount: 10,
      includedCount: 8,
      missingCount: 2,
      coverage: 0.8,
      useSpace: true
    })
    expect(result.characters.find((row) => row.character === '가')).toMatchObject({
      count: 3,
      kind: 'korean',
      included: true
    })
    const byCharacter = new Map(result.characters.map((row) => [row.character, row]))
    for (const [character, kind] of [
      ['A', 'latin'],
      ['1', 'digit'],
      ['漢', 'han'],
      ['あ', 'hiragana'],
      ['ア', 'katakana'],
      ['!', 'special']
    ]) {
      expect(byCharacter.get(character)?.kind).toBe(kind)
    }
    expect(byCharacter.get('😀')).toMatchObject({ codePoint: 'U+1F600', count: 1, included: false })
    expect(byCharacter.get('\u200b')).toMatchObject({
      codePoint: 'U+200B',
      displayName: 'ZERO WIDTH SPACE',
      included: false
    })
    expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(before)
    expect((await readdir(root)).sort()).toEqual([
      'characters.txt',
      'config.yml',
      'labels.json',
      'request.json'
    ])
  })

  it('uses the recorded boolean for U+0020 without trimming or inferring a model default', async () => {
    await saveLabels([' A '])
    expect(await service.inspect(root, labelsPath)).toMatchObject({
      status: 'covered',
      coverage: 1
    })
    request.useSpace = false
    config.Global.use_space_char = false
    await saveRun()
    const result = await service.inspect(root, labelsPath)
    expect(result).toMatchObject({
      status: 'missing',
      uniqueCount: 2,
      missingCount: 1,
      coverage: 0.5
    })
    expect(result.characters.find((row) => row.character === ' ')).toMatchObject({
      count: 2,
      included: false,
      displayName: 'SPACE (공백)'
    })
  })

  it('keeps combining characters and label controls without normalization or exclusion', async () => {
    dictionary = 'é\ne\n'
    await saveRun()
    await saveLabels(['é e\u0301\t\n\0'])
    const result = await service.inspect(root, labelsPath)
    expect(result.uniqueCount).toBe(7)
    expect(result.characters.find((row) => row.character === '\u0301')?.included).toBe(false)
    for (const character of ['\t', '\n', '\0']) {
      expect(result.characters.find((row) => row.character === character)).toMatchObject({
        count: 1,
        included: false,
        kind: 'special'
      })
    }
  })

  it('reports an empty label list explicitly instead of treating it as full coverage', async () => {
    await saveLabels([])
    expect(await service.inspect(root, labelsPath)).toMatchObject({
      status: 'empty',
      sampleCount: 0,
      uniqueCount: 0,
      includedCount: 0,
      missingCount: 0,
      coverage: null,
      characters: []
    })
  })

  it('accepts CRLF and format tokens exactly as the existing dictionary reader does', async () => {
    dictionary = '가\r\n\u200b\r\n\ufeff\r\n'
    await saveRun()
    await saveLabels(['가\u200b\ufeff'])
    expect(await service.inspect(root, labelsPath)).toMatchObject({
      status: 'covered',
      uniqueCount: 3
    })
  })

  it.each([
    ['empty dictionary', '', /한 코드포인트/],
    ['interior blank line', '가\n\nA\n', /한 코드포인트/],
    ['two terminal newlines', '가\n\n', /한 코드포인트/],
    ['multiple code points', '가A\n', /한 코드포인트/],
    ['duplicate token', '가\n가\n', /중복/],
    ['dictionary space and useSpace', '가\n \n', /중복/],
    ['leading BOM', '\ufeff가\n', /BOM/],
    ['control token', '가\n\t\n', /제어/]
  ])('rejects %s according to the loader contract', async (_name, text, error) => {
    dictionary = text as string
    await saveRun()
    await expect(service.inspect(root, labelsPath)).rejects.toThrow(error as RegExp)
  })

  it('supports the second existing model and preserves POSIX path case', async () => {
    request.model = 'v6-small-ko'
    request.modelName = 'PP-OCRv6_small_rec'
    request.profile = 'smoke'
    request.run = '/Recorded/Run'
    request.dictionary = '/Recorded/Run/characters.txt'
    config.Global.character_dict_path = request.dictionary
    await saveRun()
    await expect(service.inspect(root, labelsPath)).resolves.toHaveProperty('sampleCount', 2)
    config.Global.character_dict_path = '/recorded/run/characters.txt'
    await saveRun()
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('사전 경로가 다릅니다')
  })

  it.each([
    ['model', 'other'],
    ['modelName', 'other'],
    ['profile', 'other'],
    ['imageStage', 'resized'],
    ['schemaVersion', 2],
    ['useSpace', 'true'],
    ['run', 'relative/run'],
    ['dictionary', 'C:\\elsewhere\\characters.txt']
  ])('rejects an unsupported or inconsistent request field: %s', async (field, value) => {
    request[field] = value
    await saveRun()
    await expect(service.inspect(root, labelsPath)).rejects.toThrow()
  })

  it('requires a matching saved dictionary hash and explicit decoder setting', async () => {
    await writeFile(join(root, 'characters.txt'), '다\n')
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('SHA256')
    await saveRun()
    delete request.dictionarySha256
    await writeFile(join(root, 'request.json'), JSON.stringify(request))
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('SHA256')
    config.PostProcess.name = 'OtherDecode'
    await saveRun()
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('CTCLabelDecode')
  })

  it('rejects disagreement on useSpace instead of replacing it with a default', async () => {
    config.Global.use_space_char = false
    await saveRun()
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('useSpace')
  })

  it('reads YAML 1.1 yes/no booleans with the existing safe_load semantics', async () => {
    for (const useSpace of [true, false]) {
      request.useSpace = useSpace
      await saveRun()
      await writeFile(
        join(root, 'config.yml'),
        `Global:\n  character_dict_path: '${request.dictionary}'\n  use_space_char: ${useSpace ? 'yes' : 'no'}\nPostProcess:\n  name: CTCLabelDecode\n`
      )
      expect(await service.inspect(root, labelsPath)).toHaveProperty('useSpace', useSpace)
    }
  })

  it('rejects unsupported YAML tags instead of accepting parser warnings', async () => {
    await writeFile(join(root, 'config.yml'), '!unknown value\n')
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('config.yml')
  })

  it.each([
    ['malformed JSON', '{'],
    ['duplicate key', '{"schemaVersion":1,"schemaVersion":1,"samples":[]}'],
    ['escaped duplicate key', '{"schemaVersion":1,"samples":[],"\\u0073amples":[]}'],
    ['unknown field', '{"schemaVersion":1,"samples":[],"other":1}'],
    ['wrong version', '{"schemaVersion":2,"samples":[]}'],
    [
      'empty truth',
      JSON.stringify({
        schemaVersion: 1,
        samples: [{ id: 'a', image: `${EVENT}/001.png`, truth: '' }]
      })
    ],
    [
      'unsafe image',
      JSON.stringify({ schemaVersion: 1, samples: [{ id: 'a', image: '../001.png', truth: '가' }] })
    ],
    [
      'duplicate id',
      JSON.stringify({
        schemaVersion: 1,
        samples: [1, 2].map((index) => ({ id: 'a', image: `${EVENT}/00${index}.png`, truth: '가' }))
      })
    ],
    [
      'duplicate image',
      JSON.stringify({
        schemaVersion: 1,
        samples: ['a', 'b'].map((id) => ({ id, image: `${EVENT}/001.png`, truth: '가' }))
      })
    ]
  ])('rejects labels with %s without skipping rows', async (_name, text) => {
    await writeFile(labelsPath, text)
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('labels.json')
  })

  it('rejects duplicate request and config keys', async () => {
    await writeFile(join(root, 'request.json'), '{"useSpace":true,"useSpace":false}')
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('중복 키')
    await saveRun()
    await writeFile(
      join(root, 'config.yml'),
      'Global:\n  use_space_char: true\n  use_space_char: false\n'
    )
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('중복 키')
  })

  it('rejects invalid UTF-8 rather than replacing input bytes', async () => {
    await writeFile(join(root, 'characters.txt'), Buffer.from([0xc3, 0x28]))
    await expect(service.inspect(root, labelsPath)).rejects.toThrow('UTF-8')
  })
})
