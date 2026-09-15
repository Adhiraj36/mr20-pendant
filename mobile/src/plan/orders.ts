/**
 * Buying a tier from inside the app — `POST /orders`, checkout,
 * `GET /orders/:reference`.
 *
 * The client never sends an amount. It sends a tier id and a contact, and
 * the backend prices it from the same configuration the chooser drew itself
 * from (`orders.go:quoteChecked`), so a price cannot be tampered with and a
 * chooser that is a minute stale cannot charge yesterday's number.
 *
 * The response's `checkout` block is what opens the sheet — the key id, the
 * order id, the amount in paise and the prefill. It is not opened here: the
 * sheet is Razorpay's own Checkout on lyzn.ai/pay, because the native module
 * cannot be linked into an iOS build (see `razorpay.ts`). So there is no
 * signature for the app to hand back, and there never needed to be one: the
 * HMAC-verified webhook (`POST /webhooks/razorpay`) is what marks an order
 * paid, and the app reads the row it wrote. The app is never the thing that
 * decides a payment happened.
 *
 * Store policy (research §C): the **pendant is a physical good**, so Apple
 * 3.1.3(e) requires a payment method that is not IAP and Google Play's
 * physical-goods exemption says the same. Act Pro's ₹499 a month is software
 * consumed in the app; it is **disclosed** here and only ever started on the
 * website, so nothing in this file takes a mandate.
 */
import { request } from '../api/client';

/** What Razorpay's sheet needs, exactly as `orders.go` builds it. */
export interface Checkout {
  keyId: string;
  orderId: string;
  /** Paise. */
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
}

export interface CreatedOrder {
  reference: string;
  /** Rupees, as the backend's own quote reports them. */
  dueToday: number;
  monthly: number;
  checkout: Checkout;
}

/**
 * Who to reach about the order. The backend validates the email and a
 * ten-digit Indian mobile and nothing else — the delivery address is taken
 * at dispatch, not here (`[ADDRESS]`: the app has no address form, and the
 * pre-order page on the website is where one exists).
 */
export interface OrderContact {
  fullName?: string;
  email: string;
  phone: string;
}

export interface OrderRecord {
  reference: string;
  plan: string;
  status: string;
  dueToday: number;
  full: number;
  monthly: number;
  paidAt?: string;
  paymentId?: string;
}

/**
 * What the app knows about a payment that went through.
 *
 * The names are Razorpay's, because this is what its native sheet used to
 * resolve with. Under the web checkout the payment id comes off the order
 * row instead — written there by the webhook — and there is no signature,
 * which is why that field is optional and why nothing here is treated as
 * proof of anything. `status === 'paid'` on the row is the proof.
 */
export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  /** Only ever set by the native sheet, which this build cannot link. */
  razorpay_signature?: string;
}

/** Start one. `quantity` is always 1 from the app: one person, one pendant. */
export function createOrder(input: {
  plan: string;
  contact: OrderContact;
}): Promise<CreatedOrder> {
  return request<CreatedOrder>('POST', '/orders', {
    plan: input.plan,
    quantity: 1,
    contact: {
      fullName: input.contact.fullName ?? '',
      email: input.contact.email,
      phone: input.contact.phone,
      line1: '', line2: '', city: '', state: '', pin: '',
      invoiceName: '', gstin: '',
    },
  });
}

/**
 * Read one order back. Scoped to the caller by `authjwt.Sub` server-side, so
 * a reference alone is not enough to read somebody else's.
 *
 * This is what the checkout poll asks, once every two seconds, until the
 * webhook has flipped `status` to `paid`.
 */
export async function fetchOrder(reference: string): Promise<OrderRecord> {
  const { order } = await request<{ order: OrderRecord }>(
    'GET',
    `/orders/${encodeURIComponent(reference)}`,
  );
  return order;
}

/**
 * The server's word on an order, taken after the sheet has closed.
 *
 * There is no signature to check any more — the sheet ran in a browser and
 * handed the app a deep link, not a payload — so this is a read, and it is
 * the same read the webhook's work shows up in. It throws if the row is not
 * paid, which is what keeps a receipt from being printed for a payment the
 * backend has no record of.
 *
 * `payment` is what the native sheet used to return. It is accepted and not
 * sent anywhere: the chooser screen that passes it (`app/onboarding/plan.tsx`)
 * belongs to another task this round, and its call site is deliberately
 * unchanged.
 */
export async function verifyOrder(
  reference: string,
  payment?: RazorpaySuccess,
): Promise<{ order: OrderRecord }> {
  void payment;
  const order = await fetchOrder(reference);
  if (order.status !== 'paid') {
    throw new Error('That order has not been paid yet.');
  }
  return { order };
}

/**
 * The mobile rule lives in `mobile.ts`, which imports nothing at all, so the
 * form's behaviour can be asserted about without a simulator. It is
 * re-exported from here because this is where an order's contact is
 * assembled, and that is where a call site looks for it.
 */
export {
  mobileDigits, isMobile, mobileState, canReserve, cleanMobile, type MobileState,
} from './mobile';

/** Deliberately loose, and the same shape the website uses. */
export function isEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}
