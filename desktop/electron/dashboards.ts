// The lyzn-dash:// scheme: what turns an agent's dashboard into something the
// sandboxed frame can load with no network of its own, plus the read-only
// live sources a dashboard's data channel can reach.
//
// Registered in two halves because Electron requires it — the scheme's
// privileges before the app is ready, the handler after — see main.ts.
import { app, protocol } from 'electron'
import fs from 'node:fs'
import type { DashboardMeta } from './shared/types.js'
import { api, callTool } from './api.js'
import { daemon } from './daemon.js'
import { pairing as lyznPairing, tickets as lyznTickets } from './lyzn.js'
import { buildDashboardDocument, DASHBOARD_CSP } from './dashboardDocument.js'
import { resolveDefaultPage, resolveKitFile } from './dashboardPaths.js'
import { isLiveSource, isValidId, liveSourceAllowed } from './dashboardSources.js'

export function registerDashboardSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'lyzn-dash',
      privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false },
    },
  ])
}

function documentResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': DASHBOARD_CSP },
  })
}

/** A message with no kit dependency: this is the one document that has to
 *  render even when the kit itself failed to build. */
function smallDocument(message: string): string {
  return buildDashboardDocument(
    '<div style="display:flex;height:100vh;align-items:center;justify-content:center;' +
      'font:14px -apple-system,system-ui,sans-serif;color:#666;text-align:center;padding:24px;">' +
      `${message}</div>`,
  )
}

async function serveKit(reqPath: string): Promise<Response> {
  const found = resolveKitFile(app.getAppPath(), reqPath)
  if (!found) return new Response('Not found', { status: 404 })
  try {
    return new Response(fs.readFileSync(found.path), { status: 200, headers: { 'Content-Type': found.contentType } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

// Dashboard metadata, briefly cached: the declared-live check below asks for
// it on every `data(id, 'live:...')` call, and the kit's own poll (15s by
// spec) would otherwise mean one extra round trip to the engine per tick.
const metaCache = new Map<string, { meta: DashboardMeta; at: number }>()
const META_TTL_MS = 5000

function cacheMeta(id: string, meta: DashboardMeta): void {
  metaCache.set(id, { meta, at: Date.now() })
}

async function getDashboardMeta(id: string): Promise<DashboardMeta | null> {
  const hit = metaCache.get(id)
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta
  const res = await api<{ dashboard: DashboardMeta; html: string }>('GET', `/api/dashboards/${encodeURIComponent(id)}`)
  if (!res.ok || !res.data?.dashboard) return null
  cacheMeta(id, res.data.dashboard)
  return res.data.dashboard
}

async function servePage(rawId: string, theme: 'light' | 'dark'): Promise<Response> {
  let id: string
  try {
    id = decodeURIComponent(rawId)
  } catch {
    return documentResponse(smallDocument('This dashboard no longer exists.'), 404)
  }

  if (id === '_default') {
    const file = resolveDefaultPage(app.getAppPath())
    if (!file) return documentResponse(smallDocument('The default dashboard is missing from this build.'))
    try {
      return documentResponse(buildDashboardDocument(fs.readFileSync(file, 'utf8'), theme))
    } catch {
      return documentResponse(smallDocument('The default dashboard is missing from this build.'))
    }
  }

  if (!isValidId(id)) return documentResponse(smallDocument('This dashboard no longer exists.'), 404)

  const res = await api<{ dashboard: DashboardMeta; html: string }>('GET', `/api/dashboards/${encodeURIComponent(id)}`)
  if (!res.ok || !res.data?.html) {
    return documentResponse(smallDocument('This dashboard no longer exists.'), 404)
  }
  cacheMeta(id, res.data.dashboard)
  return documentResponse(buildDashboardDocument(res.data.html, theme))
}

export function registerDashboardProtocol(): void {
  protocol.handle('lyzn-dash', (request) => {
    const url = new URL(request.url)
    const reqPath = url.pathname.replace(/^\/+/, '')
    if (url.host === 'kit') return serveKit(reqPath)
    // The window's theme at first paint, so a dark window never flashes a
    // light page before the channel says otherwise.
    if (url.host === 'page') return servePage(reqPath, url.searchParams.get('theme') === 'dark' ? 'dark' : 'light')
    return Promise.resolve(new Response('Not found', { status: 404 }))
  })
}

/** Whether a dashboard may read a given live source right now: `_default`
 *  gets all of them; anything else only what its own agent declared. */
export async function dashboardLiveAllowed(id: string, name: string): Promise<boolean> {
  if (id === '_default') return isLiveSource(name)
  const meta = await getDashboardMeta(id)
  return liveSourceAllowed(id, name, meta?.live ?? [])
}

/** The fixed, read-only sources a dashboard's data channel can reach — each
 *  the exact path the rest of the app already reads, so a custom dashboard
 *  cannot show a different answer than the screens built from the same data. */
export async function readLiveSource(name: string): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  if (!isLiveSource(name)) return { ok: false, error: `${name} is not a live source.` }

  switch (name) {
    case 'engine':
      return { ok: true, value: daemon.status() }
    case 'tasks': {
      if (!lyznPairing()) return { ok: true, value: { paired: false } }
      const res = await lyznTickets()
      return res.ok
        ? { ok: true, value: { paired: true, ...res.data } }
        : { ok: false, error: res.error ?? 'Could not read your promises.' }
    }
    case 'brain': {
      // The same call the Dashboard screen's brain card makes, so a custom
      // dashboard cannot disagree with it about whether the brain is up.
      const res = await callTool<{ ok: boolean; output: unknown }>('harness.list', {})
      return res.ok
        ? { ok: true, value: res.data?.output ?? null }
        : { ok: false, error: res.error ?? 'Could not read the brain.' }
    }
    case 'activity': {
      const res = await api('GET', '/api/activity')
      return res.ok ? { ok: true, value: res.data } : { ok: false, error: res.error ?? 'Could not read activity.' }
    }
    case 'loops': {
      const res = await api('GET', '/api/loops')
      return res.ok ? { ok: true, value: res.data } : { ok: false, error: res.error ?? 'Could not read loops.' }
    }
    case 'loop-health': {
      const res = await api('GET', '/api/loops/health')
      return res.ok
        ? { ok: true, value: res.data }
        : { ok: false, error: res.error ?? 'Could not read loop health.' }
    }
    case 'notifications': {
      const res = await api('GET', '/api/notifications')
      return res.ok
        ? { ok: true, value: res.data }
        : { ok: false, error: res.error ?? 'Could not read notifications.' }
    }
    case 'memory': {
      // A glance, not the Memory screen's own search — 20 is enough for a
      // card and cheap enough for the kit to poll every few seconds.
      const res = await api('GET', '/api/memory/entries?limit=20')
      return res.ok ? { ok: true, value: res.data } : { ok: false, error: res.error ?? 'Could not read memory.' }
    }
    case 'logs':
      return { ok: true, value: daemon.recentLogs().slice(-200) }
  }
}

/** Teach the engine's dashboard tool about the kit's elements, so an agent
 *  asking `dashboard components` gets real reference instead of the fallback
 *  telling it to write plain HTML. Best-effort: an older engine 404s the
 *  route, and that is not something to bother anyone about. */
export async function installKitReference(): Promise<void> {
  const found = resolveKitFile(app.getAppPath(), 'REFERENCE.md')
  if (!found) return
  let text: string
  try {
    text = fs.readFileSync(found.path, 'utf8')
  } catch {
    return
  }
  const res = await api('PUT', '/api/dashboards/_kit/reference', text)
  if (!res.ok && res.status !== 404) {
    console.error(`installKitReference: ${res.error ?? `HTTP ${res.status}`}`)
  }
}
