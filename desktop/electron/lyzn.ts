// LYZN, as this app talks to it.
//
// The desktop app is a LYZN product, so unlike the engine it may hold a LYZN
// credential of its own: a machine pairs by typing six characters from the
// phone, and gets back a token bound to that machine. That token lives here in
// the main process and never reaches the renderer — the page asks for tickets,
// never for the thing that fetches them, which is the same rule the engine's
// API token follows.
//
// The engine knows nothing about any of this. Its half of the integration is a
// loop, configured with a token of its own; nothing in KARMAX is compiled
// against LYZN. What this file gives the window is the ability to *show* the
// work, which is a LYZN product's business rather than an engine's.
import os from 'node:os'
import type { ApiResult } from './shared/types.js'
import { readState, writeState } from './profile.js'
import { disarm as disarmLoop, install as installLoop, state as loopState } from './loops.js'
import { setMemorySettings } from './config.js'
import { callTool } from './api.js'

/** Where LYZN answers. CloudFront in front of the API. */
const DEFAULT_API = 'https://api.lyzn.ai'

export interface LyznPairing {
  /** The machine's bearer token. Handed back once, at the end of a claim. */
  token: string
  daemonId: string
  name: string
  api: string
  pairedAt: string
  /** What the account was allowed to do when we last asked. Refreshed on
   *  every heartbeat, because a plan can lapse while a machine sits paired. */
  plan?: PlanView
}

/** A machine's own way into the memory layer, handed over when it pairs. */
export interface MemoryGrant {
  apiKey: string
  namespace: string
  baseUrl: string
}

/** What LYZN says this account may do. */
export interface PlanView {
  tier: string
  automation: boolean
  status: string
  /** The sentence to show when automation is false. Printed, never parsed. */
  why: string
}

export function pairing(): LyznPairing | null {
  return readState().lyzn ?? null
}

function api(): string {
  return (pairing()?.api || process.env.LYZN_API || DEFAULT_API).replace(/\/+$/, '')
}

async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  token?: string,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(api() + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
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
      const error = (data as { error?: string } | null)?.error
      return { ok: false, status: res.status, data: null, error: error ?? `LYZN answered ${res.status}.` }
    }
    return { ok: true, status: res.status, data: data as T, error: null }
  } catch {
    return { ok: false, status: 0, data: null, error: 'Could not reach LYZN. Check the network.' }
  }
}

/** The alphabet LYZN mints codes from: no I, O, 0 or 1, because this is read
 *  off a phone and typed into a laptop. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** What somebody typed, turned into what was minted. The server normalises the
 *  same way; this is the check that happens while the code is still on screen. */
export function normaliseCode(raw: string): string | null {
  const clean = (raw ?? '')
    .toUpperCase()
    .split('')
    .filter((c) => c !== ' ' && c !== '-' && c !== '_')
    .join('')
  if (clean.length !== 6) return null
  for (const c of clean) if (!CODE_ALPHABET.includes(c)) return null
  return clean
}

/** Redeem a code. Single use: it is spent by being presented. */
export async function pair(rawCode: string): Promise<{
  ok: boolean
  error?: string
  name?: string
  plan?: PlanView
  loop?: boolean
  loopError?: string
  memory?: boolean
}> {
  const code = normaliseCode(rawCode)
  if (!code) {
    return { ok: false, error: 'A pairing code is six characters from the app.' }
  }

  const res = await call<{
    daemonId: string
    token: string
    name: string
    plan?: PlanView
    memory?: MemoryGrant | null
  }>(
    'POST',
    '/daemons/claim',
    {
      code,
      name: os.hostname(),
      hostname: os.hostname(),
      os: `${process.platform}/${process.arch}`,
      version: process.env.npm_package_version ?? 'desktop',
      capabilities: ['lyzn-desktop'],
    },
  )
  if (!res.ok || !res.data?.token) {
    return { ok: false, error: res.error ?? 'That code was not accepted.' }
  }

  const state = readState()
  writeState({
    ...state,
    lyzn: {
      token: res.data.token,
      daemonId: res.data.daemonId,
      name: res.data.name || os.hostname(),
      api: api(),
      pairedAt: new Date().toISOString(),
      plan: res.data.plan,
    },
  })

  // Signing in is the install step. The loop is what actually does the work,
  // it cannot get itself a token, and leaving that to a person editing YAML is
  // the thing this app exists to avoid.
  // Memory is GitLoom, always, and the key is this person's alone — scoped to
  // their namespace and to nothing else on the account. Written before the
  // loop, because a machine that starts working without its memory is doing
  // the work with half of what it knows.
  const memory = res.data.memory ? applyMemory(res.data.memory) : false

  const wrote = installLoop(res.data.token, api())
  return {
    memory,
    ok: true,
    name: res.data.name,
    plan: res.data.plan,
    loop: wrote.ok,
    loopError: wrote.ok ? undefined : wrote.error,
  }
}

/** Point the engine's memory at this person's namespace in GitLoom.
 *
 *  Never local. A memory that lives in a file on one laptop is a memory that
 *  disagrees with the phone, cannot be read by a second machine, and vanishes
 *  with the disk — and the whole product is that what you said is remembered.
 */
export function applyMemory(grant: MemoryGrant): boolean {
  try {
    setMemorySettings({
      apiKey: grant.apiKey,
      namespace: grant.namespace,
      baseUrl: grant.baseUrl,
    })
    return true
  } catch {
    return false
  }
}

/** Ask LYZN for a fresh memory credential.
 *
 *  For the machine that lost one: a reinstall, or a mint that failed while the
 *  network was down. The old key is revoked as its replacement is issued. */
export async function refreshMemory(): Promise<{ ok: boolean; error?: string }> {
  const p = pairing()
  if (!p) return { ok: false, error: 'This machine is not signed in to LYZN.' }
  const res = await call<MemoryGrant>('POST', '/daemons/memory', undefined, p.token)
  if (!res.ok || !res.data) {
    return { ok: false, error: res.error ?? 'LYZN could not issue a memory key.' }
  }
  return { ok: applyMemory(res.data) }
}

/** Forget the pairing on this machine. The row stays on the account until it
 *  is unpaired from the phone, which is where revocation belongs. */
export function unpair(): void {
  const state = readState()
  writeState({ ...state, lyzn: undefined })
  // The loop stays, holding no token: it logs one line saying this machine is
  // not signed in, which is a better thing to find than a missing file.
  disarmLoop()
}

/** Whether the loop is installed and carrying a token. */
export function loop(): ReturnType<typeof loopState> {
  return loopState()
}

export interface Ticket {
  taskId: string
  text: string
  kind: string
  quote: string
  dueAt: string
  createdAt: string
  status: string
  mine: boolean
  claimedAt: string
  finishedAt: string
  context: { title: string; summary: string; facts: { text: string; kind: string }[] }
  question?: {
    id: string
    text: string
    options?: string[]
    askedBy: string
    askedAt: string
    expiresAt: string
    answer?: string
    answeredAt?: string
    answeredBy?: string
  } | null
  receipt: {
    receiptId: string
    title: string
    stamp: string
    quote?: string
    rows?: { k: string; v: string; ok?: boolean }[]
    createdAt?: string
  } | null
}

export interface Tickets {
  waiting: Ticket[]
  running: Ticket[]
  finished: Ticket[]
  blocked?: Ticket[]
}

/** The three states, as the window shows them. */
export async function tickets(): Promise<ApiResult<Tickets>> {
  const p = pairing()
  if (!p) {
    return { ok: false, status: 0, data: null, error: 'This machine is not paired with LYZN yet.' }
  }
  return call<Tickets>('GET', '/daemons/history?limit=40', undefined, p.token)
}

/** Answer the question one of this machine's tasks is parked on.
 *
 *  Only its own: LYZN refuses a machine answering for a task another machine
 *  asked about, and the phone is where those are answered. */
export async function answerTask(taskId: string, answer: string): Promise<{ ok: boolean; error?: string }> {
  const p = pairing()
  if (!p) return { ok: false, error: 'This machine is not paired with LYZN yet.' }
  if (!TASK_ID_RE.test(taskId)) return { ok: false, error: 'That is not a task this machine knows.' }
  const text = answer.trim()
  if (!text) return { ok: false, error: 'Write an answer first.' }
  const res = await call('POST', `/daemons/work/${taskId}/answer`, { answer: text.slice(0, 400), by: 'desktop' }, p.token)
  if (res.ok) return { ok: true }
  if (res.status === 409) {
    return { ok: false, error: 'That question is no longer open. It may already have been answered on your phone.' }
  }
  return { ok: false, error: res.error ?? 'LYZN did not take that answer. Try again.' }
}

/** A heartbeat, so the phone's list shows this machine as awake while its
 *  window is open. Cheap, and it is what makes "online" mean anything. */
export async function beat(): Promise<void> {
  const p = pairing()
  if (!p) return
  const res = await call<{ plan?: PlanView }>(
    'POST',
    '/daemons/heartbeat',
    { status: 'online', capabilities: ['lyzn-desktop'] },
    p.token,
  )
  // A plan can lapse while a machine sits paired, and the beat is the cheapest
  // place to notice.
  if (res.ok && res.data?.plan) {
    const state = readState()
    if (state.lyzn) writeState({ ...state, lyzn: { ...state.lyzn, plan: res.data.plan } })
  }
}

// ---------------------------------------------------------------------------
// Stopping a running task.
//
// A taskId ends up in a URL path and in `session_id`/`working_dir`, both of
// which the engine treats as identifiers rather than data — so it is checked
// against a fixed alphabet before it touches either.
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

/** What the answer looks like when this machine's own write is the one that
 *  closed the task: outcome "failure", this exact summary. The endpoint is
 *  idempotent and answers a repeat with whatever closed the task first —
 *  which means this is also the only way to tell "I just closed it" from
 *  "it was already closed": the receipt either is this one, or it isn't. */
const STOP_SUMMARY = 'Stopped from the laptop.'

export interface StopOutcome {
  ok: boolean
  /** The engine had already killed the run (or there was nothing to kill)
   *  before LYZN could be told. Set whenever step 1 succeeded, whether or
   *  not step 2 did. */
  stopped?: boolean
  /** Whether a process group was actually in flight to kill. */
  wasRunning?: boolean
  /** The task was already closed — by an earlier stop, or because it
   *  finished on its own — before this call reached LYZN. */
  alreadyFinished?: boolean
  error?: string
}

interface WorkResultAnswer {
  receipt?: { stamp?: string; quote?: string } | null
}

/** stopTask's dependencies, swappable so a test can drive it without a real
 *  engine or a real LYZN. Each defaults to this file's own machinery. */
export interface StopTaskDeps {
  callTool?: <T = unknown>(name: string, args: unknown) => Promise<ApiResult<T>>
  request?: <T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    token?: string,
  ) => Promise<ApiResult<T>>
  pairing?: () => LyznPairing | null
}

/** Stop a running task: the engine first, LYZN second.
 *
 *  That order, always. A crash between the two steps leaves the run dead
 *  either way; the other order can leave LYZN believing a task failed while
 *  Claude Code is still changing files for it. Both steps are safe to repeat
 *  — harness.stop finds nothing running the second time, and the result post
 *  finds the task already closed — so a step-2 failure is recoverable by
 *  just trying again. */
export async function stopTask(taskId: string, deps: StopTaskDeps = {}): Promise<StopOutcome> {
  const doCallTool = deps.callTool ?? callTool
  const doRequest = deps.request ?? call
  const doPairing = deps.pairing ?? pairing

  if (!TASK_ID_RE.test(taskId)) {
    return { ok: false, error: 'That does not look like a task id.' }
  }

  const p = doPairing()
  if (!p) {
    return { ok: false, error: 'This machine is not paired with LYZN yet.' }
  }

  const stopRes = await doCallTool<{ ok: boolean; output?: { was_running?: boolean } }>('harness.stop', {
    session_id: `lyzn:${taskId}`,
    working_dir: `lyzn-tasks/${taskId}`,
  })
  if (!stopRes.ok || !stopRes.data?.ok) {
    return { ok: false, error: "The engine isn't running. Start it and try again." }
  }
  const wasRunning = Boolean(stopRes.data.output?.was_running)

  const resultRes = await doRequest<WorkResultAnswer>(
    'POST',
    `/daemons/work/${encodeURIComponent(taskId)}/result`,
    { outcome: 'failure', summary: STOP_SUMMARY },
    p.token,
  )
  if (!resultRes.ok) {
    return {
      ok: false,
      stopped: true,
      wasRunning,
      error: "Stopped here, but LYZN wasn't told. Try again.",
    }
  }

  const receipt = resultRes.data?.receipt
  const alreadyFinished = !(receipt?.stamp === 'FAILED' && receipt?.quote === STOP_SUMMARY)

  return { ok: true, wasRunning, alreadyFinished }
}
