export const CHARACTER_GROUPS = [
  'hangul',
  'special',
  'hiragana',
  'katakana',
  'hanja',
  'latin',
  'digit',
  'other'
] as const
export type CharacterGroup = (typeof CHARACTER_GROUPS)[number]
export const CHARACTER_GROUP_LABELS: Record<CharacterGroup, string> = {
  hangul: '한글',
  special: '특수문자',
  hiragana: '히라가나',
  katakana: '가타카나',
  hanja: '한자',
  latin: '영문·라틴',
  digit: '숫자',
  other: '기타'
}
export interface CharacterDistribution {
  images: number
  nicknames: number
  characters: number
  groups: Record<CharacterGroup, number>
  frequencies: { character: string; count: number; group: CharacterGroup }[]
}
export interface SupplementOptions {
  additionalCharacters: string
  pythonExecutable: string
  targets: Record<CharacterGroup, number | null>
  characters: Record<CharacterGroup, string>
  tolerance: number
  maxImages: number
  seed: number
  profile: 'dotum' | 'nanum-neo'
  fonts: { gulim: string; batang: string; nanum: string; uttum: string }
  scale: number
  width: number
  height: number
  padding: number
  color: number[]
  backgroundMode: 'solid' | 'images'
  backgroundColor: number[]
  backgroundDirectory: string
}
export interface SupplementPlan {
  real: CharacterDistribution
  synthetic: CharacterDistribution
  final: CharacterDistribution
  differences: Record<CharacterGroup, number | null>
  requestedCharacters: number
  warnings: string[]
}
export interface SupplementPreview {
  id: string
  options: SupplementOptions
  plan: SupplementPlan
  examples: { text: string; image: string }[]
}
export interface SupplementInfo {
  real: CharacterDistribution
  missing: { character: string; count: number }[]
  dictionarySize: number
  width: number
  height: number
}

export function characterGroup(char: string): CharacterGroup {
  if (/\p{Script=Hangul}/u.test(char)) {
    return 'hangul'
  }
  if (/\p{Script=Hiragana}/u.test(char)) {
    return 'hiragana'
  }
  if (/\p{Script=Katakana}/u.test(char)) {
    return 'katakana'
  }
  if (/\p{Script=Han}/u.test(char)) {
    return 'hanja'
  }
  if (/\p{Script=Latin}/u.test(char)) {
    return 'latin'
  }
  if (/\p{Number}/u.test(char)) {
    return 'digit'
  }
  if (/[\p{Punctuation}\p{Symbol}]/u.test(char)) {
    return 'special'
  }
  return 'other'
}

export function characterDistribution(texts: string[]): CharacterDistribution {
  const counts = new Map<string, number>()
  const groups = Object.fromEntries(CHARACTER_GROUPS.map((group) => [group, 0])) as Record<
    CharacterGroup,
    number
  >
  for (const text of texts) {
    for (const char of text.normalize('NFC')) {
      counts.set(char, (counts.get(char) ?? 0) + 1)
      groups[characterGroup(char)]++
    }
  }
  return {
    images: texts.length,
    nicknames: new Set(texts.map((text) => text.normalize('NFC'))).size,
    characters: [...counts.values()].reduce((sum, count) => sum + count, 0),
    groups,
    frequencies: [...counts]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([character, count]) => ({ character, count, group: characterGroup(character) }))
  }
}
