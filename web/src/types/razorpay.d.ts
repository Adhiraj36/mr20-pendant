/**
 * The slice of Razorpay Checkout's `window.Razorpay` this app actually
 * calls. No `@types` package exists for it, so this is hand-written and
 * deliberately minimal — a constructor, `open()`, `on('payment.failed', …)`
 * and the shape the `handler` callback receives.
 */
export {}

declare global {
  interface RazorpayPrefill {
    name?: string
    email?: string
    contact?: string
  }

  /** What Checkout hands the `handler` once a payment has gone through. */
  interface RazorpayResponse {
    razorpay_payment_id: string
    razorpay_order_id?: string
    razorpay_subscription_id?: string
    razorpay_signature: string
  }

  /** What Checkout hands a `payment.failed` listener. */
  interface RazorpayFailureEvent {
    error: {
      code?: string
      description?: string
      source?: string
      step?: string
      reason?: string
      metadata?: Record<string, unknown>
    }
  }

  interface RazorpayOptions {
    key: string
    /** Exactly one of these is set — a plan-only order, or a subscription
        when Automation rides the same sheet (Decision 1). */
    order_id?: string
    subscription_id?: string
    amount?: number
    currency?: string
    name?: string
    description?: string
    prefill?: RazorpayPrefill
    notes?: Record<string, string>
    theme?: { color?: string }
    handler?: (response: RazorpayResponse) => void
    modal?: { ondismiss?: () => void }
  }

  interface RazorpayInstance {
    open(): void
    on(event: 'payment.failed', handler: (response: RazorpayFailureEvent) => void): void
  }

  /** The constructor Checkout.js attaches to `window` once it has loaded. */
  type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance

  interface Window {
    Razorpay?: RazorpayConstructor
  }
}
