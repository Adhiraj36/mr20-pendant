// What every data-bound element shares: read a `source` (or a literal `value`),
// show loading, then the value, an empty state, or an error that names the
// source — and on a refresh, keep the last render on screen, dimmed, instead of
// flashing back to a skeleton.
import { on, read } from './bridge.ts'
import { isEmpty, parseSource, type SourceRef } from './source.ts'

type Child = Node | string | number | null | undefined | false

/** A DOM element with attributes and children. Text is always text: data from
 *  an agent is never parsed as markup. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined | null> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = String(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    el.append(typeof c === 'number' ? String(c) : c)
  }
  return el
}

const SVG_NS = 'http://www.w3.org/2000/svg'

export function s(tag: string, attrs: Record<string, string | number | undefined> = {}, ...children: (Node | null)[]) {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v))
  for (const c of children) if (c) el.append(c)
  return el
}

/** Attribute as a number, or the fallback when absent or not a number. */
export function num(el: Element, name: string, fallback: number): number {
  const raw = el.getAttribute(name)
  if (raw === null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** A literal `value` attribute: JSON when it parses, the text otherwise. */
export function literal(raw: string | null): unknown {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export abstract class LzData extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['source', 'value']
  }

  protected last: unknown = undefined
  private ref: SourceRef | null = null
  private off: (() => void) | null = null
  private seq = 0

  connectedCallback() {
    this.subscribe()
    void this.load()
  }

  disconnectedCallback() {
    this.off?.()
    this.off = null
  }

  attributeChangedCallback(name: string, before: string | null, after: string | null) {
    if (before === after || !this.isConnected) return
    if (name === 'source') this.subscribe()
    if (name === 'source' || name === 'value') void this.load()
    else this.rerender()
  }

  private subscribe() {
    this.off?.()
    this.ref = parseSource(this.getAttribute('source'))
    this.off = on('refresh', (scope) => {
      if (this.ref && (scope === 'live') === this.ref.live) void this.load(true)
    })
  }

  async load(refetch = false) {
    const mine = ++this.seq
    const src = this.getAttribute('source')
    if (src === null) {
      this.paint(literal(this.getAttribute('value')))
      return
    }
    if (!this.ref) {
      this.fail(`“${src}” is not a source name. Use a data file name like orders, a path like orders.total, or live:activity.`)
      return
    }
    if (refetch && this.last !== undefined) this.dataset.refreshing = ''
    else if (this.last === undefined) this.showLoading()
    try {
      const v = await read(this.ref)
      if (mine === this.seq) this.paint(v)
    } catch (e) {
      if (mine === this.seq) this.fail(`Couldn’t load ${src}. ${(e as Error).message}`)
    } finally {
      if (mine === this.seq) delete this.dataset.refreshing
    }
  }

  private paint(value: unknown) {
    this.last = value
    if (isEmpty(value) && !this.drawsEmpty()) {
      this.dataset.state = 'empty'
      this.replaceChildren(h('p', { class: 'lz-note' }, this.getAttribute('empty') ?? 'Nothing here yet.'))
      return
    }
    this.dataset.state = 'ready'
    this.render(value)
  }

  private showLoading() {
    this.dataset.state = 'loading'
    this.replaceChildren(h('span', { class: 'lz-skeleton', 'aria-hidden': 'true' }))
  }

  private fail(message: string) {
    this.dataset.state = 'error'
    this.replaceChildren(h('p', { class: 'lz-error', role: 'alert' }, message))
  }

  /** Elements that have something to say about nothing (a stat's dash, a
   *  status of "idle") draw it themselves. */
  protected drawsEmpty(): boolean {
    return false
  }

  protected abstract render(value: unknown): void

  protected rerender() {
    if (this.last !== undefined && this.dataset.state === 'ready') this.render(this.last)
  }
}

/** Light DOM on purpose: the kit's stylesheet and the agent's own CSS reach
 *  every element without a shadow root in the way. */
export function define(tag: string, ctor: CustomElementConstructor) {
  if (!customElements.get(tag)) customElements.define(tag, ctor)
}
