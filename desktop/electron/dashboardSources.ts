// The fixed vocabulary a dashboard page may use to ask for data: a file its
// own agent wrote, or one of a closed list of read-only live sources.
//
// Kept free of electron and network imports so the rules — and the one that
// matters most, that a page can only read the live sources its own agent
// declared — can be checked without a running engine.

/** The engine's own id shape (`dashboard save`'s `id`). `_default` is not a
 *  real dashboard and is checked for separately everywhere below. */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const DATA_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const LIVE_SOURCES = [
  'engine',
  'tasks',
  'brain',
  'activity',
  'loops',
  'loop-health',
  'notifications',
  'memory',
  'logs',
] as const

export type LiveSource = (typeof LIVE_SOURCES)[number]

export function isLiveSource(name: string): name is LiveSource {
  return (LIVE_SOURCES as readonly string[]).includes(name)
}

export function isValidId(id: string): boolean {
  return id === '_default' || ID_RE.test(id)
}

/** `_default` ships with the app; nothing this bridge does may delete it. */
export function isRemovableId(id: string): boolean {
  return id !== '_default' && ID_RE.test(id)
}

export type ParsedSource = { kind: 'data'; name: string } | { kind: 'live'; name: string }

/** What a `source` argument to `dashboards.data(id, source)` means: a data
 *  file (a plain name) or a live source (`live:<name>`). Neither branch
 *  accepts a path — a source names a file or a feed, never a place on disk. */
export function parseSource(source: string): ParsedSource | null {
  if (source.startsWith('live:')) {
    const name = source.slice('live:'.length)
    return name ? { kind: 'live', name } : null
  }
  return DATA_NAME_RE.test(source) ? { kind: 'data', name: source } : null
}

/** Whether a dashboard may read a given live source right now. `_default` is
 *  the kit's own page and gets all of them; any other dashboard only what its
 *  agent listed in `live` when it saved the page — an agent decides what its
 *  own dashboard can see, not this file. */
export function liveSourceAllowed(id: string, name: string, declaredLive: readonly string[]): boolean {
  if (!isLiveSource(name)) return false
  return id === '_default' || declaredLive.includes(name)
}
