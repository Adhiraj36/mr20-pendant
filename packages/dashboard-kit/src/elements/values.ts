// Single values: a stat, a value inline, a meter, a status, key–value rows,
// text, and the empty state.
import { data } from '../bridge.ts'
import { format } from '../format.ts'
import { define, h, literal, LzData, num } from '../element.ts'
import { isEmpty } from '../source.ts'

export type Tone = 'good' | 'live' | 'wait' | 'bad' | 'idle'

const TONES: [RegExp, Tone][] = [
  [/^(running|live|in[ _-]?progress|executing|working|active|syncing|starting)$/i, 'live'],
  [/^(ok|done|kept|success|succeeded|healthy|complete|completed|connected|up|online|paid|sent|passed|true|yes|good)$/i, 'good'],
  [/^(waiting|pending|queued|blocked|paused|approved|warn|warning|degraded|stale|scheduled|draft)$/i, 'wait'],
  [/^(failed|failure|error|errored|down|offline|stopped|crashed|not[ _-]?kept|rejected|cancelled|canceled|bad|false|no|critical|expired)$/i, 'bad'],
]

export function toneOf(value: unknown): Tone {
  const text = String(value ?? '').trim()
  for (const [re, tone] of TONES) if (re.test(text)) return tone
  return 'idle'
}

const GLYPH: Record<Tone, string> = { good: '✓', live: '●', wait: '◐', bad: '×', idle: '○' }

export function statusBadge(value: unknown, label?: string | null): HTMLElement {
  const tone = toneOf(value)
  const text = label ?? String(value ?? '')
  return h(
    'span',
    { class: 'lz-status-badge', 'data-tone': tone },
    h('span', { class: 'lz-status-glyph', 'aria-hidden': 'true' }, GLYPH[tone]),
    text.charAt(0).toUpperCase() + text.slice(1).replace(/[_-]+/g, ' '),
  )
}

class LzStat extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'label', 'format', 'unit', 'delta', 'delta-format', 'delta-label', 'good', 'trend', 'trend-y']
  }

  protected drawsEmpty() {
    return true
  }

  protected render(value: unknown) {
    const label = this.getAttribute('label')
    const unit = this.getAttribute('unit')
    const figure = h('p', { class: 'lz-stat-value' }, isEmpty(value) ? '—' : format(value, this.getAttribute('format')))
    if (unit && !isEmpty(value)) figure.append(h('span', { class: 'lz-stat-unit' }, unit))
    const deltaSlot = h('p', { class: 'lz-stat-delta' })
    this.replaceChildren(label ? h('p', { class: 'lz-stat-label' }, label) : '', figure, deltaSlot)

    const delta = this.getAttribute('delta')
    if (delta !== null) void this.paintDelta(delta, deltaSlot)

    const trend = this.getAttribute('trend')
    if (trend) {
      const spark = document.createElement('lz-sparkline')
      spark.setAttribute('source', trend)
      const y = this.getAttribute('trend-y')
      if (y) spark.setAttribute('y', y)
      this.append(spark)
    }
  }

  private async paintDelta(raw: string, slot: HTMLElement) {
    let d: unknown = literal(raw)
    if (typeof d === 'string' && /^(live:)?[a-z0-9]/.test(d)) {
      try {
        d = await data(d)
      } catch {
        return
      }
    }
    const n = Number(d)
    if (!Number.isFinite(n)) return
    const dir = n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
    const upIsGood = (this.getAttribute('good') ?? 'up') !== 'down'
    const good = dir === 'flat' ? 'flat' : String((dir === 'up') === upIsGood)
    const fmt = this.getAttribute('delta-format') ?? this.getAttribute('format')
    const sign = n > 0 ? '+' : n < 0 ? '−' : ''
    slot.dataset.dir = dir
    slot.dataset.good = good
    slot.replaceChildren(
      h('span', { class: 'lz-stat-arrow', 'aria-hidden': 'true' }, dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'),
      `${sign}${format(Math.abs(n), fmt)}`,
      this.getAttribute('delta-label') ? h('span', { class: 'lz-stat-vs' }, ` ${this.getAttribute('delta-label')}`) : '',
    )
  }
}

class LzValue extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'format']
  }
  protected drawsEmpty() {
    return true
  }
  protected render(value: unknown) {
    this.textContent = isEmpty(value) ? '—' : format(value, this.getAttribute('format'))
  }
}

class LzProgress extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'max', 'label', 'format', 'warn-at', 'bad-at']
  }

  protected render(value: unknown) {
    const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    const current = Number(obj ? (obj.value ?? obj.used ?? obj.done) : value)
    const max = Number(obj?.max ?? obj?.total ?? num(this, 'max', 100))
    const share = max > 0 && Number.isFinite(current) ? Math.max(0, Math.min(1, current / max)) : 0
    const warnAt = num(this, 'warn-at', Number.POSITIVE_INFINITY)
    const badAt = num(this, 'bad-at', Number.POSITIVE_INFINITY)
    const pct = share * 100
    const tone = pct >= badAt ? 'bad' : pct >= warnAt ? 'wait' : 'normal'
    const fmt = this.getAttribute('format')
    const readout = fmt ? `${format(current, fmt)} of ${format(max, fmt)}` : `${Math.round(pct)}%`
    const label = this.getAttribute('label') ?? (obj?.label ? String(obj.label) : '')
    this.replaceChildren(
      h('p', { class: 'lz-progress-top' }, h('span', {}, label), h('span', { class: 'lz-progress-readout' }, readout)),
      h(
        'div',
        { class: 'lz-progress-track', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': current, 'aria-label': label || 'Progress', 'data-tone': tone },
        h('div', { class: 'lz-progress-fill', style: `width:${pct.toFixed(2)}%` }),
      ),
    )
  }
}

class LzStatus extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'label']
  }
  protected drawsEmpty() {
    return true
  }
  protected render(value: unknown) {
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
    const state = obj ? (obj.status ?? obj.state) : value
    this.replaceChildren(statusBadge(isEmpty(state) ? 'unknown' : state, this.getAttribute('label') ?? (obj?.label ? String(obj.label) : null)))
  }
}

type Row = { k: string; v: unknown; ok?: boolean }

export function kvRows(value: unknown): Row[] {
  if (Array.isArray(value)) {
    return value
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({ k: String(r.k ?? r.key ?? r.label ?? r.name ?? ''), v: r.v ?? r.value, ok: r.ok === true }))
  }
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ k, v }))
  return []
}

class LzKv extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'format']
  }
  protected render(value: unknown) {
    const fmt = this.getAttribute('format')
    this.replaceChildren(
      h(
        'dl',
        { class: 'lz-kv-rows' },
        ...kvRows(value).map((r) =>
          h(
            'div',
            { class: 'lz-kv-row' },
            h('dt', {}, r.k),
            h('span', { class: 'lz-kv-lead', 'aria-hidden': 'true' }),
            h('dd', { 'data-ok': r.ok ? '' : undefined }, typeof r.v === 'number' ? format(r.v, fmt) : format(r.v, 'plain'), r.ok ? ' ✓' : ''),
          ),
        ),
      ),
    )
  }
}

/** Paragraphs, **bold**, `code`, "- " lists and "## " headings — enough for a
 *  summary an agent writes, built as nodes so nothing in it is markup. */
export function prose(text: string): Node[] {
  const inline = (line: string): Node[] =>
    line.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map((part) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? h('strong', {}, part.slice(2, -2))
        : part.startsWith('`') && part.endsWith('`') && part.length > 2
          ? h('code', {}, part.slice(1, -1))
          : document.createTextNode(part),
    )
  const out: Node[] = []
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim())
    if (lines.length === 0) continue
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      out.push(h('ul', {}, ...lines.map((l) => h('li', {}, ...inline(l.replace(/^\s*[-*]\s+/, ''))))))
    } else if (/^#{1,3}\s+/.test(lines[0]) && lines.length === 1) {
      out.push(h('h4', {}, ...inline(lines[0].replace(/^#{1,3}\s+/, ''))))
    } else {
      out.push(h('p', {}, ...inline(lines.join(' '))))
    }
  }
  return out
}

class LzText extends LzData {
  protected render(value: unknown) {
    this.replaceChildren(...prose(typeof value === 'string' ? value : JSON.stringify(value, null, 2)))
  }
}

class LzEmpty extends HTMLElement {
  private built = false
  connectedCallback() {
    if (this.built) return
    this.built = true
    const message = this.getAttribute('message')
    if (message && !this.textContent?.trim()) this.textContent = message
  }
}

export function defineValues() {
  define('lz-stat', LzStat)
  define('lz-value', LzValue)
  define('lz-progress', LzProgress)
  define('lz-status', LzStatus)
  define('lz-kv', LzKv)
  define('lz-text', LzText)
  define('lz-empty', LzEmpty)
}

export { literal }
