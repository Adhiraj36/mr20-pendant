// The arithmetic under a chart: clean tick values, a linear scale, and which
// category labels fit. Pure, so it is tested without a DOM.

/** 1, 2, 2.5, 5 or 10 times a power of ten: the steps an axis reads cleanly at. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(raw))
  const f = raw / power
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * power
}

/** Ticks covering [min, max] with about `count` intervals; the domain widens
 *  to the outermost ticks so the plot never ends between two gridlines. */
export function niceTicks(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] }
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.5
    min -= min === 0 ? 0 : pad
    max += pad
  }
  const step = niceStep((max - min) / Math.max(1, count))
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + (step % 1 === 0 ? 0 : 1))
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(decimals)))
  return { lo, hi, ticks }
}

export function linear([d0, d1]: [number, number], [r0, r1]: [number, number]): (v: number) => number {
  const span = d1 - d0 || 1
  return (v) => r0 + ((v - d0) / span) * (r1 - r0)
}

/** Every k-th label, so labels at `width` px apart never collide. */
export function labelStride(count: number, width: number, labelWidth: number): number {
  if (count <= 1 || width <= 0) return 1
  const per = width / count
  return Math.max(1, Math.ceil((labelWidth + 12) / per))
}

/** Where a y axis starts: bars and areas start at zero; a line whose values
 *  all sit far above zero starts near them, or its movement is a flat line. */
export function yDomain(values: number[], fromZero: boolean): [number, number] {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return [0, 1]
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (fromZero) return [Math.min(0, min), Math.max(0, max)]
  if (min > 0 && min / (max || 1) > 0.5) return [min, max]
  return [Math.min(0, min), max]
}

/** An arc path for a donut segment, angles in radians from 12 o'clock. */
export function arc(cx: number, cy: number, r: number, inner: number, start: number, end: number): string {
  const sweep = Math.min(end - start, Math.PI * 2 - 1e-6)
  const e = start + sweep
  const pt = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)].map((n) => n.toFixed(2)).join(' ')
  const large = sweep > Math.PI ? 1 : 0
  return `M ${pt(r, start)} A ${r} ${r} 0 ${large} 1 ${pt(r, e)} L ${pt(inner, e)} A ${inner} ${inner} 0 ${large} 0 ${pt(inner, start)} Z`
}
