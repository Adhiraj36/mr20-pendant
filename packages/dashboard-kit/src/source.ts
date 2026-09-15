// What a `source` attribute names, and how to reach into the value it names.
//
//   orders              the dashboard's data file "orders"
//   orders.by_day       the "by_day" key inside it
//   dms.recent.0.user   array indexes are plain numbers
//   live:activity.items a live source the app resolves, then a path into it
//
// Only dots: a path is typed by an agent into an attribute, and the one form it
// cannot get wrong is the one with nothing to escape.
export type SourceRef = { live: boolean; name: string; path: (string | number)[] }

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function parseSource(raw: string | null | undefined): SourceRef | null {
  let text = (raw ?? '').trim()
  if (!text) return null
  const live = text.startsWith('live:')
  if (live) text = text.slice(5)
  const segments = text.split('.')
  const name = segments.shift() ?? ''
  if (!NAME.test(name) || segments.some((s) => s === '')) return null
  return { live, name, path: segments.map((s) => (/^\d+$/.test(s) ? Number(s) : s)) }
}

/** The key the app is asked for: the file or live source, never the path. */
export const sourceKey = (ref: SourceRef): string => (ref.live ? `live:${ref.name}` : ref.name)

export function pick(value: unknown, path: (string | number)[]): unknown {
  let at: unknown = value
  for (const key of path) {
    if (at === null || at === undefined) return undefined
    if (Array.isArray(at) && typeof key === 'number') at = at[key]
    else if (typeof at === 'object') at = (at as Record<string, unknown>)[String(key)]
    else return undefined
  }
  return at
}

/** Nothing to draw: missing, or an empty list, object or string. */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}
