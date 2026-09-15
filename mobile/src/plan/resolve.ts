/**
 * Which plan this account holds, and whether to ask — plan §2.4.
 *
 * Three sources answer the same question at different speeds. Clerk's
 * `publicMetadata` is already in memory the instant a session restores, so
 * it is what the app renders on the first frame. `GET /plan` reads DynamoDB,
 * which is the system of record, so it wins the moment it arrives — even
 * when it says `none`, because "the API says you have not bought anything"
 * is an answer and a stale Clerk claim is not.
 *
 * The third source is the configuration: it does not say what was bought,
 * but it says what could be, and a chooser with nothing on sale is not a
 * chooser. So `needsChooser` consults it before sending anyone to one.
 *
 * Pure. No React, no storage, no network — `node --test` reads it directly.
 */
import type { Plan, PlanStatus, PlanTier } from '../api/plan';
import { tiersOnSale, type AppConfig } from './config';

/** Where the answer came from. Rendered nowhere; useful in a log and a test. */
export type PlanSource = 'api' | 'clerk' | 'none';

export interface PlanResolution {
  tier: PlanTier;
  status: PlanStatus;
  /** Act and Act Pro act; Capture only listens. Derived, never sent. */
  automation: boolean;
  since?: string;
  orderReference?: string;
  source: PlanSource;
  /** True when the app should put the chooser in front of the person. */
  needsChooser: boolean;
}

/** What Clerk carries after a verified order (`clerkmeta`, T3a). */
export interface ClerkPlanMetadata {
  plan?: unknown;
  planStatus?: unknown;
  planSince?: unknown;
  orderReference?: unknown;
}

const TIERS: PlanTier[] = ['none', 'capture', 'act', 'act-pro'];
const STATUSES: PlanStatus[] = ['none', 'active', 'halted', 'cancelled'];

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === 'string' && (TIERS as string[]).includes(value);
}

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value);
}

/** Act and Act Pro act. The one place the app derives it; the API sends its own. */
export function automationFor(tier: PlanTier): boolean {
  return tier === 'act' || tier === 'act-pro';
}

/** A tier that is held rather than merely named: paid for, and not withdrawn. */
export function isHeld(tier: PlanTier, status: PlanStatus): boolean {
  return tier !== 'none' && status !== 'cancelled';
}

/**
 * Clerk's metadata, made into an answer — or `undefined` when it does not
 * carry one. An unrecognised tier is not an answer: a build that has never
 * heard of a tier cannot claim the account holds it.
 */
function fromClerk(metadata: ClerkPlanMetadata | undefined | null): PlanResolution | undefined {
  if (!metadata) return undefined;
  const tier = metadata.plan;
  if (!isPlanTier(tier) || tier === 'none') return undefined;
  const status = isPlanStatus(metadata.planStatus) ? metadata.planStatus : 'active';
  return {
    tier,
    status,
    automation: automationFor(tier),
    since: typeof metadata.planSince === 'string' ? metadata.planSince : undefined,
    orderReference:
      typeof metadata.orderReference === 'string' ? metadata.orderReference : undefined,
    source: 'clerk',
    needsChooser: false,
  };
}

/** `GET /plan`, made into an answer. Always one, because the API always says. */
function fromApi(plan: Plan): PlanResolution {
  return {
    tier: plan.plan,
    status: plan.status,
    // The backend derives `automation` from the tier and sends it; believed
    // as sent, so a tier added in configuration acts as the backend says it
    // does rather than as this table guesses.
    automation: plan.automation,
    since: plan.since,
    orderReference: plan.orderReference,
    source: 'api',
    needsChooser: false,
  };
}

const NOTHING: PlanResolution = {
  tier: 'none',
  status: 'none',
  automation: false,
  source: 'none',
  needsChooser: true,
};

/**
 * The account's plan.
 *
 * `apiPlan` present wins outright — including `{plan:'none'}`, which is the
 * API saying nothing has been bought. Clerk answers only while the API has
 * not, which is exactly the window between a session restoring and the first
 * request completing. Nothing from either is `none`, and `none` opens the
 * chooser — unless the configuration has no tier on sale, in which case
 * there is nothing to choose and the app carries on without asking.
 */
export function resolvePlan(
  clerkPublicMetadata: ClerkPlanMetadata | undefined | null,
  apiPlan: Plan | undefined,
  config?: AppConfig,
): PlanResolution {
  const answer = apiPlan ? fromApi(apiPlan) : fromClerk(clerkPublicMetadata) ?? NOTHING;
  const held = isHeld(answer.tier, answer.status);
  const sellable = config ? tiersOnSale(config).length > 0 : true;
  return { ...answer, needsChooser: !held && sellable };
}
