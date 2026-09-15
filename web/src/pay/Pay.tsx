import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { colors } from '@lyzn/design'
import { loadCheckout } from '@/data/payment'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { PAY } from './copy'
import { deepLink, formatAmount, readPayParams, type PayParams } from './params'

/**
 * `/pay` — the payment sheet the app cannot open for itself.
 *
 * The phone opens this in an authentication session
 * (`WebBrowser.openAuthSessionAsync(payUrl, 'lyzn://order')`), the page opens
 * Razorpay Checkout the moment it has the script, and whichever way Checkout
 * ends the page navigates to `lyzn://order/<ref>?paid=0|1` — which is what
 * closes the session and hands the app its answer. See `src/pay/params.ts`
 * for why nothing here is a secret and why the amount is never sent on.
 *
 * The page is therefore almost entirely a redirect. What it draws is what a
 * person sees when a step of that takes longer than it should, or fails:
 * a slip that names the order, a line saying what is happening, and — always
 * — the deep link as something you can tap. An in-app browser may refuse a
 * scheme navigation it did not get from a gesture; if it does, the anchor is
 * the whole recovery, so it is on the page in every state.
 */
type Phase = 'opening' | 'paid' | 'cancelled' | 'broken' | 'failed'

export function Pay() {
  useDocumentTitle(PAY.title)

  // Read once. The query string is the whole of this page's input, and it
  // cannot change without a navigation that remounts it.
  const params = useMemo(() => {
    const read = readPayParams(window.location.search)
    return read.ok ? read.params : undefined
  }, [])

  const [phase, setPhase] = useState<Phase>(params ? 'opening' : 'broken')
  /**
   * Checkout dismisses its own sheet after a successful handler, so without
   * this the dismissal would report a cancellation over the top of a payment
   * that went through. A ref, not state: `ondismiss` fires in the same tick
   * as the handler's redirect and must read the value that redirect wrote.
   */
  const settled = useRef(false)
  /** StrictMode mounts an effect twice in development. One sheet, please. */
  const started = useRef(false)

  /**
   * Leave for the app.
   *
   * `paid` is not a claim that the money arrived — the app polls
   * `GET /orders/:reference` for that, and Razorpay's webhook is what writes
   * it. It says which of Checkout's two endings happened.
   */
  const leave = useCallback((ref: string, paid: boolean) => {
    settled.current = true
    setPhase(paid ? 'paid' : 'cancelled')
    window.location.href = deepLink(ref, paid)
  }, [])

  const open = useCallback(
    async (target: PayParams) => {
      settled.current = false
      setPhase('opening')
      try {
        const Razorpay = await loadCheckout()
        const rzp = new Razorpay({
          key: target.keyId,
          // The order id alone decides the figure. No `amount` is passed —
          // this page has one only to print it.
          order_id: target.orderId,
          currency: target.currency,
          name: target.name,
          prefill: { email: target.email, contact: target.contact },
          notes: { reference: target.ref },
          theme: { color: colors.inkFg },
          handler: () => leave(target.ref, true),
          modal: {
            ondismiss: () => {
              if (settled.current) return
              leave(target.ref, false)
            },
          },
        })
        // No `payment.failed` listener on purpose: a refused card should
        // leave Checkout open on its own retry screen, which is better at
        // saying why than this page could be. The dismissal that eventually
        // follows is what brings the person back.
        rzp.open()
      } catch {
        // The script did not load, or Checkout refused the options. Nothing
        // was charged, and the button below tries the whole thing again.
        setPhase('failed')
      }
    },
    [leave],
  )

  useEffect(() => {
    if (!params || started.current) return
    started.current = true
    void open(params)
  }, [params, open])

  const back = deepLink(params?.ref ?? '', phase === 'paid')
  const amount = params ? formatAmount(params.amount, params.currency) : undefined

  const said: Record<Phase, string> = {
    opening: PAY.opening,
    paid: PAY.paid,
    cancelled: PAY.cancelled,
    broken: PAY.brokenTitle,
    failed: PAY.failedTitle,
  }
  // Only three of the five have anything to add. The rest say one line and
  // are gone before it has been read twice.
  const note: Partial<Record<Phase, string>> = {
    opening: PAY.openingNote,
    broken: PAY.brokenLine,
    failed: PAY.failedLine,
  }

  return (
    <div className="on-paper flex min-h-screen flex-col items-center justify-center bg-tone-bg px-6 py-16">
      <main className="flex w-full max-w-[400px] flex-col items-center gap-8">
        {params && (
          <div className="receipt w-full max-w-[340px]">
            <header className="text-center">
              <p className="text-[12.5px] font-semibold tracking-[0.16em]">{PAY.slip}</p>
            </header>
            <div className="r-cut relative mt-4 pt-4">
              {phase === 'paid' && <span className="r-stamp -top-5">PAID</span>}
              <p className="r-row">
                <span className="r-key">{PAY.order}</span>
                <span className="lead" aria-hidden="true" />
                <span className="r-val">{params.ref}</span>
              </p>
              {amount && (
                <p className="r-row">
                  <span className="r-key">{PAY.dueToday}</span>
                  <span className="lead" aria-hidden="true" />
                  <span className="r-val">{amount}</span>
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-3 text-center">
          <p role="status" className="text-[17px] text-tone">
            {said[phase]}
          </p>
          {note[phase] && <p className="text-[14px] text-tone-muted">{note[phase]}</p>}
        </div>

        {phase === 'failed' && params && (
          <button type="button" className="btn btn-primary" onClick={() => void open(params)}>
            {PAY.retry}
          </button>
        )}

        {/* Always, in every state — including the broken one, where `ref` may
            be empty and the app still gets told the attempt is over. */}
        <div className="flex flex-col items-center gap-2 border-t border-tone-line pt-6 text-center">
          <p className="text-[13px] text-tone-faint">{PAY.fallback}</p>
          <a className="btn btn-secondary" href={back}>
            {PAY.fallbackLink}
          </a>
        </div>
      </main>
    </div>
  )
}
