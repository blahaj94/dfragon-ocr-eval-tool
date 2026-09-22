import { describe, expect, it } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { requireSender, validateDevelopmentUrl } from './window-security'

describe('renderer trust boundary', () => {
  it('accepts only the owned main frame and exact document', () => {
    const frame = { url: 'file:///app/index.html' }
    const contents = { mainFrame: frame }
    const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow
    const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
    expect(() => requireSender(event, window, frame.url)).not.toThrow()
    expect(() =>
      requireSender(
        { ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent,
        window,
        frame.url
      )
    ).toThrow()
    expect(() => requireSender(event, window, `${frame.url}?injected`)).toThrow()
  })
  it('limits development documents to loopback', () => {
    expect(validateDevelopmentUrl('http://localhost:5173')).toBe('http://localhost:5173/')
    expect(() => validateDevelopmentUrl('https://example.com')).toThrow()
    expect(() => validateDevelopmentUrl('http://user@localhost:5173')).toThrow()
  })
})
