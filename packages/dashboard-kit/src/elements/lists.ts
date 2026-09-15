// Many values: a list, a feed, a table, and a receipt.
import { barcodeBars } from '@lyzn/design'
import { format } from '../format.ts'
import { define, h, LzData, num } from '../element.ts'
import { kvRows, statusBadge, toneOf } from './values.ts'

type Rec = Record<string, unknown>

const rowsOf = (value: unknown): Rec[] =>
  (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []).map((r) =>
    r && typeof r === 'object' ? (r as Rec) : { value: r },
  )

/** The first of these keys a row actually has: agents name fields many ways. */
const field = (row: Rec, attr: string | null, ...fallbacks: string[]): unknown => {
  if (attr) return row[attr]
  for (const k of fallbacks) if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k]
  return undefined
}

const plain = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

class LzList extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'primary', 'secondary', 'meta', 'meta-format', 'status', 'limit']
  }
  protected render(value: unknown) {
    const rows = rowsOf(value).slice(0, num(this, 'limit', 50))
    const metaFormat = this.getAttribute('meta-format')
    this.replaceChildren(
      h(
        'ul',
        { class: 'lz-list-rows' },
        ...rows.map((r) => {
          const status = this.getAttribute('status') ? r[this.getAttribute('status')!] : undefined
          const meta = field(r, this.getAttribute('meta'))
          const primaryKey =
            this.getAttribute('primary') ?? ['title', 'name', 'text', 'label', 'value'].find((k) => r[k] !== undefined && r[k] !== null && r[k] !== '')
          // The second line never repeats the first, whichever key it was guessed from.
          const secondary = this.getAttribute('secondary')
            ? r[this.getAttribute('secondary')!]
            : ['description', 'subtitle', 'detail'].filter((k) => k !== primaryKey).map((k) => r[k]).find((v) => v !== undefined && v !== null && v !== '')
          return h(
            'li',
            { class: 'lz-list-row' },
            status !== undefined ? h('span', { class: 'lz-dot', 'data-tone': toneOf(status), title: plain(status) }) : null,
            h(
              'div',
              { class: 'lz-list-main' },
              h('p', { class: 'lz-list-primary' }, plain(primaryKey ? r[primaryKey] : undefined)),
              secondary !== undefined && secondary !== null && secondary !== '' ? h('p', { class: 'lz-list-secondary' }, plain(secondary)) : null,
            ),
            meta !== undefined ? h('span', { class: 'lz-list-meta' }, format(meta, metaFormat)) : null,
          )
        }),
      ),
    )
  }
}

class LzFeed extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'time', 'text', 'kind', 'time-format', 'limit', 'reverse']
  }
  protected render(value: unknown) {
    // Logs arrive oldest first; a feed reads newest first.
    const ordered = this.hasAttribute('reverse') ? [...rowsOf(value)].reverse() : rowsOf(value)
    const rows = ordered.slice(0, num(this, 'limit', 20))
    const timeFormat = this.getAttribute('time-format') ?? 'ago'
    this.replaceChildren(
      h(
        'ol',
        { class: 'lz-feed-rows' },
        ...rows.map((r) => {
          const at = field(r, this.getAttribute('time'), 'time', 'at', 'timestamp', 'created_at', 'createdAt', 'date')
          const kind = field(r, this.getAttribute('kind'), 'kind', 'status', 'type', 'level')
          return h(
            'li',
            { class: 'lz-feed-row' },
            h('time', { class: 'lz-feed-time' }, at === undefined ? '' : format(at, timeFormat)),
            h('span', { class: 'lz-dot', 'data-tone': toneOf(kind), 'aria-hidden': 'true' }),
            h('p', { class: 'lz-feed-text' }, plain(field(r, this.getAttribute('text'), 'text', 'message', 'summary', 'title', 'name'))),
          )
        }),
      ),
    )
  }
}

export type Column = { key: string; label: string; format: string | null }

/** "user:Who,sent:Sent:ago,units::number" — key, then an optional label, then
 *  an optional format. Without columns, the first row's keys. */
export function parseColumns(raw: string | null, sample?: Rec): Column[] {
  if (raw && raw.trim()) {
    return raw
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const [key, label, fmt] = c.split(':')
        return { key: key.trim(), label: (label ?? '').trim() || humanize(key.trim()), format: (fmt ?? '').trim() || null }
      })
  }
  return Object.keys(sample ?? {}).slice(0, 8).map((key) => ({ key, label: humanize(key), format: null }))
}

const humanize = (key: string) => {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const compare = (a: unknown, b: unknown) => {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && a !== '' && b !== '') return na - nb
  return plain(a).localeCompare(plain(b), undefined, { numeric: true, sensitivity: 'base' })
}

class LzTable extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'columns', 'limit', 'searchable', 'sort', 'status']
  }
  private query = ''
  private sortKey: string | null = null
  private sortDir: 1 | -1 = 1
  private showAll = false

  protected render(value: unknown) {
    const all = rowsOf(value)
    const cols = parseColumns(this.getAttribute('columns'), all[0])
    if (this.sortKey === null && this.getAttribute('sort')) {
      const raw = this.getAttribute('sort')!
      this.sortKey = raw.replace(/^-/, '')
      this.sortDir = raw.startsWith('-') ? -1 : 1
    }
    const statusKey = this.getAttribute('status')
    const q = this.query.trim().toLowerCase()
    let rows = q ? all.filter((r) => cols.some((c) => plain(r[c.key]).toLowerCase().includes(q))) : all
    if (this.sortKey) rows = [...rows].sort((a, b) => compare(a[this.sortKey!], b[this.sortKey!]) * this.sortDir)
    const limit = num(this, 'limit', 50)
    const shown = this.showAll ? rows : rows.slice(0, limit)
    const numeric = new Set(cols.filter((c) => all.length > 0 && all.every((r) => r[c.key] === undefined || r[c.key] === null || Number.isFinite(Number(r[c.key])))).map((c) => c.key))

    const head = h(
      'tr',
      {},
      ...cols.map((c) => {
        const active = this.sortKey === c.key
        const b = h('button', { type: 'button' }, c.label, active ? h('span', { class: 'lz-sort', 'aria-hidden': 'true' }, this.sortDir === 1 ? ' ↑' : ' ↓') : '')
        b.addEventListener('click', () => {
          if (this.sortKey === c.key) this.sortDir = this.sortDir === 1 ? -1 : 1
          else {
            this.sortKey = c.key
            this.sortDir = numeric.has(c.key) ? -1 : 1
          }
          this.rerender()
        })
        return h('th', { scope: 'col', 'data-num': numeric.has(c.key) ? '' : undefined, 'aria-sort': active ? (this.sortDir === 1 ? 'ascending' : 'descending') : undefined }, b)
      }),
    )
    const body = h(
      'tbody',
      {},
      ...shown.map((r) =>
        h(
          'tr',
          {},
          ...cols.map((c) =>
            h(
              'td',
              { 'data-num': numeric.has(c.key) ? '' : undefined },
              c.key === statusKey ? statusBadge(r[c.key]) : r[c.key] === undefined || r[c.key] === null ? '—' : format(r[c.key], c.format ?? (numeric.has(c.key) ? 'number' : 'plain')),
            ),
          ),
        ),
      ),
    )

    const parts: Node[] = []
    if (this.hasAttribute('searchable')) {
      const input = h('input', { type: 'search', class: 'lz-search', placeholder: 'Search', 'aria-label': 'Search this table', value: this.query })
      input.addEventListener('input', () => {
        this.query = input.value
        this.showAll = false
        this.rerender()
        const again = this.querySelector<HTMLInputElement>('input.lz-search')
        again?.focus()
        again?.setSelectionRange(again.value.length, again.value.length)
      })
      parts.push(h('div', { class: 'lz-table-tools' }, input, h('span', { class: 'lz-table-count' }, q ? `${rows.length} of ${all.length}` : `${all.length} rows`)))
    }
    parts.push(h('div', { class: 'lz-table-scroll' }, h('table', {}, h('thead', {}, head), body)))
    if (rows.length === 0) parts.push(h('p', { class: 'lz-note' }, q ? `Nothing matches “${this.query}”.` : 'Nothing here yet.'))
    if (!this.showAll && rows.length > limit) {
      const more = h('button', { type: 'button', class: 'lz-more' }, `Show all ${rows.length}`)
      more.addEventListener('click', () => {
        this.showAll = true
        this.rerender()
      })
      parts.push(more)
    }
    this.replaceChildren(...parts)
  }
}

class LzReceipt extends LzData {
  protected render(value: unknown) {
    const r = (value && typeof value === 'object' ? value : {}) as Rec
    const id = plain(r.id ?? r.receiptId ?? r.title ?? 'receipt')
    const stamp = plain(r.stamp)
    const total = r.total && typeof r.total === 'object' ? (r.total as Rec) : null
    const bars = barcodeBars(id)
    this.replaceChildren(
      h(
        'div',
        { class: 'lz-receipt-paper' },
        h('p', { class: 'lz-receipt-head' }, plain(r.heading ?? 'LYZN · PROOF OF WORK')),
        r.meta ? h('p', { class: 'lz-receipt-meta' }, plain(r.meta)) : null,
        h('p', { class: 'lz-receipt-title' }, plain(r.title)),
        r.quote ? h('p', { class: 'lz-receipt-quote' }, plain(r.quote)) : null,
        h(
          'div',
          { class: 'lz-receipt-rows' },
          ...kvRows(r.rows ?? []).map((row) =>
            h('p', { class: 'lz-receipt-row' }, h('span', {}, row.k), h('span', { class: 'lz-kv-lead', 'aria-hidden': 'true' }), h('span', { 'data-ok': row.ok ? '' : undefined }, plain(row.v), row.ok ? ' ✓' : '')),
          ),
        ),
        total ? h('p', { class: 'lz-receipt-total' }, h('span', {}, plain(total.k)), h('strong', {}, plain(total.v))) : null,
        h('div', { class: 'lz-receipt-bars', 'aria-hidden': 'true' }, ...bars.map((w, i) => h('span', { style: `flex:${w} 1 0`, 'data-ink': i % 2 === 0 ? '' : undefined }))),
        h('p', { class: 'lz-receipt-id' }, `TXN ${id.slice(-10).toUpperCase()}`),
        stamp ? h('span', { class: 'lz-receipt-stamp', 'data-tone': toneOf(stamp) }, stamp) : null,
      ),
    )
  }
}

export function defineLists() {
  define('lz-list', LzList)
  define('lz-feed', LzFeed)
  define('lz-table', LzTable)
  define('lz-receipt', LzReceipt)
}
