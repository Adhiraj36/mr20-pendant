// The contract between the two processes.
//
// Both sides import this file, so a renamed field breaks the typecheck rather
// than turning into an undefined at runtime — which is the only way an IPC
// boundary stays honest.

export type DaemonState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'restarting'
  | 'crashed'
  | 'unavailable' // no daemon binary bundled or configured

export interface DaemonStatus {
  state: DaemonState
  pid: number | null
  /** Why it is in this state, in words a non-technical person can act on. */
  detail: string
  /** Populated once the daemon answers /api/ping. */
  version: string | null
  agent: string | null
  startedAt: string | null
  /** Consecutive crash count; reset by a clean start or a manual start. */
  restarts: number
  ports: { api: number; console: number; webhooks: number }
  binary: string | null
  /** Set when the binary was built from a local checkout. */
  core: { revision: string; builtAt: string; source: string } | null
  /** The engine is on another machine, so this app watches it rather than
   *  runs it: no pid, no log file, and starting and stopping are that
   *  machine's business. */
  remote: boolean
  /** Which machine, when it is not this one. */
  host: string | null
}

export interface LogLine {
  at: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

/** What LYZN says this account may do. */
export interface PlanView {
  tier: string
  automation: boolean
  status: string
  /** The sentence to show when automation is false. Printed, never parsed. */
  why: string
}

/** What this machine got back when it paired with LYZN. */
export interface LyznPairing {
  token: string
  daemonId: string
  name: string
  api: string
  pairedAt: string
  plan?: PlanView
}

/** One promise, and what became of it. */
export interface Ticket {
  taskId: string
  text: string
  kind: string
  quote: string
  dueAt: string
  createdAt: string
  status: string
  /** This machine is the one that ran it. An account can have several. */
  mine: boolean
  claimedAt: string
  finishedAt: string
  context: { title: string; summary: string; facts: { text: string; kind: string }[] }
  /** What the task was parked on, when it asked. Kept after it is answered. */
  question?: TaskQuestion | null
  receipt: {
    receiptId: string
    title: string
    stamp: string
    quote?: string
    rows?: { k: string; v: string; ok?: boolean }[]
    createdAt?: string
  } | null
}

export interface TaskQuestion {
  id: string
  text: string
  /** Present when the question is a choice rather than free text. */
  options?: string[]
  askedBy: string
  askedAt: string
  expiresAt: string
  answer?: string
  answeredAt?: string
  /** "app", "comms" or "desktop": which surface wrote it, not who. */
  answeredBy?: string
}

export interface Tickets {
  waiting: Ticket[]
  running: Ticket[]
  finished: Ticket[]
  /** Parked on a question. Absent from a LYZN that predates follow-ups. */
  blocked?: Ticket[]
  plan?: PlanView
}

export interface RemoteEngine {
  enabled: boolean
  host: string
  apiPort: number
  consolePort: number
  token: string
}

/** One thing KARMAX needs on the machine before a feature works. */
export interface EnvCheck {
  id: string
  name: string
  /** What this unlocks, phrased as a benefit rather than a dependency. */
  purpose: string
  ok: boolean
  detail: string
  /** True when nothing works without it. */
  required: boolean
  installUrl?: string
  /** This machine can put it there without anybody opening a terminal. */
  installable?: boolean
  /** What has to be installed first when it cannot — "Node.js", "Go". */
  needs?: string
}

export interface SetupState {
  /** No config file yet — the wizard owns the window. */
  needsSetup: boolean
  profileDir: string
  configPath: string
  /** True when another KARMAX is already running on this machine. */
  foreignDaemon: { port: number; detail: string } | null
}

export interface SetupPayload {
  name: string
  /** Which coding harness orchestrates. Defaults to Claude Code. */
  orchestrator: 'claude' | 'codex'
  // The fallback brain is LYZN's to arrange, not something to put in front of
  // somebody on their first evening — so nothing asks for these and the
  // generated config carries them blank. They stay in the shape because the
  // daemon's config has the fields, and because an operator who does run their
  // own gateway can still fill them in by hand.
  /** Optional API key for the fallback path; blank is the normal case. */
  anthropicKey?: string
  /** Fallback base URL. Blank means whatever LYZN has arranged. */
  anthropicBaseUrl?: string
}

/** The slice of karmax.yaml the settings screens edit, already resolved. */
export interface Settings {
  identity: { name: string; persona: string }
  brain: {
    harnessEnabled: boolean
    binary: string
    windowShare: number
    maxLive: number
    kinds: Record<string, HarnessKind>
    fallbackProvider: string
    fallbackModel: string
  }
  budget: { usdPerMonth: number }
  ports: { api: number; console: number; webhooks: number; oauthCallback: number }
  paths: { dataDir: string }
  logging: { level: string; format: string }
  channels: Channel[]
  memory: MemorySettings
}

/** Where long-term memory lives.
 *
 *  GitLoom is configured through the environment rather than karmax.yaml, so
 *  these do not live in the config file with everything else — they are in the
 *  profile's .env, which is what karmax reads them from. */
export interface MemorySettings {
  /** True when a GitLoom key is set, which is what switches the backend. */
  gitloomEnabled: boolean
  /** Never the key itself — only whether one is stored. */
  gitloomKeySet: boolean
  namespace: string
  baseUrl: string
}

export interface HarnessKind {
  model: string
  idle: string
  max_turns: number
  turn_timeout: string
  max_cost_usd?: number
  ephemeral?: boolean
}

export interface Channel {
  id: string
  type: string
  agent_id: string
  token: string
  settings: Record<string, string>
}

/** A live integration as the daemon reports it. */
export interface Integration {
  id: string
  name: string
  status: 'connected' | 'disconnected' | 'off' | string
  detail: string
}

export interface Loop {
  name: string
  cron?: string
  every?: string
  prompt: string
  harness?: string
  enabled?: boolean
}

export interface LoopHealth {
  name: string
  schedule?: string
  last_success?: string | null
  last_failure?: string | null
  consecutive_failures?: number
  running?: boolean
  retry_at?: string | null
  /** Has not succeeded in long enough that something is wrong, though
   *  nothing is failing right now. */
  dark?: boolean
  last_error?: string
  /** Older engines. */
  last_run?: string | null
  [k: string]: unknown
}

export interface ApiResult<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

/** A dashboard as the engine's list describes it — no HTML, no data values,
 *  just enough to show a tab and to know when to reload one. */
export interface DashboardMeta {
  id: string
  title: string
  description: string
  agent: string
  createdAt: string
  updatedAt: string
  htmlVersion: number
  dataVersion: number
  data: string[]
  live: string[]
  refresh: { every?: string; cron?: string; brief: string } | null
  /** Shown first among the tabs. */
  pinned?: boolean
  /** Put away: off the tabs and no longer refreshed, but kept. */
  archived?: boolean
  archivedAt?: string
}

export interface KarmaxBridge {
  daemon: {
    status(): Promise<DaemonStatus>
    start(): Promise<DaemonStatus>
    stop(): Promise<DaemonStatus>
    restart(): Promise<DaemonStatus>
    logs(): Promise<LogLine[]>
    onChange(cb: (s: DaemonStatus) => void): () => void
    onLog(cb: (l: LogLine) => void): () => void
  }
  /** The work LYZN heard somebody promise, and what became of it.
   *
   *  The token never crosses this bridge — `pairing()` says whether there is
   *  one and what the machine is called, never what it is. */
  lyzn: {
    pairing(): Promise<{
      paired: boolean
      name?: string
      daemonId?: string
      pairedAt?: string
      plan?: PlanView
      /** The loop that does the work: installed, and carrying a token. */
      loop?: { installed: boolean; armed: boolean; path: string }
    }>
    pair(code: string): Promise<{
      ok: boolean
      error?: string
      name?: string
      plan?: PlanView
      loop?: boolean
      loopError?: string
    }>
    unpair(): Promise<{ ok: boolean }>
    tickets(): Promise<ApiResult<Tickets>>
    /** Ask LYZN for a fresh memory key, for a machine that lost one. */
    refreshMemory(): Promise<{ ok: boolean; error?: string }>
    /** Kill the run on this machine, then tell LYZN it failed. The engine is
     *  stopped first always, even if telling LYZN afterwards fails. */
    /** Answer a question this machine's own task is parked on. */
    answer(taskId: string, answer: string): Promise<{ ok: boolean; error?: string }>
    stopTask(taskId: string): Promise<{
      ok: boolean
      stopped?: boolean
      wasRunning?: boolean
      alreadyFinished?: boolean
      error?: string
    }>
  }
  /** WhatsApp's connection, which lives or dies with wacli's daemon. */
  whatsapp: {
    /** Start it if it is not up. Idempotent, and it observes before it
     *  answers, so `running` means answering rather than spawned. */
    connect(): Promise<{ running: boolean; error?: string }>
    state(): Promise<{ paired: boolean; connected: boolean }>
  }
  /** Which machine the engine runs on. This app is a UI; it does not have to
   *  be the same one. */
  engine: {
    get(): Promise<RemoteEngine>
    set(next: RemoteEngine): Promise<{ ok: boolean; error?: string }>
    /** Try the address before committing to it, so a typo is caught here
     *  rather than as a window that never finds an engine. */
    test(candidate: RemoteEngine): Promise<{ ok: boolean; version?: string; error?: string }>
    /** Put this machine's key on the clipboard, without the page seeing it. */
    copyKey(): Promise<{ ok: boolean }>
  }
  setup: {
    state(): Promise<SetupState>
    environment(): Promise<EnvCheck[]>
    complete(p: SetupPayload): Promise<SetupState>
  }
  config: {
    settings(): Promise<Settings>
    patch(patch: SettingsPatch): Promise<Settings>
    /** Blank values clear a setting. The key is write-only. */
    setMemory(m: { apiKey?: string; namespace?: string; baseUrl?: string }): Promise<Settings>
    raw(): Promise<{ path: string; text: string }>
    writeRaw(text: string): Promise<{ ok: boolean; error: string | null }>
    reveal(): Promise<void>
  }
  api: {
    request<T = unknown>(
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      path: string,
      body?: unknown,
    ): Promise<ApiResult<T>>
    get<T = unknown>(path: string): Promise<ApiResult<T>>
    post<T = unknown>(path: string, body?: unknown): Promise<ApiResult<T>>
    tool<T = unknown>(name: string, args?: unknown): Promise<ApiResult<T>>
  }
  console: {
    request<T = unknown>(
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      path: string,
      body?: unknown,
    ): Promise<ApiResult<T>>
  }
  /** Connecting a service by letting an agent do the clicking.
   *
   *  `onProgress` is the whole point: it carries the running commentary, and
   *  the "needs-you" moments that are somebody's turn to press something. */
  connect: {
    list(): Promise<Connectable[]>
    start(id: string, account?: string): Promise<{ ok: boolean; error?: string }>
    cancel(): Promise<void>
    busy(): Promise<string | null>
    onProgress(cb: (p: ConnectProgress) => void): () => void
  }
  /** The assistant, answered by the engine on this machine.
   *
   *  The page names a conversation and a message. Where the engine is and what
   *  it is asked with stay on the other side of this bridge. */
  chat: {
    send(
      conversationId: string | null,
      message: string,
      options?: { model?: string; effort?: string },
    ): Promise<{ ok: boolean; error?: string }>
    stop(): Promise<void>
    /** The models and effort levels the brain accepts, or null from an engine
     *  too old to say — the composer then offers no choice. */
    options(): Promise<ChatOptions | null>
    list(): Promise<{ conversations: ConversationSummary[]; brain: string }>
    history(id: string): Promise<EngineMessage[]>
    remove(id: string): Promise<void>
    onEvent(cb: (e: TurnEvent) => void): () => void
  }
  tasks: {
    /** What the brain did for one LYZN task, or null when there is no record. */
    transcript(taskId: string): Promise<TaskTranscript | null>
  }
  /** Speech to text for the composer. macOS only; `available` says so. */
  dictation: {
    available(): Promise<boolean>
    start(): Promise<{ ok: boolean; error?: string }>
    stop(): Promise<void>
    cancel(): Promise<void>
    openSettings(pane: 'microphone' | 'speech'): Promise<void>
    onEvent(cb: (e: DictationEvent) => void): () => void
  }
  host: {
    environment(): Promise<EnvCheck[]>
    run(action: HostAction): Promise<{ ok: boolean; error?: string }>
    cancel(): Promise<void>
    onChunk(cb: (c: StreamChunk) => void): () => void
  }
  /** Loops the engine is running, and the registry of ones it could. */
  loops: {
    active(): Promise<ActiveLoop[] | null>
    registry(refresh?: boolean): Promise<ApiResult<{ entries: RegistryEntry[]; fetchedAt: string; source: string }>>
    detail(name: string): Promise<ApiResult<RegistryDetail>>
    install(
      name: string,
      allowUntrusted?: boolean,
    ): Promise<ApiResult<{ installed?: boolean; restartRequired?: boolean; message?: string; untrusted?: boolean }>>
    uninstall(name: string): Promise<ApiResult<{ removed: boolean; restartRequired: boolean }>>
    /** `restartRequired` is true for a tier the engine only reads at start. */
    setEnabled(name: string, enabled: boolean): Promise<ApiResult<{ name: string; enabled: boolean; restartRequired?: boolean }>>
  }
  automations: {
    list(): Promise<Automation[]>
    save(a: Automation, previousName?: string): Promise<Automation[]>
    remove(name: string): Promise<Automation[]>
    runNow(name: string): Promise<ApiResult>
  }
  /** Agent-built dashboards, rendered in a sealed frame elsewhere in the app.
   *  This bridge only fetches; the frame it feeds has no bridge of its own. */
  dashboards: {
    /** null when the engine cannot list dashboards (not running, or too old). */
    list(): Promise<DashboardMeta[] | null>
    /** A data file ("orders") or a live source ("live:activity") for one
     *  dashboard. Refused before it reaches the network for anything else. */
    data(id: string, source: string): Promise<{ ok: boolean; value?: unknown; error?: string }>
    remove(id: string): Promise<{ ok: boolean; error?: string }>
    /** Pin or archive a dashboard; the engine keeps the choice. */
    update(id: string, patch: { pinned?: boolean; archived?: boolean }): Promise<{ ok: boolean; dashboard?: DashboardMeta; error?: string }>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  }
  app: {
    /** A screen that threw, so the failure reaches the log rather than only
     *  the renderer's console — which nobody can open. */
    reportError?(report: { where: string; message: string; stack: string }): Promise<{ ok: boolean }>
    version(): Promise<string>
    openExternal(url: string): Promise<void>
    revealProfile(): Promise<void>
    /** Bring the window forward, for a notification that was clicked. */
    focus(): Promise<void>
    platform: string
  }
}

/** The closed set of setup commands the UI may ask the main process to run.
 *  A name, never a command line. */
export type HostAction =
  | 'whatsapp.pair'
  | 'whatsapp.status'
  | 'whatsapp.logout'
  | 'google.status'
  | 'claude.check'
  // Putting a missing tool on the machine, rather than linking somebody to a
  // README about it. The command lines live in installs.ts.
  | 'install.claude'
  | 'install.codex'
  | 'install.wacli'
  | 'install.gog'
  | 'install.playwright'

/** One line of an agent connecting something, on its way to a window.
 *
 *  `kind` is the engine's, and "needs-you" is the one that matters: it is the
 *  moment somebody has to press something themselves. A client that does not
 *  recognise a kind should show it as an ordinary step rather than hide it. */
export interface ConnectProgress {
  /** Which service. Added by the main process; the engine does not send it. */
  id?: string
  kind: 'starting' | 'step' | 'doing' | 'says' | 'needs-you' | 'done' | 'failed'
  text?: string
}

/** One thing the engine says while a turn of the chat is running.
 *
 *  The same union as `@lyzn/chat-core`'s, restated because this file is the
 *  contract between the two processes and must not depend on a package the
 *  preload does not bundle. The reducer there switches over these, so a kind
 *  added to one has to be added to the other. */
export type TurnEvent =
  | { kind: 'conversation'; id: string }
  | { kind: 'message'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; tool: WireToolCall }
  | { kind: 'tool_update'; tool: Pick<WireToolCall, 'id' | 'status'> & Partial<WireToolCall> }
  | { kind: 'plan'; plan: WirePlanEntry[] }
  | { kind: 'ticket'; jobId: string; title: string }
  | { kind: 'meta'; model?: string; durationMs?: number; costUsd?: number }
  | { kind: 'done'; text?: string }
  | { kind: 'error'; text: string }

export interface WireToolCall {
  id: string
  title?: string
  kind?: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  locations?: { path: string; line?: number }[]
  input?: Record<string, unknown>
  output?: string
}

export interface WirePlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
  priority?: string
}

export interface ChatOptions {
  brain: string
  models: { id: string; label: string }[]
  efforts: string[]
  defaultModel: string
  defaultEffort: string
}

export interface TaskTranscript {
  messages: EngineMessage[]
  /** The task's session is mid-turn right now. */
  live: boolean
}

export type DictationEvent =
  | { type: 'ready' }
  | { type: 'level'; value: number }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; code: string; message: string }
  /** The helper has exited, whatever it said before. */
  | { type: 'end' }

/** One past conversation, as the list of them shows it. */
export interface ConversationSummary {
  id: string
  title: string
  opening: string
  updated: string
}

/** A stored message, in the engine's shape.
 *
 *  Deliberately not `Message`: `@lyzn/chat-core` has one of those and it is a
 *  different thing — it carries an id and the cards the window drew. This is
 *  what the engine remembers. The renderer maps one to the other, and two
 *  types with one name is how that mapping gets forgotten. */
export interface EngineMessage {
  role: 'user' | 'assistant'
  text: string
  at: string
  toolCalls?: WireToolCall[]
}

/** A service an agent can connect, and what it needs first. */
export interface Connectable {
  id: string
  name: string
  needs: string[]
  lede: string
}

/** What the assistant may touch on this machine. */
export interface AccessPolicy {
  enforced: boolean
  grants: { path: string; write: boolean }[]
  deny: string[]
  /** The list KARMAX applies on its own. Shown, never edited. */
  standard: string[]
}

/** The browser the person and the assistant share. */
export interface BrowserState {
  running: boolean
  available: boolean
  binary?: string
  profile: string
  tabs: { title: string; url: string }[]
  reason?: string
}

export interface StreamChunk {
  id: string
  text: string
  done: boolean
  ok?: boolean
  /** A QR code the command produced, as a data URI. */
  image?: string
}

/** An automation as the app presents it: a schedule in words, and a job. */
/** A loop as the engine lists it: what wakes it, not how it has been doing —
 *  that is LoopHealth. */
export interface ActiveLoop {
  name: string
  description?: string
  /** Six-field cron or "@every 30m"; empty for a loop woken by something else. */
  schedule?: string
  webhook?: string
  events?: string[]
  /** "recipe", "workflow", "compiled" or "prompt". */
  kind?: string
  enabled?: boolean
}

/** One loop in the registry. */
export interface RegistryEntry {
  name: string
  kind: string
  version: string
  description: string
  author: string
  requires: string[]
  shipsWithEngine: boolean
  installed: boolean
  installedVersion?: string
  active: boolean
  sourceUrl?: string
}

export interface RegistryDetail {
  entry: RegistryEntry
  /** The recipe itself, or a workflow's manifest, as text. */
  definition: string
  trigger: string
  tools: string[]
  host: string[]
}

export interface Automation {
  name: string
  /** Either a cron expression or a plain interval like "2h". */
  cron: string
  every: string
  prompt: string
  /** When set, the prompt runs straight through the coding harness and its
   *  output is saved to memory, skipping the main model entirely. */
  harness: string
  enabled: boolean
  /** Live state from the daemon; absent until it has run once. */
  health?: LoopHealth | null
  /** True for a loop the engine ships with rather than one from the settings
   *  file. These can be run by hand but not edited or deleted here. */
  builtin?: boolean
}

/** A shallow patch; every key is optional and merged into the YAML in place. */
export type SettingsPatch = {
  [K in keyof Settings]?: Partial<Settings[K]>
}

declare global {
  interface Window {
    karmax: KarmaxBridge
  }
}
