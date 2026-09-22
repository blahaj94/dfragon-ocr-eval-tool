import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export function requireSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
  documentUrl: string
): void {
  if (
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame == null ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== documentUrl
  ) {
    throw new Error('허용되지 않은 앱 화면의 요청입니다.')
  }
}

export function validateDevelopmentUrl(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('개발 화면은 로컬 HTTP 주소만 사용할 수 있습니다.')
  }
  return url.href
}
