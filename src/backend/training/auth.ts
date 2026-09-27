import { BrowserWindow, session, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { LIBRARY_ORIGIN } from './library'

export class LibrarySession {
  readonly session: Session = session.fromPartition(`ocr-training-${randomUUID()}`, {
    cache: false
  })
  private window: BrowserWindow | null = null

  constructor() {
    this.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.session.setPermissionCheckHandler(() => false)
    this.session.on('will-download', (event) => event.preventDefault())
  }

  async login(parent: BrowserWindow): Promise<void> {
    if (this.window !== null) {
      this.window.focus()
      throw new Error('열린 자료실 로그인 창을 확인해 주세요.')
    }
    const active = await this.session.fetch(`${LIBRARY_ORIGIN}/api/session`, {
      credentials: 'include',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    })
    await active.body?.cancel()
    if (active.ok) {
      return
    }
    const window = new BrowserWindow({
      parent,
      width: 720,
      height: 860,
      show: false,
      title: 'OCR 자료실 로그인',
      autoHideMenuBar: true,
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        devTools: false
      }
    })
    this.window = window
    const allowed = (value: string): boolean => {
      try {
        const url = new URL(value)
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          (url.origin === LIBRARY_ORIGIN ||
            (url.origin === 'https://api.dfragon.com' && url.pathname.startsWith('/auth/')))
        )
      } catch {
        return false
      }
    }
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (!allowed(url)) {
        event.preventDefault()
      }
    })
    window.webContents.on('will-redirect', (event, url) => {
      if (!allowed(url)) {
        event.preventDefault()
      }
    })
    window.webContents.on('will-attach-webview', (event) => event.preventDefault())
    await new Promise<void>((resolve, reject) => {
      let completed = false
      let checking = false
      window.webContents.on('did-finish-load', () => {
        if (
          checking ||
          completed ||
          !window.webContents.getURL().startsWith(`${LIBRARY_ORIGIN}/`)
        ) {
          return
        }
        checking = true
        void this.session
          .fetch(`${LIBRARY_ORIGIN}/api/session`, {
            credentials: 'include',
            redirect: 'error',
            signal: AbortSignal.timeout(15_000)
          })
          .then(async (response) => {
            await response.body?.cancel()
            if (response.ok && !window.isDestroyed()) {
              completed = true
              resolve()
              window.close()
            }
          })
          .catch(() => undefined)
          .finally(() => {
            checking = false
          })
      })
      window.once('closed', () => {
        this.window = null
        if (!completed) {
          reject(new Error('자료실 로그인을 완료하지 않았습니다.'))
        }
      })
      void window
        .loadURL(LIBRARY_ORIGIN)
        .then(() => {
          if (!window.isDestroyed()) {
            window.show()
          }
        })
        .catch(() => {
          reject(new Error('자료실 로그인 화면을 열지 못했습니다.'))
          window.close()
        })
    })
  }

  async logout(): Promise<void> {
    try {
      const response = await this.session.fetch(`${LIBRARY_ORIGIN}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        redirect: 'error',
        headers: { Origin: LIBRARY_ORIGIN },
        signal: AbortSignal.timeout(15_000)
      })
      await response.body?.cancel()
      if (!response.ok && response.status !== 401) {
        throw new Error('자료실 서버 로그아웃에 실패했습니다.')
      }
    } finally {
      await this.session.clearStorageData()
    }
  }

  close(): void {
    this.window?.close()
  }
}
