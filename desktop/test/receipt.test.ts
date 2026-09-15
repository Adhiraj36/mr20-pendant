// A stored receipt, read the way the slip prints it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Ticket } from '../electron/shared/types.js'
import { duration, outcomeLine, slipRows, spokenOf, summaryOf, when } from '../src/routes/tasks/receipt.js'

const now = new Date('2026-09-15T12:00:00')

const task = (over: Partial<Ticket> = {}): Ticket => ({
  taskId: 't1',
  text: 'DM everyone who commented LYZN',
  kind: 'message',
  quote: 'DM everyone who commented LYZN',
  dueAt: '',
  createdAt: '2026-09-14T13:14:00',
  status: 'failed',
  mine: true,
  claimedAt: '2026-09-14T16:32:00',
  finishedAt: '2026-09-14T16:36:21',
  context: { title: '', summary: '', facts: [] },
  receipt: null,
  ...over,
})

test('instants read as a day and a time, with a year only when it differs', () => {
  assert.equal(when('2026-09-14T13:14:00', now), '14 Sep, 13:14')
  assert.equal(when('2025-12-31T09:05:00', now), '31 Dec 2025, 09:05')
  assert.equal(when('not a date', now), 'not a date')
})

test('durations read the way the slip prints them', () => {
  assert.equal(duration('2026-09-14T16:32:00', '2026-09-14T16:36:21'), '4m 21s')
  assert.equal(duration('2026-09-14T16:32:00', '2026-09-14T16:32:09'), '9s')
  assert.equal(duration('2026-09-14T16:32:00', '2026-09-14T16:31:00'), null)
})

test('the backend record becomes three readable rows', () => {
  const t = task({
    receipt: {
      receiptId: 'r1',
      title: 'x',
      stamp: 'FAILED',
      rows: [
        { k: 'KIND', v: 'MESSAGE' },
        { k: 'PROMISED', v: '2026-09-14T13:14:00' },
        { k: 'RAN ON', v: "0MelloB's MacBook" },
        { k: 'STARTED', v: '2026-09-14T16:32:00' },
        { k: 'FINISHED', v: '2026-09-14T16:36:21' },
        { k: 'STATUS', v: 'FAILED' },
      ],
    },
  })
  assert.deepEqual(slipRows(t, now), [
    { k: 'PROMISED', v: '14 Sep, 13:14' },
    { k: 'RAN ON', v: "0MelloB's MacBook" },
    { k: 'Took', v: '4m 21s' },
  ])
})

test('what a run produced is kept, and a missing machine is filled in', () => {
  const t = task({
    mine: false,
    receipt: { receiptId: 'r1', title: 'x', stamp: 'DONE', rows: [{ k: 'PRODUCED', v: '~/colours.txt', ok: true }] },
  })
  assert.deepEqual(slipRows(t, now), [
    { k: 'PRODUCED', v: '~/colours.txt', ok: true },
    { k: 'Ran on', v: 'Another machine' },
    { k: 'Took', v: '4m 21s' },
  ])
})

test('a quote that is only the fallback to the person’s words is not a summary', () => {
  const r = { receiptId: 'r1', title: 'x', stamp: 'DONE' }
  assert.equal(summaryOf(task({ receipt: { ...r, quote: 'DM everyone who commented “LYZN”' } })), '')
  assert.equal(summaryOf(task({ receipt: { ...r, quote: 'the coding harness returned nothing' } })), 'the coding harness returned nothing')
  assert.equal(spokenOf(task()), '')
  assert.equal(spokenOf(task({ quote: 'message everyone who says LYZN the link' })), 'message everyone who says LYZN the link')
})

test('a summary reads as a sentence with no engine vocabulary', () => {
  assert.equal(outcomeLine('the coding harness returned nothing'), 'The assistant finished without reporting back.')
  assert.equal(outcomeLine('sent 38 DMs and replied to each comment'), 'Sent 38 DMs and replied to each comment.')
  assert.equal(outcomeLine('Stopped from the laptop.'), 'Stopped from the laptop.')
  assert.equal(outcomeLine('the harness timed out'), 'The assistant timed out.')
  assert.equal(outcomeLine('   '), '')
})
