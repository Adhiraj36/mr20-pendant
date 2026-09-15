/**
 * The memory copy is app spec §2.10 and §2.11, verbatim — pinned rather than
 * described, because a screen reads these strings out loud to the user and a
 * drift here is a drift in what the product claims it did.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryRow, memoryRows, voiceToolNote } from '../../src/state/memorySteps';

test('a recall reads MEMORY · SEARCHING, then how it ended', () => {
  assert.deepEqual(
    memoryRow({ name: 'memory.recall', status: 'start' }),
    { label: 'MEMORY', value: 'SEARCHING', live: true },
  );
  assert.deepEqual(
    memoryRow({ name: 'memory.recall', status: 'done', hits: 3 }),
    { label: 'MEMORY', value: '3 RECALLED' },
  );
  assert.deepEqual(
    memoryRow({ name: 'memory.recall', status: 'done', hits: 0 }),
    { label: 'MEMORY', value: 'NOTHING RELEVANT' },
  );
  // No count at all is the same fact as a count of zero: nothing came back.
  assert.deepEqual(
    memoryRow({ name: 'memory.recall', status: 'done' }),
    { label: 'MEMORY', value: 'NOTHING RELEVANT' },
  );
  assert.deepEqual(
    memoryRow({ name: 'memory.recall', status: 'failed' }),
    { label: 'MEMORY', value: 'UNAVAILABLE' },
  );
});

test('a write reads REMEMBERING, then how it ended', () => {
  assert.deepEqual(
    memoryRow({ name: 'memory.ingest', status: 'start' }),
    { label: 'REMEMBERING', live: true },
  );
  assert.deepEqual(memoryRow({ name: 'memory.ingest', status: 'done' }), { label: 'REMEMBERED' });
  assert.deepEqual(
    memoryRow({ name: 'memory.ingest', status: 'failed' }),
    { label: 'COULD NOT REMEMBER THIS' },
  );
});

test('an unknown tool falls back to its own name', () => {
  assert.deepEqual(
    memoryRow({ name: 'calendar.read', status: 'start' }),
    { label: 'calendar.read', live: true },
  );
});

test('a run shows one row per tool, in the order they first ran', () => {
  const rows = memoryRows([
    { name: 'memory.recall', status: 'done', hits: 2 },
    { name: 'memory.ingest', status: 'start' },
  ]);
  assert.deepEqual(rows, [
    { label: 'MEMORY', value: '2 RECALLED' },
    { label: 'REMEMBERING', live: true },
  ]);
});

test('a tool that ran twice collapses to where it got to', () => {
  const rows = memoryRows([
    { name: 'memory.recall', status: 'done', hits: 1 },
    { name: 'memory.recall', status: 'done', hits: 4 },
  ]);
  // One row, so the block's row key (the label) stays unique.
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { label: 'MEMORY', value: '4 RECALLED' });
});

test('the call names the two memory verbs its own way', () => {
  assert.equal(voiceToolNote('memory.ingest'), 'REMEMBERING');
  assert.equal(voiceToolNote('memory.recall'), 'SEARCHING MEMORY');
});

test('filing a task for the laptop is a step the thread shows', () => {
  // The assistant is the one surface where a tool *does* something rather
  // than looking something up, so the row says it plainly — and never that
  // the work is finished, which is the laptop's to report.
  assert.deepEqual(
    memoryRow({ name: 'task.sent', status: 'done' }),
    { label: 'SENT TO YOUR LAPTOP' },
  );
  assert.deepEqual(
    memoryRow({ name: 'task.sent', status: 'failed' }),
    { label: 'COULD NOT SEND TO YOUR LAPTOP' },
  );
  assert.deepEqual(
    memoryRow({ name: 'task.sent', status: 'start' }),
    { label: 'SENDING TO YOUR LAPTOP', live: true },
  );
});
