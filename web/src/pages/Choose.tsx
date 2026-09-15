/* Detached as of round four: the order is the paysheet in sections/Pricing.tsx, and nothing mounts this. Kept whole for the day the full checkout is needed again. */
import { CheckoutShell } from '@/components/checkout/Shell'
import { OrderSummary } from '@/components/checkout/Summary'
import { PlanPanel, PlanSwitch } from '@/components/checkout/Plan'
import { CHECKOUT } from '@/data/content'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useOrder } from '@/order/OrderContext'

/**
 * Step one: which of the three, and how many.
 *
 * The plan arrives in the query on the link that was pressed — the
 * provider adopts it — so somebody who pressed "Reserve Act" is not asked
 * the question again. Switching here keeps everything else: nothing typed
 * is ever lost by changing your mind about the tier.
 */
export function Choose() {
  useDocumentTitle('Choose your plan — LYZN')

  const { config, totals, setPlan, setQuantity, goToStep } = useOrder()

  return (
    <CheckoutShell
      step="choose"
      eyebrow={CHECKOUT.choose.eyebrow}
      title={CHECKOUT.choose.headline}
      chargedToday={totals.chargedToday}
      action={{ label: 'Continue', onClick: () => goToStep('details') }}
      summary={<OrderSummary config={config} totals={totals} />}
    >
      <div className="flex flex-col gap-6">
        <PlanSwitch value={config.plan} onChange={setPlan} />
        <PlanPanel plan={config.plan} quantity={config.quantity} onQuantity={setQuantity} />
      </div>
    </CheckoutShell>
  )
}
