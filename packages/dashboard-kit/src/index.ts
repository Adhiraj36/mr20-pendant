// The kit, as the page loads it: every element defined, and `window.lz` for
// the components an agent writes itself.
import { data, on, open, read, start, useMock } from './bridge.ts'
import { defineCharts } from './chart/chart.ts'
import { defineLayout } from './elements/layout.ts'
import { defineLists } from './elements/lists.ts'
import { defineValues } from './elements/values.ts'
import * as formats from './format.ts'
import { parseSource } from './source.ts'

/** Calls `render(value)` now and after every refresh of that source, or
 *  `render(undefined, error)` when it cannot be read. Returns an unsubscribe. */
function bind(el: Element, source: string, render: (value: unknown, error?: Error) => void): () => void {
  const ref = parseSource(source)
  if (!ref) {
    render(undefined, new Error(`“${source}” is not a source name.`))
    return () => {}
  }
  let seq = 0
  const run = async () => {
    const mine = ++seq
    try {
      const v = await read(ref)
      if (mine === seq && el.isConnected !== false) render(v)
    } catch (e) {
      if (mine === seq) render(undefined, e as Error)
    }
  }
  void run()
  return on('refresh', (scope) => {
    if ((scope === 'live') === ref.live) void run()
  })
}

export const lz = {
  version: '0.1.0',
  data,
  bind,
  on,
  open,
  mock: useMock,
  format: formats.format,
  formats,
}

declare global {
  interface Window {
    lz: typeof lz
  }
}

if (typeof window !== 'undefined') {
  window.lz = lz
  defineLayout()
  defineValues()
  defineLists()
  defineCharts()
  start()
  // Links leave through the app, which opens them in the browser; the frame
  // itself is not allowed to navigate anywhere.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    open(a.href)
  })
}
