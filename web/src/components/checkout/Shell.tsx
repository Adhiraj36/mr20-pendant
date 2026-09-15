import type { ReactNode } from 'react'
import { Button } from '@/components/Button'
import { money } from '@/data/pricing'
import { useOrder } from '@/order/OrderContext'
import { cn } from '@/lib/utils'

export const CHECKOUT_STEPS = [
  { id: 'choose', label: 'Choose' },
  { id: 'details', label: 'Details' },
  { id: 'pay', label: 'Pay' },
] as const

export type StepId = (typeof CHECKOUT_STEPS)[number]['id']

/**
 * Three steps, and only the ones already completed can be pressed.
 *
 * A stepper that lets somebody jump forward into a step whose inputs do not
 * exist yet is a stepper that lies about where they are.
 */
export function Stepper({ current }: { current: StepId }) {
  const { goToStep } = useOrder()
  const index = CHECKOUT_STEPS.findIndex((s) => s.id === current)

  return (
    <nav aria-label="Checkout progress">
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {CHECKOUT_STEPS.map((step, i) => {
          const done = i < index
          const active = i === index

          const body = (
            <span className="flex items-center gap-2.5">
              <span
                className={cn(
                  'label-sm',
                  active ? 'text-tone' : done ? 'text-tone-muted' : 'text-tone-faint',
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  'text-[15px]',
                  active ? 'text-tone' : done ? 'text-tone-muted' : 'text-tone-faint',
                )}
              >
                {step.label}
              </span>
            </span>
          )

          return (
            <li key={step.id} className="flex items-center gap-3">
              {done ? (
                <button type="button" onClick={() => goToStep(step.id)} className="hover:opacity-70">
                  {body}
                </button>
              ) : (
                <span aria-current={active ? 'step' : undefined}>{body}</span>
              )}
              {i < CHECKOUT_STEPS.length - 1 && (
                <span aria-hidden="true" className="h-px w-6 bg-tone-line-2 sm:w-10" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

type ShellProps = {
  step: StepId
  title: string
  eyebrow: string
  children: ReactNode
  summary: ReactNode
  action: { label: string; onClick: () => void; disabled?: boolean; icon?: ReactNode }
  /**
   * Shown in the bar so the number is never off screen. This is
   * `Totals.chargedToday` — what the card is actually about to be charged,
   * so the bar and the button beside it can never say different numbers.
   */
  chargedToday: number
  back?: { label: string; step: StepId }
}

/**
 * A step, framed by the sheet it is in.
 *
 * The chrome that used to belong to the checkout page — the stepper, the
 * summary, the bar carrying the total — lives here now, inside the panel
 * `OrderSheet` opens. The sheet is one column and about 480px wide, so
 * the summary sits under the form rather than beside it, and the bar is
 * pinned to the bottom of the panel on every size rather than only on a
 * phone: there is no width at which the total should be scrolled away.
 */
export function CheckoutShell({
  step,
  title,
  eyebrow,
  children,
  summary,
  action,
  chargedToday,
  back,
}: ShellProps) {
  const { goToStep } = useOrder()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-tone-line px-6 py-3.5">
        <Stepper current={step} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-8">
        <p className="label text-tone-faint">{eyebrow}</p>
        <h2 className="display-m mt-3">{title}</h2>

        <div className="mt-8">{children}</div>

        <div className="mt-10">{summary}</div>
      </div>

      <div className="shrink-0 border-t border-tone-line px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="label-sm text-tone-faint">Due today</p>
            <p className="text-[17px] font-medium text-tone tabular-nums">{money(chargedToday)}</p>
          </div>
          <Button onClick={action.onClick} disabled={action.disabled} className="shrink-0">
            {action.icon}
            {action.label}
          </Button>
        </div>
        {back && (
          <button
            type="button"
            onClick={() => goToStep(back.step)}
            className="link mt-3 text-[13px] text-tone-muted"
          >
            {back.label}
          </button>
        )}
      </div>
    </div>
  )
}
