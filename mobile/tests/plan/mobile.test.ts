/**
 * The chooser's one gate: what counts as a mobile number, and what the screen
 * is allowed to say about a number while it is still being typed.
 *
 * `src/plan/mobile.ts` imports nothing, so all of it is assertable here —
 * which matters, because the alternative way to find out that RESERVE is
 * pressable on an empty box is to reach the Razorpay sheet on a real phone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canReserve, cleanMobile, isMobile, mobileDigits, mobileState,
} from '../../src/plan/mobile';

/* ── Ten digits, however they arrived ─────────────────────────────────── */

test('a country code and a trunk zero are not part of the number', () => {
  assert.equal(mobileDigits('9849044417'), '9849044417');
  assert.equal(mobileDigits('+91 98490 44417'), '9849044417');
  assert.equal(mobileDigits('919849044417'), '9849044417');
  assert.equal(mobileDigits('09849044417'), '9849044417');
  assert.equal(mobileDigits('(98490) 44417'), '9849044417');
});

test('the rule is ten digits starting 6–9', () => {
  assert.equal(isMobile('9849044417'), true);
  assert.equal(isMobile('+91 98490 44417'), true);
  assert.equal(isMobile('6000000000'), true);
  // A landline-shaped first digit, one digit short, one digit over.
  assert.equal(isMobile('5849044417'), false);
  assert.equal(isMobile('984904441'), false);
  assert.equal(isMobile('98490444171'), false);
  assert.equal(isMobile(''), false);
});

/* ── What the screen may say while it is being typed ──────────────────── */

test('an empty box is not an error, and is not reservable either', () => {
  assert.equal(mobileState(''), 'empty');
  assert.equal(mobileState('   '), 'empty');
  assert.equal(mobileState('+'), 'empty');
  assert.equal(canReserve(''), false);
});

test('a half-typed number is partial, not wrong', () => {
  assert.equal(mobileState('9'), 'partial');
  assert.equal(mobileState('98490'), 'partial');
  assert.equal(mobileState('984904441'), 'partial');
  // Still being typed towards `09849044417`, which is a real number.
  assert.equal(mobileState('0984904'), 'partial');
});

test('a number that cannot become right is wrong at once', () => {
  assert.equal(mobileState('5849044417'), 'invalid');
  assert.equal(mobileState('98490444171'), 'invalid');
  assert.equal(mobileState('+91 58490 44417'), 'invalid');
});

test('only ok reserves', () => {
  assert.equal(mobileState('9849044417'), 'ok');
  assert.equal(canReserve('+91 98490 44417'), true);
  assert.equal(canReserve('98490 4441'), false);
  assert.equal(canReserve('5849044417'), false);
});

/* ── What the box will take ───────────────────────────────────────────── */

test('the box keeps how people write a number and drops the rest', () => {
  assert.equal(cleanMobile('+91 (98490) 44-417'), '+91 (98490) 44-417');
  assert.equal(cleanMobile('call me: 9849044417'), '  9849044417');
  assert.equal(cleanMobile('tel:9849044417'), '9849044417');
});
