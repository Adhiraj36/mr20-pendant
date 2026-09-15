import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { track } from '@/lib/posthog'
import { useRecordedPlan } from '@/lib/useRecordedPlan'
import {
  DEFAULT_CONFIG,
  EMPTY_CONTACT,
  clampQuantity,
  isPlanId,
  priceOrder,
  type Contact,
  type OrderConfig,
  type PlanId,
  type Totals,
} from '@/data/pricing'

const STORAGE_KEY = 'lyzn.order.v2'

/**
 * The four panels of the sheet, in the order they are reached.
 *
 * `confirmed` is one of them rather than a page of its own: paying does
 * not take you anywhere, it changes what the sheet is showing.
 */
export type OrderStep = 'choose' | 'details' | 'pay' | 'confirmed'

/** What a form outside the sheet already asked for. */
export type OrderPrefill = { phone?: string; email?: string }

export function isOrderStep(value: unknown): value is OrderStep {
  return value === 'choose' || value === 'details' || value === 'pay' || value === 'confirmed'
}

/**
 * Where the sheet lives: the landing page, with the step in the query.
 *
 * Detached as of round four — the order is the pricing section's paysheet
 * now, and nothing outside `order/OrderSheet.tsx` and the four step pages
 * addresses a step any more. Kept so they still resolve when the full
 * checkout is needed again.
 */
export function orderHref(step: OrderStep, options: { plan?: PlanId; ref?: string } = {}) {
  const params = new URLSearchParams({ order: step })
  if (options.plan) params.set('plan', options.plan)
  if (options.ref) params.set('ref', options.ref)
  return `/?${params.toString()}`
}

/**
 * What was actually bought.
 *
 * A snapshot rather than a reference to the live basket: the confirmation
 * has to keep saying the same thing if somebody opens a new tab and starts
 * configuring a second order.
 */
export type PlacedOrder = {
  reference: string
  placedAt: string
  email: string
  plan: PlanId
  quantity: number
  automation: boolean
  dueToday: number
  /** The whole price of what was ordered; `dueToday` was the deposit on it. */
  full: number
  monthly: number
  address: string[]
}

/**
 * An order exactly as the API returns it — camelCase, rupees throughout.
 * Mirrors `ddb.Order` in `backend/go/internal/ddb/orders.go`.
 */
export type Order = {
  reference: string
  userId: string
  plan: PlanId
  quantity: number
  automation: boolean
  dueToday: number
  /**
   * The whole price of the order, against which `dueToday` was the deposit.
   * Rows written before the pre-order model carry 0 — see `balanceFor`.
   */
  full: number
  monthly: number
  status: 'created' | 'paid' | 'failed'
  rzpOrderId?: string
  rzpSubscriptionId?: string
  rzpPaymentId?: string
  contact: {
    fullName: string
    email: string
    phone: string
    line1: string
    line2: string
    city: string
    state: string
    pin: string
    invoiceName: string
    gstin: string
    address: string[]
  }
  createdAt: string
  paidAt?: string
}

/** What Checkout needs to open a sheet for the order `POST /orders` just priced. */
export type CheckoutSession = {
  keyId: string
  /** A plan order, or a subscription when Automation rides the same sheet
      (Decision 1) — exactly one of the two is present. */
  orderId?: string
  subscriptionId?: string
  amount: number
  currency: string
  name: string
  description: string
  prefill: { name: string; email: string; contact: string }
  notes: { reference: string }
}

/** What `POST /orders` returns. */
export type CreatedOrder = {
  reference: string
  dueToday: number
  monthly: number
  checkout: CheckoutSession
}

/** An `Order` from the server, as the basket it grew from. */
export function toPlacedOrder(order: Order): PlacedOrder {
  return {
    reference: order.reference,
    placedAt: order.paidAt ?? order.createdAt,
    email: order.contact.email,
    plan: order.plan,
    quantity: order.quantity,
    automation: order.automation,
    dueToday: order.dueToday,
    full: order.full,
    monthly: order.monthly,
    address: order.contact.address,
  }
}

type OrderState = {
  config: OrderConfig
  contact: Contact
  placed: PlacedOrder | null
}

type OrderContextValue = OrderState & {
  totals: Totals
  /** Which panel the sheet is showing, or `null` while it is closed. */
  step: OrderStep | null
  openOrder: (plan: PlanId, prefill?: OrderPrefill) => void
  closeOrder: () => void
  goToStep: (step: OrderStep, options?: { ref?: string; replace?: boolean }) => void
  setPlan: (plan: PlanId) => void
  setQuantity: (next: number) => void
  setContact: (patch: Partial<Contact>) => void
  place: (order: PlacedOrder) => void
  reset: () => void
}

const OrderContext = createContext<OrderContextValue | null>(null)

const EMPTY: OrderState = {
  config: DEFAULT_CONFIG,
  contact: EMPTY_CONTACT,
  placed: null,
}

/**
 * Reads the basket back.
 *
 * Deliberately forgiving: a basket stored by an older build, or one that has
 * been hand-edited, must not white-screen somebody's checkout. Anything that
 * does not parse is simply an empty order.
 */
function restore(): OrderState {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<OrderState>
    const plan = isPlanId(parsed.config?.plan) ? parsed.config.plan : DEFAULT_CONFIG.plan
    return {
      config: {
        plan,
        quantity: clampQuantity(parsed.config?.quantity ?? 1),
      },
      contact: { ...EMPTY_CONTACT, ...(parsed.contact ?? {}) },
      placed: parsed.placed ?? null,
    }
  } catch {
    return EMPTY
  }
}

export function OrderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrderState>(restore)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Which step the sheet is on is not kept in React state. Back, forward
  // and a refresh all have to move it, and a second copy of "which step"
  // is how the two stop agreeing.
  const requestedStep = params.get('order')
  const step = isOrderStep(requestedStep) ? requestedStep : null

  // Session, not local. A basket should not still be sitting there next
  // week, and a shared machine should not hand the next person an address.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Private mode, or storage full. The order still works in memory.
    }
  }, [state])

  const adoptPlan = useCallback((plan: PlanId) => {
    setState((s) =>
      s.config.plan === plan
        ? s
        : // Every tier ships the same pendant, so the quantity survives a
          // change of mind about the tier.
          { ...s, config: { ...s.config, plan } },
    )
  }, [])

  // A tier also arrives from the URL — a deep link, a Back into an earlier
  // step, a reload. The query wins over the stored basket, because it is
  // the one the reader can see.
  const requestedPlan = params.get('plan')
  useEffect(() => {
    if (step && isPlanId(requestedPlan)) adoptPlan(requestedPlan)
  }, [step, requestedPlan, adoptPlan])

  const setPlan = useCallback(
    (plan: PlanId) => {
      adoptPlan(plan)
      if (!step) return
      // Replaced rather than pushed: changing your mind about the tier is
      // not a step anybody should have to press Back through.
      const next = new URLSearchParams(params)
      next.set('plan', plan)
      setParams(next, { replace: true })
    },
    [adoptPlan, params, setParams, step],
  )

  const setQuantity = useCallback((next: number) => {
    setState((s) => ({ ...s, config: { ...s.config, quantity: clampQuantity(next) } }))
  }, [])

  const setContact = useCallback((patch: Partial<Contact>) => {
    setState((s) => ({ ...s, contact: { ...s.contact, ...patch } }))
  }, [])

  /**
   * Takes the reader to the order, which is no longer anywhere else.
   *
   * As of round four the order is the paysheet in the pricing section:
   * phone, email, a code and the deposit, all in the column beside the
   * slip. So this opens nothing. It records the tier — which the section
   * reads back from here, so the button that was pressed decides which
   * card is selected when the reader arrives — and then scrolls, or
   * travels to `/#pricing` first if the button was on another page.
   *
   * The prefill is how a form outside the section hands over what it
   * already asked for. Empty values are ignored rather than written, so a
   * prefill can never blank something that was already typed.
   */
  const openOrder = useCallback(
    (plan: PlanId, prefill?: OrderPrefill) => {
      // The one call every "Preorder" CTA on the site routes through
      // (OrderButtonLink is the only caller), so this is the single place
      // that can see every press of any of them.
      track('preorder_cta_clicked', { plan })
      adoptPlan(plan)

      const patch: Partial<Contact> = {}
      if (prefill?.phone) patch.phone = prefill.phone
      if (prefill?.email) patch.email = prefill.email
      if (Object.keys(patch).length > 0) setContact(patch)

      if (pathname !== '/') {
        // `ScrollToTop` in App.tsx honours the hash, so this lands on the
        // section rather than at the top of the page it is halfway down.
        navigate('/#pricing')
        return
      }

      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      document
        .getElementById('pricing')
        ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
    },
    [adoptPlan, navigate, pathname, setContact],
  )

  const closeOrder = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete('order')
    next.delete('plan')
    next.delete('ref')
    // Pushed as well: opening the sheet was a step forward and closing it
    // is another, so Back after an accidental close re-opens what was
    // closed rather than jumping to the step before it.
    setParams(next)
  }, [params, setParams])

  const plan = state.config.plan
  const goToStep = useCallback(
    (to: OrderStep, options?: { ref?: string; replace?: boolean }) => {
      const next = new URLSearchParams(params)
      next.set('order', to)
      next.set('plan', plan)
      // The reference belongs in the URL from the moment there is one: it
      // is what a reload of the confirmation reads the order back with.
      if (options?.ref) next.set('ref', options.ref)
      setParams(next, { replace: options?.replace })
    },
    [params, plan, setParams],
  )

  const place = useCallback((order: PlacedOrder) => {
    setState((s) => ({ ...s, placed: order }))
  }, [])

  const reset = useCallback(() => {
    setState(EMPTY)
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* nothing to clear */
    }
  }, [])

  const totals = useMemo(() => priceOrder(state.config), [state.config])

  // The tier is chosen in four places — the hero, the nav, the last
  // section, the cards themselves — and all four end up here, so this is
  // the one place that can see every change of mind. See useRecordedPlan.
  useRecordedPlan(plan)

  const value = useMemo(
    () => ({
      ...state,
      totals,
      step,
      openOrder,
      closeOrder,
      goToStep,
      setPlan,
      setQuantity,
      setContact,
      place,
      reset,
    }),
    [
      state,
      totals,
      step,
      openOrder,
      closeOrder,
      goToStep,
      setPlan,
      setQuantity,
      setContact,
      place,
      reset,
    ],
  )

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>
}

export function useOrder() {
  const context = useContext(OrderContext)
  if (!context) throw new Error('useOrder must be used inside <OrderProvider>')
  return context
}

/** A reference somebody can read down a phone. Replace with your own. */
export function makeReference() {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5)
  const salt = Math.random().toString(36).toUpperCase().slice(2, 5)
  return `LYZN-${stamp}${salt}`
}
