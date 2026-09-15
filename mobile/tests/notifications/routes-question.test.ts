import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFor, isPushType } from '../../src/notifications/routes';

test('task.question routes to the task detail screen', () => {
  assert.equal(routeFor({ type: 'task.question', taskId: 'tk_1' }), '/task/tk_1');
});

test('task.question with no id routes nowhere', () => {
  assert.equal(routeFor({ type: 'task.question' }), undefined);
});

test('task.question is a recognised push type', () => {
  assert.equal(isPushType('task.question'), true);
});
