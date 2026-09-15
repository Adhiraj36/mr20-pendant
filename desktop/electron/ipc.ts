// Every channel the renderer can reach, in one file.
//
// invoke/handle only — no remote module, no node integration in the window. The
// renderer names an intent; the main process decides what that means and holds
// every credential involved.
import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import type {
  ActiveLoop,
  ChatOptions,
  DashboardMeta,
  DictationEvent,
  TaskTranscript,
  ApiResult,
  Automation,
  Connectable,
  ConnectProgress,
  ConversationSummary,
  EngineMessage,
  HostAction,
  RemoteEngine,
  SettingsPatch,
  SetupPayload,
  SetupState,
  StreamChunk,
  TurnEvent,
} from './shared/types.js'
import { api, callTool, consoleApi, dropSession } from './api.js'
import { dashboardLiveAllowed, readLiveSource } from './dashboards.js'
import { isRemovableId, isValidId, parseSource } from './dashboardSources.js'
import {
  configExists,
  patchSettings,
  setMemorySettings,
  readLoops,
  readRaw,
  readSettings,
  writeDefaultConfig,
  writeLoops,
  writeRaw,
} from './config.js'
import { ChatRunner } from './chat.js'
import { DictationRunner } from './dictation.js'
import { ConnectRunner } from './connect.js'
import { daemon } from './daemon.js'
import { ensureWacliDaemon, environment, hostRunner, wacliState } from './hosttools.js'
import {
  loop as lyznLoop,
  pair as lyznPair,
  pairing as lyznPairing,
  refreshMemory as lyznRefreshMemory,
  answerTask as lyznAnswer,
  stopTask as lyznStopTask,
  tickets as lyznTickets,
  unpair as lyznUnpair,
} from './lyzn.js'
import {
  configPath,
  defaultRemote,
  DEFAULT_PORTS,
  portInUse,
  profileDir,
  readState,
  writeState,
} from './profile.js'

/** What somebody typed, made safe to store: no scheme, no path, no port stuck
 *  on the end of the host, and ports that are actually ports. */
function cleanRemote(next: RemoteEngine): RemoteEngine {
  const host = (next?.host ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
  const port = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : fallback
  }
  return {
    enabled: Boolean(next?.enabled),
    host,
    apiPort: port(next?.apiPort, DEFAULT_PORTS.api),
    consolePort: port(next?.consolePort, DEFAULT_PORTS.console),
    token: (next?.token ?? '').trim(),
  }
}

/** The PATH the daemon runs with, reused for the setup commands so a tool the
 *  daemon can see is a tool the wizard can see. */
let searchPath = process.env.PATH ?? ''
export function setSearchPath(p: string): void {
  searchPath = p
}

/** One agent at a time: they share a browser, and two of them clicking in the
 *  same window is not a thing to find out about from a bug report. */
const connectRunner = new ConnectRunner()

const chatRunner = new ChatRunner()
const dictationRunner = new DictationRunner()

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

async function setupState(): Promise<SetupState> {
  // A KARMAX already answering on the stock port is worth saying out loud: it
  // is almost always the person's own existing install, and the honest message
  // is "you have one already", not a silent second copy.
  let foreign: SetupState['foreignDaemon'] = null
  for (const port of [8080, 9091, DEFAULT_PORTS.api]) {
    if (configExists() && port === readSettings().ports.api) continue
    if (await portInUse(port)) {
      foreign = { port, detail: `Something is already listening on port ${port}.` }
      break
    }
  }
  return {
    needsSetup: !configExists() || !readState().setupCompletedAt,
    profileDir: profileDir(),
    configPath: configPath(),
    foreignDaemon: foreign,
  }
}

export function registerIpc(): void {
  // ---- daemon ------------------------------------------------------------
  ipcMain.handle('daemon:status', () => daemon.status())
  ipcMain.handle('daemon:start', () => daemon.start(true))
  ipcMain.handle('daemon:stop', () => daemon.stop())
  ipcMain.handle('daemon:restart', () => {
    dropSession() // the console's session store does not survive a restart
    return daemon.restart()
  })
  ipcMain.handle('daemon:logs', () => daemon.recentLogs())

  daemon.on('change', (s) => broadcast('daemon:change', s))
  daemon.on('log', (l) => broadcast('daemon:log', l))

  // ---- which machine the engine runs on -----------------------------------
  //
  // This app is a UI. Pointing it at an engine somewhere else costs an address
  // and that engine's own token — it cannot mint one, because the token lives
  // in the other machine's .env and is the only thing standing between the
  // network and a shell.
  ipcMain.handle('engine:get', () => readState().remote ?? defaultRemote())

  ipcMain.handle('engine:set', async (_e, next: RemoteEngine) => {
    const clean = cleanRemote(next)
    if (clean.enabled && !clean.host) return { ok: false, error: 'Give it an address first.' }
    if (clean.enabled && !clean.token) return { ok: false, error: 'That engine needs its own token.' }
    const state = readState()
    writeState({ ...state, remote: clean })
    dropSession()
    // Whichever way it moved, what the window is watching has changed.
    await daemon.stop()
    void daemon.start(true)
    return { ok: true }
  })

  // This machine's own key, for typing into another machine's window.
  //
  // Copied by the main process straight to the clipboard: the renderer never
  // holds it, because that token can invoke shell.exec and a page that has it
  // is a page worth attacking. A button that says "copied" is also a better
  // affordance than a field somebody has to select by hand.
  ipcMain.handle('engine:copyKey', () => {
    clipboard.writeText(readState().apiToken)
    return { ok: true }
  })

  ipcMain.handle('engine:test', async (_e, candidate: RemoteEngine) => {
    const clean = cleanRemote(candidate)
    if (!clean.host) return { ok: false, error: 'Give it an address first.' }
    try {
      const res = await fetch(`http://${clean.host}:${clean.apiPort}/api/ping`, {
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) return { ok: false, error: `That machine answered ${res.status}.` }
      const body = (await res.json()) as { version?: string }
      return { ok: true, version: body.version }
    } catch {
      return {
        ok: false,
        error: 'Nothing answered. Check the address, and that the engine there is running.',
      }
    }
  })

  // A screen that failed to draw, reported by the renderer's error boundary.
  // The renderer's console is not somewhere a person can reach; this is.
  ipcMain.handle('app:reportError', (_e, report: { where: string; message: string; stack: string }) => {
    console.error(`renderer: ${report?.where} failed to draw: ${report?.message}\n${report?.stack}`)
    return { ok: true }
  })

  // ---- LYZN, which this app may talk to and the engine may not -----------
  ipcMain.handle('lyzn:pairing', () => {
    const p = lyznPairing()
    // The token stays here. The page is told there is one, never what it is.
    return p
      ? {
          paired: true,
          name: p.name,
          daemonId: p.daemonId,
          pairedAt: p.pairedAt,
          plan: p.plan,
          loop: lyznLoop(),
        }
      : { paired: false, loop: lyznLoop() }
  })
  ipcMain.handle('lyzn:pair', (_e, code: string) => lyznPair(code))
  ipcMain.handle('lyzn:unpair', () => {
    lyznUnpair()
    return { ok: true }
  })
  ipcMain.handle('lyzn:tickets', () => lyznTickets())
  ipcMain.handle('lyzn:refreshMemory', () => lyznRefreshMemory())
  ipcMain.handle('lyzn:stopTask', (_e, taskId: string) => lyznStopTask(taskId))
  ipcMain.handle('lyzn:answer', (_e, taskId: string, answer: string) =>
    typeof taskId === 'string' && typeof answer === 'string'
      ? lyznAnswer(taskId, answer)
      : { ok: false, error: 'That answer could not be read.' },
  )

  // ---- setup -------------------------------------------------------------
  ipcMain.handle('setup:state', () => setupState())
  ipcMain.handle('setup:environment', () => environment(searchPath))

  // WhatsApp stays connected only while wacli's daemon is up, and somebody who
  // just scanned a QR should not have to know that.
  ipcMain.handle('whatsapp:connect', () => ensureWacliDaemon(searchPath))
  ipcMain.handle('whatsapp:state', () => wacliState(searchPath))
  ipcMain.handle('setup:complete', async (_e, payload: SetupPayload) => {
    await writeDefaultConfig({
      name: payload.name?.trim() || 'LYZN',
      orchestrator: payload.orchestrator === 'codex' ? 'codex' : 'claude',
      anthropicKey: payload.anthropicKey?.trim() ?? '',
      anthropicBaseUrl: payload.anthropicBaseUrl?.trim() ?? '',
    })
    const state = readState()
    state.setupCompletedAt = new Date().toISOString()
    writeState(state)
    void daemon.start(true)
    return setupState()
  })

  // ---- config ------------------------------------------------------------
  ipcMain.handle('config:settings', () => readSettings())
  ipcMain.handle('config:patch', (_e, patch: SettingsPatch) => patchSettings(patch))
  ipcMain.handle(
    'config:setMemory',
    (_e, m: { apiKey?: string; namespace?: string; baseUrl?: string; clearKey?: boolean }) =>
      setMemorySettings(m),
  )
  ipcMain.handle('config:raw', () => ({ path: configPath(), text: readRaw() }))
  ipcMain.handle('config:writeRaw', (_e, text: string) => writeRaw(text))
  ipcMain.handle('config:reveal', () => shell.showItemInFolder(configPath()))

  // ---- the daemon's own APIs --------------------------------------------
  ipcMain.handle(
    'api:request',
    (_e, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown) =>
      api(method, path, body),
  )
  ipcMain.handle('api:get', (_e, path: string) => api('GET', path))
  ipcMain.handle('api:post', (_e, path: string, body: unknown) => api('POST', path, body))
  ipcMain.handle('api:tool', (_e, name: string, args: unknown) => callTool(name, args))
  ipcMain.handle(
    'console:request',
    (_e, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown) =>
      consoleApi(method, path, body),
  )

  // ---- agent-built dashboards ---------------------------------------------
  //
  // The frame that shows these has no bridge of its own — sandboxed, no
  // preload — so every read an agent's page makes crosses back here first,
  // named rather than as a URL it picked.
  ipcMain.handle('dashboards:list', async () => {
    const res = await api<{ dashboards: DashboardMeta[] }>('GET', '/api/dashboards')
    return res.ok ? (res.data?.dashboards ?? []) : null
  })
  ipcMain.handle('dashboards:remove', async (_e, id: string) => {
    if (!isRemovableId(id)) {
      return {
        ok: false,
        error: id === '_default' ? 'The default dashboard cannot be removed.' : 'That is not a dashboard.',
      }
    }
    const res = await api('DELETE', `/api/dashboards/${encodeURIComponent(id)}`)
    return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'Could not remove that dashboard.' }
  })
  ipcMain.handle('dashboards:update', async (_e, id: string, patch: { pinned?: unknown; archived?: unknown }) => {
    if (typeof id !== 'string' || !isRemovableId(id)) return { ok: false, error: 'That is not a dashboard.' }
    const body: { pinned?: boolean; archived?: boolean } = {}
    if (typeof patch?.pinned === 'boolean') body.pinned = patch.pinned
    if (typeof patch?.archived === 'boolean') body.archived = patch.archived
    if (Object.keys(body).length === 0) return { ok: false, error: 'Nothing to change.' }
    const res = await api<{ dashboard: DashboardMeta }>('PATCH', `/api/dashboards/${encodeURIComponent(id)}`, body)
    if (res.ok) return { ok: true, dashboard: res.data?.dashboard }
    // An engine from before pinning answers 404 or 405 for the route itself.
    return { ok: false, error: res.status === 405 ? 'This engine cannot pin or archive dashboards yet.' : (res.error ?? 'That did not change.') }
  })
  ipcMain.handle('dashboards:data', async (_e, id: string, source: string) => {
    if (!isValidId(id)) return { ok: false, error: 'That is not a dashboard.' }
    const parsed = parseSource(source)
    if (!parsed) return { ok: false, error: `${source} is not something a dashboard can read.` }

    if (parsed.kind === 'live') {
      if (!(await dashboardLiveAllowed(id, parsed.name))) {
        return { ok: false, error: `${parsed.name} is not a live source.` }
      }
      return readLiveSource(parsed.name)
    }

    // The default dashboard is the kit's own page: it has live sources but no
    // data files of its own to set.
    if (id === '_default') return { ok: false, error: 'The default dashboard has no data files.' }
    const res = await api('GET', `/api/dashboards/${encodeURIComponent(id)}/data/${encodeURIComponent(parsed.name)}`)
    return res.ok ? { ok: true, value: res.data } : { ok: false, error: res.error ?? 'Could not read that data.' }
  })

  // ---- host tools --------------------------------------------------------
  // ---- connecting a service, with an agent doing the clicking -------------
  ipcMain.handle('connect:list', async () => {
    const res = await api<{ connectable: Connectable[] }>('GET', '/api/connect')
    return res.ok ? (res.data?.connectable ?? []) : []
  })
  ipcMain.handle('connect:start', (_e, id: string, account?: string) =>
    connectRunner.start(id, account),
  )
  ipcMain.handle('connect:cancel', () => connectRunner.cancel())
  ipcMain.handle('connect:busy', () => connectRunner.busy())

  // ---- the chat ----------------------------------------------------------
  //
  // A conversation id and a sentence is the whole vocabulary. Everything that
  // could be pointed somewhere else — the address, the bearer token — is read
  // here, from the same place every other call reads it.
  ipcMain.handle('chat:send', (_e, id: string | null, message: string, options?: { model?: string; effort?: string }) =>
    chatRunner.send(id, message, options),
  )
  ipcMain.handle('chat:stop', () => chatRunner.stop())
  ipcMain.handle('chat:list', async () => {
    const res = await api<{ conversations: ConversationSummary[]; brain: string }>(
      'GET',
      '/api/chat/conversations',
    )
    // An engine that is down is a window with no history in it, not a screen
    // that fails to draw.
    return res.ok ? res.data : { conversations: [], brain: '' }
  })
  ipcMain.handle('chat:history', async (_e, id: string) => {
    const res = await api<{ messages: EngineMessage[] }>(
      'GET',
      `/api/chat/conversations/${encodeURIComponent(id)}`,
    )
    return res.ok ? (res.data?.messages ?? []) : []
  })
  ipcMain.handle('chat:delete', (_e, id: string) =>
    api('DELETE', `/api/chat/conversations/${encodeURIComponent(id)}`),
  )
  chatRunner.on('event', (e: TurnEvent) => broadcast('chat:event', e))
  ipcMain.handle('chat:options', async () => {
    const res = await api<ChatOptions>('GET', '/api/chat/options')
    // An engine from before the pickers answers 404, and the composer then
    // offers no choice rather than one the engine would ignore.
    return res.ok ? res.data : null
  })

  ipcMain.handle('tasks:transcript', async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) return null
    const res = await api<TaskTranscript>('GET', `/api/tasks/${encodeURIComponent(taskId)}/transcript`)
    return res.ok ? res.data : null
  })

  ipcMain.handle('dictation:available', () => dictationRunner.available())
  ipcMain.handle('dictation:start', () => dictationRunner.start())
  ipcMain.handle('dictation:stop', () => dictationRunner.stop())
  ipcMain.handle('dictation:cancel', () => dictationRunner.cancel())
  ipcMain.handle('dictation:settings', (_e, pane: 'microphone' | 'speech') =>
    shell.openExternal(
      `x-apple.systempreferences:com.apple.preference.security?${pane === 'speech' ? 'Privacy_SpeechRecognition' : 'Privacy_Microphone'}`,
    ),
  )
  dictationRunner.on('event', (e: DictationEvent) => broadcast('dictation:event', e))
  // A window closed mid-sentence must not leave a microphone open.
  app.on('before-quit', () => dictationRunner.dispose())

  ipcMain.handle('host:run', (_e, action: HostAction) => hostRunner.start(action, searchPath))
  ipcMain.handle('host:cancel', () => hostRunner.cancel())
  hostRunner.on('chunk', (c: StreamChunk) => broadcast('host:chunk', c))
  connectRunner.on('progress', (p: ConnectProgress) => broadcast('connect:progress', p))

  // ---- automations -------------------------------------------------------
  // ---- loops and the registry ----------------------------------------------
  //
  // A registry name ends up in a file path on the engine's side, so only the
  // registry's own alphabet crosses; an engine loop's name is looser, because
  // the compiled ones predate that rule.
  const REGISTRY_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
  const LOOP_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
  const refused = { ok: false, status: 400, data: null, error: 'That is not a loop name.' }
  ipcMain.handle('loops:active', async () => {
    const res = await api<{ loops?: ActiveLoop[] }>('GET', '/api/loops')
    return res.ok ? (res.data?.loops ?? []) : null
  })
  ipcMain.handle('loops:registry', (_e, refresh?: boolean) =>
    api('GET', `/api/loops/registry${refresh === true ? '?refresh=1' : ''}`, undefined, 30_000),
  )
  ipcMain.handle('loops:detail', (_e, name: string) =>
    REGISTRY_NAME.test(name) ? api('GET', `/api/loops/registry/${name}`, undefined, 30_000) : refused,
  )
  ipcMain.handle('loops:install', (_e, name: string, allowUntrusted?: boolean) =>
    REGISTRY_NAME.test(name)
      ? api('POST', `/api/loops/registry/${name}/install`, { allowUntrusted: allowUntrusted === true }, 180_000)
      : refused,
  )
  ipcMain.handle('loops:uninstall', (_e, name: string) =>
    REGISTRY_NAME.test(name) ? api('DELETE', `/api/loops/registry/${name}`) : refused,
  )
  ipcMain.handle('loops:setEnabled', (_e, name: string, enabled: boolean) =>
    LOOP_NAME.test(name)
      ? api('POST', `/api/loops/${encodeURIComponent(name)}/${enabled === true ? 'enable' : 'disable'}`, {})
      : refused,
  )

  ipcMain.handle('automations:list', () => listAutomations())
  ipcMain.handle('automations:save', (_e, a: Automation, previousName?: string) => {
    const loops = readLoops().filter((l) => l.name !== (previousName ?? a.name) && l.name !== a.name)
    const next: Record<string, unknown> = {
      name: a.name,
      prompt: a.prompt,
      enabled: a.enabled,
    }
    // cron and every are alternatives; writing both would leave the file
    // saying two different things about when this runs.
    if (a.every.trim()) next.every = a.every.trim()
    else next.cron = a.cron.trim()
    if (a.harness.trim()) next.harness = a.harness.trim()
    writeLoops([...loops, next])
    return listAutomations()
  })
  ipcMain.handle('automations:remove', (_e, name: string) => {
    writeLoops(readLoops().filter((l) => l.name !== name))
    return listAutomations()
  })
  ipcMain.handle('automations:run', (_e, name: string) =>
    api('POST', `/api/loops/${encodeURIComponent(name)}/run`, {}, 300_000),
  )

  // ---- app ---------------------------------------------------------------
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    // Only ever a web address. An app that will open any string it is handed
    // will eventually be handed a file:// or a shell handler.
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })
  ipcMain.handle('app:revealProfile', () => shell.openPath(profileDir()))
  ipcMain.handle('app:focus', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (!w || w.isDestroyed()) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  })
}

/** Automations, merged from the file that defines them and the daemon that
 *  runs them.
 *
 *  Neither half alone is the truth. The file says what should happen; the
 *  daemon says what did, AND it runs loops of its own that were never in the
 *  file. Listing only the file's half is what made the overview and this page
 *  disagree about how many automations exist. */
async function listAutomations(): Promise<Automation[]> {
  const health: Record<string, Record<string, unknown>> = {}
  const res = await api<{ loops?: Record<string, unknown>[] }>('GET', '/api/loops/health')
  if (res.ok && Array.isArray(res.data?.loops)) {
    for (const h of res.data.loops) {
      const name = typeof h.name === 'string' ? h.name : ''
      if (name) health[name] = h
    }
  }

  const fromFile = readLoops().map((l): Automation => {
    const name = String(l.name ?? '')
    const cron = String(l.cron ?? '')
    return {
      name,
      // "@every 2h" is how karmax stores an interval; show it the way it was
      // typed rather than the way it was normalised.
      every: String(l.every ?? (cron.startsWith('@every ') ? cron.slice(7) : '')),
      cron: cron.startsWith('@every ') ? '' : cron,
      prompt: String(l.prompt ?? ''),
      harness: String(l.harness ?? ''),
      enabled: l.enabled !== false,
      health: (health[name] as Automation['health']) ?? null,
      builtin: false,
    }
  })

  const named = new Set(fromFile.map((a) => a.name))
  const fromEngine: Automation[] = Object.keys(health)
    .filter((name) => !named.has(name))
    .map((name) => ({
      name,
      cron: String(health[name].cron ?? health[name].schedule ?? ''),
      every: '',
      prompt: String(health[name].description ?? ''),
      harness: '',
      enabled: health[name].enabled !== false,
      health: health[name] as Automation['health'],
      builtin: true,
    }))

  return [...fromFile, ...fromEngine]
}
