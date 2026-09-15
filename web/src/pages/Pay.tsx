/* Detached as of round four: the order is the paysheet in sections/Pricing.tsx, and nothing mounts this. Kept whole for the day the full checkout is needed again. */
import { useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { colors } from '@lyzn/design'
import { Lock } from 'lucide-react'
import { CheckoutShell } from '@/components/checkout/Shell'
import { OrderSummary } from '@/components/checkout/Summary'
import { PaymentMethod } from '@/components/checkout/Plan'
import { CheckboxField, Field, StateSelect, TextControl } from '@/components/checkout/Fields'
import { CHECKOUT, GST_NOTE } from '@/data/content'
import { loadCheckout } from '@/data/payment'
import { PLANS, money, validateDetails, validatePayment } from '@/data/pricing'
import { useApi, ApiError } from '@/lib/api'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import {
  orderHref,
  useOrder,
  toPlacedOrder,
  type CreatedOrder,
  type Order,
} from '@/order/OrderContext'
import { useFieldErrors } from './useFieldErrors'

/**
 * Step three: the invoice, how to pay, and the handoff.
 *
 * The button says the exact figure it is about to take, and the number on
 * it is the same one the panel has been showing since the first step.
 * "Submit" here means: price the basket on the server, open Razorpay
 * Checkout for whatever it priced, and verify what Checkout hands back —
 * the client never invents an amount or a reference of its own.
 */
export function Pay() {
  useDocumentTitle('Order — LYZN')

  const { isLoaded, isSignedIn } = useUser()
  const api = useApi()
  const { config, contact, totals, setContact, place, goToStep } = useOrder()
  const { errors, touch, showAll, all } = useFieldErrors(() =>
    validatePayment(contact, config.plan),
  )
  const [method, setMethod] = useState('upi')
  const [agreed, setAgreed] = useState(false)
  const [showGstin, setShowGstin] = useState(false)

  // Set on a provider cancel/failure or a network error. Every field stays
  // filled; only the notice and the button's enabled state change.
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const form = useRef<HTMLFormElement>(null)

  const plan = PLANS[config.plan]

  // The order is tied to an account (Decision 2); a signed-out visitor has
  // nothing here to pay for yet.
  if (!isLoaded) return null
  if (!isSignedIn) return <Navigate to={orderHref('details')} replace />

  // Nobody reaches the money without the details that make the money mean
  // something. A deep link lands on the step it actually needs.
  if (Object.keys(validateDetails(contact, config.plan)).length > 0) {
    return <Navigate to={orderHref('details')} replace />
  }

  // A pre-order takes the deposit and nothing else: no balance, no mandate.
  // That figure is `chargedToday`, and it is the one the backend hands
  // Checkout (internal/api/orders.go) — the button must never name a figure
  // other than the one about to be taken.
  const payAmount = totals.chargedToday

  const submit = async () => {
    setNotice('')
    showAll()

    const first = Object.keys(all)[0]
    if (first) {
      form.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus()
      return
    }
    if (!agreed || submitting) return

    setSubmitting(true)
    try {
      const created = await api.post<CreatedOrder>('/orders', {
        plan: config.plan,
        quantity: config.quantity,
        contact,
      })

      const Razorpay = await loadCheckout()
      const rzp = new Razorpay({
        key: created.checkout.keyId,
        ...(created.checkout.orderId
          ? { order_id: created.checkout.orderId }
          : { subscription_id: created.checkout.subscriptionId }),
        name: 'LYZN',
        description: created.checkout.description,
        prefill: created.checkout.prefill,
        notes: created.checkout.notes,
        theme: { color: colors.inkFg },
        handler: async (r: RazorpayResponse) => {
          try {
            const verified = await api.post<{ order: Order }>(
              `/orders/${created.reference}/verify`,
              r,
            )
            place(toPlacedOrder(verified.order))
            // The reference travels in the URL, so a reload of the
            // confirmation reads the same paid order back.
            goToStep('confirmed', { ref: verified.order.reference })
          } catch {
            setSubmitting(false)
            setNotice(CHECKOUT.pay.failure)
          }
        },
        modal: {
          ondismiss: () => {
            setSubmitting(false)
            setNotice(CHECKOUT.pay.failure)
          },
        },
      })
      rzp.on('payment.failed', () => {
        setSubmitting(false)
        setNotice(CHECKOUT.pay.failure)
      })
      rzp.open()
    } catch (err) {
      // A network failure, or the server itself rejecting the basket
      // (§9.6): the button comes back and nothing was charged.
      setSubmitting(false)
      setNotice(err instanceof ApiError ? err.message : CHECKOUT.pay.failure)
    }
  }

  return (
    <CheckoutShell
      step="pay"
      eyebrow={CHECKOUT.pay.eyebrow}
      title={CHECKOUT.pay.headline}
      chargedToday={totals.chargedToday}
      action={{
        label: `Pay ${money(payAmount)}`,
        onClick: () => void submit(),
        disabled: !agreed || submitting,
        icon: <Lock className="size-4" strokeWidth={1.5} />,
      }}
      back={{ label: 'Back', step: 'details' }}
      summary={<OrderSummary config={config} totals={totals} contact={contact} showAddress />}
    >
      <form
        ref={form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="flex flex-col gap-10"
      >
        <fieldset className="flex flex-col gap-5 border-0 p-0">
          <legend className="label-sm mb-1 text-tone-faint">Billing</legend>

          <Field label="Name on invoice" error={errors.invoiceName}>
            {(props) => (
              <TextControl
                {...props}
                data-field="invoiceName"
                        onBlur={() => touch('invoiceName')}
                value={contact.invoiceName}
                autoComplete="name"
                onChange={(e) => setContact({ invoiceName: e.target.value })}
              />
            )}
          </Field>

          {plan.physical ? (
            <>
              <CheckboxField
                checked={contact.billingSame}
                onChange={(value) => setContact({ billingSame: value })}
              >
                Billing address same as delivery
              </CheckboxField>

              {!contact.billingSame && (
                <div className="flex flex-col gap-5 border-l border-tone-line pl-5">
                  <Field label="Address line 1" error={errors.billingLine1}>
                    {(props) => (
                      <TextControl
                        {...props}
                        data-field="billingLine1"
                        onBlur={() => touch('billingLine1')}
                        value={contact.billingLine1}
                        onChange={(e) => setContact({ billingLine1: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Address line 2 (optional)">
                    {(props) => (
                      <TextControl
                        {...props}
                        value={contact.billingLine2}
                        onChange={(e) => setContact({ billingLine2: e.target.value })}
                      />
                    )}
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="City" error={errors.billingCity}>
                      {(props) => (
                        <TextControl
                          {...props}
                          data-field="billingCity"
                        onBlur={() => touch('billingCity')}
                          value={contact.billingCity}
                          onChange={(e) => setContact({ billingCity: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="State" error={errors.billingState}>
                      {(props) => (
                        <StateSelect
                          {...props}
                          data-field="billingState"
                        onBlur={() => touch('billingState')}
                          value={contact.billingState}
                          onChange={(e) => setContact({ billingState: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                  <Field label="PIN code" error={errors.billingPin} className="sm:max-w-[220px]">
                    {(props) => (
                      <TextControl
                        {...props}
                        data-field="billingPin"
                        onBlur={() => touch('billingPin')}
                        value={contact.billingPin}
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(e) =>
                          setContact({ billingPin: e.target.value.replace(/\D/g, '') })
                        }
                      />
                    )}
                  </Field>
                </div>
              )}
            </>
          ) : (
            // Software still needs a place of supply for the invoice, and
            // that is all it needs.
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="State" error={errors.state} hint={GST_NOTE || undefined}>
                {(props) => (
                  <StateSelect
                    {...props}
                    data-field="state"
                        onBlur={() => touch('state')}
                    value={contact.state}
                    onChange={(e) => setContact({ state: e.target.value })}
                  />
                )}
              </Field>
              <Field label="PIN code" error={errors.pin}>
                {(props) => (
                  <TextControl
                    {...props}
                    data-field="pin"
                        onBlur={() => touch('pin')}
                    value={contact.pin}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(e) => setContact({ pin: e.target.value.replace(/\D/g, '') })}
                  />
                )}
              </Field>
            </div>
          )}

          {showGstin ? (
            <Field label="GSTIN" error={errors.gstin} className="sm:max-w-[320px]">
              {(props) => (
                <TextControl
                  {...props}
                  data-field="gstin"
                        onBlur={() => touch('gstin')}
                  value={contact.gstin}
                  maxLength={15}
                  onChange={(e) => setContact({ gstin: e.target.value.toUpperCase() })}
                />
              )}
            </Field>
          ) : (
            <button
              type="button"
              onClick={() => setShowGstin(true)}
              className="link self-start text-[15px] text-tone-muted"
            >
              Add GSTIN
            </button>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-5 border-0 p-0">
          <legend className="label-sm mb-1 text-tone-faint">How you would like to pay</legend>
          <PaymentMethod value={method} onChange={setMethod} />
        </fieldset>

        {notice && (
          <p role="alert" className="text-[15px] text-danger">
            {notice}
          </p>
        )}

        <CheckboxField checked={agreed} onChange={setAgreed}>
          {CHECKOUT.pay.terms}{' '}
          <Link to="/terms" className="link text-tone">
            {CHECKOUT.pay.termsLink}
          </Link>
          .
        </CheckboxField>

        {/* Enter submits. Hidden from assistive technology and the tab
            order: the visible button beside the summary has the same name. */}
        <button type="submit" aria-hidden="true" tabIndex={-1} className="sr-only">
          Pay {money(payAmount)}
        </button>
      </form>
    </CheckoutShell>
  )
}
