import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isEmpty, parseSource, pick, sourceKey } from '../src/source.ts'

test('a file, a path into it, and a live source', () => {
  assert.deepEqual(parseSource('orders'), { live: false, name: 'orders', path: [] })
  assert.deepEqual(parseSource(' orders.by_day '), { live: false, name: 'orders', path: ['by_day'] })
  assert.deepEqual(parseSource('live:activity.items.0.text'), { live: true, name: 'activity', path: ['items', 0, 'text'] })
  assert.equal(sourceKey(parseSource('live:activity.items')!), 'live:activity')
})

test('names an agent could get wrong are refused, not guessed at', () => {
  for (const bad of ['', 'Orders', 'orders..x', 'orders.', '../etc', 'live:', 'a b']) {
    assert.equal(parseSource(bad), null, bad)
  }
})

test('a path walks objects and arrays, and stops quietly at a gap', () => {
  const v = { by_day: [{ units: 3 }, { units: 5 }] }
  assert.equal(pick(v, ['by_day', 1, 'units']), 5)
  assert.equal(pick(v, ['by_day', 7, 'units']), undefined)
  assert.equal(pick(v, ['missing', 'x']), undefined)
  assert.equal(pick(42, ['x']), undefined)
})

test('empty means nothing to draw', () => {
  for (const e of [null, undefined, '', [], {}]) assert.equal(isEmpty(e), true)
  for (const v of [0, false, 'x', [0], { a: 1 }]) assert.equal(isEmpty(v), false)
})
