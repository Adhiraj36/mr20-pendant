// Numbers, money, time and sizes, the way the kit prints them.
//
// A `format` attribute names one of these: "number", "compact", "percent",
// "currency:INR", "duration", "bytes", "date", "time", "datetime", "ago". An
// unknown name prints the value as it came, because a wrong format guessed at is
// worse than a raw one.
const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

const toDate = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v)
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

export function number(v: unknown, digits = 0): string {
  const n = toNumber(v)
  if (n === null) return String(v ?? '')
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

/** 1,284 / 12.9K / 4.2M: short enough for a stat, exact below ten thousand. */
export function compact(v: unknown): string {
  const n = toNumber(v)
  if (n === null) return String(v ?? '')
  const abs = Math.abs(n)
  const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (const [size, unit] of units) {
    if (abs >= size && (unit !== 'K' || abs >= 1e4)) {
      const scaled = n / size
      return `${scaled.toFixed(Math.abs(scaled) < 100 ? 1 : 0).replace(/\.0$/, '')}${unit}`
    }
  }
  return number(n, abs < 10 && !Number.isInteger(n) ? 1 : 0)
}

/** 0.42 and 42 both read as 42%: an agent writes either. */
export function percent(v: unknown): string {
  const n = toNumber(v)
  if (n === null) return String(v ?? '')
  const pct = Math.abs(n) <= 1 && !Number.isInteger(n) ? n * 100 : n
  return `${number(pct, Math.abs(pct) < 10 ? 1 : 0)}%`
}

export function currency(v: unknown, code = 'INR'): string {
  const n = toNumber(v)
  if (n === null) return String(v ?? '')
  try {
    return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n)
  } catch {
    return `${code} ${number(n, 2)}`
  }
}

/** Seconds as "4m 21s", "2h 05m", "3d 4h". */
export function duration(v: unknown): string {
  const n = toNumber(v)
  if (n === null) return String(v ?? '')
  const s = Math.max(0, Math.round(n))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${pad(s % 60)}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${pad(m % 60)}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function bytes(v: unknown): string {
  const n = toNumber(v)
  if (n === null) return String(v ?? '')
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.abs(n)
  let i = 0
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${number(Math.sign(n) * size, size < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

export function date(v: unknown, now = new Date()): string {
  const d = toDate(v)
  if (!d) return String(v ?? '')
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${d.getDate()} ${MONTH[d.getMonth()]}${year}`
}

export function time(v: unknown): string {
  const d = toDate(v)
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : String(v ?? '')
}

export function datetime(v: unknown, now = new Date()): string {
  const d = toDate(v)
  return d ? `${date(d, now)}, ${time(d)}` : String(v ?? '')
}

export function ago(v: unknown, now = Date.now()): string {
  const d = toDate(v)
  if (!d) return String(v ?? '')
  const s = Math.round((now - d.getTime()) / 1000)
  if (s < 0) return 'soon'
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.round(h / 24)
  return days < 30 ? `${days} d ago` : date(d)
}

export function format(v: unknown, spec?: string | null): string {
  if (v === null || v === undefined) return '—'
  const [name, arg] = (spec ?? '').split(':')
  switch (name) {
    case 'number':
      return number(v, arg ? Number(arg) : 0)
    case 'compact':
      return compact(v)
    case 'percent':
      return percent(v)
    case 'currency':
      return currency(v, (arg || 'INR').toUpperCase())
    case 'duration':
      return duration(v)
    case 'bytes':
      return bytes(v)
    case 'date':
      return date(v)
    case 'time':
      return time(v)
    case 'datetime':
      return datetime(v)
    case 'ago':
      return ago(v)
    case '':
      return typeof v === 'number' ? compact(v) : typeof v === 'object' ? JSON.stringify(v) : String(v)
    case 'plain':
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
    default:
      return String(v)
  }
}
