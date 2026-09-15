/**
 * What can be bought, what it costs, and the one function that turns a
 * basket into money.
 *
 * Spec: docs/superpowers/specs/2026-09-04-lyzn-website-design.md §0.2, §7, §9
 *
 * Three tiers of one device, sold as a pre-order. There is no configurator:
 * no finishes, no accessories. Every surface that shows a number calls
 * `priceOrder`, so the pricing section, the rail and the pay button can
 * never disagree.
 *
 * Two figures a tier, and they are not the same figure. `price` is what the
 * device costs; `deposit` is what the card is charged today to reserve one.
 * The rest is taken when the pendant is dispatched — so `dueToday` is the
 * deposit, and `full` and `balance` carry the other half of that sentence.
 *
 * The deposit is the same ₹999 on every tier. It is a place in the batch,
 * not a share of the price, so a dearer tier does not cost more to hold —
 * only more on dispatch. The server prices the order from its own table
 * (the `tiers` in the app config), and these figures have to agree with it.
 *
 * Act Pro adds ₹499 a month from activation. Nothing recurs at checkout and
 * no mandate is taken today: the device has not shipped, and a subscription
 * for an unshipped product cannot be billed. It is disclosed on the card and
 * the slip, and set up from the app when the pendant is activated.
 */

import { money, monthly } from '@lyzn/design'
import { SHIP_MONTH, join } from './content'

/** Moved to the shared package so the app formats prices the same way. */
export { money, monthly }

export type PlanId = 'capture' | 'act' | 'act-pro'

export type ReceiptLine = { k: string; v: string; ok?: boolean }

export type Plan = {
  id: PlanId
  /** The name as the customer reads it. */
  name: string
  /** The whole price of the device. Not what is charged today. */
  price: number
  /**
   * What the card is charged today to reserve one. The balance — `price`
   * less this — is taken on dispatch, so this is the only figure anything
   * saying "today" is allowed to show.
   */
  deposit: number
  /** One line under the price. */
  line: string
  bullets: readonly string[]
  /** Mono note beneath the card. The one caveat each tier carries. */
  foot: string
  /** Meta shown inside the checkout's plan panel. */
  checkoutMeta: string
  cta: string
  /** Every tier ships the pendant. Kept because the checkout branches on it. */
  physical: true
  /**
   * The slip printed for this tier: the whole price, what today takes, and
   * what is left for dispatch, with everything the price includes shown at
   * nothing.
   */
  receipt: {
    stamp: string
    meta: string
    rows: readonly ReceiptLine[]
    total: { k: string; v: string }
    footer: string
  }
  /**
   * Act Pro alone renews: this much a month from the day the pendant is
   * activated, or nothing with your own key. No mandate is taken today —
   * an unshipped device cannot be billed for — so it is set up from the app
   * at activation.
   */
  renewal?: { price: number; from: 'activation' }
}

/**
 * Three ways to buy it. The device is the same in all three — what changes
 * is how much work it does for you. Every tier ships the pendant, so every
 * tier has a quantity and a delivery address.
 */
export const PLANS: Record<PlanId, Plan> = {
  capture: {
    id: 'capture',
    name: 'Capture',
    price: 5999,
    deposit: 999,
    line: 'It hears everything and tells you what you promised.',
    bullets: [
      'Unlimited recording and transcription',
      'Every commitment you made, listed',
      'Runs on your phone — no laptop needed',
      'No subscription. Ever.',
    ],
    foot: "It doesn't do the tasks. You still do those.",
    checkoutMeta: join(['First wave', SHIP_MONTH && `Ships ${SHIP_MONTH}`], ' · '),
    cta: 'Reserve Capture',
    physical: true,
    receipt: {
      stamp: 'Pre-order',
      meta: 'Batch 01 · GST incl.',
      rows: [
        { k: 'Full price', v: '₹5,999' },
        { k: 'Clip + strap + cord', v: '₹0' },
        { k: 'Phone app', v: '₹0' },
        { k: 'Monthly plan', v: '₹0' },
        { k: 'Balance on dispatch', v: '₹5,000' },
      ],
      total: { k: 'Pre-order today', v: '₹999' },
      footer: 'Balance on dispatch · November 2026',
    },
  },
  act: {
    id: 'act',
    name: 'Act',
    price: 8999,
    deposit: 999,
    line: 'Acts on its own. You just approve the sensitive ones.',
    bullets: [
      'Everything in Capture',
      'Orchestrator for your laptop',
      'Tasks get done, not just listed',
      'Bring your own Claude or ChatGPT subscription',
      'No subscription to us. Ever.',
    ],
    foot: 'About five minutes to set up',
    checkoutMeta: join(['First wave', SHIP_MONTH && `Ships ${SHIP_MONTH}`], ' · '),
    cta: 'Reserve Act',
    physical: true,
    receipt: {
      stamp: 'Pre-order',
      meta: 'Batch 01 · GST incl.',
      rows: [
        { k: 'Full price', v: '₹8,999' },
        { k: 'Orchestrator', v: 'Included' },
        { k: 'Your API key', v: 'Bring your own' },
        { k: 'Monthly plan', v: '₹0' },
        { k: 'Balance on dispatch', v: '₹8,000' },
      ],
      total: { k: 'Pre-order today', v: '₹999' },
      footer: 'Balance on dispatch · November 2026',
    },
  },
  'act-pro': {
    id: 'act-pro',
    name: 'Act Pro',
    price: 12999,
    deposit: 999,
    line: 'It does the work. We supply the AI.',
    bullets: [
      'Everything in Act',
      'No ChatGPT or Claude account, nothing to configure',
      'We supply the AI — ₹499 a month from activation',
      'Or bring your own key and pay nothing',
    ],
    foot: '₹499/mo from activation · Nothing for it today',
    checkoutMeta: join(['First wave', SHIP_MONTH && `Ships ${SHIP_MONTH}`], ' · '),
    cta: 'Reserve Act Pro',
    physical: true,
    receipt: {
      stamp: 'Pre-order',
      meta: 'Batch 01 · GST incl.',
      rows: [
        { k: 'Full price', v: '₹12,999' },
        { k: 'Pendant + orchestrator', v: 'Included' },
        { k: 'From activation', v: '₹499/mo' },
        { k: 'Or bring your own key', v: '₹0' },
        { k: 'Balance on dispatch', v: '₹12,000' },
      ],
      total: { k: 'Pre-order today', v: '₹999' },
      footer: 'Balance on dispatch · November 2026 · ₹499/mo from activation',
    },
    renewal: { price: 499, from: 'activation' },
  },
}

export const PLAN_ORDER: PlanId[] = ['capture', 'act', 'act-pro']

/**
 * What a pre-order takes today, as a button says it.
 *
 * Every tier holds a place for the same ₹999, so the buttons that start a
 * pre-order quote that and not the device — a button reading "from ₹5,999"
 * over a pay bar reading ₹999 is two answers to the question the reader is
 * actually asking, which is what pressing it will cost them. The device's
 * price is the subject of the tiers and the slip, where it is beside the
 * balance that explains it.
 *
 * Derived rather than written down, and it says "from" if the tiers ever
 * stop agreeing.
 */
export function depositLabel() {
  const amounts = PLAN_ORDER.map((id) => PLANS[id].deposit)
  const low = Math.min(...amounts)
  return amounts.every((a) => a === low) ? money(low) : `from ${money(low)}`
}

/** What the same two years cost on the thing people compare it to. */
export const COMPARE = { k: 'Plaud, 2 yrs', v: '₹58,000+' } as const

export const MAX_QUANTITY = 5

export type OrderConfig = {
  plan: PlanId
  quantity: number
}

export const DEFAULT_CONFIG: OrderConfig = {
  plan: 'act',
  quantity: 1,
}

export type LineItem = {
  label: string
  detail?: string
  amount: number
}

export type Totals = {
  items: LineItem[]
  /** The deposit, times the quantity: what today takes. */
  dueToday: number
  /**
   * What the card is charged now. Equal to `dueToday` — a pre-order takes
   * the deposit and nothing else — and kept as its own name because every
   * surface that says "today" reads this, and the two were once different
   * numbers.
   */
  chargedToday: number
  /** The whole price of the basket: the tier, times the quantity. */
  full: number
  /** What dispatch will take: `full`, less what today takes. */
  balance: number
}

export function priceOrder(config: OrderConfig): Totals {
  const plan = PLANS[config.plan]
  const quantity = clampQuantity(config.quantity)

  // The line item is the deposit, not the price: a summary that lists
  // amounts and then a "due today" beneath them has to add up to the figure
  // the card is about to be charged. What the deposit is a deposit *on* is
  // spelled out beside it, and carried as `full`.
  const items: LineItem[] = [
    {
      label: plan.name,
      detail:
        quantity > 1
          ? `${quantity} × ${money(plan.deposit)} of ${money(plan.price)}`
          : `${money(plan.deposit)} of ${money(plan.price)}`,
      amount: plan.deposit * quantity,
    },
  ]

  const dueToday = items.reduce((sum, item) => sum + item.amount, 0)
  const full = plan.price * quantity
  return { items, dueToday, chargedToday: dueToday, full, balance: full - dueToday }
}

/**
 * What was actually taken for an order the server has already stored — the
 * deposit — read from the figure the API persists rather than from the
 * basket, so a receipt loaded from a link shows the amount that was charged.
 */
export function chargedFor(order: { dueToday: number }) {
  return order.dueToday
}

/**
 * What is still owed on a stored order: the full price the server recorded
 * against it, less what was taken. Rows written before the pre-order model
 * carry no `full` and were paid in one go, so the clamp reads them —
 * correctly — as nothing owed.
 */
export function balanceFor(order: { full?: number; dueToday: number }) {
  return Math.max(0, (order.full ?? 0) - order.dueToday)
}

export function clampQuantity(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(MAX_QUANTITY, Math.round(value)))
}

export function isPlanId(value: unknown): value is PlanId {
  return value === 'capture' || value === 'act' || value === 'act-pro'
}

/* ─────────────────────────────────────────────────────────────
   The customer

   One flat record. For the pendant, `state` and `pin` belong to the
   delivery address; for software-only there is no delivery address and the
   same two fields carry the place of supply, which is all the tax needs.
   ───────────────────────────────────────────────────────────── */

export type Contact = {
  fullName: string
  email: string
  phone: string
  line1: string
  line2: string
  city: string
  state: string
  pin: string
  invoiceName: string
  billingSame: boolean
  billingLine1: string
  billingLine2: string
  billingCity: string
  billingState: string
  billingPin: string
  gstin: string
}

export const EMPTY_CONTACT: Contact = {
  fullName: '',
  email: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pin: '',
  invoiceName: '',
  billingSame: true,
  billingLine1: '',
  billingLine2: '',
  billingCity: '',
  billingState: '',
  billingPin: '',
  gstin: '',
}

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
]

export type FieldErrors = Partial<Record<keyof Contact, string>>

/**
 * Validates only what the selected plan actually needs.
 *
 * Software-only is never asked for an address, so a missing city cannot
 * block it — that is the difference the checkout turns on.
 */
export function validateDetails(contact: Contact, plan: PlanId): FieldErrors {
  const errors: FieldErrors = {}

  if (!contact.fullName.trim()) errors.fullName = 'Please enter your name.'
  if (!isEmail(contact.email)) errors.email = 'Please enter an email we can reach you at.'
  if (!isPhone(contact.phone)) errors.phone = 'Please enter a 10-digit mobile number.'

  if (PLANS[plan].physical) {
    if (!contact.line1.trim()) errors.line1 = 'Please enter the street address.'
    if (!contact.city.trim()) errors.city = 'Please enter the city.'
    if (!contact.state) errors.state = 'Please choose a state.'
    if (!isPin(contact.pin)) errors.pin = 'Please enter a 6-digit PIN code.'
  }

  return errors
}

export function validatePayment(contact: Contact, plan: PlanId): FieldErrors {
  const errors: FieldErrors = {}

  if (!contact.invoiceName.trim()) errors.invoiceName = 'Please enter the name for the invoice.'

  if (PLANS[plan].physical) {
    if (!contact.billingSame) {
      if (!contact.billingLine1.trim()) errors.billingLine1 = 'Please enter the street address.'
      if (!contact.billingCity.trim()) errors.billingCity = 'Please enter the city.'
      if (!contact.billingState) errors.billingState = 'Please choose a state.'
      if (!isPin(contact.billingPin)) errors.billingPin = 'Please enter a 6-digit PIN code.'
    }
  } else {
    if (!contact.state) errors.state = 'Please choose a state.'
    if (!isPin(contact.pin)) errors.pin = 'Please enter a 6-digit PIN code.'
  }

  if (contact.gstin.trim() && !isGstin(contact.gstin)) {
    errors.gstin = 'That does not look like a 15-character GSTIN.'
  }

  return errors
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

export function isPhone(value: string) {
  return /^[6-9]\d{9}$/.test(value.replace(/\D/g, ''))
}

export function isPin(value: string) {
  return /^[1-9]\d{5}$/.test(value.trim())
}

export function isGstin(value: string) {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Zz][A-Z\d]$/.test(value.trim().toUpperCase())
}

/** The delivery address as one readable block. */
export function addressLines(contact: Contact) {
  return [
    contact.line1,
    contact.line2,
    join([contact.city, contact.state], ', '),
    join([contact.pin, 'India'], ' · '),
  ].filter(Boolean)
}
