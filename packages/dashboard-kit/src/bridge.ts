// The page's one line to the app.
//
// The frame has no network and no origin of its own, so the only way data gets
// in is a message to the parent window, answered by the app from the engine or
// its fixed list of live sources. Every message carries `lz: 1`, and only
// messages from the parent itself are believed: anything else in the page
// could post a message too.
import { parseSource, pick, sourceKey, type SourceRef } from './source.ts'

type Reply = { ok: boolean; value?: unknown; error?: string }
type Listener = (detail?: unknown) => void
export type RefreshScope = 'data' | 'live'

const TIMEOUT_MS = 20_000
export const LIVE_EVERY_MS = 15_000

const pending = new Map<number, (reply: Reply) => void>()
const cache = new Map<string, Promise<unknown>>()
const listeners = new Map<string, Set<Listener>>()
let rid = 0
let mock: Record<string, unknown> | null = null
let context: unknown = null

export function on(event: 'refresh' | 'context' | 'theme', fn: Listener): () => void {
  let set = listeners.get(event)
  if (!set) listeners.set(event, (set = new Set()))
  set.add(fn)
  return () => set.delete(fn)
}

function emit(event: string, detail?: unknown) {
  for (const fn of listeners.get(event) ?? []) {
    try {
      fn(detail)
    } catch (e) {
      console.error(e)
    }
  }
}

/** Data to use instead of the app's: for previewing a page outside a
 *  dashboard, and for tests. Keys are file names and `live:` names. */
export function useMock(data: Record<string, unknown>) {
  mock = data
  cache.clear()
  emit('refresh', 'data')
  emit('refresh', 'live')
}

export const getContext = () => context

const inFrame = () => typeof window !== 'undefined' && window.parent !== window

function ask(key: string): Promise<unknown> {
  if (mock) {
    return key in mock ? Promise.resolve(mock[key]) : Promise.reject(new Error(`No mock data for ${key}`))
  }
  if (!inFrame()) return Promise.reject(new Error('This page is not open in a dashboard.'))
  return new Promise((resolve, reject) => {
    const id = ++rid
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${key} took too long to arrive.`))
    }, TIMEOUT_MS)
    pending.set(id, (reply) => {
      clearTimeout(timer)
      if (reply.ok) resolve(reply.value)
      else reject(new Error(reply.error || `${key} could not be read.`))
    })
    window.parent.postMessage({ lz: 1, type: 'data', rid: id, source: key }, '*')
  })
}

function fetchKey(key: string): Promise<unknown> {
  let hit = cache.get(key)
  if (!hit) {
    hit = ask(key)
    cache.set(key, hit)
    // A failure is not remembered: the next refresh should try again.
    hit.catch(() => cache.delete(key))
  }
  return hit
}

export async function read(ref: SourceRef): Promise<unknown> {
  return pick(await fetchKey(sourceKey(ref)), ref.path)
}

/** `lz.data('orders.by_day')`: the value a source names. */
export function data(source: string): Promise<unknown> {
  const ref = parseSource(source)
  if (!ref) return Promise.reject(new Error(`"${source}" is not a source name.`))
  return read(ref)
}

export function invalidate(scope: RefreshScope) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith('live:') === (scope === 'live')) cache.delete(key)
  }
  emit('refresh', scope)
}

/** Opens a web address in the browser, through the app. Nothing else leaves. */
export function open(url: string) {
  if (!/^https:\/\//i.test(url)) return
  if (inFrame()) window.parent.postMessage({ lz: 1, type: 'open', url }, '*')
}

/** A beat that does not keep a test process, or anything else, alive. */
export function unref(timer: unknown) {
  ;(timer as { unref?: () => void } | null)?.unref?.()
}

let started = false

export function start() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent || !e.data || e.data.lz !== 1) return
    const msg = e.data as { type: string; rid?: number; theme?: string; scope?: RefreshScope; dashboard?: unknown } & Reply
    switch (msg.type) {
      case 'data': {
        const done = pending.get(Number(msg.rid))
        if (done) {
          pending.delete(Number(msg.rid))
          done({ ok: msg.ok, value: msg.value, error: msg.error })
        }
        return
      }
      case 'refresh':
        invalidate(msg.scope === 'live' ? 'live' : 'data')
        return
      case 'theme':
        if (msg.theme === 'dark' || msg.theme === 'light') {
          document.documentElement.dataset.theme = msg.theme
          emit('theme', msg.theme)
        }
        return
      case 'context':
        context = msg.dashboard ?? null
        emit('context', context)
        return
    }
  })
  // Live sources are the app's state, which changes without telling anyone;
  // the page asks again on a beat, but only while something is watching one.
  unref(
    setInterval(() => {
      if ([...cache.keys()].some((k) => k.startsWith('live:'))) invalidate('live')
    }, LIVE_EVERY_MS),
  )
  if (inFrame()) window.parent.postMessage({ lz: 1, type: 'ready' }, '*')
}
