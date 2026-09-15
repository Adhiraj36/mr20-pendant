/**
 * A conversation as a receipt (app spec §2.6) — the facts and the tasks the
 * `/recordings` API returns, turned into rows and nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TASK_ROWS, openRowKey, slipFacts, slipFooter, slipTasks, slipTitle,
} from '../../src/recordings/slip';
import { receiptBands } from '../../src/design/receiptLogic';
import type { RecordingStatus } from '../../src/api/client';

const speaker = (index: number) => (index === 0 ? 'Kartik' : `Speaker ${index + 1}`);

test('the slip header is the conversation s own start time', () => {
  assert.equal(slipTitle(new Date(2026, 8, 7, 9, 41).toISOString()), 'LYZN · 09:41');
  assert.equal(slipTitle('not a date'), 'LYZN');
});

test('the open row is the status, and only while there is one', () => {
  assert.equal(openRowKey('pending'), 'ON PHONE');
  assert.equal(openRowKey('uploaded'), 'QUEUED');
  assert.equal(openRowKey('processing'), 'TRANSCRIBING');
  assert.equal(openRowKey('ready'), null);
  assert.equal(openRowKey('archived'), null);
  assert.equal(openRowKey('failed'), null);
});

test('an unrecognised status closes quietly — the discipline `default: null` already had', () => {
  // 'transcribed' sits between processing and ready (spec's 2026-09-14
  // amendment). The slip does not have to say anything new about it yet —
  // it only must not throw, the same as any future status it has not been
  // taught about.
  assert.equal(openRowKey('transcribed' as RecordingStatus), null);
});

test('the facts are speakers, length and the category — each dropped when absent', () => {
  assert.deepEqual(slipFacts({ speakerCount: 2, durationSeconds: 720 }, 'Work'), [
    { k: 'SPEAKERS', v: '2' },
    { k: 'LENGTH', v: '12M' },
    { k: 'FILED UNDER', v: 'WORK' },
  ]);
  // No category is no row, not an empty one (spec §0.3).
  assert.deepEqual(slipFacts({ speakerCount: 2, durationSeconds: 720 }), [
    { k: 'SPEAKERS', v: '2' },
    { k: 'LENGTH', v: '12M' },
  ]);
  assert.deepEqual(slipFacts({ durationSeconds: 0 }), []);
});

test('every task is a plain row, its owner the value, `—` when nobody owns it', () => {
  const rows = slipTasks(
    [{ text: 'Send the invoice', owner: 0 }, { text: 'Book the room', owner: null }],
    speaker,
  );
  assert.deepEqual(rows, [
    { k: 'Send the invoice', v: 'Kartik', plain: true },
    { k: 'Book the room', v: '—', plain: true },
  ]);
});

test('four tasks at most, then the slip counts the rest', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ text: `Task ${i}`, owner: null }));
  const rows = slipTasks(items, speaker);
  assert.equal(rows.length, MAX_TASK_ROWS + 1);
  assert.deepEqual(rows[MAX_TASK_ROWS], { k: '+ 2 MORE' });
  // The counting row is not a task: no value, no `plain`.
  assert.equal(rows[MAX_TASK_ROWS].v, undefined);
});

test('no action items is no rows at all', () => {
  assert.deepEqual(slipTasks(undefined, speaker), []);
  assert.deepEqual(slipTasks([], speaker), []);
});

test('the footer is the transaction id: the last eight characters, uppercased', () => {
  assert.equal(slipFooter('rec_01j9x3f9a2b1c'), 'TXN 3F9A2B1C');
  assert.equal(slipFooter('abcdefghij'), 'TXN CDEFGHIJ');
  assert.equal(slipFooter('short'), 'TXN SHORT');
});

/**
 * The band count the Library steps `printing.bands` through. Band 0 is the
 * header, so the queue's total is one more than this list — a drift here is
 * a slip that stops printing before its footer.
 */
test('a finished conversation prints four content bands: title, rows, barcode, footer', () => {
  const bands = receiptBands({
    quote: 'Standup with Ravi',
    rows: [slipFacts({ speakerCount: 2, durationSeconds: 720 }, 'Work'),
      slipTasks([{ text: 'Send the invoice', owner: 0 }], speaker)],
    barcodeSeed: 'rec_1',
    footer: slipFooter('rec_1'),
  });
  assert.deepEqual(bands, ['quote', 'rows', 'barcode', 'footer']);
});

test('a conversation with no title and no tasks still prints its facts', () => {
  const bands = receiptBands({
    quote: undefined,
    rows: [slipFacts({ speakerCount: 1, durationSeconds: 60 }), slipTasks(undefined, speaker)],
    barcodeSeed: 'rec_2',
    footer: slipFooter('rec_2'),
  });
  assert.deepEqual(bands, ['rows', 'barcode', 'footer']);
});

test('a slip with two empty row groups has no rows band', () => {
  assert.deepEqual(
    receiptBands({ rows: [[], []], barcodeSeed: 'x' }),
    ['barcode'],
  );
});
