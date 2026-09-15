// Where this app's KARMAX lives.
//
// Deliberately NOT ~/.karmax. A machine can already be running a KARMAX from
// there — a systemd unit, a terminal, an older install — and karmax's own docs
// are blunt about the consequence: one daemon per database, because crash
// recovery at startup assumes no other process is reading the same rows. Two
// instances sharing a data dir do not conflict loudly; they corrupt quietly and
// answer as each other. So the desktop app gets its own profile, and the only
// way to point it at an existing one is to say so on purpose.
import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import type { LyznPairing, RemoteEngine } from './shared/types.js'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export interface Ports {
  api: number
  console: number
  webhooks: number
  oauthCallback: number
}

/** The ports a fresh profile asks for first. Offset from karmax's own defaults
 *  (9091/8080/9090/9095) so a desktop install never lands on top of one that
 *  was already there. */
export const DEFAULT_PORTS: Ports = { api: 9191, console: 8181, webhooks: 9190, oauthCallback: 9195 }

/** An engine on somebody else's machine.
 *
 *  This app is a UI. Nothing about it needs the engine to be on the same
 *  computer — a laptop that is closed at night and a machine that never
 *  sleeps are a reasonable pair to own — so it can be pointed at one over the
 *  network. Supervision is the part that cannot travel: starting, stopping and
 *  reading the log file are local acts, and the screens that do them say so
 *  rather than pretending. */
export interface DesktopState {
  apiToken: string
  console: { member: string; password: string } | null
  /** Absent on every install that has never looked elsewhere. */
  remote?: RemoteEngine
  /** This machine's own pairing with LYZN. The desktop app is a LYZN product,
   *  so unlike the engine it may hold one. */
  lyzn?: LyznPairing
  /** Set once the wizard finishes, so a half-written profile is not mistaken
   *  for a finished one. */
  setupCompletedAt: string | null
}

export function profileDir(): string {
  const override = process.env.KARMAX_DESKTOP_PROFILE?.trim()
  if (override) return path.resolve(expandHome(override))
  return path.join(os.homedir(), '.karmax-desktop')
}

export function configPath(): string {
  return path.join(profileDir(), 'karmax.yaml')
}

/** Where this install's loops live.
 *
 *  Inside the profile rather than the engine's default ~/.karmax/recipes,
 *  which is the same rule the data directory follows and for the same reason:
 *  two engines sharing a folder is two engines running each other's work. It
 *  is also what makes installing a loop for somebody a safe thing to do — a
 *  file written here belongs to this app and to nothing else on the machine. */
export function recipesDir(): string {
  return path.join(profileDir(), 'recipes')
}

/** Where this app puts binaries it installed for you.
 *
 *  Inside the profile rather than /usr/local/bin: no sudo, nothing of the
 *  system's touched, and uninstalling the app takes its tools with it. On the
 *  tool PATH ahead of everything else, so a version this app fetched is the
 *  one it runs. */
export function toolsDir(): string {
  return path.join(profileDir(), 'bin')
}

export function envPath(): string {
  return path.join(profileDir(), '.env')
}

function statePath(): string {
  return path.join(profileDir(), 'desktop.json')
}

export function logPath(): string {
  return path.join(profileDir(), 'logs', 'daemon.log')
}

function pidPath(): string {
  return path.join(profileDir(), 'daemon.pid')
}

/** Remember which process is ours.
 *
 *  A desktop app does not always get to shut down politely — a SIGKILL, a
 *  session ending, a crash — and a daemon that outlives the app holds the port
 *  and the database. The pid on disk is what lets the next launch tell its own
 *  orphan (adopt it) from somebody else's KARMAX (leave it alone). */
export function writePid(pid: number): void {
  ensureProfile()
  try {
    fs.writeFileSync(pidPath(), String(pid), { mode: 0o600 })
  } catch {
    // Losing the pidfile costs an adoption, not correctness.
  }
}

export function readPid(): number | null {
  try {
    const pid = Number(fs.readFileSync(pidPath(), 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function clearPid(): void {
  try {
    fs.rmSync(pidPath(), { force: true })
  } catch {
    // nothing to clear
  }
}

/** Whether a pid is alive, without signalling it. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

export function ensureProfile(): void {
  fs.mkdirSync(path.join(profileDir(), 'logs'), { recursive: true })
  fs.mkdirSync(recipesDir(), { recursive: true })
  fs.mkdirSync(toolsDir(), { recursive: true })
}

/** The engine this app is talking to, and whether it is the one it supervises.
 *
 *  One place, because "which machine" is asked by the API layer, the status
 *  poller and half the settings screen, and three answers that can disagree is
 *  a window that says the engine is running while it talks to nothing. */
export function engineTarget(): {
  remote: boolean
  apiBase: string
  consoleBase: string
  token: string
} {
  const state = readState()
  const r = state.remote
  if (r?.enabled && r.host.trim()) {
    const host = r.host.trim()
    return {
      remote: true,
      apiBase: `http://${host}:${r.apiPort || DEFAULT_PORTS.api}`,
      consoleBase: `http://${host}:${r.consolePort || DEFAULT_PORTS.console}`,
      token: r.token.trim(),
    }
  }
  return { remote: false, apiBase: '', consoleBase: '', token: state.apiToken }
}

export function readState(): DesktopState {
  ensureProfile()
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as Partial<DesktopState>
    if (raw.apiToken) {
      return {
        apiToken: raw.apiToken,
        console: raw.console ?? null,
        setupCompletedAt: raw.setupCompletedAt ?? null,
        remote: raw.remote,
        lyzn: raw.lyzn,
      }
    }
  } catch {
    // A missing or unreadable state file means a new profile, which is the
    // normal first run rather than an error worth surfacing.
  }
  const fresh: DesktopState = {
    apiToken: 'kmx_' + randomBytes(24).toString('hex'),
    console: { member: 'owner', password: randomBytes(24).toString('base64url') },
    setupCompletedAt: null,
  }
  writeState(fresh)
  return fresh
}

/** What a fresh remote setting looks like: pointed nowhere, ports matching a
 *  desktop install on the other end. */
export function defaultRemote(): RemoteEngine {
  return {
    enabled: false,
    host: '',
    apiPort: DEFAULT_PORTS.api,
    consolePort: DEFAULT_PORTS.console,
    token: '',
  }
}

export function writeState(s: DesktopState): void {
  ensureProfile()
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), { mode: 0o600 })
}

/** The variables this app owns. Everything else in the .env is somebody
 *  else's — GitLoom credentials, a provider key — and survives a rewrite. */
const MANAGED_ENV = ['KARMAX_API_TOKEN', 'KARMAX_DATA_DIR', 'KARMAX_RECIPES_DIR']

/** The .env the daemon reads on start.
 *
 *  Merged, not overwritten. It is regenerated on every start so the token the
 *  app authenticates with and the token the daemon expects cannot drift — but
 *  this file is also the only way to configure things karmax reads from the
 *  environment rather than from YAML, GitLoom among them. Truncating it would
 *  mean the memory settings silently disappearing on the next restart. */
export function writeEnvFile(state: DesktopState): void {
  ensureProfile()
  const kept: string[] = []
  try {
    for (const line of fs.readFileSync(envPath(), 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const key = trimmed.slice(0, trimmed.indexOf('=')).trim()
      if (key && !MANAGED_ENV.includes(key)) kept.push(line)
    }
  } catch {
    // No file yet: a first start, which is the normal case.
  }

  const lines = [
    '# Written by the LYZN desktop app.',
    '# The three KARMAX_ lines below are rewritten on every start; anything',
    '# else you add here is left alone.',
    `KARMAX_API_TOKEN=${state.apiToken}`,
    `KARMAX_DATA_DIR=${profileDir()}`,
    `KARMAX_RECIPES_DIR=${recipesDir()}`,
    ...kept,
    '',
  ]
  fs.writeFileSync(envPath(), lines.join('\n'), { mode: 0o600 })
}

/** Read the .env as a map, for the settings screens. */
export function readEnvFile(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of fs.readFileSync(envPath(), 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
  } catch {
    // Nothing written yet.
  }
  return out
}

/** Set or clear variables in the .env, leaving the rest of the file intact.
 *
 *  A blank value REMOVES the key rather than writing an empty one: karmax
 *  treats an empty GITLOOM_API_KEY as "no account" via a trim, but an empty
 *  value in a file reads to a person like a setting that exists and is broken. */
export function patchEnvFile(patch: Record<string, string>): void {
  ensureProfile()
  const current = readEnvFile()
  for (const [k, v] of Object.entries(patch)) {
    if (v.trim() === '') delete current[k]
    else current[k] = v.trim()
  }

  const managed = MANAGED_ENV.filter((k) => current[k] !== undefined).map(
    (k) => `${k}=${current[k]}`,
  )
  const rest = Object.keys(current)
    .filter((k) => !MANAGED_ENV.includes(k))
    .sort()
    .map((k) => `${k}=${current[k]}`)

  const lines = [
    '# Written by the KARMAX desktop app.',
    '# The two KARMAX_ lines below are rewritten on every start; anything else',
    '# you add here is left alone.',
    ...managed,
    ...rest,
    '',
  ]
  fs.writeFileSync(envPath(), lines.join('\n'), { mode: 0o600 })
}

/** True when something is already listening. Used both to find a free port for
 *  a new profile and to notice a KARMAX that is already running. */
export function portInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (v: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(v)
    }
    socket.setTimeout(400)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

export async function findFreePort(start: number, span = 40): Promise<number> {
  for (let p = start; p < start + span; p++) {
    if (!(await portInUse(p))) return p
  }
  return start
}

export async function allocatePorts(): Promise<Ports> {
  return {
    api: await findFreePort(DEFAULT_PORTS.api),
    console: await findFreePort(DEFAULT_PORTS.console),
    webhooks: await findFreePort(DEFAULT_PORTS.webhooks),
    oauthCallback: await findFreePort(DEFAULT_PORTS.oauthCallback),
  }
}

/** The bundled daemon, or null when this build shipped without one. */
export function daemonBinary(): string | null {
  const explicit = process.env.KARMAX_BINARY?.trim()
  if (explicit && fs.existsSync(explicit)) return explicit

  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const name = `karmax-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`

  const roots = app.isPackaged
    ? [path.join(process.resourcesPath, 'core')]
    : [path.join(app.getAppPath(), 'resources')]

  for (const root of roots) {
    const candidate = path.join(root, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/** Provenance for the bundled binary, written by scripts/build-core.sh. */
export function coreInfo(): { revision: string; builtAt: string; source: string } | null {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'core')
    : path.join(app.getAppPath(), 'resources')
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'core.json'), 'utf8'))
    return { revision: j.revision ?? 'unknown', builtAt: j.builtAt ?? '', source: j.source ?? '' }
  } catch {
    return null
  }
}
