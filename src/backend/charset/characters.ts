import type { CharacterKind, CharsetCharacter } from '../../shared/charset'

function characterKind(character: string): CharacterKind {
  if (/\p{Script=Hangul}/u.test(character)) {
    return 'korean'
  }
  if (/\p{Script=Latin}/u.test(character)) {
    return 'latin'
  }
  if (/\p{Decimal_Number}/u.test(character)) {
    return 'digit'
  }
  if (/\p{Script=Han}/u.test(character)) {
    return 'han'
  }
  if (/\p{Script=Hiragana}/u.test(character)) {
    return 'hiragana'
  }
  if (/\p{Script=Katakana}/u.test(character)) {
    return 'katakana'
  }
  if (/[\p{Punctuation}\p{Symbol}\p{White_Space}\p{Control}\p{Format}]/u.test(character)) {
    return 'special'
  }
  return 'other'
}

const NAMES: Record<string, string> = {
  ' ': 'SPACE (공백)',
  '\t': 'TAB (탭)',
  '\n': 'LINE FEED (줄바꿈)',
  '\r': 'CARRIAGE RETURN',
  '\0': 'NULL (제어 문자)',
  '\u00a0': 'NO-BREAK SPACE',
  '\u200b': 'ZERO WIDTH SPACE',
  '\u200c': 'ZERO WIDTH NON-JOINER',
  '\u200d': 'ZERO WIDTH JOINER',
  '\u2060': 'WORD JOINER',
  '\ufeff': 'ZERO WIDTH NO-BREAK SPACE / BOM'
}

export function describeCharacter(
  character: string,
  count: number,
  included: boolean
): CharsetCharacter {
  const codePoint = `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
  const displayName =
    NAMES[character] ??
    (/\p{White_Space}/u.test(character)
      ? '공백 문자'
      : /[\p{Control}\p{Format}\p{Mark}]/u.test(character)
        ? '제어·결합 문자'
        : character)
  return { character, displayName, codePoint, kind: characterKind(character), count, included }
}
