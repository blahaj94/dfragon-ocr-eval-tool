import { expect, test } from 'vitest'
import { characterDistribution, characterGroup } from './supplement'

test('character counts include all scripts and agree with the worker for CP949 symbols', () => {
  expect(characterDistribution(['검사★龍', 'あアA2Ω']).groups).toEqual({
    hangul: 2,
    special: 1,
    hiragana: 1,
    katakana: 1,
    hanja: 1,
    latin: 1,
    digit: 1,
    other: 1
  })
  expect([...'ⓐ⒜Ⅰⅰ'].map(characterGroup)).toEqual(['special', 'special', 'latin', 'latin'])
  expect(characterDistribution(['가', '가'])).toMatchObject({
    images: 2,
    nicknames: 1,
    characters: 2
  })
})
