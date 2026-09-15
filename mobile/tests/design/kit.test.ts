/**
 * The kit's decisions — plan §4, T5's "pure models with tests".
 *
 * `src/design/kit/models.ts` is React-free precisely so this file can reach
 * it: which face a task card wears, what a finished task prints, how a label
 * joins, how a code splits into boxes and which ink was stored are five
 * rules, and a regression in a *rule* should be caught here rather than by
 * looking at a simulator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inks, INK_STORAGE_KEY as PACKAGE_KEY, toggle, stampAngle } from '@lyzn/design';
import {
  taskCardState, taskTag, taskKindLabel, taskEyebrow,
  receiptFromTask, receiptClock,
  metaLine, countLabel, conversationChips,
  codeBoxes, parseInk, isInk, inkHex, DEFAULT_INK, INK_STORAGE_KEY,
  RECEIPT_GROUND,
  type TaskLike, type TaskStatus,
} from '../../src/design/kit/models';

// -- taskCardState ---------------------------------------------------------

test('with execution off, everything unfinished is the capture card', () => {
  const off = { execution: false };
  assert.equal(taskCardState('proposed', off), 'capture');
  assert.equal(taskCardState('approved', off), 'capture');
});

test('with execution on, a task walks proposed → running → done', () => {
  const on = { execution: true };
  assert.equal(taskCardState('proposed', on), 'waiting');
  assert.equal(taskCardState('approved', on), 'running');
  assert.equal(taskCardState('done', on), 'done');
});

test('failed and done do not care whether execution is unlocked', () => {
  for (const execution of [true, false]) {
    assert.equal(taskCardState('failed', { execution }), 'failed');
    assert.equal(taskCardState('done', { execution }), 'done');
  }
});

test('a blocked task wears its own face — not proposed, not running, not failed', () => {
  for (const execution of [true, false]) {
    assert.equal(taskCardState('blocked', { execution }), 'blocked');
  }
  assert.equal(taskTag('blocked'), 'NEEDS AN ANSWER');
  // Distinct from the two it must not be confused with.
  assert.notEqual(taskTag('blocked'), taskTag('approved'));
  assert.notEqual(taskTag('blocked'), taskTag('failed'));
});

test('a dismissed task wears the done card — settled business, no actions', () => {
  assert.equal(taskCardState('dismissed', { execution: true }), 'done');
  // …and is told apart by its tag, which is the only thing that differs.
  assert.equal(taskTag('dismissed'), 'DROPPED');
  assert.equal(taskTag('done'), 'DONE ✓');
});

test('every status has a state, and it is one of the six the canvas draws', () => {
  const states = new Set(['waiting', 'running', 'done', 'failed', 'capture', 'blocked']);
  const all: TaskStatus[] = ['proposed', 'approved', 'blocked', 'done', 'dismissed', 'failed'];
  for (const status of all) {
    for (const execution of [true, false]) {
      assert.ok(states.has(taskCardState(status, { execution })), `${status}/${execution}`);
    }
  }
});

test('only the two that are acting carry a tag; waiting and proposed do not', () => {
  assert.equal(taskTag('proposed'), undefined);
  assert.equal(taskTag('approved'), 'RUNNING');
  assert.equal(taskTag('failed'), "DIDN'T GO THROUGH");
});

// -- the kind, and the eyebrow it opens ------------------------------------

test('the capture tier says "would": it cannot act, so every verb is conditional', () => {
  assert.equal(taskKindLabel('message'), 'SENDS A MESSAGE');
  assert.equal(taskKindLabel('message', { capture: true }), 'WOULD SEND A MESSAGE');
  assert.equal(taskKindLabel('spend', { capture: true }), 'WOULD SPEND');
});

test('the eyebrow carries the amount with the verb and the target after the dot', () => {
  assert.equal(
    taskEyebrow({ kind: 'spend', owner: 'Karachi Bakery' }, { amount: '₹540' }),
    'SPENDS ₹540 · KARACHI BAKERY',
  );
});

test('an eyebrow with no owner is the verb alone — never a trailing dot', () => {
  assert.equal(taskEyebrow({ kind: 'reminder' }), 'REMINDS YOU');
});

// -- receiptFromTask -------------------------------------------------------

const DONE: TaskLike = {
  taskId: 't-0412',
  text: 'Send the revised quote to Ravi K.',
  kind: 'message',
  status: 'done',
  owner: 'Ravi K.',
  quote: "I'll send you the revised quote before lunch.",
  recordingId: 'rec-9',
  doneAt: '2026-09-08T11:05:07.000Z',
};

test('only a finished task prints — the rule stated as a return type', () => {
  for (const status of ['proposed', 'approved', 'dismissed', 'failed'] as TaskStatus[]) {
    assert.equal(receiptFromTask({ ...DONE, status }), null, status);
  }
  assert.notEqual(receiptFromTask(DONE), null);
});

test('the slip carries the task, who it was for, and the moment it was marked', () => {
  const receipt = receiptFromTask(DONE)!;
  assert.equal(receipt.kind, 'task');
  assert.equal(receipt.taskId, 't-0412');
  assert.equal(receipt.recordingId, 'rec-9');
  assert.equal(receipt.stamp, 'DONE');
  assert.equal(receipt.quote, DONE.quote);
  assert.deepEqual(receipt.rows.map((r) => r.k), ['TASK', 'TO', 'KIND', 'MARKED DONE']);
  assert.equal(receipt.rows[1]?.v, 'RAVI K.');
  // The one row in settled green: the line the whole slip exists to carry.
  assert.equal(receipt.rows.filter((r) => r.ok).length, 1);
  assert.equal(receipt.rows[3]?.ok, true);
});

test('a task with no owner and no time prints the rows it actually has', () => {
  const receipt = receiptFromTask({ ...DONE, owner: undefined, doneAt: undefined })!;
  assert.deepEqual(receipt.rows.map((r) => r.k), ['TASK', 'KIND']);
});

test('the title defaults to the shipped one and is overridable from config', () => {
  assert.equal(receiptFromTask(DONE)!.title, 'LYZN · PROOF OF WORK');
  assert.equal(receiptFromTask(DONE, { title: 'LYZN · PROOF' })!.title, 'LYZN · PROOF');
});

test('a receipt states its time to the second, because it is proof', () => {
  // Built from local parts so the assertion does not depend on the zone the
  // test happens to run in — the formatting is what is under test.
  const local = new Date(2026, 8, 8, 9, 4, 5).toISOString();
  assert.equal(receiptClock(local), '09:04:05');
  assert.equal(receiptClock('not a date'), 'not a date');
});

// -- labels ----------------------------------------------------------------

test('a meta line joins with " · " and drops every empty fragment', () => {
  assert.equal(metaLine(['11:04', 'OFFICE', '22 MIN']), '11:04 · OFFICE · 22 MIN');
  assert.equal(metaLine(['11:04', undefined, false, null, '', 'OFFICE']), '11:04 · OFFICE');
  assert.equal(metaLine([undefined, false]), '');
  assert.equal(metaLine(['TASKS', 3]), 'TASKS · 3');
});

test('a count of zero is not news: it drops out of the line it would join', () => {
  assert.equal(countLabel(0, 'COMMITMENT'), undefined);
  assert.equal(countLabel(-2, 'COMMITMENT'), undefined);
  assert.equal(countLabel(Number.NaN, 'COMMITMENT'), undefined);
  assert.equal(countLabel(1, 'COMMITMENT'), '1 COMMITMENT');
  assert.equal(countLabel(2, 'COMMITMENT'), '2 COMMITMENTS');
  assert.equal(countLabel(6, 'KEY POINT'), '6 KEY POINTS');
});

test('a conversation shows the languages it heard, then what it owes, then what it settled', () => {
  assert.deepEqual(conversationChips({ languages: ['te', 'en'], commitments: 2 }), [
    { label: 'TE + EN', tone: 'faint' },
    { label: '2 COMMITMENTS', tone: 'stamp' },
  ]);
  assert.deepEqual(conversationChips({ languages: ['en'], done: 1 }), [
    { label: 'EN', tone: 'faint' },
    { label: '1 DONE ✓', tone: 'settled' },
  ]);
  assert.deepEqual(conversationChips({}), []);
});

// -- codeBoxes -------------------------------------------------------------

test('a code fills its boxes left to right and puts the caret in the next one', () => {
  const boxes = codeBoxes('419', 6);
  assert.deepEqual(boxes.chars, ['4', '1', '9', '', '', '']);
  assert.equal(boxes.filled, 3);
  assert.equal(boxes.caret, 3);
  assert.equal(boxes.complete, false);
});

test('a complete code has no caret — there is no next box to point at', () => {
  const boxes = codeBoxes('419283', 6);
  assert.equal(boxes.caret, -1);
  assert.equal(boxes.complete, true);
  assert.deepEqual(boxes.chars, ['4', '1', '9', '2', '8', '3']);
});

test('an empty value is six empty boxes with the caret in the first', () => {
  const boxes = codeBoxes('', 6);
  assert.equal(boxes.chars.length, 6);
  assert.equal(boxes.caret, 0);
  assert.equal(boxes.filled, 0);
});

test('anything past the length is dropped rather than wrapped', () => {
  const boxes = codeBoxes('4192837', 6);
  assert.deepEqual(boxes.chars, ['4', '1', '9', '2', '8', '3']);
  assert.equal(boxes.filled, 6);
});

test('the length is the caller\'s: four boxes is a four-digit code', () => {
  const boxes = codeBoxes('41', 4);
  assert.equal(boxes.chars.length, 4);
  assert.equal(boxes.caret, 2);
});

// -- the ink ---------------------------------------------------------------

test('the storage key is the package\'s, so the app and the site agree', () => {
  assert.equal(INK_STORAGE_KEY, PACKAGE_KEY);
  assert.equal(INK_STORAGE_KEY, 'lyzn.ink');
});

test('the default ink is the one the package marks, not a string written here', () => {
  const marked = inks.find((ink) => 'default' in ink && ink.default);
  assert.ok(marked);
  assert.equal(DEFAULT_INK, marked.id);
});

test('there are six inks, and each has a swatch', () => {
  assert.equal(inks.length, 6);
  for (const ink of inks) assert.match(inkHex(ink.id), /^#[0-9A-Fa-f]{6}$/);
});

test('storage answering with nothing, or with junk, is the default ink', () => {
  assert.equal(parseInk(null), DEFAULT_INK);
  assert.equal(parseInk(undefined), DEFAULT_INK);
  assert.equal(parseInk(''), DEFAULT_INK);
  // An id an older build wrote and this one has dropped: silently the
  // default, never a picker that refuses to render.
  assert.equal(parseInk('teal'), DEFAULT_INK);
});

test('a stored id the package still knows is kept exactly', () => {
  assert.equal(parseInk('blue'), 'blue');
  assert.equal(isInk('blue'), true);
  assert.equal(isInk('teal'), false);
  assert.equal(isInk(7), false);
});

// -- the constants the kit draws from --------------------------------------

test('receipts never go dark: the kit names one ground for them', () => {
  assert.equal(RECEIPT_GROUND, 'paper');
});

test('the one pill and the stamp angle come from the package, not the kit', () => {
  assert.deepEqual({ ...toggle }, { w: 44, h: 26, radius: 13 });
  assert.equal(stampAngle, -11);
});
