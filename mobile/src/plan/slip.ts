/**
 * The plan, as a receipt — spec §1.5's "receipts only as proof", applied to
 * the one proof the app did not have: what you bought.
 *
 * The tiers are ruling R16's: Capture, Act and Act Pro, each paid once,
 * none of them a subscription. Automation is not a thing you buy separately
 * any more — it comes with Act and Act Pro, and the backend derives the
 * flag from the tier, so the slip prints what it is told rather than
 * re-deriving it here.
 *
 * No React, no react-native, and the `Plan` import is type-only, so the node
 * test runner can load this directly — the same split `receiptLogic.ts` and
 * `onboarding/pairing.ts` make.
 */
import { joinLabel } from '../design/tokens';
import type { ReceiptRowSpec } from '../design/receiptLogic';
import type { Plan, PlanStatus, PlanTier } from '../api/plan';

/** Fixed copy, kept out of the render so it is not retyped (spec §7). */
export const PLAN_TITLE = 'LYZN · YOUR PLAN';
export const PLAN_FOOTER = 'PAID ONCE · KEEP THIS';

/** Where a buyer goes to get one. The website owns the whole purchase. */
export const ORDER_URL = 'https://lyzn.ai/order';
export const NO_PLAN_TITLE = 'No plan yet';
export const NO_PLAN_LINE =
  'The pendant and what it does are bought on the website. Sign in there with this same account and it appears here.';
export const NO_PLAN_LINK = 'lyzn.ai/order';

/**
 * The tiers by their own names (R16), not by the device — every tier ships
 * the same pendant, so "PENDANT" would name the one thing they share rather
 * than the thing that was chosen. Matches `PLANS[*].name` in
 * `web/src/data/pricing.ts`; the receipt uppercases them itself.
 */
const TIER_NAMES: Record<Exclude<PlanTier, 'none'>, string> = {
  capture: 'Capture',
  act: 'Act',
  'act-pro': 'Act Pro',
};

/** `undefined` for `none` — there is no tier to name, so there is no row. */
export function tierName(plan: PlanTier): string | undefined {
  return plan === 'none' ? undefined : TIER_NAMES[plan];
}

/** True when there is something to print at all. */
export function hasPlan(plan: Plan | undefined): plan is Plan {
  return !!plan && plan.plan !== 'none';
}

/**
 * The stamp. The brief names `ACTIVE` and `HALTED`; `cancelled` is also on
 * the wire and reads as itself rather than being flattened into `HALTED`,
 * because the two are different things and a receipt does not round.
 * `none` never reaches here — the screen shows the empty panel instead.
 */
export function planStamp(status: PlanStatus): string | undefined {
  return status === 'none' ? undefined : status.toUpperCase();
}

/** `7 SEP 2026`. */
const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/**
 * The date the tier was paid for, in the receipt's own mono. Spelled out
 * rather than taken from `toLocaleDateString` for the reason `grouping.ts`
 * gives: the copy is fixed, and a device locale must not rewrite it.
 * An unparseable or absent date gets no row (spec §0.3).
 */
export function sinceLabel(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * The three rows. `AUTOMATION` is `ok` — the ✓ and the signal colour — only
 * when it is both included and running: an entitlement that Razorpay has
 * halted is not a thing to tick.
 */
export function planRows(plan: Plan): ReceiptRowSpec[] {
  const rows: ReceiptRowSpec[] = [];

  const tier = tierName(plan.plan);
  if (tier) rows.push({ k: 'PLAN', v: tier });

  rows.push({
    k: 'AUTOMATION',
    v: plan.automation ? 'ON' : 'OFF',
    ok: plan.automation && plan.status === 'active',
  });

  const since = sinceLabel(plan.since);
  if (since) rows.push({ k: 'SINCE', v: since });

  return rows;
}

/**
 * The line under the title: the order this entitlement came from. Dropped
 * when the row predates the field, which is the slot rule again.
 */
export function planMeta(plan: Plan): string {
  return joinLabel([plan.orderReference && `ORDER ${plan.orderReference}`]);
}

/**
 * The barcode is a transaction's own code, so it is seeded by the order
 * reference and there is simply no barcode without one.
 */
export function planSeed(plan: Plan): string | undefined {
  return plan.orderReference || undefined;
}
