import type { Result } from './contracts'

export type CharacterKind =
  'korean' | 'latin' | 'digit' | 'han' | 'hiragana' | 'katakana' | 'special' | 'other'

export interface CharsetCharacter {
  character: string
  displayName: string
  codePoint: string
  kind: CharacterKind
  count: number
  included: boolean
}

export interface CharsetInspection {
  status: 'covered' | 'missing' | 'empty'
  sampleCount: number
  uniqueCount: number
  includedCount: number
  missingCount: number
  coverage: number | null
  useSpace: boolean
  characters: CharsetCharacter[]
}

export interface CharsetApi {
  inspect(runDirectory: string, labelsPath: string): Promise<Result<CharsetInspection>>
}

export const CHARSET_IPC = { inspect: 'charset:inspect' } as const
