/**
 * The plan receipt's row model (ruling R16's three tiers), and the slot rule
 * applied to the two fields `GET /plan` omits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Plan } from '../../src/api/plan';
import {
  PLAN_TITLE, hasPlan, planMeta, planRows, planSeed, planStamp, sinceLabel, tierName,
} from '../../src/plan/slip';

const paid = (over: Partial<Plan> = {}): Plan => ({
  plan: 'act',
  automation: true,
  status: 'active',
  since: '2026-09-07T11:22:33Z',
  orderReference: 'LYZN-4F2A91',
  ...over,
});

test('the tiers are named, not called "pendant"', () => {
  assert.equal(tierName('capture'), 'Capture');
  assert.equal(tierName('act'), 'Act');
  assert.equal(tierName('act-pro'), 'Act Pro');
  assert.equal(tierName('none'), undefined);
  assert.equal(PLAN_TITLE, 'LYZN · YOUR PLAN');
});

test('an account with no order has nothing to print', () => {
  assert.equal(hasPlan(undefined), false);
  assert.equal(hasPlan({ plan: 'none', automation: false, status: 'none' }), false);
  assert.equal(hasPlan(paid()), true);
});

test('the three rows, in the brief’s order', () => {
  assert.deepEqual(planRows(paid()), [
    { k: 'PLAN', v: 'Act' },
    { k: 'AUTOMATION', v: 'ON', ok: true },
    { k: 'SINCE', v: '7 SEP 2026' },
  ]);
});

test('capture has no automation, and the row says so without a tick', () => {
  const rows = planRows(paid({ plan: 'capture', automation: false }));
  assert.deepEqual(rows[1], { k: 'AUTOMATION', v: 'OFF', ok: false });
});

test('a halted entitlement is not ticked', () => {
  const rows = planRows(paid({ status: 'halted' }));
  assert.deepEqual(rows[1], { k: 'AUTOMATION', v: 'ON', ok: false });
});

test('a fact the wire omits gets no row at all', () => {
  const rows = planRows(paid({ since: undefined }));
  assert.deepEqual(rows.map((r) => r.k), ['PLAN', 'AUTOMATION']);
  assert.equal(sinceLabel(undefined), undefined);
  assert.equal(sinceLabel('not a date'), undefined);
});

test('the stamp is the status, spelled out', () => {
  assert.equal(planStamp('active'), 'ACTIVE');
  assert.equal(planStamp('halted'), 'HALTED');
  assert.equal(planStamp('cancelled'), 'CANCELLED');
  assert.equal(planStamp('none'), undefined);
});

test('the order reference is the meta line and the barcode seed, or neither', () => {
  assert.equal(planMeta(paid()), 'ORDER LYZN-4F2A91');
  assert.equal(planSeed(paid()), 'LYZN-4F2A91');
  assert.equal(planMeta(paid({ orderReference: undefined })), '');
  assert.equal(planSeed(paid({ orderReference: undefined })), undefined);
});
