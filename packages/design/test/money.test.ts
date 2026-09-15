import { test } from 'node:test'
import assert from 'node:assert/strict'
import { money, monthly } from '../src/money.ts'
test('rupees group Indian-style with no paise', () => assert.equal(money(5999), '₹5,999'))
test('monthly keeps the slash on the same line', () => assert.equal(monthly(1500), '₹1,500 / month'))
