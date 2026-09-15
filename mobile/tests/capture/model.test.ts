import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canStart, captureName, elapsed, entitledToPhoneCapture, nearingLimit,
  shouldStop, tooShort, MAX_SECONDS, MIN_SECONDS, WARN_SECONDS,
} from '../../src/capture/model.ts';

// The pendant wins whenever it is there: two microphones on one conversation
// is two transcripts of it, and a bill for both.
test('a paired pendant takes precedence over the phone', () => {
  assert.equal(canStart({ entitled: true, pendantPaired: true, state: 'idle' }), false);
});

test('no plan, no phone recording', () => {
  assert.equal(canStart({ entitled: false, pendantPaired: false, state: 'idle' }), false);
});

test('a finished or failed capture can be started again; one in flight cannot', () => {
  for (const state of ['idle', 'done', 'failed'] as const) {
    assert.equal(canStart({ entitled: true, pendantPaired: false, state }), true, state);
  }
  for (const state of ['arming', 'recording', 'saving'] as const) {
    assert.equal(canStart({ entitled: true, pendantPaired: false, state }), false, state);
  }
});

test('entitlement is the deployment and the plan, separately', () => {
  assert.equal(entitledToPhoneCapture({ phoneCaptureEnabled: false, tier: 'act' }), false);
  assert.equal(entitledToPhoneCapture({ phoneCaptureEnabled: true, tier: 'none' }), false);
  assert.equal(entitledToPhoneCapture({ phoneCaptureEnabled: true, tier: 'capture' }), true);
});

test('the clock reads the way a recording counts', () => {
  assert.equal(elapsed(0), '00:00');
  assert.equal(elapsed(9), '00:09');
  assert.equal(elapsed(252), '04:12');
  assert.equal(elapsed(3600), '1:00:00');
  assert.equal(elapsed(-5), '00:00');
});

test('a slip of the thumb is not a conversation', () => {
  assert.equal(tooShort(MIN_SECONDS - 0.1), true);
  assert.equal(tooShort(MIN_SECONDS), false);
});

test('it warns before it stops itself, and then stops', () => {
  assert.equal(nearingLimit(WARN_SECONDS - 1), false);
  assert.equal(nearingLimit(WARN_SECONDS), true);
  assert.equal(nearingLimit(MAX_SECONDS), false, 'past the limit it is stopping, not warning');
  assert.equal(shouldStop(MAX_SECONDS - 1), false);
  assert.equal(shouldStop(MAX_SECONDS), true);
});

test('a phone recording is filed the way the pendant files one', () => {
  const { folder, file } = captureName(new Date(2026, 8, 9, 2, 5, 7));
  assert.equal(folder, 'PHONE');
  assert.equal(file, '20260909-020507.m4a');
});
