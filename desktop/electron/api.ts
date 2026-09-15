// Talking to the daemon.
//
// Both tokens live in the main process and never reach the renderer. The UI
// asks for a path; it cannot ask for a credential. That is the only reason it
// is safe to give a web page a bearer token that can invoke shell.exec.
import type { ApiResult } from './shared/types.js'
import { engineTarget, readState } from './profile.js'
import { readSettings, configExists } from './config.js'

function ports() {
  if (!configExists()) return { api: 0, console: 0 }
  const s = readSettings().ports
  return { api: s.api, console: s.console }
}

/** Where the engine answers, and with what credential.
 *
 *  A remote engine has its own token and its own ports, and this app has no
 *  config file of its own to read them from — so they come from the setting
 *  somebody typed rather than from the local YAML. */
function apiTarget(): { base: string; token: string } {
  const target = engineTarget()
  if (target.remote) return { base: target.apiBase, token: target.token }
  const p = ports().api
  return { base: p ? `http://127.0.0.1:${p}` : '', token: readState().apiToken }
}

function consoleBase(): string {
  const target = engineTarget()
  if (target.remote) return target.consoleBase
  const p = ports().console
  return p ? `http://127.0.0.1:${p}` : ''
}

async function request<T>(
  base: string,
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 30_000,
): Promise<ApiResult<T>> {
  if (!base) {
    return { ok: false, status: 0, data: null, error: 'KARMAX is not set up yet.' }
  }
  try {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!res.ok) {
      const err =
        (data as { error?: string } | null)?.error ??
        (typeof data === 'string' ? data : `HTTP ${res.status}`)
      return { ok: false, status: res.status, data: data as T, error: err }
    }
    return { ok: true, status: res.status, data: data as T, error: null }
  } catch (e) {
    const msg = (e as Error).name === 'TimeoutError' ? 'The engine did not answer in time.' : (e as Error).message
    return { ok: false, status: 0, data: null, error: msg }
  }
}

/** The phone-app API: chat, memory, loops, tools. Bearer token. */
export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<ApiResult<T>> {
  const { base, token } = apiTarget()
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  // A raw string body is sent as-is: the dashboard reference install PUTs
  // Markdown, and JSON.stringify-ing a string would hand the engine a quoted,
  // escaped blob instead of the text it asked for.
  if (typeof body === 'string') headers['Content-Type'] = 'text/plain; charset=utf-8'
  return request<T>(base, method, path, body, headers, timeoutMs)
}

/** A request whose body is read as it arrives rather than all at once.
 *
 *  The connect endpoint narrates for minutes: what it is doing, and the moment
 *  it needs somebody to click something. Buffering that until the end would
 *  turn a progress stream into a transcript delivered after the fact, which is
 *  the one thing it must not be. */
export async function apiStream(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error: string | null; body: ReadableStream<Uint8Array> | null }> {
  const { base, token } = apiTarget()
  if (!base) return { ok: false, error: 'KARMAX is not set up yet.', body: null }
  try {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      return { ok: false, error: (await res.text()) || `HTTP ${res.status}`, body: null }
    }
    return { ok: true, error: null, body: res.body }
  } catch (e) {
    return { ok: false, error: (e as Error).message, body: null }
  }
}

/** Tool calls get a long window: some of them delegate to a coding harness. */
export function callTool<T = unknown>(name: string, args: unknown): Promise<ApiResult<T>> {
  return api<T>('POST', `/api/tools/${encodeURIComponent(name)}`, args ?? {}, 300_000)
}

// ---------------------------------------------------------------------------
// The console API, which has human accounts rather than one shared secret.
//
// A desktop app has exactly one human and no login screen worth showing them,
// so the app holds an account of its own: created on first contact, logged in
// on demand, and re-logged-in whenever the session expires. The password is
// random and stored beside the profile — it exists to satisfy the server's
// model, not to be typed by anyone.

let sessionToken: string | null = null

async function ensureSession(): Promise<string | null> {
  if (sessionToken) return sessionToken
  const base = consoleBase()
  if (!base) return null
  const state = readState()
  const creds = state.console
  if (!creds) return null

  const status = await request<{ needs_bootstrap: boolean }>(
    base,
    'GET',
    '/api/console/auth/bootstrap-status',
    undefined,
    {},
  )
  if (!status.ok) return null

  const path = status.data?.needs_bootstrap ? '/api/console/auth/bootstrap' : '/api/console/auth/login'
  const body = status.data?.needs_bootstrap
    ? { name: 'Owner', member: creds.member, password: creds.password }
    : { member: creds.member, password: creds.password }

  const res = await request<{ token: string }>(base, 'POST', path, body, {})
  if (!res.ok || !res.data?.token) return null
  sessionToken = res.data.token
  return sessionToken
}

export function dropSession(): void {
  sessionToken = null
}

export async function consoleApi<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const base = consoleBase()
  if (!base) return { ok: false, status: 0, data: null, error: 'The engine is not set up yet.' }

  const token = await ensureSession()
  if (!token) {
    return { ok: false, status: 0, data: null, error: 'Could not sign in to the engine.' }
  }
  let res = await request<T>(base, method, path, body, { Authorization: `Bearer ${token}` })
  if (res.status === 401) {
    // The session outlived its TTL, or the daemon restarted with a fresh store.
    // One silent retry, because an expired token is not something a desktop
    // user should ever be asked about.
    dropSession()
    const fresh = await ensureSession()
    if (!fresh) return res
    res = await request<T>(base, method, path, body, { Authorization: `Bearer ${fresh}` })
  }
  return res
}
