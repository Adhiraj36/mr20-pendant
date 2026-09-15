/**
 * Payment: the methods shown before the sheet opens, and the loader for
 * Razorpay's Checkout script.
 *
 * The order itself — amount, key, whether it is a plan order or a
 * subscription — comes from the server (`POST /orders`, see `pages/Pay.tsx`
 * and `backend/go/internal/api/orders.go`). Nothing about money lives here.
 */

export type PayMethod = {
  id: string
  name: string
  detail: string
}

/**
 * What the provider will offer once it opens. Shown so the sheet that
 * appears after the button is not a surprise. No logos: this is a choice
 * about how somebody wants to pay, not a wall of brands.
 */
export const PAY_METHODS: PayMethod[] = [
  { id: 'upi', name: 'UPI', detail: 'Any UPI app' },
  { id: 'card', name: 'Card', detail: 'Credit or debit' },
  { id: 'netbanking', name: 'Net banking', detail: 'All major Indian banks' },
]

const CHECKOUT_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

let checkoutPromise: Promise<RazorpayConstructor> | null = null

/**
 * Injects Razorpay's Checkout script the first time anything needs it, and
 * hands back the same promise to every caller after that — the pay button
 * only ever needs one `<script>` on the page, however many times somebody
 * comes back to try again.
 */
export function loadCheckout(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (checkoutPromise) return checkoutPromise

  checkoutPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT_SRC
    script.async = true
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay)
      else reject(new Error('Razorpay Checkout loaded but did not attach to window.Razorpay'))
    }
    script.onerror = () => {
      // A failed load should not be remembered as a failed load forever —
      // the next attempt (a flaky network, an ad blocker toggled off)
      // deserves a fresh try.
      checkoutPromise = null
      reject(new Error('Could not load Razorpay Checkout'))
    }
    document.head.appendChild(script)
  })

  return checkoutPromise
}
