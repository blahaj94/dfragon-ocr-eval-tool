import { LIBRARY_ORIGIN } from './library'

export function isAllowedLibraryNavigation(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (url.origin === LIBRARY_ORIGIN ||
        (url.origin === 'https://accounts.dfragon.com' && url.pathname.startsWith('/auth/')))
    )
  } catch {
    return false
  }
}
