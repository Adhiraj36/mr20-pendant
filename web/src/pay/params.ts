/**
 * The handoff contract between the app and this page.
 *
 * The phone cannot open Razorpay's sheet itself — `react-native-razorpay`
 * links a static library that force-loads SwiftUICore, which Apple lets only
 * SwiftUI link, so the iOS build fails at `ld` — and the web already takes
 * payments with Checkout in shipped code. So the app opens this page in an
 * authentication session and reads the deep link the page ends on.
 *
 * **Nothing secret travels in the URL.** The key id is the publishable one
 * printed in every Checkout page's source, and the Razorpay order id is a
 * handle that can only be paid for the amount the order was created with,
 * server-side, by `POST /orders`. `amount` is here to be *printed* and for
 * no other reason: it is never handed to Checkout, so a tampered figure
 * changes what this page says and not one paisa of what is charged. The
 * amount actually taken is the order's, and the webhook — not this page —
 * is what marks it paid.
 */

/** What the app puts in the query string, once it has been read back. */
export interface PayParams {
  /** Our own order reference (`LYZN-4F2A91`). The deep link comes back on it. */
  ref: string
  /** Razorpay's publishable key id. */
  keyId: string
  /** The Razorpay order id. Alone it decides the figure. */
  orderId: string
  /** Paise, for display only — see the note above. Absent if unreadable. */
  amount?: number
  /** ISO 4217. `INR` unless the app says otherwise. */
  currency: string
  /** The business name Checkout prints at the top of its sheet. */
  name: string
  /** Prefill. Saves a re-type; Checkout treats both as editable. */
  email?: string
  contact?: string
}

export type PayParamsResult =
  | { ok: true; params: PayParams }
  | { ok: false; missing: string[] }

/** The three the page cannot invent. Everything else has a sane default. */
const REQUIRED = ['ref', 'keyId', 'orderId'] as const

/**
 * Trimmed, or undefined — an empty parameter is the same as an absent one,
 * so `?email=` does not become a prefill of the empty string.
 */
function value(search: URLSearchParams, key: string): string | undefined {
  const raw = search.get(key)?.trim()
  return raw ? raw : undefined
}

/**
 * Read the query string, or say which parts of it are missing.
 *
 * A page that opens Checkout with a blank order id shows Razorpay's own
 * error inside an in-app browser, which is a dead end with no back button.
 * Better to fail here, where there is a retry and a way back to the app.
 */
export function readPayParams(search: string): PayParamsResult {
  const query = new URLSearchParams(search)

  const missing = REQUIRED.filter((key) => !value(query, key))
  if (missing.length > 0) return { ok: false, missing: [...missing] }

  const amount = Number(value(query, 'amount'))

  return {
    ok: true,
    params: {
      ref: value(query, 'ref')!,
      keyId: value(query, 'keyId')!,
      orderId: value(query, 'orderId')!,
      amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
      currency: value(query, 'currency') ?? 'INR',
      name: value(query, 'name') ?? 'LYZN',
      email: value(query, 'email'),
      contact: value(query, 'contact'),
    },
  }
}

/**
 * Where the page ends, either way.
 *
 * The scheme and the host are fixed here rather than taken from the query,
 * so no parameter can turn this page into an open redirect: whatever arrives
 * can only ever be a path segment of `lyzn://order/`.
 *
 * `paid=1` does not claim the payment is verified — the app polls
 * `GET /orders/:reference` for that. It says only which of Checkout's two
 * endings happened, so the app knows whether to poll or to go quiet.
 */
export function deepLink(ref: string, paid: boolean): string {
  return `lyzn://order/${encodeURIComponent(ref)}?paid=${paid ? 1 : 0}`
}

/**
 * Paise as money, in the locale the currency belongs to.
 *
 * Unknown or absent amounts print nothing at all rather than `₹0` — a slip
 * that names the wrong figure is worse than one that names none.
 */
export function formatAmount(paise: number | undefined, currency: string): string | undefined {
  if (paise === undefined) return undefined
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
    }).format(paise / 100)
  } catch {
    // An unknown currency code throws rather than falling back.
    return `${(paise / 100).toLocaleString('en-IN')} ${currency}`
  }
}
