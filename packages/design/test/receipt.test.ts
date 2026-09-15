import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barcodeBars } from '../src/receipt.ts'

test('same seed, same bars, on every call', () => {
  assert.deepEqual(barcodeBars('LYZN-ABC12'), barcodeBars('LYZN-ABC12'))
})
test('84 bars, each width 1 to 3', () => {
  const bars = barcodeBars('anything')
  assert.equal(bars.length, 84)
  assert.ok(bars.every((w) => w >= 1 && w <= 3))
})
test('different seeds differ', () => {
  assert.notDeepEqual(barcodeBars('LYZN-A'), barcodeBars('LYZN-B'))
})
