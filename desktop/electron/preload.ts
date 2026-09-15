// The only thing the page can see of Node.
//
// A hand-written surface, not a proxy: every method here is one the main
// process meant to expose. contextBridge with the sandbox on means the page
// gets these functions and nothing else — no require, no process, no fs.
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiResult,
  Automation,
  ConnectProgress,
  DaemonStatus,
  DashboardMeta,
  HostAction,
  KarmaxBridge,
  LogLine,
  RemoteEngine,
  SettingsPatch,
  SetupPayload,
  DictationEvent,
  StreamChunk,
  TurnEvent,
} from './shared/types.js'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const bridge: KarmaxBridge = {
  daemon: {
    status: () => ipcRenderer.invoke('daemon:status'),
    start: () => ipcRenderer.invoke('daemon:start'),
    stop: () => ipcRenderer.invoke('daemon:stop'),
    restart: () => ipcRenderer.invoke('daemon:restart'),
    logs: () => ipcRenderer.invoke('daemon:logs'),
    onChange: (cb: (s: DaemonStatus) => void) => subscribe('daemon:change', cb),
    onLog: (cb: (l: LogLine) => void) => subscribe('daemon:log', cb),
  },
  lyzn: {
    pairing: () => ipcRenderer.invoke('lyzn:pairing'),
    pair: (code: string) => ipcRenderer.invoke('lyzn:pair', code),
    unpair: () => ipcRenderer.invoke('lyzn:unpair'),
    tickets: () => ipcRenderer.invoke('lyzn:tickets'),
    refreshMemory: () => ipcRenderer.invoke('lyzn:refreshMemory'),
    stopTask: (taskId: string) => ipcRenderer.invoke('lyzn:stopTask', taskId),
    answer: (taskId: string, answer: string) => ipcRenderer.invoke('lyzn:answer', taskId, answer),
  },
  whatsapp: {
    connect: () => ipcRenderer.invoke('whatsapp:connect'),
    state: () => ipcRenderer.invoke('whatsapp:state'),
  },
  engine: {
    get: () => ipcRenderer.invoke('engine:get'),
    set: (next: RemoteEngine) => ipcRenderer.invoke('engine:set', next),
    test: (candidate: RemoteEngine) => ipcRenderer.invoke('engine:test', candidate),
    copyKey: () => ipcRenderer.invoke('engine:copyKey'),
  },
  setup: {
    state: () => ipcRenderer.invoke('setup:state'),
    environment: () => ipcRenderer.invoke('setup:environment'),
    complete: (p: SetupPayload) => ipcRenderer.invoke('setup:complete', p),
  },
  config: {
    settings: () => ipcRenderer.invoke('config:settings'),
    patch: (patch: SettingsPatch) => ipcRenderer.invoke('config:patch', patch),
    setMemory: (m: { apiKey?: string; namespace?: string; baseUrl?: string }) =>
      ipcRenderer.invoke('config:setMemory', m),
    raw: () => ipcRenderer.invoke('config:raw'),
    writeRaw: (text: string) => ipcRenderer.invoke('config:writeRaw', text),
    reveal: () => ipcRenderer.invoke('config:reveal'),
  },
  api: {
    request: <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
      ipcRenderer.invoke('api:request', method, path, body) as Promise<ApiResult<T>>,
    get: <T>(path: string) => ipcRenderer.invoke('api:get', path) as Promise<ApiResult<T>>,
    post: <T>(path: string, body?: unknown) =>
      ipcRenderer.invoke('api:post', path, body) as Promise<ApiResult<T>>,
    tool: <T>(name: string, args?: unknown) =>
      ipcRenderer.invoke('api:tool', name, args) as Promise<ApiResult<T>>,
  },
  console: {
    request: <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
      ipcRenderer.invoke('console:request', method, path, body) as Promise<ApiResult<T>>,
  },
  dashboards: {
    list: () => ipcRenderer.invoke('dashboards:list') as Promise<DashboardMeta[] | null>,
    data: (id: string, source: string) => ipcRenderer.invoke('dashboards:data', id, source),
    remove: (id: string) => ipcRenderer.invoke('dashboards:remove', id),
    update: (id: string, patch: { pinned?: boolean; archived?: boolean }) => ipcRenderer.invoke('dashboards:update', id, patch),
  },
  connect: {
    list: () => ipcRenderer.invoke('connect:list'),
    start: (id: string, account?: string) => ipcRenderer.invoke('connect:start', id, account),
    cancel: () => ipcRenderer.invoke('connect:cancel'),
    busy: () => ipcRenderer.invoke('connect:busy'),
    onProgress: (cb: (p: ConnectProgress) => void) => subscribe('connect:progress', cb),
  },
  chat: {
    send: (conversationId: string | null, message: string, options?: { model?: string; effort?: string }) =>
      ipcRenderer.invoke('chat:send', conversationId, message, options),
    stop: () => ipcRenderer.invoke('chat:stop'),
    options: () => ipcRenderer.invoke('chat:options'),
    list: () => ipcRenderer.invoke('chat:list'),
    history: (id: string) => ipcRenderer.invoke('chat:history', id),
    remove: (id: string) => ipcRenderer.invoke('chat:delete', id),
    onEvent: (cb: (e: TurnEvent) => void) => subscribe('chat:event', cb),
  },
  tasks: {
    transcript: (taskId: string) => ipcRenderer.invoke('tasks:transcript', taskId),
  },
  dictation: {
    available: () => ipcRenderer.invoke('dictation:available'),
    start: () => ipcRenderer.invoke('dictation:start'),
    stop: () => ipcRenderer.invoke('dictation:stop'),
    cancel: () => ipcRenderer.invoke('dictation:cancel'),
    openSettings: (pane: 'microphone' | 'speech') => ipcRenderer.invoke('dictation:settings', pane),
    onEvent: (cb: (e: DictationEvent) => void) => subscribe('dictation:event', cb),
  },
  host: {
    environment: () => ipcRenderer.invoke('setup:environment'),
    run: (action: HostAction) => ipcRenderer.invoke('host:run', action),
    cancel: () => ipcRenderer.invoke('host:cancel'),
    onChunk: (cb: (c: StreamChunk) => void) => subscribe('host:chunk', cb),
  },
  loops: {
    active: () => ipcRenderer.invoke('loops:active'),
    registry: (refresh?: boolean) => ipcRenderer.invoke('loops:registry', refresh),
    detail: (name: string) => ipcRenderer.invoke('loops:detail', name),
    install: (name: string, allowUntrusted?: boolean) => ipcRenderer.invoke('loops:install', name, allowUntrusted),
    uninstall: (name: string) => ipcRenderer.invoke('loops:uninstall', name),
    setEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('loops:setEnabled', name, enabled),
  },
  automations: {
    list: () => ipcRenderer.invoke('automations:list'),
    save: (a: Automation, previousName?: string) =>
      ipcRenderer.invoke('automations:save', a, previousName),
    remove: (name: string) => ipcRenderer.invoke('automations:remove', name),
    runNow: (name: string) => ipcRenderer.invoke('automations:run', name),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  app: {
    reportError: (report: { where: string; message: string; stack: string }) =>
      ipcRenderer.invoke('app:reportError', report),
    version: () => ipcRenderer.invoke('app:version'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    revealProfile: () => ipcRenderer.invoke('app:revealProfile'),
    focus: () => ipcRenderer.invoke('app:focus'),
    platform: process.platform,
  },
}

contextBridge.exposeInMainWorld('karmax', bridge)
