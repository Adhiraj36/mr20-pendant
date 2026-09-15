import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useUser } from '@clerk/clerk-react'
import { barcodeBars, colors } from '@lyzn/design'
import { Section } from '@/components/Section'
import { PRICING } from '@/data/content'
import { loadCheckout } from '@/data/payment'
import {
  COMPARE,
  PLANS,
  PLAN_ORDER,
  chargedFor,
  isEmail,
  isPhone,
  money,
  type Plan,
  type PlanId,
  type ReceiptLine,
} from '@/data/pricing'
import { ApiError, useApi } from '@/lib/api'
import { useMedia } from '@/lib/hooks'
import { track } from '@/lib/posthog'
import { useEmailCode } from '@/lib/useEmailCode'
import { useOrderCount } from '@/lib/useOrderCount'
import { useOrder, type CreatedOrder, type Order } from '@/order/OrderContext'
import { cn } from '@/lib/utils'
import '@/styles/pricing.css'

/**
 * The barcode, as one repeating gradient rather than eighty-four elements.
 *
 * `barcodeBars` hashes the seed into widths of 1 to 3, deterministic on
 * purpose — one tier always draws the same code — and they are read here in
 * pairs, a bar and then the gap after it, until the pattern is about 30px
 * wide, which is where it starts repeating across the slip.
 */
function barcodeImage(seed: string) {
  const bars = barcodeBars(seed)
  const stops: string[] = []
  let x = 0

  for (let i = 0; x < 30 && i + 1 < bars.length; i += 2) {
    const bar = bars[i]
    const gap = bars[i + 1]
    stops.push(`var(--ink) ${x}px ${x + bar}px`, `transparent ${x + bar}px ${x + bar + gap}px`)
    x += bar + gap
  }

  return `repeating-linear-gradient(90deg,${stops.join(',')})`
}

/**
 * What the card is charged today.
 *
 * Task 1 of this round puts the deposit on the tier and hands it back from
 * `priceOrder` as `dueToday`; until then this reads the deposit if the
 * table has one and the full price if it does not — so the swap to
 * `priceOrder({ plan: id, quantity: 1 }).dueToday` is this one line.
 */
function depositOf(plan: Plan) {
  return (plan as Plan & { deposit?: number }).deposit ?? plan.price
}

/** What is still owed when the pendant ships. */
function balanceOf(plan: Plan, paid: number) {
  return Math.max(0, plan.price - paid)
}

/**
 * The phone as the validator wants it.
 *
 * The field asks for +91, so the country code is stripped before
 * `isPhone`, which is the checkout's and counts ten digits starting 6–9.
 */
function localMobile(value: string) {
  return value.replace(/[\s-]/g, '').replace(/^\+91/, '')
}

/**
 * The four stages of the paysheet, in the order they are reached.
 *
 * Nothing navigates between them: the form under the slip is one form, and
 * a stage is which of its rows are showing and what the button says. A
 * visitor who is already signed in starts at `pay` — the code exists only
 * to prove an address nobody has proved yet.
 */
type Stage = 'contact' | 'code' | 'pay' | 'done'

type Errors = { phone?: string; email?: string }

/** The tier's own slip, or the slip printed for an order that was paid. */
type Slip = {
  seed: string
  stamp: string
  meta: string
  rows: readonly ReceiptLine[]
  total?: { k: string; v: string }
  /** Somebody else's price, which only the sales pitch carries. */
  compare: boolean
  footer: string
}

/** The date on a paid slip, in the shape a till would print it. */
function slipDate(iso: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function Pricing() {
  const uid = useId()

  // The tier lives in the order context rather than here, so the hero and
  // the nav can preselect one on their way down to this section.
  const { config, setPlan } = useOrder()
  const tier = config.plan
  const plan = PLANS[tier]

  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Errors>({})

  const [stage, setStage] = useState<Stage>('contact')
  /** The order the server verified. Present only at `done`. */
  const [placed, setPlaced] = useState<Order | null>(null)
  /** A provider cancel, a failed payment, or a server that said no. */
  const [notice, setNotice] = useState('')
  const [paying, setPaying] = useState(false)

  const phoneField = useRef<HTMLInputElement>(null)
  const emailField = useRef<HTMLInputElement>(null)
  const codeField = useRef<HTMLInputElement>(null)

  const { isLoaded, isSignedIn } = useUser()
  const api = useApi()
  const auth = useEmailCode()
  const orderCount = useOrderCount()

  /* The pay sheet is a real <details>. On a desktop the summary bar is
     display:none and the sheet is always open — a closed one there would
     hide the receipt and the form with no way to open them. Below 900px it
     is the fixed bottom sheet, and it starts closed. */
  const narrow = useMedia('(max-width: 900px)')
  const [sheetOpen, setSheetOpen] = useState(false)
  const open = narrow ? sheetOpen : true

  /*
   * The bar belongs to this section, not to the page.
   *
   * The reference fixed it for the whole document, which works when the
   * document is the checkout. Ours is eight screens long and the bar sat
   * over the hero and the whole of the story — it covered "See how it
   * works", which is the one thing the hero asks the reader to press.
   *
   * So it arrives when the section does. The observer's root is grown
   * ninety per cent of a screen upward, which is what keeps the bar while
   * the reader is just past the tiers and still deciding; beyond that the
   * section is genuinely behind them and the bar goes with it. Nothing
   * below 900px is fixed while `data-near` is false, so it cannot cover
   * anything it is not the bar for.
   */
  const section = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDetailsElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = section.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry?.isIntersecting ?? false),
      { rootMargin: '90% 0px 0px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!narrow || !sheetOpen) return
    const id = window.setTimeout(() => phoneField.current?.focus({ preventScroll: true }), 60)
    return () => window.clearTimeout(id)
  }, [narrow, sheetOpen])

  // Six digits are the only thing to do on this stage, so the cursor is
  // waiting in them the moment the row appears.
  //
  // On a phone the sheet is a bottom sheet with a receipt above the form,
  // and it is already taller than the screen: the row a new stage adds
  // arrives below the fold, and a focused field the reader cannot see is a
  // form that looks broken. So the sheet is scrolled to the stage's own
  // action. The sheet, not the page — `scrollIntoView` would carry the
  // section behind it along and lose the reader's place.
  useEffect(() => {
    if (stage === 'code') codeField.current?.focus({ preventScroll: true })
    if (!narrow || stage === 'contact') return
    const el = sheet.current
    if (!el) return
    const id = window.setTimeout(() => {
      el.scrollTop = el.scrollHeight
    }, 40)
    return () => window.clearTimeout(id)
  }, [stage, narrow])

  const deposit = depositOf(plan)
  const amount = money(deposit)
  const locked = stage !== 'contact'

  function chooseTier(id: PlanId) {
    track('tier_selected', { plan: id })
    setPlan(id)
    // A paid slip belongs to the order that paid for it. Choosing another
    // tier after that starts a second order rather than reprinting the
    // first — and the session is already live, so it starts at the money.
    if (stage === 'done') {
      setPlaced(null)
      setNotice('')
      setStage('pay')
    }
  }

  /** Stage 1 → the code, or straight to the money for a live session. */
  async function reserve() {
    const next: Errors = {}
    if (!isPhone(localMobile(phone))) next.phone = PRICING.form.phone.error
    if (!isEmail(email)) next.email = PRICING.form.email.error
    setErrors(next)

    // The first field that failed takes the focus, as the reference does.
    if (next.phone) return phoneField.current?.focus()
    if (next.email) return emailField.current?.focus()

    track('checkout_contact_submitted', { plan: tier, signedIn: Boolean(isSignedIn) })

    // Nothing to prove: this address already has a session behind it.
    if (isSignedIn) {
      setStage('pay')
      return
    }

    if (await auth.send(email)) setStage('code')
  }

  /** Stage 2 → the money, once Clerk says the six digits were right. */
  async function confirmCode() {
    if (await auth.verify()) {
      track('checkout_code_verified', { plan: tier })
      setStage('pay')
    }
  }

  /**
   * Stage 3 — the deposit.
   *
   * The button says the exact figure it is about to take, and it is the
   * server that decides that figure: `POST /orders` prices the tier and
   * hands back a Checkout session, and the reference that comes with it is
   * what the payment is verified against. The client never invents an
   * amount or a reference of its own.
   */
  async function pay() {
    if (paying) return
    setNotice('')
    setPaying(true)

    try {
      const created = await api.post<CreatedOrder>('/orders', {
        plan: tier,
        quantity: 1,
        // A pre-order needs somewhere to send the confirmation and a number
        // to reach the buyer on. There is nothing to ship until November 2026, so
        // there is no address to ask for yet.
        contact: { email: email.trim(), phone: localMobile(phone) },
      })

      track('checkout_payment_started', { plan: tier, reference: created.reference, amount: created.dueToday })

      // Razorpay dismisses its own sheet after a successful handler, so
      // without this the dismissal would report a failed payment over the
      // top of the receipt that just printed.
      let settled = false

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
        handler: async (response: RazorpayResponse) => {
          try {
            const verified = await api.post<{ order: Order }>(
              `/orders/${created.reference}/verify`,
              response,
            )
            settled = true
            track('order_completed', {
              plan: tier,
              reference: created.reference,
              revenue: verified.order.dueToday,
              currency: 'INR',
            })
            setPlaced(verified.order)
            setStage('done')
          } catch {
            track('checkout_payment_failed', { plan: tier, reason: 'verify_failed' })
            setNotice(PRICING.form.pay.failure)
          } finally {
            setPaying(false)
          }
        },
        modal: {
          ondismiss: () => {
            if (settled) return
            track('checkout_payment_failed', { plan: tier, reason: 'dismissed' })
            setPaying(false)
            setNotice(PRICING.form.pay.failure)
          },
        },
      })
      rzp.on('payment.failed', () => {
        if (settled) return
        track('checkout_payment_failed', { plan: tier, reason: 'payment_failed' })
        setPaying(false)
        setNotice(PRICING.form.pay.failure)
      })
      rzp.open()
    } catch (err) {
      // A network failure, or the server itself rejecting the order: the
      // button comes back and nothing was charged.
      track('checkout_payment_failed', { plan: tier, reason: 'order_create_failed' })
      setPaying(false)
      setNotice(err instanceof ApiError ? err.message : PRICING.form.pay.failure)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (stage === 'contact') return void reserve()
    if (stage === 'code') return void confirmCode()
    if (stage === 'pay') return void pay()
  }

  /** Back to the address, with the attempt it belonged to thrown away. */
  function changeEmail() {
    auth.restart()
    setNotice('')
    setStage('contact')
    emailField.current?.focus()
  }

  // Clerk decides both things the first press turns on — whether there is
  // already a session, and whether a code can be sent at all — so until it
  // has loaded the button is held rather than left to do nothing.
  const busy = auth.busy || paying || (stage === 'contact' && !isLoaded)
  const action =
    stage === 'contact'
      ? auth.busy
        ? PRICING.form.code.sending
        : `${plan.cta} · ${amount}`
      : stage === 'code'
        ? auth.busy
          ? PRICING.form.code.checking
          : PRICING.form.code.verify
        : paying
          ? PRICING.form.pay.opening
          : `${PRICING.form.pay.label} ${amount}`

  // The slip is the tier's until there is an order, and the order's after.
  const paid = placed ? chargedFor(placed) : 0
  const slip: Slip = placed
    ? {
        seed: placed.reference,
        stamp: PRICING.form.done.stamp,
        meta: slipDate(placed.paidAt ?? placed.createdAt),
        rows: [
          { k: 'Tier', v: PLANS[placed.plan].name },
          { k: 'Paid today', v: money(paid), ok: true },
          { k: 'Balance on dispatch', v: money(balanceOf(PLANS[placed.plan], paid)) },
          { k: 'Reference', v: placed.reference },
        ],
        compare: false,
        footer: PRICING.form.done.footer,
      }
    : {
        seed: plan.id,
        stamp: plan.receipt.stamp,
        meta: plan.receipt.meta,
        rows: plan.receipt.rows,
        total: plan.receipt.total,
        compare: true,
        footer: plan.receipt.footer,
      }

  return (
    <Section id="pricing" ground="paper" transparent labelledBy="pricing-title" className="pricing-sec">
      <div className="sec" ref={section}>
        <div className="sec-head">
          <span className="sec-no">{PRICING.no}</span>
          <div>
            <h2 id="pricing-title">{PRICING.headline}</h2>
            <p className="sec-note">{PRICING.sub}</p>
            <p className="pricing-counter mono">
              <span
                aria-hidden="true"
                className="pricing-counter-rule"
                style={{ '--pct': `${(orderCount.count / orderCount.of) * 100}%` } as CSSProperties}
              />
              {PRICING.counter
                .replace('{count}', String(orderCount.count))
                .replace('{of}', String(orderCount.of))}
            </p>
          </div>
        </div>

        <div className="pricing">
          <fieldset className="tiers">
            <legend className="sr-only">{PRICING.legend}</legend>
            {PLAN_ORDER.map((id) => {
              const item = PLANS[id]
              const inputId = `${uid}-${id}`
              const footId = `${inputId}-foot`

              return (
                <div className="tier" key={id}>
                  <input
                    className="tier-in"
                    type="radio"
                    name={`${uid}-tier`}
                    id={inputId}
                    value={id}
                    checked={id === tier}
                    onChange={() => chooseTier(id)}
                    aria-describedby={footId}
                  />
                  <label className="tier-card" htmlFor={inputId}>
                    <span className="tier-top">
                      <span className="tier-name mono">{item.name}</span>
                      {/* What the device costs, and only that. What today
                          takes is the slip's business — it is the surface
                          with room to say the deposit and the balance in the
                          same breath, which is the only way that number is
                          not a second price for the same thing. */}
                      <span className="tier-price mono">{money(item.price)}</span>
                    </span>
                    <span className="tier-line mono">{item.line}</span>
                    <span className="tier-list">
                      {item.bullets.map((bullet) => (
                        <span className="tier-bullet" key={bullet}>
                          {bullet}
                        </span>
                      ))}
                    </span>
                  </label>
                  <p className="tier-foot mono" id={footId}>
                    {item.foot}
                  </p>
                </div>
              )
            })}
          </fieldset>

          <div className="pricing-right">
            <details
              ref={sheet}
              className="paysheet"
              data-near={near ? 'true' : 'false'}
              open={open}
              // Only while it is the bottom sheet. React opens the element
              // by setting the property after creating it, which the browser
              // reports as a toggle — so on a desktop, where the sheet is
              // always open, that first event would otherwise leave the
              // mobile state open before the sheet has ever been one.
              onToggle={(event) => narrow && setSheetOpen(event.currentTarget.open)}
            >
              <summary className="paysheet-bar">
                <span className="ps-name mono">{plan.name}</span>
                <span className="ps-total mono">{amount}</span>
                <span className="ps-cta mono" aria-hidden="true">
                  {stage === 'done'
                    ? PRICING.form.done.stamp
                    : stage === 'pay'
                      ? PRICING.form.pay.label
                      : stage === 'code'
                        ? PRICING.form.code.verify
                        : PRICING.form.reserve}
                </span>
              </summary>

              <div className="paysheet-body">
                {/* Keyed by what it is a slip for, so a change of tier — and
                    the order that ends the flow — prints again rather than
                    swapping in place. */}
                <article className="rcpt" key={slip.seed}>
                  <div className="stamp" aria-label={`Stamped: ${slip.stamp.toLowerCase()}`}>
                    {slip.stamp}
                  </div>
                  <div className="s-head">
                    <div className="s-brand">LYZN · {plan.name}</div>
                    <div className="s-sub">{slip.meta}</div>
                  </div>

                  <div className="s-body">
                    {slip.rows.map((row) => (
                      <div className="ln" key={row.k}>
                        <span className="k">{row.k}</span>
                        <span className="lead" />
                        <span className={cn('v', row.ok && 'ok')}>{row.v}</span>
                      </div>
                    ))}
                    {slip.total && (
                      <div className="ln sum">
                        <span className="k">{slip.total.k}</span>
                        <span className="lead" />
                        <span className="v tot">{slip.total.v}</span>
                      </div>
                    )}
                    {/* What the same two years cost on the thing people
                        compare it to. A receipt lists what you paid; this is
                        the one line on it that is somebody else's price —
                        which a slip for an order that was actually placed
                        has no business carrying. */}
                    {slip.compare && (
                      <div className="ln">
                        <span className="k was">{COMPARE.k}</span>
                        <span className="lead" />
                        <span className="v was">{COMPARE.v}</span>
                      </div>
                    )}
                  </div>

                  <div
                    className="code"
                    aria-hidden="true"
                    style={{ backgroundImage: barcodeImage(slip.seed) }}
                  />
                  <div className="s-foot">{slip.footer}</div>
                </article>

                {placed ? (
                  // The form has nothing left to ask. What replaces it is
                  // one line about what happened and one about what to
                  // watch for.
                  <div className="order done" role="status">
                    <p className="done-line">{PRICING.form.done.line}</p>
                    <p className="fine">
                      {PRICING.form.done.note.replace('{email}', placed.contact.email || email)}
                    </p>
                  </div>
                ) : (
                  <form className="order" noValidate onSubmit={submit}>
                    <label htmlFor={`${uid}-phone`}>
                      {PRICING.form.phone.label}
                      <input
                        ref={phoneField}
                        id={`${uid}-phone`}
                        name="phone"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        maxLength={10}
                        placeholder={PRICING.form.phone.placeholder}
                        value={phone}
                        readOnly={locked}
                        onChange={(event) => {
                          // Ten digits, nothing else: the field is an Indian
                          // mobile, and the note under it says why.
                          setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))
                          if (errors.phone) setErrors((e) => ({ ...e, phone: undefined }))
                        }}
                        aria-describedby={`${uid}-phone-err`}
                        aria-invalid={errors.phone ? true : undefined}
                        required
                      />
                      <span className="note">{PRICING.form.phone.note}</span>
                    </label>
                    <p className="err" id={`${uid}-phone-err`} role="alert">
                      {errors.phone}
                    </p>

                    <label htmlFor={`${uid}-email`}>
                      {PRICING.form.email.label}
                      <input
                        ref={emailField}
                        id={`${uid}-email`}
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder={PRICING.form.email.placeholder}
                        value={email}
                        readOnly={locked}
                        onChange={(event) => {
                          setEmail(event.target.value)
                          if (errors.email) setErrors((e) => ({ ...e, email: undefined }))
                        }}
                        aria-describedby={`${uid}-email-err`}
                        aria-invalid={errors.email ? true : undefined}
                        required
                      />
                    </label>
                    <p className="err" id={`${uid}-email-err`} role="alert">
                      {/* Clerk's own wording for a refused address belongs
                          under the address, beside our own. */}
                      {stage === 'contact' ? (errors.email ?? auth.error) : undefined}
                    </p>

                    {stage === 'code' && (
                      <>
                        <label htmlFor={`${uid}-code`}>
                          {PRICING.form.code.label}
                          <input
                            ref={codeField}
                            id={`${uid}-code`}
                            name="code"
                            className="code-in"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder={PRICING.form.code.placeholder}
                            value={auth.code}
                            onChange={(event) =>
                              auth.setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                            }
                            aria-describedby={`${uid}-code-err`}
                            aria-invalid={auth.error ? true : undefined}
                            required
                          />
                          {/* Pink on request — not a site token, a one-off call-out for the spam-folder note. */}
                          <span className="note" style={{ color: '#EC4899' }}>
                            {PRICING.form.code.note}
                          </span>
                        </label>
                        <p className="err" id={`${uid}-code-err`} role="alert">
                          {auth.error}
                        </p>

                        <div className="code-again">
                          {/* Offered late on purpose. A resend live from the
                              first second gets pressed before the first email
                              has landed, and then there are two codes and
                              only one of them works. */}
                          <button
                            type="button"
                            className="mono-link"
                            disabled={busy || auth.wait > 0}
                            onClick={() => void auth.resend()}
                          >
                            {auth.wait > 0
                              ? PRICING.form.code.resendIn.replace('{s}', String(auth.wait))
                              : PRICING.form.code.resend}
                          </button>
                          <button type="button" className="mono-link" onClick={changeEmail}>
                            {PRICING.form.code.change}
                          </button>
                        </div>
                      </>
                    )}

                    {notice && (
                      <p className="err" role="alert">
                        {notice}
                      </p>
                    )}

                    {/* Clerk mounts its bot check here when an instance has
                        one switched on; without the element a headless
                        sign-up is refused outright. Empty otherwise. */}
                    <div id="clerk-captcha" />
                    <button className="btn" type="submit" disabled={busy}>
                      {action}
                    </button>
                    <p className="fine">{PRICING.fine}</p>
                  </form>
                )}
              </div>
            </details>
          </div>
        </div>
      </div>
    </Section>
  )
}
