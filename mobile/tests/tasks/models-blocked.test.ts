import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpen, groupTasks } from '../../src/tasks/models';
import type { Task } from '../../src/api/tasks';

const blocked = (id: string): Task => ({
  taskId: id, userId: 'u', recordingId: '', text: 'x', kind: 'other',
  status: 'blocked', createdAt: '2026-09-14T09:00:00Z', updatedAt: '2026-09-14T09:00:00Z',
});

test('a blocked task is open — it is waiting on an answer, not settled', () => {
  assert.equal(isOpen({ status: 'blocked' }), true);
});

test('a blocked task lands in the open group, not lost', () => {
  const groups = groupTasks([blocked('t1')]);
  assert.equal(groups.open.length, 1);
  assert.equal(groups.open[0].taskId, 't1');
});
