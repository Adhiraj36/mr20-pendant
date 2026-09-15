export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** "3 minutes ago", and honest about not knowing. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'never'
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(then).toLocaleDateString()
}

export function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : ''
}

/** Cron, in a sentence. Covers what the app itself writes and the common
 *  hand-written shapes; anything stranger is shown verbatim rather than
 *  guessed at, because a wrong plain-English schedule is worse than a cron
 *  string a person can look up. */
export function describeSchedule(cron: string, every: string): string {
  if (every.trim()) return `Every ${humanDuration(every.trim())}`
  const c = cron.trim()
  if (!c) return 'No schedule'
  if (c.startsWith('@every ')) return `Every ${humanDuration(c.slice(7))}`
  if (c === '@hourly') return 'Every hour'
  if (c === '@daily' || c === '@midnight') return 'Every day at midnight'
  if (c === '@weekly') return 'Every week'

  // karmax uses 6-field cron: second minute hour dom month dow.
  const f = c.split(/\s+/)
  if (f.length === 6 && f[0] === '0' && f[3] === '*' && f[4] === '*') {
    const min = f[1]
    const hour = f[2]
    if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
      const when = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
      if (f[5] === '*') return `Every day at ${when}`
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      const d = Number(f[5])
      if (Number.isInteger(d) && days[d]) return `Every ${days[d]} at ${when}`
    }
  }
  return c
}

function humanDuration(d: string): string {
  const m = /^(\d+)\s*([smhd])$/i.exec(d.trim())
  if (!m) return d
  const n = Number(m[1])
  const unit = { s: 'second', m: 'minute', h: 'hour', d: 'day' }[m[2].toLowerCase()] ?? m[2]
  return n === 1 ? unit : `${n} ${unit}s`
}

/** The reverse: a schedule the app can store, from the fields it offers. */
export function cronForDaily(hour: number, minute: number): string {
  return `0 ${minute} ${hour} * * *`
}

export function parseDaily(cron: string): { hour: number; minute: number } | null {
  const f = cron.trim().split(/\s+/)
  if (f.length !== 6 || f[0] !== '0' || f[3] !== '*' || f[4] !== '*' || f[5] !== '*') return null
  const minute = Number(f[1])
  const hour = Number(f[2])
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null
  return { hour, minute }
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
