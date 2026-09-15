import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arc, labelStride, linear, niceStep, niceTicks, yDomain } from '../src/chart/scale.ts'
import { buildModel, MAX_SERIES, slices } from '../src/chart/model.ts'

test('ticks land on numbers an axis reads cleanly', () => {
  assert.equal(niceStep(21.75), 25)
  assert.equal(niceStep(0.13), 0.2)
  assert.deepEqual(niceTicks(0, 87, 4), { lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100] })
  assert.deepEqual(niceTicks(0, 0.9, 4).ticks, [0, 0.25, 0.5, 0.75, 1])
  assert.deepEqual(niceTicks(5, 5).ticks.length > 1, true)
})

test('bars start at zero; a line far above zero starts near its data', () => {
  assert.deepEqual(yDomain([40, 60], true), [0, 60])
  assert.deepEqual(yDomain([40, 60], false), [40, 60])
  assert.deepEqual(yDomain([-5, 10], true), [-5, 10])
  assert.deepEqual(yDomain([], false), [0, 1])
})

test('a scale maps its domain onto its range, and labels thin to fit', () => {
  const y = linear([0, 100], [200, 0])
  assert.equal(y(25), 150)
  assert.equal(labelStride(30, 300, 40), 6)
  assert.equal(labelStride(4, 600, 40), 1)
  assert.match(arc(50, 50, 40, 25, 0, Math.PI / 2), /^M 50\.00 10\.00 A 40 40 0 0 1/)
})

test('wide rows become one series per numeric key, x guessed', () => {
  const m = buildModel(
    [
      { day: '2026-09-14', units: 3, returns: 1, note: 'x' },
      { day: '2026-09-15', units: 5, returns: '2', note: 'y' },
    ],
    {},
  )
  assert.deepEqual(m.categories, ['2026-09-14', '2026-09-15'])
  assert.deepEqual(m.series.map((s) => [s.name, s.values]), [
    ['Units', [3, 5]],
    ['Returns', [1, 2]],
  ])
})

test('long rows split by the series key, keeping first-seen order', () => {
  const m = buildModel(
    [
      { week: 'W1', channel: 'Instagram', dms: 10 },
      { week: 'W1', channel: 'WhatsApp', dms: 4 },
      { week: 'W2', channel: 'Instagram', dms: 12 },
    ],
    { x: 'week', y: 'dms', series: 'channel' },
  )
  assert.deepEqual(m.categories, ['W1', 'W2'])
  assert.deepEqual(m.series.map((s) => [s.name, s.slot, s.values]), [
    ['Instagram', 0, [10, 12]],
    ['WhatsApp', 1, [4, null]],
  ])
})

test('an object of numbers is one series over its keys', () => {
  const m = buildModel({ Mon: 3, Tue: 5 }, {})
  assert.deepEqual(m.categories, ['Mon', 'Tue'])
  assert.deepEqual(m.series[0].values, [3, 5])
})

test('past five series the rest fold into Other instead of reusing a colour', () => {
  const row = Object.fromEntries([['x', 'a'], ...Array.from({ length: 8 }, (_, i) => [`s${i}`, i + 1])])
  const m = buildModel([row], {})
  assert.equal(m.series.length, MAX_SERIES)
  assert.equal(m.folded, 4)
  assert.equal(m.series.at(-1)!.name, 'Other (4)')
  assert.deepEqual(m.series.at(-1)!.values, [5 + 6 + 7 + 8])
  assert.deepEqual(new Set(m.series.map((s) => s.slot)).size, MAX_SERIES)
})

test('a donut keeps its biggest slices in their own order and folds the rest', () => {
  const m = buildModel([{ x: 'a', v: 1 }, { x: 'b', v: 9 }, { x: 'c', v: 5 }, { x: 'd', v: 8 }, { x: 'e', v: 7 }, { x: 'f', v: 2 }, { x: 'g', v: 0 }], { y: 'v' })
  const s = slices(m)
  assert.deepEqual(s.map((d) => d.name), ['b', 'c', 'd', 'e', 'Other (2)'])
  assert.equal(s.at(-1)!.value, 3)
})
