import { useEffect, useRef, useState } from 'react'
import { GST_NOTE } from '@/data/content'
import {
  PLANS,
  addressLines,
  money,
  type Contact,
  type OrderConfig,
  type Totals,
} from '@/data/pricing'
import { usePrefersReducedMotion } from '@/lib/hooks'
import { useOrder } from '@/order/OrderContext'

/**
 * Counts to a new total rather than swapping to it.
 *
 * Two hundred and forty milliseconds is enough for the eye to notice which
 * way the number went, which is the entire point: somebody who has just
 * changed the quantity should see the total agree with them.
 */
function useRolling(target: number) {
  const reduced = usePrefersReducedMotion()
  const [value, setValue] = useState(target)
  const from = useRef(target)

  useEffect(() => {
    if (reduced) {
      setValue(target)
      return
    }
    const start = performance.now()
    const origin = from.current
    let frame = 0

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 240)
      setValue(Math.round(origin + (target - origin) * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
      else from.current = target
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, reduced])

  return value
}

/**
 * The one panel that is always telling the truth about money.
 *
 * The line items are deposits, so "Due today" is their sum and is the figure
 * the button is about to take. The balance due on dispatch is deliberately
 * not a row here: everything in this list reads as part of the total, and
 * that money is not moving today.
 */
export function OrderSummary({
  config,
  totals,
  contact,
  showAddress,
}: {
  config: OrderConfig
  totals: Totals
  contact?: Contact
  showAddress?: boolean
}) {
  const { goToStep } = useOrder()
  const plan = PLANS[config.plan]
  // The same number the button is about to take.
  const total = useRolling(totals.chargedToday)
  const address = contact && plan.physical ? addressLines(contact) : []

  return (
    <div className="rounded-[20px] border border-tone-line bg-tone-panel p-6 sm:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="display-m text-[19px]">Your order</h2>
        <button
          type="button"
          onClick={() => goToStep('choose')}
          className="label-sm text-tone-muted transition-colors hover:text-tone"
        >
          Edit
        </button>
      </div>

      {/* One list. The total is a term and its value like every other row,
          so it belongs inside the same <dl> rather than in a div beside it. */}
      <dl className="mt-6 flex flex-col gap-4 border-t border-tone-line pt-6">
        {totals.items.map((item) => (
          <div key={item.label} className="flex items-baseline justify-between gap-4">
            <dt className="min-w-0">
              <span className="block text-[15px] text-tone">{item.label}</span>
              {item.detail && (
                <span className="mt-1 block font-mono text-[11px] text-tone-faint">{item.detail}</span>
              )}
            </dt>
            <dd className="shrink-0 text-[15px] text-tone tabular-nums">{money(item.amount)}</dd>
          </div>
        ))}

        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-tone-line pt-6">
          <dt className="text-[15px] font-medium text-tone">Due today</dt>
          <dd className="price text-[26px] text-tone">{money(total)}</dd>
        </div>
      </dl>

      {showAddress && (
        <div className="mt-6 border-t border-tone-line pt-6">
          <p className="label-sm text-tone-faint">{plan.physical ? 'Delivery' : 'Access'}</p>
          <address className="mt-3 font-mono text-[12px] leading-relaxed text-tone-muted not-italic">
            {contact?.email}
            {address.length > 0 && (
              <>
                <br />
                {address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </>
            )}
          </address>
        </div>
      )}

      {GST_NOTE && <p className="label-sm mt-6 text-tone-faint">{GST_NOTE}</p>}
    </div>
  )
}
