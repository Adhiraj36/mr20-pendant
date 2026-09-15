// lz-chart and lz-sparkline: SVG charts in the kit's colours.
//
// Built to one set of rules so any agent's chart reads like every other one:
// thin marks, hairline grid, a legend from two series up, a crosshair and
// tooltip that list every series, the same readout on keyboard focus, and a
// table view so no value is only reachable by hovering.
import { format } from '../format.ts'
import { define, h, LzData, num, s } from '../element.ts'
import { arc, labelStride, linear, niceTicks, yDomain } from './scale.ts'
import { buildModel, slices, type ChartModel } from './model.ts'

type Kind = 'line' | 'area' | 'bar' | 'stacked' | 'hbar' | 'donut'
const KINDS: Kind[] = ['line', 'area', 'bar', 'stacked', 'hbar', 'donut']

const color = (slot: number) => `var(--lz-series-${slot + 1})`
const CHAR_W = 6.4

class LzChart extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'kind', 'x', 'y', 'series', 'labels', 'height', 'format', 'x-format', 'total-label']
  }

  private observer: ResizeObserver | null = null
  private width = 0
  private asTable = false

  connectedCallback() {
    super.connectedCallback()
    if (typeof ResizeObserver !== 'undefined' && !this.observer) {
      this.observer = new ResizeObserver(() => {
        const w = Math.round(this.clientWidth)
        if (w && w !== this.width) {
          this.width = w
          this.rerender()
        }
      })
      this.observer.observe(this)
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.observer?.disconnect()
    this.observer = null
  }

  /** Called by lz-tabs when a hidden panel is shown, since a hidden chart
   *  measured nothing. */
  redraw() {
    this.width = Math.round(this.clientWidth)
    this.rerender()
  }

  protected render(value: unknown) {
    const kind = (KINDS.includes(this.getAttribute('kind') as Kind) ? this.getAttribute('kind') : 'line') as Kind
    const model = buildModel(value, {
      x: this.getAttribute('x'),
      y: this.getAttribute('y'),
      series: this.getAttribute('series'),
      labels: this.getAttribute('labels'),
    })
    if (model.series.length === 0 || model.categories.length === 0) {
      this.replaceChildren(h('p', { class: 'lz-note' }, this.getAttribute('empty') ?? 'Nothing to chart yet.'))
      return
    }
    const width = this.width || Math.round(this.clientWidth) || 560
    const height = num(this, 'height', kind === 'donut' ? 220 : kind === 'hbar' ? Math.max(120, model.categories.length * 30 + 24) : 220)
    const fmt = this.getAttribute('format')
    const xFmt = this.getAttribute('x-format')
    const xLabel = (i: number) => (xFmt ? format(model.rawCategories[i], xFmt) : model.categories[i])

    const figure = h('figure', { class: 'lz-chart-figure' })
    const tip = h('div', { class: 'lz-tip', role: 'status', hidden: true })

    if (this.asTable) figure.append(table(model, kind, fmt, xLabel))
    else if (kind === 'donut') figure.append(this.donut(model, width, height, fmt, tip))
    else if (kind === 'hbar') figure.append(this.hbar(model, width, fmt, tip))
    else figure.append(this.cartesian(model, kind, width, height, fmt, xLabel, tip))

    const legendItems =
      kind === 'donut' ? slices(model).map((d) => ({ name: d.name, slot: d.slot })) : model.series.length > 1 ? model.series.map((sr) => ({ name: sr.name, slot: sr.slot })) : []
    const legend = legendItems.length
      ? h(
          'ul',
          { class: 'lz-legend' },
          ...legendItems.map((it) =>
            h('li', {}, h('span', { class: kind === 'line' ? 'lz-key-line' : 'lz-key-box', style: `--c:${color(it.slot)}`, 'aria-hidden': 'true' }), it.name),
          ),
        )
      : null

    const toggle = h('button', { type: 'button', class: 'lz-chart-toggle' }, this.asTable ? 'View as chart' : 'View as table')
    toggle.addEventListener('click', () => {
      this.asTable = !this.asTable
      this.rerender()
    })

    const foot = h(
      'div',
      { class: 'lz-chart-foot' },
      legend ?? h('span', {}),
      model.folded ? h('span', { class: 'lz-note' }, `${model.folded} smaller series grouped as Other`) : null,
      toggle,
    )
    figure.append(tip)
    this.replaceChildren(figure, foot)
  }

  private cartesian(model: ChartModel, kind: Kind, width: number, height: number, fmt: string | null, xLabel: (i: number) => string, tip: HTMLElement) {
    const n = model.categories.length
    const stacked = kind === 'stacked'
    const values = stacked
      ? model.categories.flatMap((_, i) => {
          const pos = model.series.reduce((a, sr) => a + Math.max(0, sr.values[i] ?? 0), 0)
          const neg = model.series.reduce((a, sr) => a + Math.min(0, sr.values[i] ?? 0), 0)
          return [pos, neg]
        })
      : model.series.flatMap((sr) => sr.values.filter((v): v is number => v !== null))
    const [d0, d1] = yDomain(values, kind !== 'line')
    const { lo, hi, ticks } = niceTicks(d0, d1, 4)
    const tickLabels = ticks.map((t) => format(t, fmt ?? 'compact'))
    const left = Math.max(28, Math.max(...tickLabels.map((t) => t.length)) * CHAR_W + 12)
    const right = 12
    const top = 10
    const bottom = 26
    const plotW = Math.max(40, width - left - right)
    const plotH = Math.max(40, height - top - bottom)
    const y = linear([lo, hi], [top + plotH, top])
    const band = plotW / n
    const xAt = kind === 'line' || kind === 'area' ? (i: number) => left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1)) : (i: number) => left + band * i + band / 2

    const svg = s('svg', { class: 'lz-chart-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', tabindex: 0, 'aria-label': summary(model, kind, fmt) })
    const grid = s('g', { class: 'lz-axis' })
    ticks.forEach((t, i) => {
      const yy = Math.round(y(t)) + 0.5
      grid.append(s('line', { class: t === 0 ? 'lz-baseline' : 'lz-gridline', x1: left, x2: left + plotW, y1: yy, y2: yy }))
      const label = s('text', { x: left - 8, y: yy + 3.5, 'text-anchor': 'end' })
      label.textContent = tickLabels[i]
      grid.append(label)
    })
    const maxLabel = Math.max(...model.categories.map((_, i) => xLabel(i).length)) * CHAR_W
    const stride = labelStride(n, plotW, Math.min(maxLabel, 120))
    for (let i = 0; i < n; i += stride) {
      const label = s('text', { x: xAt(i), y: top + plotH + 17, 'text-anchor': 'middle' })
      label.textContent = xLabel(i)
      grid.append(label)
    }
    svg.append(grid)

    const marks = s('g', {})
    if (kind === 'line' || kind === 'area') {
      for (const sr of model.series) {
        const pts = sr.values.map((v, i) => (v === null ? null : ([xAt(i), y(v)] as [number, number])))
        const segments: [number, number][][] = []
        let run: [number, number][] = []
        for (const p of pts) {
          if (p) run.push(p)
          else if (run.length) {
            segments.push(run)
            run = []
          }
        }
        if (run.length) segments.push(run)
        for (const seg of segments) {
          const d = seg.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
          if (kind === 'area') {
            const base = y(Math.max(lo, Math.min(hi, 0)))
            marks.append(s('path', { d: `${d} L${seg[seg.length - 1][0].toFixed(1)} ${base} L${seg[0][0].toFixed(1)} ${base} Z`, fill: color(sr.slot), 'fill-opacity': 0.1, stroke: 'none' }))
          }
          marks.append(s('path', { d, class: 'lz-line', stroke: color(sr.slot) }))
        }
        const lastIndex = sr.values.map((v) => v !== null).lastIndexOf(true)
        if (lastIndex >= 0) marks.append(s('circle', { class: 'lz-dot-mark', cx: xAt(lastIndex), cy: y(sr.values[lastIndex]!), r: 4, fill: color(sr.slot) }))
      }
    } else {
      const zero = y(Math.max(lo, Math.min(hi, 0)))
      const groupW = Math.min(band * 0.72, stacked ? 24 : model.series.length * 24 + (model.series.length - 1) * 2)
      const barW = stacked ? groupW : Math.min(24, (groupW - (model.series.length - 1) * 2) / model.series.length)
      model.categories.forEach((_, i) => {
        const start = xAt(i) - groupW / 2
        let posTop = zero
        let negTop = zero
        model.series.forEach((sr, k) => {
          const v = sr.values[i]
          if (v === null || v === 0) return
          if (stacked) {
            const h0 = Math.abs(y(v) - zero)
            const gap = posTop !== zero || negTop !== zero ? 2 : 0
            if (v > 0) {
              const top0 = posTop - h0
              marks.append(s('path', { d: bar(start, top0, barW, h0 - (posTop !== zero ? gap : 0), true), fill: color(sr.slot) }))
              posTop = top0
            } else {
              marks.append(s('path', { d: bar(start, negTop + (negTop !== zero ? gap : 0), barW, h0 - (negTop !== zero ? gap : 0), false), fill: color(sr.slot) }))
              negTop += h0
            }
          } else {
            const x0 = start + k * (barW + 2)
            const yy = y(v)
            marks.append(s('path', { d: bar(x0, Math.min(yy, zero), barW, Math.abs(yy - zero), v > 0), fill: color(sr.slot) }))
          }
        })
      })
    }
    svg.append(marks)

    // The hover layer: the crosshair finds the category, and the readout lists
    // every series there, so the pointer never has to land on a 2px line.
    const cross = s('line', { class: 'lz-crosshair', y1: top, y2: top + plotH, x1: left, x2: left, visibility: 'hidden' })
    const hot = s('g', {})
    // A transparent layer over the whole plot, so the pointer is caught over
    // empty space and bars alike, not only on the 2px lines.
    const hit = s('rect', { x: left, y: top, width: plotW, height: plotH, fill: 'transparent', 'pointer-events': 'all' })
    svg.append(cross, hot, hit)
    const show = (i: number) => {
      const cx = xAt(i)
      cross.setAttribute('x1', String(cx))
      cross.setAttribute('x2', String(cx))
      cross.setAttribute('visibility', 'visible')
      hot.replaceChildren()
      if (kind === 'line' || kind === 'area') {
        for (const sr of model.series) {
          const v = sr.values[i]
          if (v !== null) hot.append(s('circle', { class: 'lz-dot-mark', cx, cy: y(v), r: 4.5, fill: color(sr.slot) }))
        }
      }
      fillTip(tip, xLabel(i), model.series.map((sr) => ({ name: sr.name, slot: sr.slot, value: sr.values[i] })), fmt, kind)
      tip.hidden = false
      const box = svg.getBoundingClientRect()
      const scale = box.width ? box.width / width : 1
      tip.style.left = `${Math.min(cx * scale + 12, box.width - 180)}px`
      tip.style.top = `${top * scale}px`
    }
    const hide = () => {
      cross.setAttribute('visibility', 'hidden')
      hot.replaceChildren()
      tip.hidden = true
    }
    const indexAt = (clientX: number) => {
      const box = svg.getBoundingClientRect()
      const px = (clientX - box.left) * (width / (box.width || width))
      if (kind === 'line' || kind === 'area') return Math.max(0, Math.min(n - 1, Math.round(((px - left) / plotW) * (n - 1))))
      return Math.max(0, Math.min(n - 1, Math.floor((px - left) / band)))
    }
    let focused = n - 1
    svg.addEventListener('pointermove', (e) => show((focused = indexAt(e.clientX))))
    svg.addEventListener('pointerleave', hide)
    svg.addEventListener('focus', () => show(focused))
    svg.addEventListener('blur', hide)
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') focused = Math.min(n - 1, focused + 1)
      else if (e.key === 'ArrowLeft') focused = Math.max(0, focused - 1)
      else return
      e.preventDefault()
      show(focused)
    })
    return svg
  }

  private hbar(model: ChartModel, width: number, fmt: string | null, tip: HTMLElement) {
    const sr = model.series[0]
    const n = model.categories.length
    const rowH = 30
    const labelW = Math.min(width * 0.36, Math.max(...model.categories.map((c) => c.length)) * CHAR_W + 12)
    const valueW = Math.max(...sr.values.map((v) => format(v ?? 0, fmt ?? 'compact').length)) * CHAR_W + 10
    const plotW = Math.max(40, width - labelW - valueW)
    const max = Math.max(0, ...sr.values.map((v) => v ?? 0))
    const x = linear([0, max || 1], [labelW, labelW + plotW])
    const height = n * rowH + 4
    const svg = s('svg', { class: 'lz-chart-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': summary(model, 'hbar', fmt) })
    model.categories.forEach((cat, i) => {
      const v = sr.values[i] ?? 0
      const yy = i * rowH + 3
      const thick = Math.min(24, rowH - 10)
      const g = s('g', { class: 'lz-hbar-row', tabindex: 0 })
      const name = s('text', { class: 'lz-hbar-label', x: 0, y: yy + thick / 2 + 4 })
      name.textContent = cat.length * CHAR_W > labelW - 12 ? `${cat.slice(0, Math.floor((labelW - 18) / CHAR_W))}…` : cat
      const w = Math.max(0, x(Math.max(0, v)) - labelW)
      const mark = s('path', { d: barH(labelW, yy, w, thick), fill: color(sr.slot) })
      const val = s('text', { class: 'lz-hbar-value', x: labelW + w + 6, y: yy + thick / 2 + 4 })
      val.textContent = format(v, fmt ?? 'compact')
      const hit = s('rect', { x: 0, y: yy - 3, width, height: rowH, fill: 'transparent' })
      g.append(hit, name, mark, val)
      const on = () => {
        fillTip(tip, cat, [{ name: sr.name, slot: sr.slot, value: v }], fmt, 'hbar')
        tip.hidden = false
        tip.style.left = `${Math.min(labelW + w + 60, width - 180)}px`
        tip.style.top = `${yy}px`
      }
      g.addEventListener('pointerenter', on)
      g.addEventListener('focus', on)
      g.addEventListener('pointerleave', () => (tip.hidden = true))
      g.addEventListener('blur', () => (tip.hidden = true))
      svg.append(g)
    })
    return svg
  }

  private donut(model: ChartModel, width: number, height: number, fmt: string | null, tip: HTMLElement) {
    const data = slices(model)
    const total = data.reduce((a, d) => a + d.value, 0)
    const size = Math.min(width, height)
    const cx = width / 2
    const cy = height / 2
    const r = size / 2 - 4
    const inner = r * 0.62
    const svg = s('svg', { class: 'lz-chart-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': summary(model, 'donut', fmt) })
    let at = 0
    for (const d of data) {
      const sweep = total ? (d.value / total) * Math.PI * 2 : 0
      const path = s('path', { class: 'lz-slice', d: arc(cx, cy, r, inner, at, at + sweep), fill: color(d.slot), tabindex: 0 })
      const on = () => {
        fillTip(tip, d.name, [{ name: `${Math.round((d.value / (total || 1)) * 100)}% of the total`, slot: d.slot, value: d.value }], fmt, 'donut')
        tip.hidden = false
        tip.style.left = `${Math.min(cx + r * 0.3, width - 180)}px`
        tip.style.top = '8px'
      }
      path.addEventListener('pointerenter', on)
      path.addEventListener('focus', on)
      path.addEventListener('pointerleave', () => (tip.hidden = true))
      path.addEventListener('blur', () => (tip.hidden = true))
      svg.append(path)
      at += sweep
    }
    const figure = s('text', { class: 'lz-donut-total', x: cx, y: cy + 4, 'text-anchor': 'middle' })
    figure.textContent = format(total, fmt ?? 'compact')
    const label = s('text', { class: 'lz-donut-label', x: cx, y: cy + 22, 'text-anchor': 'middle' })
    label.textContent = this.getAttribute('total-label') ?? 'Total'
    svg.append(figure, label)
    return svg
  }
}

/** A bar with its data end squared to the design system's tick radius and
 *  its baseline end square. */
function bar(x: number, yTop: number, w: number, hgt: number, up: boolean): string {
  if (hgt <= 0 || w <= 0) return ''
  const r = Math.min(2, w / 2, hgt)
  if (up) return `M${x} ${yTop + hgt} V${yTop + r} Q${x} ${yTop} ${x + r} ${yTop} H${x + w - r} Q${x + w} ${yTop} ${x + w} ${yTop + r} V${yTop + hgt} Z`
  return `M${x} ${yTop} V${yTop + hgt - r} Q${x} ${yTop + hgt} ${x + r} ${yTop + hgt} H${x + w - r} Q${x + w} ${yTop + hgt} ${x + w} ${yTop + hgt - r} V${yTop} Z`
}

function barH(x: number, y: number, w: number, hgt: number): string {
  if (w <= 0) return ''
  const r = Math.min(2, hgt / 2, w)
  return `M${x} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + hgt - r} Q${x + w} ${y + hgt} ${x + w - r} ${y + hgt} H${x} Z`
}

function fillTip(tip: HTMLElement, title: string, rows: { name: string; slot: number; value: number | null }[], fmt: string | null, kind: Kind) {
  tip.replaceChildren(
    h('p', { class: 'lz-tip-title' }, title),
    ...rows.map((r) =>
      h(
        'p',
        { class: 'lz-tip-row' },
        h('span', { class: kind === 'line' ? 'lz-key-line' : 'lz-key-box', style: `--c:${color(r.slot)}`, 'aria-hidden': 'true' }),
        h('strong', {}, r.value === null ? '—' : format(r.value, fmt ?? 'number')),
        h('span', {}, r.name),
      ),
    ),
  )
}

function table(model: ChartModel, kind: Kind, fmt: string | null, xLabel: (i: number) => string) {
  if (kind === 'donut') {
    return h(
      'table',
      { class: 'lz-chart-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Category'), h('th', { 'data-num': '' }, model.series[0]?.name ?? 'Value'))),
      h('tbody', {}, ...slices(model).map((d) => h('tr', {}, h('td', {}, d.name), h('td', { 'data-num': '' }, format(d.value, fmt ?? 'number'))))),
    )
  }
  return h(
    'table',
    { class: 'lz-chart-table' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), ...model.series.map((sr) => h('th', { 'data-num': '' }, sr.name)))),
    h(
      'tbody',
      {},
      ...model.categories.map((_, i) =>
        h('tr', {}, h('td', {}, xLabel(i)), ...model.series.map((sr) => h('td', { 'data-num': '' }, sr.values[i] === null ? '—' : format(sr.values[i], fmt ?? 'number')))),
      ),
    ),
  )
}

function summary(model: ChartModel, kind: Kind, fmt: string | null): string {
  const what = kind === 'donut' ? 'Donut chart' : kind === 'hbar' ? 'Bar chart' : `${kind.charAt(0).toUpperCase()}${kind.slice(1)} chart`
  const parts = model.series.map((sr) => {
    const vals = sr.values.filter((v): v is number => v !== null)
    if (!vals.length) return sr.name
    return `${sr.name} from ${format(vals[0], fmt ?? 'compact')} to ${format(vals[vals.length - 1], fmt ?? 'compact')}`
  })
  return `${what} over ${model.categories.length} points: ${parts.join('; ')}.`
}

class LzSparkline extends LzData {
  static get observedAttributes() {
    return [...LzData.observedAttributes, 'y', 'height']
  }

  redraw() {
    this.rerender()
  }

  protected render(value: unknown) {
    const yKey = this.getAttribute('y')
    const vals = (Array.isArray(value) ? value : [])
      .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[yKey ?? 'value'] : v))
      .map(Number)
      .filter(Number.isFinite)
    if (vals.length < 2) {
      this.replaceChildren()
      return
    }
    // Drawn at its real width: a stretched view box turns the end dot into an oval.
    const width = Math.max(60, Math.round(this.clientWidth) || 120)
    const height = num(this, 'height', 28)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const x = linear([0, vals.length - 1], [2, width - 5])
    const y = linear([min, max === min ? min + 1 : max], [height - 4, 4])
    const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
    this.replaceChildren(
      s(
        'svg',
        { class: 'lz-spark', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Trend from ${format(vals[0], 'compact')} to ${format(vals[vals.length - 1], 'compact')}` },
        s('path', { d, class: 'lz-spark-line' }),
        s('circle', { cx: x(vals.length - 1), cy: y(vals[vals.length - 1]), r: 2.5, class: 'lz-spark-end' }),
      ),
    )
  }
}

export function defineCharts() {
  define('lz-chart', LzChart)
  define('lz-sparkline', LzSparkline)
}
