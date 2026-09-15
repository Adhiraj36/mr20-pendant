/**
 * The web checkout's three moving parts: the URL the phone opens, the deep
 * link it comes back on, and the poll that waits for Razorpay's webhook.
 *
 * Every one of them is a pure function in `src/plan/checkout.ts`, which is
 * the point — the interesting behaviour of a payment is exactly the part
 * that cannot be exercised on a simulator without spending money.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SITE_URL,
  POLL_EVERY_MS,
  POLL_FOR_MS,
  RETURN_PREFIX,
  buildPayUrl,
  pollUntilPaid,
  pollVerdict,
  readPayResult,
  siteUrl,
  type OrderLike,
  type PayUrlInput,
} from '../../src/plan/checkout';

const order = (over: Partial<PayUrlInput> = {}): PayUrlInput => ({
  reference: 'LYZN-4F2A91',
  keyId: 'rzp_live_abc123',
  orderId: 'order_PqR7sTuVwXyZ01',
  amount: 249900,
  currency: 'INR',
  name: 'LYZN',
  email: 'nikhil@ghmev.in',
  contact: '9849044417',
  ...over,
});

/* ── The pay URL ─────────────────────────────────────────────────────── */

test('every parameter the page reads, in a fixed order', () => {
  assert.equal(
    buildPayUrl(order(), 'https://lyzn.ai'),
    'https://lyzn.ai/pay'
      + '?ref=LYZN-4F2A91'
      + '&keyId=rzp_live_abc123'
      + '&orderId=order_PqR7sTuVwXyZ01'
      + '&amount=249900'
      + '&currency=INR'
      + '&name=LYZN'
      + '&email=nikhil%40ghmev.in'
      + '&contact=9849044417',
  );
});

test('a key that has no value is not a key', () => {
  const url = buildPayUrl(
    order({ amount: undefined, email: undefined, contact: '   ' }),
    'https://lyzn.ai',
  );
  assert.equal(url, 'https://lyzn.ai/pay?ref=LYZN-4F2A91&keyId=rzp_live_abc123'
    + '&orderId=order_PqR7sTuVwXyZ01&currency=INR&name=LYZN');
  // The three that would have read as the string "undefined".
  assert.ok(!url.includes('undefined'));
  assert.ok(!url.includes('amount='));
  assert.ok(!url.includes('email='));
  assert.ok(!url.includes('contact='));
});

test('everything that goes in is encoded on the way', () => {
  const url = buildPayUrl(
    order({ reference: 'LYZN/4F 2A&91', name: 'LYZN · Act Pro', email: 'a+b@x.co' }),
    'https://lyzn.ai',
  );
  assert.ok(url.includes('ref=LYZN%2F4F%202A%2691'));
  assert.ok(url.includes('name=LYZN%20%C2%B7%20Act%20Pro'));
  assert.ok(url.includes('email=a%2Bb%40x.co'));
  // One '?' and no stray separators: the ampersand in the reference did not
  // become a parameter of its own.
  assert.equal(url.split('?').length, 2);
  assert.equal(url.split('&').length, 8);
});

test('the site is lyzn.ai unless a build says otherwise, and never doubles its slash', () => {
  assert.equal(siteUrl({}), DEFAULT_SITE_URL);
  assert.equal(siteUrl({ EXPO_PUBLIC_SITE_URL: '' }), DEFAULT_SITE_URL);
  assert.equal(siteUrl({ EXPO_PUBLIC_SITE_URL: '  ' }), DEFAULT_SITE_URL);
  assert.equal(siteUrl({ EXPO_PUBLIC_SITE_URL: 'https://preview.lyzn.ai/' }), 'https://preview.lyzn.ai');
  assert.equal(siteUrl({ EXPO_PUBLIC_SITE_URL: 'https://preview.lyzn.ai//' }), 'https://preview.lyzn.ai');
  assert.ok(buildPayUrl(order(), siteUrl({})).startsWith('https://lyzn.ai/pay?'));
});

/* ── The way back ────────────────────────────────────────────────────── */

test('paid=1 is the only thing that starts a poll for a payment', () => {
  assert.deepEqual(
    readPayResult({ type: 'success', url: `${RETURN_PREFIX}/LYZN-4F2A91?paid=1` }),
    { kind: 'paid', reference: 'LYZN-4F2A91' },
  );
});

test('the reference survives the round trip, encoded or not', () => {
  assert.deepEqual(
    readPayResult({ type: 'success', url: `${RETURN_PREFIX}/LYZN%2F4F%202A91?paid=1` }),
    { kind: 'paid', reference: 'LYZN/4F 2A91' },
  );
});

test('a dismissal is a dismissal however it was reported', () => {
  assert.deepEqual(
    readPayResult({ type: 'success', url: `${RETURN_PREFIX}/LYZN-4F2A91?paid=0` }),
    { kind: 'cancelled' },
  );
  assert.deepEqual(readPayResult({ type: 'cancel' }), { kind: 'cancelled' });
  assert.deepEqual(readPayResult({ type: 'dismiss' }), { kind: 'cancelled' });
});

test('a session that ended in a shape nobody chose is not a cancellation', () => {
  // Reporting a payment that went through as "nothing was charged" is the
  // one unrecoverable mistake here, so anything unreadable is polled.
  assert.deepEqual(readPayResult({ type: 'locked' }), { kind: 'unknown' });
  assert.deepEqual(readPayResult({ type: 'opened' }), { kind: 'unknown' });
  assert.deepEqual(readPayResult({ type: 'success' }), { kind: 'unknown' });
  assert.deepEqual(
    readPayResult({ type: 'success', url: `${RETURN_PREFIX}/LYZN-4F2A91` }),
    { kind: 'unknown' },
  );
  assert.deepEqual(
    readPayResult({ type: 'success', url: `${RETURN_PREFIX}/LYZN-4F2A91?paid=yes` }),
    { kind: 'unknown' },
  );
});

test('a parameter after paid does not hide it, and one that merely starts with it is not it', () => {
  assert.deepEqual(
    readPayResult({ type: 'success', url: `${RETURN_PREFIX}/R1?from=app&paid=1#done` }),
    { kind: 'paid', reference: 'R1' },
  );
  assert.deepEqual(
    readPayResult({ type: 'success', url: `${RETURN_PREFIX}/R1?paid_at=1` }),
    { kind: 'unknown' },
  );
});

/* ── The poll ────────────────────────────────────────────────────────── */

test('only the backend’s two settled states settle a poll', () => {
  assert.equal(pollVerdict('paid'), 'paid');
  assert.equal(pollVerdict('failed'), 'failed');
  assert.equal(pollVerdict('created'), 'wait');
  assert.equal(pollVerdict(undefined), 'wait');
  assert.equal(pollVerdict('PAID'), 'wait');
});

/** A clock and a sleep that agree with each other and take no real time. */
function fakeClock() {
  let at = 0;
  return {
    now: () => at,
    sleep: async (ms: number) => {
      at += ms;
    },
    get elapsed() {
      return at;
    },
  };
}

test('an order already paid settles on the first read, with no wait at all', async () => {
  const clock = fakeClock();
  let reads = 0;
  const result = await pollUntilPaid(
    async () => {
      reads += 1;
      return { status: 'paid', paymentId: 'pay_XyZ' };
    },
    { now: clock.now, sleep: clock.sleep },
  );

  assert.deepEqual(result, { settled: 'paid', order: { status: 'paid', paymentId: 'pay_XyZ' } });
  assert.equal(reads, 1);
  assert.equal(clock.elapsed, 0);
});

test('a row the webhook has not reached yet is waited on, two seconds at a time', async () => {
  const clock = fakeClock();
  const rows: OrderLike[] = [
    { status: 'created' },
    { status: 'created' },
    { status: 'paid', paymentId: 'pay_XyZ' },
  ];
  let reads = 0;
  const result = await pollUntilPaid(
    async () => rows[reads++]!,
    { now: clock.now, sleep: clock.sleep },
  );

  assert.equal(result.settled, 'paid');
  assert.equal(reads, 3);
  assert.equal(clock.elapsed, 2 * POLL_EVERY_MS);
});

test('a failed order settles immediately — there is nothing to wait for', async () => {
  const clock = fakeClock();
  const result = await pollUntilPaid(
    async () => ({ status: 'failed' }),
    { now: clock.now, sleep: clock.sleep },
  );
  assert.deepEqual(result, { settled: 'failed', order: { status: 'failed' } });
  assert.equal(clock.elapsed, 0);
});

test('thirty seconds of "created" is pending, never cancelled, and stops on time', async () => {
  const clock = fakeClock();
  let reads = 0;
  const result = await pollUntilPaid(
    async () => {
      reads += 1;
      return { status: 'created' };
    },
    { now: clock.now, sleep: clock.sleep },
  );

  assert.deepEqual(result, { settled: 'pending' });
  // The window is inclusive of the last read that could still have answered:
  // 0s, 2s … 30s.
  assert.equal(reads, POLL_FOR_MS / POLL_EVERY_MS + 1);
  assert.equal(clock.elapsed, POLL_FOR_MS);
});

test('a read that throws is a blip, not an answer', async () => {
  const clock = fakeClock();
  let reads = 0;
  const result = await pollUntilPaid(
    async () => {
      reads += 1;
      if (reads < 3) throw new Error('offline');
      return { status: 'paid', paymentId: 'pay_XyZ' };
    },
    { now: clock.now, sleep: clock.sleep },
  );

  assert.equal(result.settled, 'paid');
  assert.equal(reads, 3);
});

test('a backend that never answers still gives up, and gives up as pending', async () => {
  const clock = fakeClock();
  const result = await pollUntilPaid(
    async () => {
      throw new Error('offline');
    },
    { now: clock.now, sleep: clock.sleep },
  );
  assert.deepEqual(result, { settled: 'pending' });
  assert.equal(clock.elapsed, POLL_FOR_MS);
});

test('the window and the interval are the caller’s to shorten', async () => {
  const clock = fakeClock();
  let reads = 0;
  const result = await pollUntilPaid(
    async () => {
      reads += 1;
      return { status: 'created' };
    },
    { now: clock.now, sleep: clock.sleep, everyMs: 100, forMs: 250 },
  );
  assert.deepEqual(result, { settled: 'pending' });
  assert.equal(reads, 3);
  assert.equal(clock.elapsed, 200);
});
