// The daemon supervisor.
//
// The app owns the KARMAX process: it starts it, watches it, restarts it when
// it falls over, and stops it on quit. A person who installed a desktop app
// should never have to know a background service exists, which means every
// failure here has to end in either a working daemon or a sentence explaining
// why not.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import type { DaemonState, DaemonStatus, LogLine } from './shared/types.js'
import {
  clearPid,
  coreInfo,
  daemonBinary,
  ensureProfile,
  envPath,
  logPath,
  pidAlive,
  portInUse,
  profileDir,
  readPid,
  readState,
  writeEnvFile,
  writePid,
  engineTarget,
  recipesDir,
} from './profile.js'
import { readSettings, configExists, ensureAgentTools } from './config.js'
import { loginPath } from './envpath.js'

const LOG_CAP = 800
const HEALTH_INTERVAL_MS = 4000
const START_TIMEOUT_MS = 45_000
const STOP_GRACE_MS = 8000
/** Backoff between crash restarts. Capped rather than unbounded: a daemon that
 *  cannot start should end up visibly stopped, not retrying forever in silence. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 20_000]
const MAX_RESTARTS = 5

export class Daemon extends EventEmitter {
  private child: ChildProcess | null = null
  private state: DaemonState = 'stopped'
  private detail = 'Not started yet.'
  private version: string | null = null
  private agent: string | null = null
  private startedAt: string | null = null
  private restarts = 0
  private logs: LogLine[] = []
  private healthTimer: NodeJS.Timeout | null = null
  private backoffTimer: NodeJS.Timeout | null = null
  /** Set while stop() is in flight so the exit handler does not read a
   *  deliberate shutdown as a crash and restart what the user just stopped. */
  private stopping = false
  /** An orphan from a previous run that this instance took back over. There is
   *  no ChildProcess for it, so it is killed by pid and watched by health
   *  polling alone. */
  private adopted: number | null = null

  private livePid(): number | null {
    return this.child?.pid ?? this.adopted
  }

  status(): DaemonStatus {
    const ports = configExists()
      ? readSettings().ports
      : { api: 0, console: 0, webhooks: 0, oauthCallback: 0 }
    const target = engineTarget()
    return {
      remote: target.remote,
      host: target.remote ? new URL(target.apiBase).hostname : null,
      state: this.state,
      pid: this.livePid(),
      detail: this.detail,
      version: this.version,
      agent: this.agent,
      startedAt: this.startedAt,
      restarts: this.restarts,
      ports: { api: ports.api, console: ports.console, webhooks: ports.webhooks },
      binary: daemonBinary(),
      core: coreInfo(),
    }
  }

  recentLogs(): LogLine[] {
    return this.logs.slice(-LOG_CAP)
  }

  private set(state: DaemonState, detail: string): void {
    this.state = state
    this.detail = detail
    this.emit('change', this.status())
  }

  private log(stream: LogLine['stream'], text: string): void {
    for (const raw of text.split('\n')) {
      const line = raw.trimEnd()
      if (!line) continue
      const entry: LogLine = { at: new Date().toISOString(), stream, text: line }
      this.logs.push(entry)
      if (this.logs.length > LOG_CAP * 2) this.logs = this.logs.slice(-LOG_CAP)
      this.emit('log', entry)
    }
    try {
      fs.appendFileSync(logPath(), text.endsWith('\n') ? text : text + '\n')
    } catch {
      // A log we cannot write is not a reason to take the daemon down.
    }
  }

  private async childEnv(): Promise<NodeJS.ProcessEnv> {
    const state = readState()
    writeEnvFile(state)
    return {
      ...process.env,
      PATH: await loginPath(),
      // Both are set explicitly rather than left to the .env, because karmax
      // resolves its config from KARMAX_DATA_DIR before it reads any file and
      // an ambient value would point this instance at somebody else's data.
      KARMAX_DATA_DIR: profileDir(),
      // Loops live with the profile, not in the engine's shared default.
      KARMAX_RECIPES_DIR: recipesDir(),
      KARMAX_API_TOKEN: state.apiToken,
      KARMAX_ENV_FILE: envPath(),
    }
  }

  async start(manual = false): Promise<DaemonStatus> {
    // A remote engine is not ours to start. Watching it is the whole of what
    // this app can honestly do, so that is what "start" means here.
    if (engineTarget().remote) {
      this.set('starting', 'Looking for the engine on the other machine…')
      this.startHealth(0)
      void this.ping(0)
      return this.status()
    }
    if (this.child) return this.status()
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer)
      this.backoffTimer = null
    }
    if (manual) this.restarts = 0

    const binary = daemonBinary()
    if (!binary) {
      this.set(
        'unavailable',
        'No KARMAX engine is bundled with this build. Run `npm run build:core` before packaging.',
      )
      return this.status()
    }
    if (!configExists()) {
      this.set('stopped', 'Not set up yet.')
      return this.status()
    }

    // Read once at engine start, so this is the moment an allowlist written
    // by an older build learns the tools this one ships.
    const allowed = ensureAgentTools()
    if (allowed.length) this.log('system', `allowed agents to use ${allowed.join(', ')}`)

    ensureProfile()
    const ports = readSettings().ports

    // A port already answering means SOMETHING owns this profile's address.
    // Starting a second daemon would give two of them one database, which does
    // not fail loudly — it corrupts quietly. So: find out whose it is first.
    if (await portInUse(ports.api)) {
      if (await this.adopt(ports.api)) return this.status()
      this.set(
        'crashed',
        `Something else is already using port ${ports.api}. Quit it, or change the port in Settings.`,
      )
      return this.status()
    }

    this.set('starting', 'Starting the engine…')
    this.log('system', `starting ${binary} (profile ${profileDir()})`)

    const child = spawn(binary, ['start'], {
      cwd: profileDir(),
      env: await this.childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })
    this.child = child
    this.adopted = null
    this.stopping = false
    if (child.pid) writePid(child.pid)

    child.stdout?.on('data', (b: Buffer) => this.log('stdout', b.toString()))
    child.stderr?.on('data', (b: Buffer) => this.log('stderr', b.toString()))

    child.on('error', (err) => {
      this.log('system', `spawn failed: ${err.message}`)
      this.child = null
      this.set('crashed', `The engine could not start: ${err.message}`)
    })

    child.on('exit', (code, signal) => {
      this.child = null
      clearPid()
      this.stopHealth()
      const how = signal ? `signal ${signal}` : `exit code ${code}`
      this.log('system', `daemon exited (${how})`)
      if (this.stopping) {
        this.stopping = false
        this.set('stopped', 'Stopped.')
        return
      }
      this.onCrash(how)
    })

    const healthy = await this.waitForHealth(ports.api, START_TIMEOUT_MS)
    if (!healthy && this.child) {
      // The process is alive but never answered. Keep it and keep polling — a
      // slow first start (migrations, a cold model) is not a failure yet.
      this.set('starting', 'The engine is up but still warming up…')
    }
    this.startHealth(ports.api)
    return this.status()
  }

  /** Take back a daemon this app started and then lost.
   *
   *  Ours is identified by the pidfile plus a ping that our token is accepted
   *  on: the pid alone could have been recycled, and a live port alone could be
   *  somebody else's KARMAX — or anything at all. Both together is enough. */
  private async adopt(port: number): Promise<boolean> {
    const pid = readPid()
    if (!pid || !pidAlive(pid)) return false
    if (!(await this.ping(port))) return false

    this.adopted = pid
    this.log('system', `adopted the daemon left behind by an earlier run (pid ${pid})`)
    this.set('running', 'Running. (Reconnected to the engine from your last session.)')
    this.startHealth(port)
    return true
  }

  private onCrash(how: string): void {
    this.startedAt = null
    this.version = null
    if (this.restarts >= MAX_RESTARTS) {
      this.set(
        'crashed',
        `The engine stopped ${this.restarts} times in a row (${how}). Check the log below, then start it again.`,
      )
      return
    }
    const wait = BACKOFF_MS[Math.min(this.restarts, BACKOFF_MS.length - 1)]
    this.restarts++
    this.set('restarting', `The engine stopped unexpectedly (${how}). Restarting in ${Math.round(wait / 1000)}s…`)
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null
      void this.start()
    }, wait)
  }

  async stop(): Promise<DaemonStatus> {
    if (engineTarget().remote) {
      this.stopHealth()
      this.set('stopped', 'Stopped watching. The engine on the other machine keeps running.')
      return this.status()
    }
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer)
      this.backoffTimer = null
    }
    this.stopHealth()

    // An adopted daemon has no ChildProcess to wait on, so it is signalled by
    // pid and confirmed by watching the pid go away.
    if (!this.child && this.adopted) {
      const pid = this.adopted
      this.set('stopping', 'Stopping…')
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
      for (let i = 0; i < STOP_GRACE_MS / 250 && pidAlive(pid); i++) {
        await new Promise((r) => setTimeout(r, 250))
      }
      if (pidAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // nothing left to kill
        }
      }
      this.adopted = null
      clearPid()
      this.restarts = 0
      this.set('stopped', 'Stopped.')
      return this.status()
    }

    const child = this.child
    if (!child) {
      this.set('stopped', 'Stopped.')
      return this.status()
    }
    this.stopping = true
    this.set('stopping', 'Stopping…')
    this.log('system', 'sending SIGTERM')
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone; the exit handler has the rest.
    }

    await new Promise<void>((resolve) => {
      const done = () => resolve()
      const timer = setTimeout(() => {
        if (this.child) {
          this.log('system', 'grace period expired, sending SIGKILL')
          try {
            this.child.kill('SIGKILL')
          } catch {
            // nothing left to kill
          }
        }
        resolve()
      }, STOP_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        done()
      })
    })
    this.restarts = 0
    return this.status()
  }

  async restart(): Promise<DaemonStatus> {
    await this.stop()
    return this.start(true)
  }

  /** Fired on quit. Synchronous kill, because the app is going away and an
   *  orphaned daemon holding the database is the worst thing to leave behind. */
  shutdownSync(): void {
    if (this.backoffTimer) clearTimeout(this.backoffTimer)
    this.stopHealth()
    const pid = this.livePid()
    if (pid === null) return
    this.stopping = true
    try {
      if (this.child) this.child.kill('SIGTERM')
      else process.kill(pid, 'SIGTERM')
    } catch {
      // best effort
    }
    clearPid()
  }

  private startHealth(port: number): void {
    this.stopHealth()
    this.healthTimer = setInterval(() => void this.ping(port), HEALTH_INTERVAL_MS)
  }

  private stopHealth(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  private async waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!this.child) return false
      if (await this.ping(port)) return true
      await new Promise((r) => setTimeout(r, 600))
    }
    return false
  }

  private async ping(port: number): Promise<boolean> {
    const target = engineTarget()
    // A machine across a room answers slower than one in this process, and a
    // sleeping laptop does not answer at all — so the remote timeout is wider
    // and its failure reads as "cannot reach" rather than "it crashed".
    const url = target.remote ? `${target.apiBase}/api/ping` : `http://127.0.0.1:${port}/api/ping`
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(target.remote ? 6000 : 2500),
      })
      if (!res.ok) return false
      const body = (await res.json()) as { version?: string; agent?: string }
      this.version = body.version ?? null
      this.agent = body.agent ?? null
      if (this.state !== 'running') {
        this.startedAt = new Date().toISOString()
        this.restarts = 0
        this.set('running', 'Your assistant is up. It stays running in the background, even with this window closed.')
      }
      return true
    } catch {
      if (engineTarget().remote) {
        if (this.state !== 'crashed') {
          this.set('crashed', 'Cannot reach the engine on that machine. It may be asleep, or the address may be wrong.')
        }
        return false
      }
      if (this.state === 'running') {
        this.set('starting', 'The engine stopped answering. Waiting for it to come back…')
      }
      return false
    }
  }
}

export const daemon = new Daemon()
