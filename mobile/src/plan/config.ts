/**
 * The remote configuration document — plan §2.4's `GET /config`.
 *
 * Prices, the words beside them and the feature flags are configuration, not
 * code: a tier's price changes without a release, and the three unbuilt
 * halves of the product (`daemon`, `whatsapp`, `execution`) are switched off
 * here rather than commented out in a screen.
 *
 * This file is the **shape and the coercion**, and nothing else — no fetch,
 * no storage, no React — so `node --test` reads it directly. The client that
 * fetches and caches it is `src/api/appConfig.ts`.
 *
 * Everything here is defensive on purpose. The document comes off a network
 * and out of a cache written by an older build, and a missing tier array or
 * a price that arrived as a string must degrade to the defaults rather than
 * take a chooser screen down. `coerceAppConfig` never throws and never
 * returns a partial document.
 */

/** One tier on sale. Amounts are **paise** — the backend's own unit. */
export interface AppTier {
  id: string;
  name: string;
  /** What the device costs in full. */
  full: number;
  /** What a checkout takes today. */
  deposit: number;
  /** What renews from activation; 0 for the tiers that never renew. */
  monthly: number;
  enabled: boolean;
  /** `Most chosen`, or empty. */
  badge: string;
  lines: string[];
}

/** The words the chooser sets around the prices. */
export interface AppPricingCopy {
  chooserTitle: string;
  chooserSub: string;
  depositNote: string;
  indiaOnly: string;
  receiptTitle: string;
}

export interface AppPricing {
  currency: string;
  preorder: boolean;
  tiers: AppTier[];
  copy: AppPricingCopy;
}

/**
 * The five flags. Three of them are the plan's slots: `daemon`, `whatsapp`
 * and `execution` name halves of the product that do not exist yet, and a
 * screen that would show one hides it instead.
 */
export interface AppFeatures {
  daemon: boolean;
  whatsapp: boolean;
  execution: boolean;
  askLyzn: boolean;
  /** Record with the phone when no pendant is paired. */
  phoneCapture: boolean;
  darkMode: boolean;
}

export interface AppNotificationSettings {
  /** The hour a daily digest would go out, 0–23. */
  digestHour: number;
}

export interface AppConfig {
  version: number;
  updatedAt: string;
  pricing: AppPricing;
  features: AppFeatures;
  notifications: AppNotificationSettings;
}

/**
 * What the app runs on before the network has answered once.
 *
 * These are the backend's own seeded values (T3a's report, "The `AppConfig`
 * as seeded") copied here so a first launch on a dead network still has a
 * chooser to draw. Every flag is off except the two that describe things
 * that are actually built — which is also the safe default for a document
 * that failed to arrive: never unlock a screen because a fetch failed.
 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  version: 0,
  updatedAt: '',
  pricing: {
    currency: 'INR',
    preorder: true,
    tiers: [
      {
        id: 'capture',
        name: 'Capture',
        full: 599900,
        deposit: 99900,
        monthly: 0,
        enabled: true,
        badge: '',
        lines: [
          'Unlimited recording and transcription',
          'Every commitment you made, listed',
          'Runs on your phone — no laptop needed',
          'No subscription. Ever.',
        ],
      },
      {
        id: 'act',
        name: 'Act',
        full: 899900,
        deposit: 99900,
        monthly: 0,
        enabled: true,
        badge: 'Most chosen',
        lines: [
          'Everything in Capture',
          'Orchestrator for your laptop',
          'Tasks get done, not just listed',
          'Bring your own Claude or ChatGPT subscription',
          'No subscription to us. Ever.',
        ],
      },
      {
        id: 'act-pro',
        name: 'Act Pro',
        full: 1299900,
        deposit: 99900,
        monthly: 49900,
        enabled: true,
        badge: '',
        lines: [
          'Everything in Act',
          'No ChatGPT or Claude account, nothing to configure',
          'We supply the AI — ₹499 a month from activation',
          'Or bring your own key and pay nothing',
        ],
      },
    ],
    copy: {
      chooserTitle: 'What it costs',
      chooserSub:
        'Three ways to buy it. The device is the same in all three — what changes is how much work it does for you.',
      depositNote: 'Balance on dispatch · NOVEMBER 2026',
      indiaOnly: 'Indian mobile numbers only — LYZN ships in India for now.',
      receiptTitle: 'LYZN · PROOF OF WORK',
    },
  },
  features: {
    daemon: false,
    whatsapp: false,
    execution: false,
    askLyzn: true,
    phoneCapture: true,
    darkMode: true,
  },
  notifications: { digestHour: 8 },
};

// -- coercion --------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * A whole, non-negative number of paise. A price that arrives as a string,
 * a float or a negative is the fallback — a checkout must never be built on
 * a number nobody meant.
 */
function money(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return fallback;
  return Math.round(value);
}

function lines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
}

/**
 * One tier, or `undefined` if it has no id — an unnamed tier cannot be
 * ordered, so it is dropped rather than shown with a blank heading.
 */
function coerceTier(raw: unknown): AppTier | undefined {
  if (!isObject(raw)) return undefined;
  const id = str(raw.id, '').trim();
  if (!id) return undefined;
  return {
    id,
    name: str(raw.name, id),
    full: money(raw.full, 0),
    deposit: money(raw.deposit, 0),
    monthly: money(raw.monthly, 0),
    // A tier with no `enabled` is on sale: the field was added late, and a
    // document written before it must not empty the chooser.
    enabled: bool(raw.enabled, true),
    badge: str(raw.badge, ''),
    lines: lines(raw.lines),
  };
}

function coercePricing(raw: unknown): AppPricing {
  const base = DEFAULT_APP_CONFIG.pricing;
  if (!isObject(raw)) return base;
  const tiers = Array.isArray(raw.tiers)
    ? raw.tiers.map(coerceTier).filter((tier): tier is AppTier => !!tier)
    : [];
  const copy = isObject(raw.copy) ? raw.copy : {};
  return {
    currency: str(raw.currency, base.currency),
    preorder: bool(raw.preorder, base.preorder),
    // An empty list after coercion is a document we cannot sell from, so the
    // defaults stand in rather than the chooser drawing nothing.
    tiers: tiers.length ? tiers : base.tiers,
    copy: {
      chooserTitle: str(copy.chooserTitle, base.copy.chooserTitle),
      chooserSub: str(copy.chooserSub, base.copy.chooserSub),
      depositNote: str(copy.depositNote, base.copy.depositNote),
      indiaOnly: str(copy.indiaOnly, base.copy.indiaOnly),
      receiptTitle: str(copy.receiptTitle, base.copy.receiptTitle),
    },
  };
}

/**
 * The flags. Each one defaults to the built-in — which is `false` for the
 * three that gate unbuilt product — so a document missing a flag never
 * unlocks a screen, and a document that names one is believed.
 */
function coerceFeatures(raw: unknown): AppFeatures {
  const base = DEFAULT_APP_CONFIG.features;
  if (!isObject(raw)) return base;
  return {
    daemon: bool(raw.daemon, base.daemon),
    whatsapp: bool(raw.whatsapp, base.whatsapp),
    execution: bool(raw.execution, base.execution),
    askLyzn: bool(raw.askLyzn, base.askLyzn),
    phoneCapture: bool(raw.phoneCapture, base.phoneCapture),
    darkMode: bool(raw.darkMode, base.darkMode),
  };
}

function coerceNotifications(raw: unknown): AppNotificationSettings {
  const base = DEFAULT_APP_CONFIG.notifications;
  if (!isObject(raw)) return base;
  const hour = raw.digestHour;
  if (typeof hour !== 'number' || !Number.isFinite(hour) || hour < 0 || hour > 23) return base;
  return { digestHour: Math.floor(hour) };
}

/** Anything at all, made into a document the app can render. Never throws. */
export function coerceAppConfig(raw: unknown): AppConfig {
  if (!isObject(raw)) return DEFAULT_APP_CONFIG;
  return {
    version: money(raw.version, DEFAULT_APP_CONFIG.version),
    updatedAt: str(raw.updatedAt, ''),
    pricing: coercePricing(raw.pricing),
    features: coerceFeatures(raw.features),
    notifications: coerceNotifications(raw.notifications),
  };
}

// -- reading it ------------------------------------------------------------

/** The tiers a chooser may offer: the ones switched on, in document order. */
export function tiersOnSale(config: AppConfig): AppTier[] {
  return config.pricing.tiers.filter((tier) => tier.enabled);
}

/** One tier by id, whether or not it is on sale — a bought tier still names itself. */
export function tierById(config: AppConfig, id: string | undefined): AppTier | undefined {
  if (!id) return undefined;
  return config.pricing.tiers.find((tier) => tier.id === id);
}

/**
 * Indian digit grouping: the last three digits, then pairs.
 *
 * `toLocaleString('en-IN')` needs an ICU build to be right and silently
 * falls back to Western grouping where there is none, which would print
 * `10,999` as `10,999` (fine) and `100,000` as `100,000` (wrong). The rule
 * is four lines, so it is four lines.
 */
function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/**
 * Paise as the price a person reads: `₹5,999`.
 *
 * Whole rupees wherever the amount is whole, which every configured price
 * is; a stray remainder prints its two decimals rather than being rounded
 * away, because a price that is not what was charged is worse than an ugly
 * price.
 */
export function formatINR(paise: number): string {
  const safe = Number.isFinite(paise) ? Math.round(paise) : 0;
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  const body = remainder === 0
    ? groupIndian(String(rupees))
    : `${groupIndian(String(rupees))}.${String(remainder).padStart(2, '0')}`;
  return `${negative ? '-' : ''}₹${body}`;
}
