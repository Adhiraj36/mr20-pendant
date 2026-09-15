/**
 * What the account bought — `GET /plan`.
 *
 * The pendant is sold on lyzn.ai in three tiers, each paid once and none of
 * them a subscription (ruling R16). The order is written under the buyer's
 * Clerk `sub`, and the app identifies people by the same Clerk instance, so
 * the tier a buyer chose on the website is the tier this returns here.
 *
 * The wire shape is `backend/go/internal/ddb.Plan`'s json tags verbatim.
 * Three fields are `omitempty` and therefore genuinely optional: an account
 * that has never ordered gets `{plan:"none", status:"none"}` and nothing
 * else. Nothing is invented — `since` is the order's `paidAt` and
 * `orderReference` is the reference the website's Confirmed page stamped.
 */
import { request } from './client';

/** The three tiers, plus what an account that has not ordered reads as. */
export type PlanTier = 'none' | 'capture' | 'act' | 'act-pro';

/**
 * `active` for a paid tier; `halted`/`cancelled` come from Razorpay's
 * subscription webhooks, which only the pre-R16 monthly plan could raise.
 * They stay on the wire because rows written under that model carry them.
 */
export type PlanStatus = 'none' | 'active' | 'halted' | 'cancelled';

export interface Plan {
  plan: PlanTier;
  /** Derived from the tier by the backend: true for `act` and `act-pro`. */
  automation: boolean;
  status: PlanStatus;
  /** RFC 3339, the moment the order was paid. Absent until one is. */
  since?: string;
  /** The paid order's reference, when there is one. */
  orderReference?: string;
  /** Only ever set on a row written under the old monthly model. */
  subscriptionId?: string;
}

/** The entitlement this account holds. Read on focus by the Profile screen. */
export function fetchPlan(): Promise<Plan> {
  return request<Plan>('GET', '/plan');
}
