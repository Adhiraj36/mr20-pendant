// A chart's data, whatever shape the agent handed over, as categories and
// series. Pure, so the shape rules are tested without drawing anything.
export type Series = { key: string; name: string; slot: number; values: (number | null)[] }
export type ChartModel = { categories: string[]; rawCategories: unknown[]; series: Series[]; folded: number }

/** Five colours exist, and a sixth series is never a repeated or invented
 *  colour: past five, the rest fold into one "Other" series. */
export const MAX_SERIES = 5

type Rec = Record<string, unknown>

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

const splitList = (raw: string | null) =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function buildModel(
  value: unknown,
  opts: { x?: string | null; y?: string | null; series?: string | null; labels?: string | null },
): ChartModel {
  let rows: Rec[] = []
  if (Array.isArray(value)) {
    rows = value.map((r, i) => (r && typeof r === 'object' ? (r as Rec) : { x: i + 1, value: r }))
  } else if (value && typeof value === 'object') {
    // { "Mon": 3, "Tue": 5 } reads as one series over the keys.
    rows = Object.entries(value as Rec).map(([k, v]) => ({ x: k, value: v }))
  }
  if (rows.length === 0) return { categories: [], rawCategories: [], series: [], folded: 0 }

  const sample = rows[0]
  const xKey =
    opts.x ?? ['x', 'date', 'day', 'label', 'name', 'month', 'week', 'category', 'time'].find((k) => k in sample) ?? Object.keys(sample)[0]
  const names = splitList(opts.labels ?? null)

  let categories: unknown[] = []
  let series: Series[] = []

  if (opts.series) {
    // Long format: one row per (category, series), the value under `y`.
    const yKey = splitList(opts.y ?? null)[0] ?? 'value'
    const seriesKey = opts.series
    const catIndex = new Map<string, number>()
    const bySeries = new Map<string, Series>()
    for (const r of rows) {
      const cat = String(r[xKey])
      if (!catIndex.has(cat)) {
        catIndex.set(cat, categories.length)
        categories.push(r[xKey])
      }
    }
    for (const r of rows) {
      const name = String(r[seriesKey] ?? 'Series')
      let s = bySeries.get(name)
      if (!s) {
        s = { key: name, name, slot: bySeries.size, values: new Array(categories.length).fill(null) }
        bySeries.set(name, s)
      }
      s.values[catIndex.get(String(r[xKey]))!] = toNum(r[yKey])
    }
    series = [...bySeries.values()]
  } else {
    categories = rows.map((r) => r[xKey])
    const yKeys = splitList(opts.y ?? null)
    const keys = yKeys.length ? yKeys : Object.keys(sample).filter((k) => k !== xKey && rows.some((r) => toNum(r[k]) !== null))
    series = keys.map((key, i) => ({ key, name: names[i] ?? humanize(key), slot: i, values: rows.map((r) => toNum(r[key])) }))
  }

  let folded = 0
  if (series.length > MAX_SERIES) {
    const kept = series.slice(0, MAX_SERIES - 1)
    const rest = series.slice(MAX_SERIES - 1)
    folded = rest.length
    kept.push({
      key: '__other',
      name: `Other (${rest.length})`,
      slot: MAX_SERIES - 1,
      values: categories.map((_, i) => {
        const vals = rest.map((s) => s.values[i]).filter((v): v is number => v !== null)
        return vals.length ? vals.reduce((a, b) => a + b, 0) : null
      }),
    })
    series = kept
  }

  return { categories: categories.map((c) => String(c ?? '')), rawCategories: categories, series, folded }
}

export function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A donut is one series split by category; past five slices the smallest
 *  fold into "Other", so a slice never takes a colour it has to share. */
export function slices(model: ChartModel): { name: string; value: number; slot: number }[] {
  const s = model.series[0]
  if (!s) return []
  const all = model.categories
    .map((name, i) => ({ name, value: s.values[i] ?? 0 }))
    .filter((d) => d.value > 0)
  if (all.length <= MAX_SERIES) return all.map((d, i) => ({ ...d, slot: i }))
  const sorted = [...all].sort((a, b) => b.value - a.value)
  const kept = sorted.slice(0, MAX_SERIES - 1)
  const rest = sorted.slice(MAX_SERIES - 1)
  const keptInOrder = all.filter((d) => kept.includes(d))
  return [
    ...keptInOrder.map((d, i) => ({ ...d, slot: i })),
    { name: `Other (${rest.length})`, value: rest.reduce((a, d) => a + d.value, 0), slot: MAX_SERIES - 1 },
  ]
}
