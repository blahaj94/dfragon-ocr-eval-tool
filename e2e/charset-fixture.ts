import type { Page } from '@playwright/test'
import type { CharsetApi, CharsetCharacter, CharsetInspection } from '../src/shared/charset'
import type { EvaluationApi, PathKind } from '../src/shared/contracts'

interface CharsetFixtureWindow extends Window {
  charset: CharsetApi
  evaluation: EvaluationApi
  charsetFixture: {
    choices: PathKind[]
    inspectRunCalls: number
    inspections: [string, string][]
    failNextInspection: boolean
  }
}

// Fixed inspection responses verify presentation; the real service tests read config, dictionary and labels.
export async function installCharsetFixture(
  page: Page,
  status: CharsetInspection['status'] = 'missing'
): Promise<void> {
  await page.addInitScript(
    ({ status }) => {
      const fixtureWindow = window as unknown as CharsetFixtureWindow
      fixtureWindow.charsetFixture = {
        choices: [],
        inspectRunCalls: 0,
        inspections: [],
        failNextInspection: false
      }
      const characters: CharsetCharacter[] = [
        {
          character: '가',
          displayName: '가',
          codePoint: 'U+AC00',
          kind: 'korean',
          count: 3,
          included: true
        },
        {
          character: 'A',
          displayName: 'A',
          codePoint: 'U+0041',
          kind: 'latin',
          count: 1,
          included: true
        },
        {
          character: '1',
          displayName: '1',
          codePoint: 'U+0031',
          kind: 'digit',
          count: 2,
          included: true
        },
        {
          character: '漢',
          displayName: '漢',
          codePoint: 'U+6F22',
          kind: 'han',
          count: 1,
          included: false
        },
        {
          character: 'あ',
          displayName: 'あ',
          codePoint: 'U+3042',
          kind: 'hiragana',
          count: 1,
          included: false
        },
        {
          character: 'ア',
          displayName: 'ア',
          codePoint: 'U+30A2',
          kind: 'katakana',
          count: 1,
          included: false
        },
        {
          character: ' ',
          displayName: 'SPACE (공백)',
          codePoint: 'U+0020',
          kind: 'special',
          count: 4,
          included: true
        },
        {
          character: '\u200b',
          displayName: 'ZERO WIDTH SPACE (너비 없는 공백)',
          codePoint: 'U+200B',
          kind: 'other',
          count: 1,
          included: false
        }
      ]
      fixtureWindow.charset = {
        inspect: async (runDirectory, labelsPath) => {
          fixtureWindow.charsetFixture.inspections.push([runDirectory, labelsPath])
          if (fixtureWindow.charsetFixture.failNextInspection) {
            return { ok: false, error: 'Fixture: 학습 설정에 지정된 문자 사전을 읽지 못했습니다.' }
          }
          const inspection: CharsetInspection =
            status === 'empty'
              ? {
                  status,
                  sampleCount: 2,
                  uniqueCount: 0,
                  includedCount: 0,
                  missingCount: 0,
                  coverage: null,
                  useSpace: false,
                  characters: []
                }
              : {
                  status,
                  sampleCount: 2,
                  uniqueCount: 8,
                  includedCount: status === 'covered' ? 8 : 4,
                  missingCount: status === 'covered' ? 0 : 4,
                  coverage: status === 'covered' ? 1 : 0.5,
                  useSpace: true,
                  characters:
                    status === 'covered'
                      ? characters.map((character) => ({ ...character, included: true }))
                      : characters
                }
          return { ok: true, value: inspection }
        }
      }
      let labelsChoices = 0
      fixtureWindow.evaluation = {
        createLabels: async () => ({ ok: true, value: null }),
        getSettings: async () => ({
          ok: true,
          value: {
            settings: {},
            pythons: []
          }
        }),
        saveSettings: async () => ({ ok: true, value: null }),
        choosePath: async (kind) => {
          fixtureWindow.charsetFixture.choices.push(kind)
          if (kind === 'labels') {
            labelsChoices += 1
            return {
              ok: true,
              value: labelsChoices === 1 ? 'C:/fixture/labels.json' : 'C:/fixture/labels-new.json'
            }
          }
          return { ok: true, value: kind === 'run' ? 'C:/fixture/run' : 'C:/fixture/python.exe' }
        },
        inspectRun: async () => {
          fixtureWindow.charsetFixture.inspectRunCalls += 1
          return { ok: false, error: 'Character inspection must not inspect checkpoint weights.' }
        },
        getSnapshot: async () => ({
          ok: true,
          value: {
            status: 'idle',
            totalSamples: 0,
            processedSamples: 0,
            samples: [],
            report: null,
            reportPath: null,
            error: null
          }
        }),
        onSnapshot: () => () => {},
        start: async () => ({
          ok: false,
          error: 'Model inference is outside this charset fixture.'
        }),
        cancel: async () => ({ ok: true, value: null }),
        readImage: async () => ({
          ok: false,
          error: 'Image loading is outside this charset fixture.'
        }),
        openReport: async () => ({ ok: true, value: null })
      }
    },
    { status }
  )
}

export async function inspectCharsetFixture(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '문자 검사', exact: true }).click()
  await page.getByRole('button', { name: '문자 검사 학습 결과 폴더 선택', exact: true }).click()
  await page.getByRole('button', { name: '문자 검사 정답 파일 선택', exact: true }).click()
  await page.getByRole('button', { name: '문자 포함 검사', exact: true }).click()
}

export async function getCharsetFixtureCalls(
  page: Page
): Promise<{ choices: PathKind[]; inspectRunCalls: number; inspections: [string, string][] }> {
  return page.evaluate(() => {
    const { choices, inspectRunCalls, inspections } = (window as unknown as CharsetFixtureWindow)
      .charsetFixture
    return { choices, inspectRunCalls, inspections }
  })
}

export async function failNextCharsetInspection(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as CharsetFixtureWindow).charsetFixture.failNextInspection = true
  })
}
