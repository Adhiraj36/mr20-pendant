/**
 * The checkout sheet, and the five ways it can end.
 *
 * There is no native sheet. `react-native-razorpay` ships a static library
 * that RN's `-ObjC` force-loads whole, and the autolinker then pulls in
 * `SwiftUICore` — a private framework Apple permits only SwiftUI to link —
 * so an iOS build fails at `ld` and no amount of pod configuration moves it
 * (round seven, `task-screens-report.md`). The module is gone from
 * package.json and is not coming back.
 *
 * What replaces it is the sheet the website has been taking money with all
 * along. `lyzn.ai/pay` reads a created order out of its query string, opens
 * Razorpay Checkout, and ends on `lyzn://order/<ref>?paid=0|1`;
 * `WebBrowser.openAuthSessionAsync` opens that page in an
 * ASWebAuthenticationSession (a Custom Tab on Android) and resolves the
 * moment the deep link fires. No new native dependency — `expo-web-browser`
 * is already in this app.
 *
 * The cost is UPI intent: a browser checkout offers UPI as a QR code and an
 * intent hand-off rather than the native app-switch, which on a phone is a
 * degradation. It is the only shipping option, and Checkout's own UPI flow
 * inside a Custom Tab still reaches the installed apps on Android.
 *
 * **The app never verifies a payment.** There is no signature here to check.
 * Razorpay's webhook — HMAC-verified, already shipped — marks the order paid
 * server-side, and this file waits for that row to change: up to thirty
 * seconds, every two. Running out of time is not a failure and is never
 * reported as one, because the money may well have moved.
 */
import * as WebBrowser from 'expo-web-browser';
import { PAY_COPY } from '../design/copy';
import { fetchOrder, type Checkout, type RazorpaySuccess } from './orders';
import { RETURN_PREFIX, buildPayUrl, pollUntilPaid, readPayResult } from './checkout';

export type PaymentOutcome =
  | { ok: true; payment: RazorpaySuccess }
  | { ok: false; reason: 'cancelled' }
  /** Opened, closed, and the order row still has not changed. Not a failure. */
  | { ok: false; reason: 'pending'; message?: string }
  | { ok: false; reason: 'failed'; message?: string }
  | { ok: false; reason: 'unavailable'; message?: string };

/**
 * Options the chooser passes. Both are optional and neither changes what is
 * charged — the Razorpay order id decides that, and it was priced by
 * `POST /orders`.
 *
 * `themeColor` is accepted and not sent: the page themes Checkout from
 * `@lyzn/design`'s own token, which is where the app's value comes from too,
 * so passing it would only be a way for the two to disagree.
 *
 * `reference` is the order the deep link comes back on. It is normally read
 * off `checkout.notes.reference`, which `orders.go` always sets; the option
 * exists so a caller holding the reference need not rely on that.
 */
export interface CheckoutOptions {
  themeColor?: string;
  reference?: string;
}

/**
 * Open the sheet for a created order, and come back with what happened.
 *
 * Everything the page is given comes from `POST /orders` — the key id and
 * the order id are public by design, and the amount travels only so the page
 * can print it. Nothing on this device can change what is charged.
 */
export async function payWithRazorpay(
  checkout: Checkout,
  options: CheckoutOptions = {},
): Promise<PaymentOutcome> {
  void options.themeColor;

  const reference = options.reference ?? checkout.notes?.reference;
  if (!reference) {
    return { ok: false, reason: 'failed', message: PAY_COPY.noReference };
  }

  const payUrl = buildPayUrl({
    reference,
    keyId: checkout.keyId,
    orderId: checkout.orderId,
    amount: checkout.amount,
    currency: checkout.currency,
    name: checkout.name,
    email: checkout.prefill?.email,
    contact: checkout.prefill?.contact,
  });

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(payUrl, RETURN_PREFIX);
  } catch (err) {
    // No browser the OS will open, or a session already in flight. Nothing
    // was charged, because nothing was ever shown.
    return {
      ok: false,
      reason: 'unavailable',
      message: (err as Error)?.message || PAY_COPY.unavailable,
    };
  }

  const returned = readPayResult(result);
  // A dismissed sheet is not a failure and must never be reported as one:
  // the person changed their mind, and nothing was charged either way.
  if (returned.kind === 'cancelled') return { ok: false, reason: 'cancelled' };

  // `paid` and `unknown` both end here. A session that came back in a shape
  // neither side chose is polled rather than guessed at — reporting a
  // payment that went through as a cancellation is the one unrecoverable
  // mistake this function can make.
  const settled = await pollUntilPaid(() => fetchOrder(reference));

  if (settled.settled === 'paid') {
    return {
      ok: true,
      payment: {
        razorpay_payment_id: settled.order.paymentId ?? '',
        razorpay_order_id: checkout.orderId,
      },
    };
  }
  if (settled.settled === 'failed') {
    return { ok: false, reason: 'failed', message: PAY_COPY.failed };
  }
  return { ok: false, reason: 'pending', message: PAY_COPY.pending };
}
