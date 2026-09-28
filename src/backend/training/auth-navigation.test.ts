import { describe, expect, it } from 'vitest'
import { isAllowedLibraryNavigation } from './auth-navigation'

describe('library login navigation', () => {
  it.each([
    'https://ocr.dfragon.com/',
    'https://ocr.dfragon.com/auth/callback?code=fixture',
    'https://accounts.dfragon.com/auth/login/authorize?ticket=fixture',
    'https://accounts.dfragon.com/auth/login'
  ])('allows the library and current account login: %s', (url) => {
    expect(isAllowedLibraryNavigation(url)).toBe(true)
  })

  it.each([
    'https://api.dfragon.com/auth/login/authorize?ticket=fixture',
    'http://accounts.dfragon.com/auth/login',
    'https://accounts.dfragon.com/',
    'https://accounts.dfragon.com/authentication',
    'https://accounts.dfragon.com/auth/../admin',
    'https://accounts.dfragon.com.evil.example/auth/login',
    'https://accounts.dfragon.com@evil.example/auth/login',
    'https://user:password@accounts.dfragon.com/auth/login',
    'https://accounts.dfragon.com:8443/auth/login',
    'https://evil.example/auth/login',
    'javascript:alert(1)',
    '/auth/login'
  ])('blocks destinations outside the login boundary: %s', (url) => {
    expect(isAllowedLibraryNavigation(url)).toBe(false)
  })
})
