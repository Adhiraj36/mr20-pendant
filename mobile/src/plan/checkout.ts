/**
 * The web checkout, as a model.
 *
 * Three things happen between RESERVE and a receipt, and all three are here
 * as plain functions so they can be tested without a browser, a network or a
 * device: the URL the phone opens, the deep link it comes back on, and the
 * poll that waits for the webhook to have done its work. `razorpay.ts` is
 * the thin part that puts them together around `expo-web-browser`.
 *
 * Nothing in this file imports React Native, Expo or the API client — the
 * test runner compiles it directly.
 */

/** Where `/pay` lives when nothing says otherwise. */
export const DEFAULT_SITE_URL = 'https://lyzn.ai';

/**
 * The prefix `WebBrowser.openAuthSessionAsync` watches for, and the prefix
 * the page redirects to. The app's `scheme` in app.json already registers
 * `lyzn`, so nothing new is claimed here.
 */
export const RETURN_PREFIX = 'lyzn://order';

/** Every two seconds, for thirty. Both are the brief's numbers. */
export const POLL_EVERY_MS = 2_000;
export const POLL_FOR_MS = 30_000;

/* ── The pay URL ─────────────────────────────────────────────────────── */

/**
 * What `/pay` needs to open Checkout, and nothing else.
 *
 * `amount` is carried so the page can *print* what is about to be taken. It
 * is never handed to Checkout: the Razorpay order id alone decides the
 * figure, and that order was priced server-side by `POST /orders`. So the
 * URL holds no secret and no lever — the key id is the publishable one, and
 * a tampered amount changes a line of text and not one paisa.
 */
export interface PayUrlInput {
  /** Our own order reference. The deep link comes back on it. */
  reference: string;
  keyId: string;
  orderId: string;
  /** Paise. Display only. */
  amount?: number;
  currency?: string;
  /** The business name Checkout prints at the top of its sheet. */
  name?: string;
  email?: string;
  contact?: string;
}

/**
 * The site the app hands off to.
 *
 * `EXPO_PUBLIC_SITE_URL` exists so a preview deploy can be pointed at, which
 * is the only way to try a change to `/pay` against a real build. A trailing
 * slash is dropped so the join below never produces `//pay`.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = env.EXPO_PUBLIC_SITE_URL?.trim();
  return (configured || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

/** A query pair, or nothing at all — an empty value is not a parameter. */
function pair(key: string, value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  return `${encodeURIComponent(key)}=${encodeURIComponent(text)}`;
}

/**
 * `https://lyzn.ai/pay?ref=…&keyId=…&orderId=…&amount=…&currency=…&name=…`
 *
 * The order of the parameters is fixed rather than incidental, so the URL a
 * given order produces is the same every time — which is what makes it
 * something a test can assert on and a support ticket can quote.
 */
export function buildPayUrl(input: PayUrlInput, site: string = siteUrl()): string {
  const query = [
    pair('ref', input.reference),
    pair('keyId', input.keyId),
    pair('orderId', input.orderId),
    pair('amount', input.amount),
    pair('currency', input.currency),
    pair('name', input.name),
    pair('email', input.email),
    pair('contact', input.contact),
  ].filter((part): part is string => part !== undefined);

  return `${site}/pay?${query.join('&')}`;
}

/* ── The way back ────────────────────────────────────────────────────── */

/**
 * What the browser session came back as.
 *
 * `paid` does not mean the money arrived — it means Checkout's handler fired
 * and the page said so. The poll below is what turns that into a fact.
 * `unknown` is a session that ended in a way neither the page nor the app
 * chose (another session already open, an OS dismissal); it is polled too,
 * because a payment that went through must never be reported as cancelled.
 */
export type PayReturn =
  | { kind: 'paid'; reference?: string }
  | { kind: 'cancelled' }
  | { kind: 'unknown' };

/** The shape `WebBrowser.openAuthSessionAsync` resolves with, narrowed. */
export interface AuthSessionResultLike {
  type: string;
  url?: string;
}

/** `?paid=1` → `'1'`. Hand-rolled: a custom scheme is not a URL to `URL`. */
function queryValue(url: string, key: string): string | undefined {
  const start = url.indexOf('?');
  if (start < 0) return undefined;
  const query = url.slice(start + 1).split('#')[0];
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const name = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
    if (name === key) return decodeURIComponent(eq < 0 ? '' : part.slice(eq + 1));
  }
  return undefined;
}

/** `lyzn://order/LYZN-4F2A91?paid=1` → `LYZN-4F2A91`. */
function referenceIn(url: string): string | undefined {
  if (!url.startsWith(`${RETURN_PREFIX}/`)) return undefined;
  const rest = url.slice(RETURN_PREFIX.length + 1).split('?')[0].split('#')[0];
  return rest ? decodeURIComponent(rest) : undefined;
}

/**
 * Read the session result.
 *
 * `cancel` is the person closing the browser and `dismiss` is the app
 * closing it; neither charged anything. `success` is the page having
 * navigated to the deep link, and the `paid` parameter on it says which of
 * Checkout's two endings it was.
 */
export function readPayResult(result: AuthSessionResultLike): PayReturn {
  if (result.type === 'cancel' || result.type === 'dismiss') return { kind: 'cancelled' };
  if (result.type !== 'success' || !result.url) return { kind: 'unknown' };

  const paid = queryValue(result.url, 'paid');
  if (paid === '0') return { kind: 'cancelled' };
  if (paid === '1') return { kind: 'paid', reference: referenceIn(result.url) };
  // A deep link we do not recognise. Poll rather than guess.
  return { kind: 'unknown' };
}

/* ── The poll ────────────────────────────────────────────────────────── */

/** The two fields of an order this file reads. `OrderRecord` satisfies it. */
export interface OrderLike {
  status?: string;
  paymentId?: string;
}

/** What one reading of the order row settles, if anything. */
export type PollVerdict = 'paid' | 'failed' | 'wait';

/**
 * `created` is not a verdict: it is the row before Razorpay's webhook
 * reached it, which is the entire reason this poll exists. Anything the
 * backend has not defined is waited on rather than guessed at.
 */
export function pollVerdict(status: string | undefined): PollVerdict {
  if (status === 'paid') return 'paid';
  if (status === 'failed') return 'failed';
  return 'wait';
}

export interface PollOptions {
  everyMs?: number;
  forMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type PollResult<T extends OrderLike> =
  | { settled: 'paid'; order: T }
  | { settled: 'failed'; order: T }
  | { settled: 'pending' };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read the order until it stops saying `created`, or until the window closes.
 *
 * The first read happens immediately: a UPI payment can be captured before
 * the browser has finished animating away, and a two-second stare at a
 * spinner for an order that is already paid is two seconds of doubt.
 *
 * A read that throws is a network blip, not an answer — it is waited through
 * like any other unsettled attempt. Running out of time is `pending`, which
 * is the honest outcome: the webhook may still be in flight, and the app
 * must not tell somebody nothing was charged when something may have been.
 */
export async function pollUntilPaid<T extends OrderLike>(
  read: () => Promise<T>,
  options: PollOptions = {},
): Promise<PollResult<T>> {
  const everyMs = options.everyMs ?? POLL_EVERY_MS;
  const forMs = options.forMs ?? POLL_FOR_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;

  const startedAt = now();

  for (;;) {
    try {
      const order = await read();
      const verdict = pollVerdict(order.status);
      if (verdict === 'paid') return { settled: 'paid', order };
      if (verdict === 'failed') return { settled: 'failed', order };
    } catch {
      // Transient. Fall through to the wait.
    }

    // Room for the sleep *and* the read that follows it, so the last attempt
    // is one that could have answered rather than one cut off mid-flight.
    if (now() - startedAt + everyMs > forMs) return { settled: 'pending' };
    await sleep(everyMs);
  }
}
