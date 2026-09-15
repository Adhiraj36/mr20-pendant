/**
 * Where a task lands in the list — including one the person just sent.
 *
 * The rule was inside the store, which imports the API client and therefore
 * Expo, and so could not be reached by `node --test`. It is the same rule a
 * page of tasks arriving from the network goes through; sending one is only
 * a page of one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTasks } from '../../src/tasks/merge';
import type { Task } from '../../src/api/tasks';

const task = (id: string, createdAt: string, over: Partial<Task> = {}): Task => ({
  taskId: id, userId: 'user_1', recordingId: '', text: id, kind: 'other',
  status: 'approved', createdAt, updatedAt: createdAt, ...over,
});

test('a task just sent is the newest thing in the list', () => {
  const held = [task('b', '2026-09-10T09:00:00Z'), task('a', '2026-09-09T09:00:00Z')];
  const next = mergeTasks(held, [task('c', '2026-09-11T09:00:00Z')]);
  assert.deepEqual(next.map((t) => t.taskId), ['c', 'b', 'a']);
});

test('the same task twice is one row, and the newer copy wins', () => {
  const held = [task('c', '2026-09-11T09:00:00Z')];
  const next = mergeTasks(held, [task('c', '2026-09-11T09:00:00Z', { text: 'edited' })]);
  assert.equal(next.length, 1);
  assert.equal(next[0].text, 'edited');
});

test('a task with no conversation behind it merges like any other', () => {
  // `own_…` ids and an empty recordingId are what POST /tasks writes.
  const sent = task('own_4f2a91c07b8d4e1fa6c35d9e8b210347', '2026-09-11T10:00:00Z');
  const next = mergeTasks([task('a', '2026-09-09T09:00:00Z')], [sent]);
  assert.equal(next[0].taskId, sent.taskId);
  assert.equal(next[0].recordingId, '');
});
