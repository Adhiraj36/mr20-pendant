/* Detached as of round four: the order is the paysheet in sections/Pricing.tsx, and nothing mounts this. Kept whole for the day the full checkout is needed again. */
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Picture } from '@/components/Picture'
import { Receipt, type Row } from '@/components/Receipt'
import { Reveal } from '@/components/Reveal'
import { CHECKOUT, nextSteps } from '@/data/content'
import { PLANS, balanceFor, chargedFor, money } from '@/data/pricing'
import { useApi } from '@/lib/api'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { orderHref, useOrder, type Order } from '@/order/OrderContext'

/**
 * Not "Order Successful!".
 *
 * The headline stays the shape of the rest of the site — one line, one
 * sub-line — but the summary underneath is the thing the whole site has
 * been arguing for: a receipt, not a note. It comes from the server rather
 * than the basket that placed it, so a reload, or a link from a
 * confirmation email, shows the same paid order either way.
 *
 * The last panel of the sheet rather than a page of its own: paying
 * replaces the form with the receipt, and closing the sheet puts the
 * reader back on the page they were reading before they bought anything.
 */
export function Confirmed() {
  useDocumentTitle('Order — LYZN')

  const { isLoaded, isSignedIn } = useUser()
  const { placed, closeOrder } = useOrder()
  const [params] = useSearchParams()
  const api = useApi()

  // The basket's own record of what it just placed, or — a reload, a link
  // from an email — a reference carried in the URL instead.
  const reference = placed?.reference ?? params.get('ref') ?? ''

  const [order, setOrder] = useState<Order | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // Waiting on `isLoaded`/`isSignedIn` rather than firing regardless
    // matters here: a fetch that goes out before Clerk has resolved goes
    // out with no bearer token, fails, and — without these in the
    // dependency list — would never be retried once sign-in resolves.
    if (!reference || !isLoaded || !isSignedIn) return
    let cancelled = false
    setFailed(false)
    setOrder(null)

    api
      .get<{ order: Order }>(`/orders/${reference}`)
      .then((res) => {
        if (!cancelled) setOrder(res.order)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
    // Not `api` itself — a client that recreates its token getter every
    // render should not refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, isLoaded, isSignedIn, attempt])

  // The order is tied to an account (Decision 2); a signed-out visitor has
  // nothing here to confirm.
  if (!isLoaded) return null
  if (!isSignedIn) return <Navigate to={orderHref('details')} replace />
  if (!reference) return <Navigate to={orderHref('choose')} replace />

  if (failed) {
    return (
      <Frame>
        <p className="text-[15px] text-tone-muted">
          We couldn&rsquo;t load this order.{' '}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="link text-tone"
          >
            Try again
          </button>
          .
        </p>
      </Frame>
    )
  }

  if (!order) {
    return (
      <Frame>
        <p className="text-[15px] text-tone-muted">Loading your order…</p>
      </Frame>
    )
  }

  const plan = PLANS[order.plan]
  const copy = CHECKOUT.confirmed
  const balance = balanceFor(order)
  const nextStepRows = nextSteps({
    email: order.contact.email,
    renewal: Boolean(plan.renewal),
    balance,
  })

  const paidAt = new Date(order.paidAt ?? order.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const summaryRows: Row[] = [
    { k: 'Plan', v: plan.name },
    ...(plan.physical ? [{ k: 'Quantity', v: String(order.quantity) }] : []),
    ...(plan.renewal
      ? [{ k: 'AI', v: '₹499/mo from activation' }]
      : [{ k: 'Subscription', v: 'None' }]),
    { k: 'Balance on dispatch', v: money(balance), ok: balance === 0 },
    ...(order.contact.address.length > 0
      ? [{ k: plan.physical ? 'Delivery' : 'Access', v: order.contact.address.join(', ') }]
      : []),
  ]

  return (
    <Frame>
      {plan.physical && (
        <Reveal onMount>
          <div className="mx-auto mb-10 flex h-40 w-64 items-center justify-center overflow-hidden rounded-[20px] bg-tone-panel">
            <Picture
              name="card-pendant"
              alt="The LYZN pendant and its braided cord."
              sizes="256px"
              width={1200}
              height={800}
              className="object-contain"
            />
          </div>
        </Reveal>
      )}

      <Reveal onMount>
        <h2 className="display-l">{copy.headline}</h2>
        <p className="body-l mt-4 text-tone-muted">{copy.sub}</p>
      </Reveal>

      <Reveal onMount delay={120}>
        <p className="label-sm mt-8 text-tone-faint">
          Order {order.reference} · {paidAt}
        </p>
      </Reveal>

      <Reveal onMount delay={200}>
        <Receipt
          className="mx-auto mt-10 w-full max-w-[400px]"
          stamp="PRE-ORDERED"
          title="LYZN · ORDER"
          meta={paidAt}
          rows={summaryRows}
          total={{ k: 'PAID TODAY', v: money(chargedFor(order)) }}
          barcode={order.reference}
          footer="KEEP THIS"
        />
      </Reveal>

      <Reveal onMount delay={280}>
        <div className="mt-12 text-left">
          <p className="label-sm text-tone-faint">What happens next</p>
          <ul className="mt-5 flex flex-col border-t border-tone-line">
            {nextStepRows.map((row) => (
              <li key={row} className="border-b border-tone-line py-4 text-tone-muted">
                {row}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>

      <Reveal onMount delay={360}>
        {/* The way out is closing the sheet, not going somewhere: the page
            the order was placed from is still underneath it. */}
        <button type="button" onClick={closeOrder} className="link mt-12 text-tone-muted">
          {CHECKOUT.confirmed.back}
        </button>
      </Reveal>
    </Frame>
  )
}

/** The panel's frame, without content that depends on the order having
    loaded — shared by the receipt, the loading and the failed states. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-10 text-center">
        {children}
      </div>
    </div>
  )
}
