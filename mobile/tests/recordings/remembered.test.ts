import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rememberedLabel } from '../../src/recordings/remembered.ts';

// The count on Ask lyzn says what memory holds. It used to count recordings,
// which is a different number: every recording failed to file for months and
// the screen still claimed them.

test('counts what was filed, not what was recorded', () => {
  const label = rememberedLabel([
    { memoryStatus: 'ingested' },
    { memoryStatus: 'ingested' },
    { memoryStatus: 'failed' },
  ]);
  assert.equal(label, '2 CONVERSATIONS REMEMBERED');
});

test('one is a conversation', () => {
  assert.equal(rememberedLabel([{ memoryStatus: 'ingested' }]), '1 CONVERSATION REMEMBERED');
});

test('says filing while a recording is still on its way to memory', () => {
  assert.equal(rememberedLabel([{ memoryStatus: undefined }]), 'FILING WHAT YOU SAID');
  assert.equal(rememberedLabel([{ memoryStatus: 'pending' }]), 'FILING WHAT YOU SAID');
});

test('does not claim a memory that failed', () => {
  assert.equal(rememberedLabel([{ memoryStatus: 'failed' }]), 'NOTHING FILED TO MEMORY YET');
});

test('an empty account says so plainly', () => {
  assert.equal(rememberedLabel([]), 'NOTHING RECORDED YET');
});
