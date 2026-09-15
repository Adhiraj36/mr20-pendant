// The app process: one window, one tray icon, one daemon.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { daemon } from './daemon.js'
import { registerIpc, setSearchPath } from './ipc.js'
import { ensureWacliDaemon } from './hosttools.js'
import { loginPath } from './envpath.js'
import { configExists } from './config.js'
import { ensureProfile, readState } from './profile.js'
import { installKitReference, registerDashboardProtocol, registerDashboardSchemePrivileged } from './dashboards.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.join(here, '..', '..')
const DEV_SERVER = process.env.KARMAX_DEV_SERVER

let win: BrowserWindow | null = null
let tray: Tray | null = null
/** Set only by a real quit, so closing the window can mean "hide" without
 *  the app then refusing to ever exit. */
let quitting = false

const single = app.requestSingleInstanceLock()
if (!single) {
  app.quit()
}

// Must run before the app is ready — Electron refuses privilege registration
// any later than that.
registerDashboardSchemePrivileged()

function iconPath(size: number): string {
  return path.join(APP_ROOT, 'build', `icon-${size}.png`)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    show: false,
    // The window chrome is drawn by the app. A control panel that looks like
    // one continuous surface is the whole visual idea, and a native title bar
    // cuts a grey strip across the top of it on every platform.
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#0d0b14',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    icon: iconPath(256),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win?.show())

  // A renderer that dies takes the window's contents with it and says nothing.
  // At least say it here, where the log is.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`renderer gone: ${details.reason} (exit ${details.exitCode})`)
  })

  win.on('close', (e) => {
    // Closing the window leaves the assistant running, which is the point of
    // an always-on agent; the tray is how you get back to it.
    if (!quitting && tray) {
      e.preventDefault()
      win?.hide()
    }
  })

  win.on('closed', () => {
    win = null
  })

  // Links open in the real browser, never in the app's own window: an OAuth
  // consent screen inside an Electron window is both worse UX and a phishing
  // pattern users are right to distrust.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const target = new URL(url)
    const dev = DEV_SERVER ? new URL(DEV_SERVER) : null
    if (target.protocol === 'file:' || (dev && target.host === dev.host)) return
    e.preventDefault()
    if (/^https?:$/i.test(target.protocol)) void shell.openExternal(url)
  })

  if (DEV_SERVER) {
    // Vite may not be listening yet. A port that accepts a TCP connection is
    // not the same as a dev server that will serve a document, so the window
    // retries rather than trusting a readiness check.
    const load = () => {
      win?.loadURL(DEV_SERVER).catch(() => {})
    }
    win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
      // -3 is ERR_ABORTED, which a superseded navigation reports; retrying it
      // would fight the navigation that replaced it.
      if (!isMainFrame || code === -3) return
      if (url.startsWith(DEV_SERVER)) setTimeout(load, 500)
    })
    load()
  } else {
    void win.loadFile(path.join(APP_ROOT, 'dist', 'renderer', 'index.html'))
  }
}

function show(): void {
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function buildTray(): void {
  // 16px on Windows and Linux; macOS wants a template image at 22.
  const img = nativeImage.createFromPath(iconPath(process.platform === 'darwin' ? 24 : 32))
  tray = new Tray(img.resize({ width: process.platform === 'darwin' ? 18 : 20, height: process.platform === 'darwin' ? 18 : 20 }))
  tray.setToolTip('LYZN')
  refreshTray()
  tray.on('click', show)
}

function refreshTray(): void {
  if (!tray) return
  const s = daemon.status()
  const label =
    s.state === 'running'
      ? 'Running'
      : s.state === 'stopped'
        ? 'Stopped'
        : s.state.charAt(0).toUpperCase() + s.state.slice(1)

  tray.setToolTip(`LYZN — ${label}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `LYZN — ${label}`, enabled: false },
      { type: 'separator' },
      { label: 'Open', click: show },
      {
        label: s.state === 'running' ? 'Stop the engine' : 'Start the engine',
        click: () => void (s.state === 'running' ? daemon.stop() : daemon.start(true)),
      },
      { label: 'Restart the engine', click: () => void daemon.restart() },
      { type: 'separator' },
      {
        label: 'Quit LYZN',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
}

app.on('second-instance', show)

app.whenReady().then(async () => {
  ensureProfile()
  readState() // mints the API token and console credentials on a fresh profile
  setSearchPath(await loginPath())

  registerDashboardProtocol()
  registerIpc()
  ipcMain.handle('app:version', () => app.getVersion())

  // The window controls the app draws itself.
  ipcMain.handle('window:minimize', () => win?.minimize())
  ipcMain.handle('window:toggleMaximize', () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window:close', () => win?.close())
  ipcMain.handle('window:isMaximized', () => win?.isMaximized() ?? false)

  daemon.on('change', refreshTray)
  // The reference is what tells an agent's dashboard tool which elements
  // exist; reinstalling it each time the engine comes up (a fresh launch, a
  // restart) keeps it in step with whichever kit build this app shipped.
  daemon.on('change', (s) => {
    if (s.state === 'running') void installKitReference()
  })

  createWindow()
  buildTray()

  // An always-on assistant starts itself. A first run has no config yet, so
  // the wizard owns the window until it does.
  if (configExists() && readState().setupCompletedAt) {
    void daemon.start()
    // WhatsApp is only connected while wacli's daemon is up, and that does not
    // survive a reboot on its own. A machine that paired once should come back
    // connected rather than quietly deaf until somebody opens Apps.
    void loginPath().then((p) => ensureWacliDaemon(p).catch(() => undefined))
  }

  app.on('activate', show)
})

app.on('window-all-closed', () => {
  // Nothing here: the tray keeps the app alive on every platform, and the
  // daemon is the reason to stay alive.
})

app.on('before-quit', () => {
  quitting = true
  daemon.shutdownSync()
})

// A last resort. If the app is being torn down without before-quit — a signal,
// a crash of the parent — the daemon still has to go with it, because an
// orphan holding the database is what makes the next start fail.
//
// Node's default signal handling exits without running `exit` listeners, so
// the signals have to be caught by name. This is not hypothetical: a session
// ending or a `kill` on the app leaves a daemon holding the port otherwise,
// and the next launch finds its own address occupied.
process.on('exit', () => daemon.shutdownSync())
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => {
    quitting = true
    daemon.shutdownSync()
    app.quit()
    // app.quit() unwinds asynchronously; a signal should still take the
    // process down promptly if that stalls.
    setTimeout(() => process.exit(0), 1500).unref()
  })
}
