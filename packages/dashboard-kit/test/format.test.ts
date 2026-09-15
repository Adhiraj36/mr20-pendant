import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ago, bytes, compact, currency, date, duration, format, percent } from '../src/format.ts'

test('compact stays exact below ten thousand', () => {
  assert.equal(compact(1284), '1,284')
  assert.equal(compact(12_900), '12.9K')
  assert.equal(compact(4_200_000), '4.2M')
  assert.equal(compact(250_000), '250K')
  assert.equal(compact(3.25), '3.3')
})

test('percent accepts a fraction or a whole number', () => {
  assert.equal(percent(0.42), '42%')
  assert.equal(percent(42), '42%')
  assert.equal(percent(0.035), '3.5%')
})

test('money, time and sizes', () => {
  assert.equal(currency(5999), '₹5,999')
  assert.equal(currency(12.5, 'USD'), '$12.50')
  assert.equal(duration(261), '4m 21s')
  assert.equal(duration(7500), '2h 05m')
  assert.equal(bytes(1536), '1.5 KB')
  assert.equal(date('2026-09-14T13:14:00', new Date('2026-09-15T00:00:00')), '14 Sep')
  assert.equal(ago('2026-09-15T11:57:00Z', Date.parse('2026-09-15T12:00:00Z')), '3 min ago')
})

test('format dispatches by name and never throws on odd input', () => {
  assert.equal(format(null, 'number'), '—')
  assert.equal(format(0.5, 'percent'), '50%')
  assert.equal(format('n/a', 'compact'), 'n/a')
  assert.equal(format(12, 'no-such-format'), '12')
  assert.equal(format({ a: 1 }), '{"a":1}')
})
