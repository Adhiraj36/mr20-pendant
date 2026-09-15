import { Minus, Plus } from 'lucide-react'
import { Picture } from '@/components/Picture'
import { MAX_QUANTITY, PLANS, PLAN_ORDER, money, type PlanId } from '@/data/pricing'
import { PAY_METHODS } from '@/data/payment'
import { cn } from '@/lib/utils'

/** Three tiers, one control. Switching never loses anything already typed. */
export function PlanSwitch({
  value,
  onChange,
}: {
  value: PlanId
  onChange: (plan: PlanId) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Plan"
      className="grid gap-1 border border-tone-line bg-tone-panel p-1 sm:grid-cols-3"
    >
      {PLAN_ORDER.map((id) => {
        const plan = PLANS[id]
        const active = value === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            className={cn(
              'flex min-h-[52px] items-center justify-between gap-3 px-4 text-left transition-colors duration-[var(--dur-ui)]',
              active ? 'bg-tone-inv-bg text-tone-inv-fg' : 'text-tone-muted hover:text-tone',
            )}
          >
            <span className="text-[15px] font-medium">{plan.name}</span>
            <span className="text-[15px] tabular-nums">{money(plan.price)}</span>
          </button>
        )
      })}
    </div>
  )
}

export function PlanPanel({
  plan,
  quantity,
  onQuantity,
}: {
  plan: PlanId
  quantity: number
  onQuantity: (next: number) => void
}) {
  const details = PLANS[plan]

  return (
    <div className="flex flex-col gap-7 rounded-[20px] border border-tone-line bg-tone-panel p-6 sm:flex-row sm:p-7">
      <div className="flex h-32 w-full shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-tone-panel-2 sm:w-40">
        {details.physical ? (
          <Picture
            name="card-pendant"
            alt="The LYZN pendant and its braided cord, laid flat."
            width={1200}
            height={800}
            sizes="200px"
            className="object-contain"
          />
        ) : (
          <svg viewBox="0 0 64 96" className="h-24 text-tone-faint" aria-hidden="true" fill="none">
            <rect x="0.75" y="0.75" width="62.5" height="94.5" rx="10" stroke="currentColor" />
            <rect x="10" y="18" width="44" height="3" rx="1.5" fill="currentColor" opacity="0.5" />
            <rect x="10" y="28" width="30" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
            <rect x="10" y="44" width="44" height="14" rx="5" stroke="currentColor" opacity="0.5" />
          </svg>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div>
          <p className="text-[15px] text-tone">{details.line}</p>
          <ul className="mt-3 flex flex-wrap gap-x-2 gap-y-1.5 text-[14px] text-tone-muted">
            {details.bullets.map((item, i) => (
              <li key={item} className="flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden="true" className="text-tone-faint">
                    ·
                  </span>
                )}
                {item}
              </li>
            ))}
          </ul>
        </div>

        {details.physical && (
          <QuantityStepper value={quantity} onChange={onQuantity} />
        )}

        {details.checkoutMeta && <p className="label-sm text-tone-faint">{details.checkoutMeta}</p>}
      </div>
    </div>
  )
}

export function QuantityStepper({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="label-sm text-tone-muted" id="quantity-label">
        Quantity
      </span>
      <div
        className="flex items-center gap-1 border border-tone-line-2 p-1"
        role="group"
        aria-labelledby="quantity-label"
      >
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          disabled={value <= 1}
          aria-label="One fewer"
          className="flex size-9 items-center justify-center text-tone transition-colors hover:bg-tone-panel-2 disabled:opacity-30"
        >
          <Minus className="size-4" strokeWidth={1.5} />
        </button>
        <span className="min-w-8 text-center text-[15px] text-tone tabular-nums" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          disabled={value >= MAX_QUANTITY}
          aria-label="One more"
          className="flex size-9 items-center justify-center text-tone transition-colors hover:bg-tone-panel-2 disabled:opacity-30"
        >
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}

/**
 * Three ways to pay, and no logos.
 *
 * Choosing here changes nothing on the page: the provider's own sheet
 * collects the details. It is asked anyway because knowing which sheet is
 * about to open is the difference between a button and a surprise.
 */
export function PaymentMethod({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div role="radiogroup" aria-label="Payment method" className="grid gap-3 sm:grid-cols-3">
      {PAY_METHODS.map((method) => {
        const active = value === method.id
        return (
          <button
            key={method.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(method.id)}
            className={cn(
              'flex flex-col gap-1.5 border p-4 text-left transition-colors duration-[var(--dur-ui)]',
              active ? 'border-tone bg-tone-panel' : 'border-tone-line hover:border-tone-line-2',
            )}
          >
            <span className="text-[15px] font-medium text-tone">{method.name}</span>
            <span className="text-[13px] leading-snug text-tone-faint">{method.detail}</span>
          </button>
        )
      })}
    </div>
  )
}
