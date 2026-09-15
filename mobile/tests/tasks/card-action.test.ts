import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskCardAction } from '../../src/tasks/models';

// The regression these guard: the list card's primary button was wired to
// "select" for a waiting task, so tapping APPROVE never approved anything.
// The action a card offers must follow from its face, and be one of these.

test('a waiting card approves — it must not just select', () => {
  assert.equal(taskCardAction('waiting'), 'approve');
});

test('a blocked card answers the question that parked it', () => {
  assert.equal(taskCardAction('blocked'), 'answer');
});

test('a capture card marks done — lyzn cannot do this one for you', () => {
  assert.equal(taskCardAction('capture'), 'markDone');
});

test('running, done and failed cards offer nothing to tap', () => {
  for (const s of ['running', 'done', 'failed'] as const) {
    assert.equal(taskCardAction(s), undefined);
  }
});
