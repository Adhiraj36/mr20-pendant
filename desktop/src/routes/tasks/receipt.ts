// A receipt as the desktop prints it.
//
// The backend stores a record, not a slip: raw instants, the task's kind, a
// STATUS line the stamp already says, and the run's own summary in the quote
// slot — which, for a task that failed, is the reason it failed rather than
// anything anybody said. These rules turn that record into what a person reads,
// and are kept apart from the components so they can be tested without a DOM.
import type { Ticket } from '@shared/types'

export type SlipRow = { k: string; v: string; ok?: boolean }

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** "14 Sep, 13:14", with the year only when it is not this one. */
export function when(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${d.getDate()} ${MONTH[d.getMonth()]}${year}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "4m 21s" between two instants, or null when they cannot be read. */
export function duration(startIso: string, endIso: string): string | null {
  const a = Date.parse(startIso)
  const b = Date.parse(endIso)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  const s = Math.round((b - a) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${pad(s % 60)}s` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`
}

/** Printed elsewhere or not worth a line: the stamp is the verdict, the kind
 *  is the engine's filing, and the start and finish are what Took is made of. */
const DROP = new Set(['KIND', 'STATUS', 'STARTED', 'FINISHED'])

export function slipRows(task: Ticket, now = new Date()): SlipRow[] {
  const raw = task.receipt?.rows ?? []
  const valueOf = (key: string) => raw.find((r) => r.k.trim().toUpperCase() === key)?.v ?? ''
  const rows: SlipRow[] = []
  const seen = new Set<string>()
  const has = (key: string) => rows.some((r) => r.k.toUpperCase() === key)

  for (const r of raw) {
    const k = r.k.trim()
    const v = (r.v ?? '').trim()
    if (!k || !v || DROP.has(k.toUpperCase())) continue
    const printed = ISO.test(v) ? when(v, now) : v
    const key = `${k.toUpperCase()}|${printed}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ k, v: printed, ...(r.ok ? { ok: true } : {}) })
  }

  if (!has('RAN ON')) rows.push({ k: 'Ran on', v: task.mine ? 'This machine' : 'Another machine' })
  const took = duration(valueOf('STARTED') || task.claimedAt, valueOf('FINISHED') || task.finishedAt)
  if (took && !has('TOOK')) {
    const at = rows.findIndex((r) => r.k.toUpperCase() === 'RAN ON')
    rows.splice(at + 1, 0, { k: 'Took', v: took })
  }
  return rows
}

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** What the run said it did, or why it did not. Empty when the backend fell
 *  back to the person's own words, which are not a summary of anything. */
export function summaryOf(task: Ticket): string {
  const q = task.receipt?.quote?.trim() ?? ''
  return q && norm(q) !== norm(task.quote) && norm(q) !== norm(task.text) ? q : ''
}

/** What the person actually said, when it is more than the task's own text. */
export function spokenOf(task: Ticket): string {
  const q = task.quote?.trim() ?? ''
  return q && norm(q) !== norm(task.text) ? q : ''
}

/** A run's summary as a sentence for a person: no engine vocabulary, a
 *  capital, a full stop. */
export function outcomeLine(text: string): string {
  let s = text.trim().replace(/\s+/g, ' ')
  if (!s) return ''
  if (/\b(returned|came back with|produced) nothing\b|\bempty (reply|result|response)\b/i.test(s)) {
    return 'The assistant finished without reporting back.'
  }
  s = s.replace(/\b(the )?coding harness\b/gi, (_m, the: string | undefined) => (the ? 'the assistant' : 'assistant'))
  s = s.replace(/\bharness\b/gi, 'assistant')
  s = s.charAt(0).toUpperCase() + s.slice(1)
  return /[.!?…]$/.test(s) ? s : `${s}.`
}
