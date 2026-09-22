import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '../shared/contracts'
import { EvaluationRunner } from './evaluation/runner'
import { registerEvaluationIpc } from './ipc'
import { DatasetService } from './dataset/service'
import { registerDatasetIpc } from './dataset-ipc'
import { ComparisonService } from './comparison/service'
import { registerComparisonIpc } from './comparison-ipc'
import { CharsetService } from './charset/service'
import { registerCharsetIpc } from './charset-ipc'
import { DiagnosticsRunner } from './diagnostics/runner'
import { registerDiagnosticsIpc } from './diagnostics-ipc'
import { DIAGNOSTIC_IPC } from '../shared/diagnostics'
import { validateDevelopmentUrl } from './window-security'

let window: BrowserWindow | null = null
let runner: EvaluationRunner | null = null
let diagnostics: DiagnosticsRunner | null = null
let quitting = false

function finishQuitting(): void {
  if (quitting && !runner?.isActive() && !diagnostics?.isActive()) {
    app.quit()
  }
}

function cancelBeforeQuit(event: { preventDefault(): void }): void {
  if (!runner?.isActive() && !diagnostics?.isActive()) {
    return
  }
  event.preventDefault()
  quitting = true
  try {
    if (runner?.isActive()) {
      runner.cancel()
    }
    if (diagnostics?.isActive()) {
      diagnostics.cancel()
    }
  } catch {
    // The runner publishes the cancellation error; keep the window and worker available.
    quitting = false
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) {
      window.restore()
    }
    window?.focus()
  })
  void app
    .whenReady()
    .then(() => {
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false)
      )
      session.defaultSession.setPermissionCheckHandler(() => false)
      const resourcesDirectory = app.isPackaged
        ? process.resourcesPath
        : join(app.getAppPath(), 'resources')
      const pythonDirectory = join(
        app.isPackaged ? process.resourcesPath : app.getAppPath(),
        'python'
      )
      const iconPath = join(
        resourcesDirectory,
        process.platform === 'win32' ? 'icon.ico' : 'icon.png'
      )
      if (process.platform === 'win32') {
        app.setAppUserModelId('com.dfragon.ocr-eval-tool')
      } else if (process.platform === 'darwin') {
        app.dock?.setIcon(iconPath)
      }
      const entry = join(__dirname, '../frontend/index.html')
      const developmentUrl = process.env.ELECTRON_RENDERER_URL
      const documentUrl =
        !app.isPackaged && developmentUrl != null
          ? validateDevelopmentUrl(developmentUrl)
          : pathToFileURL(entry).href
      window = new BrowserWindow({
        title: 'Real OCR Evaluation',
        icon: iconPath,
        width: 1360,
        height: 920,
        minWidth: 1024,
        minHeight: 720,
        backgroundColor: '#f5f7fa',
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      runner = new EvaluationRunner(
        join(pythonDirectory, 'worker.py'),
        (snapshot) => {
          if (window != null && !window.isDestroyed()) {
            window.webContents.send(IPC.snapshot, snapshot)
          }
          finishQuitting()
        },
        () => diagnostics?.isActive() ?? false
      )
      diagnostics = new DiagnosticsRunner(
        join(pythonDirectory, 'diagnostic_worker.py'),
        runner,
        (snapshot) => {
          if (window != null && !window.isDestroyed()) {
            window.webContents.send(DIAGNOSTIC_IPC.snapshot, snapshot)
          }
          finishQuitting()
        }
      )
      registerEvaluationIpc(window, documentUrl, runner)
      registerDiagnosticsIpc(window, documentUrl, diagnostics)
      registerComparisonIpc(window, documentUrl, new ComparisonService())
      registerCharsetIpc(window, documentUrl, new CharsetService())
      registerDatasetIpc(
        window,
        documentUrl,
        new DatasetService(
          join(app.getPath('userData'), 'dataset-splits.json'),
          join(pythonDirectory, 'dataset_check.py')
        )
      )
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.on('will-attach-webview', (event) => event.preventDefault())
      window.on('close', cancelBeforeQuit)
      return window.loadURL(documentUrl)
    })
    .catch((error: unknown) => {
      console.error(error)
      app.quit()
    })
  app.on('before-quit', cancelBeforeQuit)
  app.on('window-all-closed', () => app.quit())
}
