/**
 * Who is offered a task to write, and what the offer does when tapped.
 *
 * The same three-way answer the segment's upsell strip is drawn from, said
 * once so the button and the strip cannot disagree about whether this account
 * can hand work to a laptop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeState } from '../../src/tasks/models';

test('with the deployment flag down there is nothing to offer', () => {
  // Not disabled — absent. There is no laptop surface in this build at all,
  // so a button that opens the chooser would be selling a thing that is off.
  assert.equal(composeState({ execution: false }, { automation: true }), 'hidden');
  assert.equal(composeState({ execution: false }, undefined), 'hidden');
});

test('the flag is up and the plan carries automation: send', () => {
  assert.equal(composeState({ execution: true }, { automation: true }), 'send');
});

test('the flag is up and the plan does not carry it: the chooser, not a 402', () => {
  assert.equal(composeState({ execution: true }, { automation: false }), 'unlock');
  assert.equal(composeState({ execution: true }, undefined), 'unlock');
});
