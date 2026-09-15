// The kit in a document: elements render from data, keep agent text as text,
// and the catalog agents read matches what the code actually defines.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { ELEMENTS } from '../src/catalog.ts'
import { buildReference } from '../src/reference.ts'

const win = new Window({ url: 'https://kit.test/', width: 900, height: 700 })
const g = globalThis as Record<string, unknown>

before(async () => {
  for (const key of ['window', 'document', 'customElements', 'HTMLElement', 'Node', 'Element', 'Event', 'MessageEvent', 'getComputedStyle', 'CustomEvent', 'MutationObserver']) {
    g[key] = (win as unknown as Record<string, unknown>)[key]
  }
  g.window = win
  await import('../src/index.ts')
})

after(async () => {
  await win.happyDOM.close()
})

const lz = () => (win as unknown as { lz: { mock: (d: Record<string, unknown>) => void } }).lz
const settle = () => new Promise((r) => setTimeout(r, 25))

async function mount(html: string, data: Record<string, unknown>) {
  lz().mock(data)
  win.document.body.innerHTML = html
  await settle()
  return win.document.body
}

test('every element in the catalog is defined, and every defined element is in the catalog', () => {
  const documented = new Set(ELEMENTS.map((e) => e.tag))
  for (const tag of documented) assert.ok(win.customElements.get(tag), `${tag} is documented but not defined`)
  const reference = buildReference()
  for (const tag of documented) assert.ok(reference.includes(`<${tag}>`), `${tag} is missing from REFERENCE.md`)
})

test('every attribute an element reacts to is documented', () => {
  for (const el of ELEMENTS) {
    const ctor = win.customElements.get(el.tag) as unknown as { observedAttributes?: string[] } | undefined
    const names = new Set(el.attrs.map((a) => a.name))
    for (const attr of ctor?.observedAttributes ?? []) {
      assert.ok(names.has(attr), `${el.tag} reacts to "${attr}" but REFERENCE.md does not mention it`)
    }
  }
})

test('a stat reads a path into a data file and formats it', async () => {
  const body = await mount('<lz-stat label="Units sold" source="orders.total" delta="orders.change" delta-label="vs last week"></lz-stat>', {
    orders: { total: 1284, change: 12 },
  })
  const stat = body.querySelector('lz-stat')!
  assert.equal(stat.querySelector('.lz-stat-value')!.textContent, '1,284')
  const delta = stat.querySelector('.lz-stat-delta') as unknown as HTMLElement
  assert.equal(delta.dataset.good, 'true')
  assert.match(delta.textContent!, /\+12 vs last week/)
})

test('a missing source says which one, and a bad name says how to write one', async () => {
  const body = await mount('<lz-stat source="nope.total"></lz-stat><lz-table source="Bad Name"></lz-table>', {})
  assert.match(body.querySelector('lz-stat .lz-error')!.textContent!, /nope\.total/)
  assert.match(body.querySelector('lz-table .lz-error')!.textContent!, /not a source name/)
})

test('text from data is never parsed as markup', async () => {
  const body = await mount('<lz-list source="rows"></lz-list><lz-text source="note"></lz-text>', {
    rows: [{ title: '<img src=x onerror=alert(1)>' }],
    note: 'Hi **there** <script>bad()</script>',
  })
  assert.equal(body.querySelectorAll('img').length, 0)
  assert.equal(body.querySelectorAll('lz-text script').length, 0)
  assert.equal(body.querySelector('.lz-list-primary')!.textContent, '<img src=x onerror=alert(1)>')
  assert.equal(body.querySelector('lz-text strong')!.textContent, 'there')
})

test('a table sorts, searches and limits', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ user: `user${i}`, sent: i }))
  const body = await mount('<lz-table source="dms" columns="user:Who,sent:Sent" sort="-sent" limit="5" searchable></lz-table>', { dms: rows })
  const table = body.querySelector('lz-table')!
  assert.equal(table.querySelectorAll('tbody tr').length, 5)
  assert.equal(table.querySelector('tbody td')!.textContent, 'user11')
  assert.match(table.querySelector('.lz-more')!.textContent!, /Show all 12/)
  const input = table.querySelector('input.lz-search') as unknown as HTMLInputElement
  input.value = 'user3'
  input.dispatchEvent(new win.Event('input') as unknown as Event)
  assert.equal(table.querySelectorAll('tbody tr').length, 1)
})

test('a chart draws a mark per series and offers a table', async () => {
  const body = await mount('<lz-chart kind="line" source="orders.by_day" x="day" y="units,returns"></lz-chart>', {
    orders: { by_day: [{ day: 'Mon', units: 3, returns: 1 }, { day: 'Tue', units: 5, returns: 2 }, { day: 'Wed', units: 4, returns: 0 }] },
  })
  const chart = body.querySelector('lz-chart')!
  assert.equal(chart.querySelectorAll('path.lz-line').length, 2)
  assert.equal(chart.querySelectorAll('.lz-legend li').length, 2)
  ;(chart.querySelector('.lz-chart-toggle') as unknown as HTMLElement).click()
  assert.equal(chart.querySelectorAll('.lz-chart-table tbody tr').length, 3)
})

test('a status picks its tone from the word', async () => {
  const body = await mount('<lz-status value="running"></lz-status><lz-status value="not kept"></lz-status><lz-status value="waiting"></lz-status>', {})
  const tones = [...body.querySelectorAll('.lz-status-badge')].map((b) => (b as unknown as HTMLElement).dataset.tone)
  assert.deepEqual(tones, ['live', 'bad', 'wait'])
})

test('tabs show one panel at a time', async () => {
  const body = await mount('<lz-tabs><lz-tab label="A">one</lz-tab><lz-tab label="B" selected>two</lz-tab></lz-tabs>', {})
  await settle()
  const panels = [...body.querySelectorAll('lz-tab')] as unknown as HTMLElement[]
  assert.deepEqual(panels.map((p) => p.hidden), [true, false])
  ;(body.querySelector('[role=tab]') as unknown as HTMLElement).click()
  assert.deepEqual(panels.map((p) => p.hidden), [false, true])
})

test('a list never repeats its main line as the second line', async () => {
  const body = await mount('<lz-list source="rows" primary="description"></lz-list>', { rows: [{ description: 'Laptop cleanup', status: 'done' }] })
  assert.equal(body.querySelectorAll('.lz-list-secondary').length, 0)
})

test('a chart hides its crosshair until something is hovered', async () => {
  const body = await mount('<lz-chart kind="bar" source="d" x="x" y="v"></lz-chart>', { d: [{ x: 'a', v: 1 }, { x: 'b', v: 2 }] })
  const cross = body.querySelector('.lz-crosshair')!
  assert.equal(cross.getAttribute('visibility'), 'hidden')
  assert.equal(body.querySelectorAll('lz-chart svg rect[pointer-events="all"]').length, 1)
})

test('a page with no title starts with its content, and a titled one keeps its header', async () => {
  const bare = await mount('<lz-page><lz-stat label="Runs" source="runs"></lz-stat></lz-page>', { runs: 3 })
  assert.equal((bare.querySelector('.lz-page-head') as unknown as HTMLElement).hidden, true)
  const titled = await mount('<lz-page title="Sales"></lz-page>', {})
  assert.equal((titled.querySelector('.lz-page-head') as unknown as HTMLElement).hidden, false)
})
