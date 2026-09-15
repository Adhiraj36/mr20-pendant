// When a loop runs, as the timetable draws it and as a sentence.
//
// Cron here is the engine's six fields (second minute hour day-of-month month
// day-of-week); five-field expressions are read too, because hand-written
// recipes use both. Only the shapes worth drawing are expanded — a schedule
// this cannot read is shown as its own text rather than guessed at, because a
// wrong timetable is worse than an unfamiliar one.

export type Schedule =
  /** Fires at these minutes of the day; `days` says which days when not all. */
  | { kind: 'times'; minutes: number[]; today: boolean; days: string }
  | { kind: 'every'; minutes: number }
  | { kind: 'event'; text: string }
  | { kind: 'unknown'; text: string }

const DAY = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function expand(field: string, min: number, max: number): number[] | null {
  const out = new Set<number>()
  for (const part of (field === '?' ? '*' : field).split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim())
    if (!m) return null
    let lo = min
    let hi = max
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number)
      lo = a
      hi = b ?? (m[2] ? max : a)
    }
    const step = m[2] ? Number(m[2]) : 1
    if (lo < min || hi > max || lo > hi || step < 1) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

function daysPhrase(dom: string, doms: number[], dow: string, dows: number[]): string {
  if (dow !== '*' && dow !== '?') {
    const set = dows.join(',')
    if (set === '1,2,3,4,5') return 'Weekdays'
    if (set === '0,6') return 'Weekends'
    if (dows.length === 1) return DAY[dows[0]]
    return dows.map((d) => SHORT[d]).join(', ')
  }
  if (dom !== '*' && dom !== '?') return doms.length === 1 ? `On day ${doms[0]} of the month` : `On days ${doms.join(', ')}`
  return ''
}

export function parseCron(expr: string, now = new Date()): Schedule {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5 && f.length !== 6) return { kind: 'unknown', text: expr.trim() }
  const [min, hour, dom, mon, dowRaw] = f.length === 6 ? f.slice(1) : f
  const dow = dowRaw.replace(/\b7\b/g, '0')
  const minutes = expand(min, 0, 59)
  const hours = expand(hour, 0, 23)
  const doms = expand(dom, 1, 31)
  const mons = expand(mon, 1, 12)
  const dows = expand(dow, 0, 6)
  if (!minutes || !hours || !doms || !mons || !dows) return { kind: 'unknown', text: expr.trim() }

  const today =
    doms.includes(now.getDate()) && mons.includes(now.getMonth() + 1) && dows.includes(now.getDay())
  return {
    kind: 'times',
    minutes: hours.flatMap((h) => minutes.map((m) => h * 60 + m)),
    today,
    days: daysPhrase(dom, doms, dow, dows),
  }
}

/** "30m", "2h", "1h30m", "45s" — Go's duration spelling, which the engine uses. */
export function durationMinutes(text: string): number | null {
  let total = 0
  let matched = ''
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)(h|m|s)/g)) {
    matched += m[0]
    total += Number(m[1]) * (m[2] === 'h' ? 60 : m[2] === 'm' ? 1 : 1 / 60)
  }
  return matched === text && total > 0 ? total : null
}

/** The engine's description of what wakes a loop, whatever words surround it. */
export function parseTrigger(raw: string, now = new Date()): Schedule {
  const text = raw.trim()
  if (!text) return { kind: 'unknown', text: '' }
  const every = /@every\s+([0-9.hms]+)/i.exec(text)
  if (every) {
    const minutes = durationMinutes(every[1])
    if (minutes) return { kind: 'every', minutes }
  }
  if (/@hourly\b/i.test(text)) return { kind: 'every', minutes: 60 }
  if (/@(daily|midnight)\b/i.test(text)) return parseCron('0 0 0 * * *', now)
  if (/@weekly\b/i.test(text)) return parseCron('0 0 0 * * 0', now)
  const cron = /(?:^|[\s:="'(])((?:[\d*?][\d*/,?-]*\s+){4,5}[\d*?][\d*/,?-]*)/.exec(text)
  if (cron) {
    const s = parseCron(cron[1], now)
    if (s.kind !== 'unknown') return s
  }
  return { kind: 'event', text }
}

/** A loop written in the settings file: either an interval or a cron. */
export function scheduleOf(cron: string, every: string, now = new Date()): Schedule {
  if (every.trim()) {
    const minutes = durationMinutes(every.trim())
    return minutes ? { kind: 'every', minutes } : { kind: 'unknown', text: `every ${every.trim()}` }
  }
  return parseTrigger(cron, now)
}

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(Math.round(minute % 60)).padStart(2, '0')}`

function span(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} seconds`
  if (minutes === 1) return 'minute'
  if (minutes < 60) return `${Math.round(minutes)} minutes`
  if (minutes % 1440 === 0) return minutes === 1440 ? 'day' : `${minutes / 1440} days`
  if (minutes % 60 === 0) return minutes === 60 ? 'hour' : `${minutes / 60} hours`
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`
}

const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

export function describe(s: Schedule): string {
  switch (s.kind) {
    case 'every':
      return `Every ${span(s.minutes)}`
    case 'event':
      return `On ${s.text.replace(/^(events?|on|trigger(s|ed by)?)[:\s]+/i, '')}`
    case 'unknown':
      return s.text
    case 'times': {
      const t = s.minutes
      const lead = s.days || 'Every day'
      if (t.length === 0) return lead
      if (t.length <= 4) return `${lead} at ${list(t.map(clock))}`
      const gap = t[1] - t[0]
      const even = t.every((v, i) => i === 0 || v - t[i - 1] === gap)
      if (even && t[0] < gap && 1440 - t.at(-1)! <= gap) {
        return s.days ? `${s.days}, every ${span(gap)}` : `Every ${span(gap)}`
      }
      if (even && gap === 60) {
        const hourly = `hourly from ${clock(t[0])} to ${clock(t.at(-1)!)}`
        return s.days ? `${s.days}, ${hourly}` : hourly.charAt(0).toUpperCase() + hourly.slice(1)
      }
      return `${lead}, ${t.length} times`
    }
  }
}

/** Minutes from now until it next fires, for ordering the timetable. */
export function nextIn(s: Schedule, nowMinute: number): number {
  if (s.kind === 'every') return s.minutes - (nowMinute % s.minutes)
  if (s.kind !== 'times' || s.minutes.length === 0) return Number.POSITIVE_INFINITY
  const later = s.minutes.find((m) => m >= nowMinute)
  const next = later !== undefined ? later - nowMinute : s.minutes[0] + 1440 - nowMinute
  return s.today ? next : next + 1440
}
