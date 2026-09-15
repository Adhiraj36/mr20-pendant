// The parts of setup that are not an HTTP call.
//
// Pairing WhatsApp, signing into Google, checking whether a coding harness is
// installed — all of these are command-line rituals today. The app runs them
// and streams what they print, so the user gets a QR code and a progress line
// instead of a terminal and an instruction manual.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import {
  goBin,
  goPath,
  INSTALLS,
  plan as installPlan,
  which as whichSync,
  type Step,
  type ToolId,
} from './installs'
import { fetchTool, releaseFor } from './fetchtool.js'
import { EventEmitter } from 'node:events'
import type { EnvCheck } from './shared/types.js'
import { profileDir, toolsDir } from './profile.js'

const execFileAsync = promisify(execFile)

/** WhatsApp lives in the app's own profile, not the user's ~/.wacli.
 *  wacli supports exactly one session per WACLI_HOME, so sharing one would
 *  mean the app and a terminal fighting over the same pairing. */
export function wacliHome(): string {
  return path.join(profileDir(), 'wacli')
}

export function qrImagePath(): string {
  return path.join(wacliHome(), 'qr.png')
}

function toolEnv(extraPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // What this app installed comes first: a tool it fetched and verified is
    // the one it should run, not an older copy somewhere on the system. A Go
    // it fetched, and whatever that Go builds, are on the same footing.
    PATH: [toolsDir(), goBin(), goPath(), extraPath].join(path.delimiter),
    WACLI_HOME: wacliHome(),
    // Its own port too: the default would collide with a wacli daemon the
    // person may already be running.
    WACLI_HTTP_ADDR: '127.0.0.1:8791',
  }
}

async function which(bin: string, searchPath: string): Promise<string | null> {
  return whichSync(bin, searchPath)
}

/** What is installed, phrased as what it unlocks.
 *
 *  Deliberately not a dependency list. "Claude Code — this is the brain" tells
 *  someone why they should care; "claude: not found" does not. */
export async function environment(searchPath: string): Promise<EnvCheck[]> {
  const checks: EnvCheck[] = []

  const claude = await which('claude', searchPath)
  checks.push({
    id: 'claude',
    name: 'Claude Code',
    purpose: 'Does the thinking. KARMAX runs it as a long conversation with real tools.',
    ok: !!claude,
    detail: claude ? await version(claude, ['--version'], searchPath) : 'Not installed',
    required: true,
    installUrl: 'https://claude.com/product/claude-code',
  })

  const codex = await which('codex', searchPath)
  checks.push({
    id: 'codex',
    name: 'Codex',
    purpose: 'An alternative brain. Optional — pick one in Settings.',
    ok: !!codex,
    detail: codex ? await version(codex, ['--version'], searchPath) : 'Not installed',
    required: false,
    installUrl: 'https://developers.openai.com/codex/cli',
  })

  const wacli = await which('wacli', searchPath)
  checks.push({
    id: 'wacli',
    name: 'WhatsApp',
    purpose: 'Lets KARMAX read and reply on your own WhatsApp account.',
    ok: !!wacli,
    detail: wacli ? await wacliStatus(wacli, searchPath) : 'Not installed',
    required: false,
    installUrl: 'https://github.com/MelloB1989/wacli',
  })

  const gog = await which('gog', searchPath)
  checks.push({
    id: 'gog',
    name: 'Google',
    purpose: 'Calendar, Gmail, Drive, Docs and Chat.',
    ok: !!gog,
    detail: gog ? await googleStatus(gog, searchPath) : 'Not installed',
    required: false,
    installUrl: 'https://github.com/openclaw/gogcli',
  })

  // Browsing is not a binary on PATH but a server registered inside Claude
  // Code, so it is asked about rather than looked for.
  const browsing = claude ? await mcpHasPlaywright(claude, searchPath) : false
  checks.push({
    id: 'playwright',
    name: 'Browsing',
    purpose: 'Lets the assistant open a real browser to read pages and fill things in.',
    ok: browsing,
    detail: !claude ? 'Needs Claude Code first' : browsing ? 'Ready' : 'Not set up',
    required: false,
  })

  const git = await which('git', searchPath)
  checks.push({
    id: 'git',
    name: 'git',
    purpose: 'Needed for automations that touch code.',
    ok: !!git,
    detail: git ? await version(git, ['--version'], searchPath) : 'Not installed',
    required: false,
  })

  // Whether this machine could install the missing ones without anybody
  // opening a terminal, so a screen can offer a button instead of a link.
  for (const check of checks) {
    if (check.ok) continue
    if (!(check.id in INSTALLS)) continue
    const how = installPlan(check.id as ToolId, searchPath)
    check.installable = how.ok
    if (!how.ok) check.needs = how.name
  }

  return checks
}

/** Whether Claude Code already knows how to browse. */
async function mcpHasPlaywright(claude: string, searchPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(claude, ['mcp', 'list'], {
      timeout: 15000,
      env: toolEnv(searchPath),
      encoding: 'utf8',
    })
    return /playwright/i.test(stdout)
  } catch {
    // An older Claude Code without `mcp list`, or one that is not signed in.
    // Either way we cannot say it is ready.
    return false
  }
}

async function version(bin: string, args: string[], searchPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: 6000,
      env: toolEnv(searchPath),
      encoding: 'utf8',
    })
    return firstLine(stdout || stderr) || 'Installed'
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    return firstLine(err.stdout || err.stderr || '') || 'Installed'
  }
}

/** How many Google accounts gog holds.
 *
 *  `gog auth status` describes the keyring and says nothing about whether
 *  anybody is signed in — it exits happily on a machine that has never
 *  authorized an account. The question worth answering is whether there is an
 *  account to act as. */
async function googleStatus(bin: string, searchPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, ['auth', 'list', '--json', '--no-input'], {
      timeout: 8000,
      env: toolEnv(searchPath),
      encoding: 'utf8',
    })
    const accounts = (JSON.parse(stdout) as { accounts?: { email?: string }[] }).accounts ?? []
    if (accounts.length === 0) return 'Installed, no account connected'
    if (accounts.length === 1) return `Connected: ${accounts[0].email ?? 'one account'}`
    return `Connected: ${accounts.length} accounts`
  } catch {
    return 'Installed'
  }
}

async function wacliStatus(bin: string, searchPath: string): Promise<string> {
  const out = await version(bin, ['status'], searchPath)
  const low = out.toLowerCase()
  if (low.includes('connected') || low.includes('logged in') || low.includes('ready')) {
    return 'Paired'
  }
  return out || 'Not paired'
}

function firstLine(s: string): string {
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
}

// ---------------------------------------------------------------------------
// Streamed commands. One at a time, cancellable, output pushed to the renderer.

export interface StreamChunk {
  id: string
  text: string
  done: boolean
  ok?: boolean
  /** Set when the command produced a QR image on disk, as a data URI. */
  image?: string
}

export class HostRunner extends EventEmitter {
  private current: ChildProcess | null = null
  private currentId: string | null = null
  private watch: NodeJS.Timeout | null = null

  busy(): string | null {
    return this.currentId
  }

  /** Run one known command. The list is closed on purpose: the renderer names
   *  an action, never a command line, so a compromised page cannot ask the
   *  main process to run something of its own devising. */
  start(id: string, searchPath: string): { ok: boolean; error?: string } {
    if (this.current) return { ok: false, error: 'Something else is already running.' }

    const recipes: Record<string, Step[]> = {
      // --skip-access-config: the login otherwise stops to ask which chats it
      // may touch, on a stdin this app deliberately does not give it.
      'whatsapp.pair': [{ bin: 'wacli', args: ['login', '--skip-access-config'] }],
      'whatsapp.status': [{ bin: 'wacli', args: ['status'] }],
      'whatsapp.logout': [{ bin: 'wacli', args: ['logout'] }],
      // No google.signin here on purpose: signing into Google is not one
      // command any more. It is a project, an OAuth client and a consent
      // screen, which is what the connect agent does — see connect.ts.
      'google.status': [{ bin: 'gog', args: ['auth', 'list', '--plain'] }],
      'claude.check': [{ bin: 'claude', args: ['--version'] }],
    }

    let steps = recipes[id]
    let opening = ''

    // Fetching a released binary is not a command line, so it does not go
    // through the recipe table — but it is the same kind of action to whoever
    // pressed the button, and it streams to the same window.
    if (!steps && id.startsWith('install.')) {
      const tool = id.slice('install.'.length)
      if (releaseFor(tool)) {
        this.currentId = id
        void this.fetch(id, tool, searchPath)
        return { ok: true }
      }
    }
    // An install is the same kind of thing — a named action with a fixed
    // command line — but which command line depends on what this machine has,
    // so it is resolved here rather than written in the table above.
    if (!steps && (id.startsWith('install.') || id.startsWith('build.'))) {
      const tool = id.replace(/^(install|build)\./, '') as ToolId
      if (!(tool in INSTALLS)) return { ok: false, error: `Unknown action: ${id}` }
      const how = installPlan(tool, searchPath)
      if (!how.ok) {
        return {
          ok: false,
          error: `${INSTALLS[tool].name} needs ${how.name} on this machine first.`,
        }
      }
      steps = how.steps
      opening = how.label + '…\n'
    }
    if (!steps || steps.length === 0) return { ok: false, error: `Unknown action: ${id}` }

    fs.mkdirSync(wacliHome(), { recursive: true })
    // A stale QR from a previous attempt is worse than none: it is a code that
    // silently will not scan.
    try {
      fs.rmSync(qrImagePath(), { force: true })
    } catch {
      // nothing to remove
    }

    this.currentId = id
    const push = (text: string) => this.emit('chunk', { id, text, done: false } as StreamChunk)
    if (opening) push(opening)

    const finish = (ok: boolean, text: string) => {
      if (this.watch) {
        clearInterval(this.watch)
        this.watch = null
      }
      this.current = null
      this.currentId = null
      this.emit('chunk', { id, text, done: true, ok } as StreamChunk)
    }

    // Steps run in sequence and stop at the first failure. An install that
    // registered a browser tool but could not fetch the browser has not
    // succeeded, and saying so beats a green tick over a half-done job.
    const runStep = (index: number) => {
      const step = steps[index]
      const child = spawn(step.bin, step.args, {
        env: toolEnv(searchPath),
        cwd: os.homedir(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.current = child

      child.stdout?.on('data', (b: Buffer) => push(b.toString()))
      child.stderr?.on('data', (b: Buffer) => push(b.toString()))
      child.on('error', (err) => finish(false, `Could not run ${step.bin}: ${err.message}`))
      child.on('exit', (code, signal) => {
        if (signal) return finish(false, 'Cancelled.')
        if (code !== 0) return finish(false, `Finished with exit code ${code}.`)
        if (index + 1 < steps.length) return runStep(index + 1)
        finish(true, 'Done.')
      })
    }

    // wacli writes a PNG next to its session when qrencode is available. It is
    // far easier to scan than the block-drawing version in the log.
    this.watch = setInterval(() => {
      try {
        const buf = fs.readFileSync(qrImagePath())
        if (buf.length > 0) {
          this.emit('chunk', {
            id,
            text: '',
            done: false,
            image: `data:image/png;base64,${buf.toString('base64')}`,
          } as StreamChunk)
          if (this.watch) clearInterval(this.watch)
          this.watch = null
        }
      } catch {
        // not written yet
      }
    }, 500)

    runStep(0)

    return { ok: true }
  }

  /** Download a released binary, then hand off to whatever comes after it.
   *
   *  Building from source stays as the fallback, because a platform the
   *  project has not built for is a real case and a Go toolchain is a real
   *  answer to it — just not the first thing to ask of somebody. */
  private async fetch(id: string, tool: string, searchPath: string): Promise<void> {
    const push = (text: string) => this.emit('chunk', { id, text, done: false } as StreamChunk)
    const finish = (ok: boolean, text: string) => {
      this.current = null
      this.currentId = null
      this.emit('chunk', { id, text, done: true, ok } as StreamChunk)
    }

    let result: { ok: boolean; error?: string }
    try {
      result = await fetchTool(tool, push)
    } catch (e) {
      result = { ok: false, error: (e as Error).message }
    }
    if (result.ok) {
      finish(true, 'Done.')
      return
    }

    // The download could not be had. Fall back to building it, which is what
    // this app did before releases were an option.
    push(`Could not fetch a released build (${result.error}). Building it instead…\n`)
    const how = installPlan(tool as ToolId, searchPath)
    if (!how.ok) {
      finish(false, `${INSTALLS[tool as ToolId]?.name ?? tool} needs ${how.name} on this machine first.`)
      return
    }
    this.currentId = null
    this.current = null
    const started = this.start(`build.${tool}`, searchPath)
    if (!started.ok) finish(false, started.error ?? 'Could not start the build.')
  }

  cancel(): void {
    if (!this.current) return
    try {
      this.current.kill('SIGTERM')
    } catch {
      // already gone
    }
  }
}

export const hostRunner = new HostRunner()

// ---------------------------------------------------------------------------
// Keeping WhatsApp connected.
//
// `wacli login` pairs the phone, pulls the history down, and exits — after
// which nothing is listening, so messages stop arriving and the engine's
// WhatsApp tools answer into a void. `wacli daemon` is what holds the
// connection open, and somebody who has just scanned a QR should not have to
// know that, let alone run it.
//
// Supervised here rather than in the engine on purpose: the engine talks to
// wacli over HTTP and has no business spawning host binaries, while this app
// is already the thing that starts processes and watches them. Same reason it
// owns the daemon it was built around.

export function wacliLogPath(): string {
  return path.join(wacliHome(), 'daemon.log')
}

/** Whether a wacli daemon is already answering on the port this app uses. */
async function wacliAnswering(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:8791/status', {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Start the WhatsApp connection if it is not already up.
 *
 *  Detached, so closing the window does not close WhatsApp — the same promise
 *  this app makes about the assistant itself. Idempotent: called after a
 *  pairing, and again whenever the app starts. */
export async function ensureWacliDaemon(searchPath: string): Promise<{ running: boolean; error?: string }> {
  if (await wacliAnswering()) return { running: true }

  const bin = await which('wacli', searchPath)
  if (!bin) return { running: false, error: 'WhatsApp is not installed on this machine yet.' }

  // No session, nothing to connect. Starting the daemon anyway would sit there
  // logging that it is not logged in.
  const status = await wacliStatus(bin, searchPath)
  if (!/paired|connected|logged in|ready/i.test(status)) {
    return { running: false, error: 'WhatsApp is not paired on this machine yet.' }
  }

  fs.mkdirSync(wacliHome(), { recursive: true })
  const log = fs.openSync(wacliLogPath(), 'a')
  const child = spawn(bin, ['daemon'], {
    env: toolEnv(searchPath),
    cwd: os.homedir(),
    detached: true,
    stdio: ['ignore', log, log],
  })
  child.unref()

  // Give it a moment to bind before reporting, so "connected" is something we
  // observed rather than something we hope for.
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 700))
    if (await wacliAnswering()) return { running: true }
  }
  return { running: false, error: 'WhatsApp started but is not answering yet.' }
}

/** What to show beside WhatsApp: connected, paired but idle, or neither. */
export async function wacliState(searchPath: string): Promise<{ paired: boolean; connected: boolean }> {
  const bin = await which('wacli', searchPath)
  if (!bin) return { paired: false, connected: false }
  const status = await wacliStatus(bin, searchPath)
  return {
    paired: /paired|connected|logged in|ready/i.test(status),
    connected: await wacliAnswering(),
  }
}
