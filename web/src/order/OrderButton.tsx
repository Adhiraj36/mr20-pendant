import type { ComponentProps, MouseEvent } from 'react'
import { ButtonLink } from '@/components/Button'
import type { PlanId } from '@/data/pricing'
import { useOrder, type OrderPrefill } from '@/order/OrderContext'

/**
 * The one control that starts an order.
 *
 * It is still a real link — to `/#pricing`, where the order now is — so a
 * middle click, a modifier click and the right-click menu all still open
 * it in a tab of its own. A plain click never leaves the page: it scrolls
 * to the paysheet with this tier already selected, which is the whole
 * point of the thing.
 *
 * This replaced the ink-wipe route transition that used to run between the
 * page and the checkout. There is no longer anywhere to go.
 */
export function OrderButtonLink({
  plan,
  prefill,
  ...props
}: { plan: PlanId; prefill?: OrderPrefill } & Omit<ComponentProps<typeof ButtonLink>, 'to'>) {
  const { openOrder } = useOrder()

  return (
    <ButtonLink
      {...props}
      to="/#pricing"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        props.onClick?.(event)
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        event.preventDefault()
        openOrder(plan, prefill)
      }}
    />
  )
}
