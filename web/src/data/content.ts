/**
 * Every word on the site, and the slots that are not yet answerable.
 *
 * Spec: docs/superpowers/specs/2026-09-04-lyzn-website-design.md §11
 *
 * ── Slots ──────────────────────────────────────────────────────────────
 * A slot is a fact the product has not confirmed. Each one is an empty
 * string until it is. Nothing renders the token text; every sentence that
 * uses a slot is assembled so that an empty slot simply drops out of it.
 * Fill these in and the copy completes itself.
 *
 * Do not replace a slot with a guess. The privacy slots in particular are
 * claims about what happens to somebody's conversations.
 */

import { money } from '@lyzn/design'

/** e.g. 'March 2027'. Hero eyebrow, pricing meta, confirmation. (§0.2 A5) */
export const SHIP_MONTH = ''

/**
 * e.g. 'Prices include GST'. Pricing footnote and the summary rail. (§0.2 A6)
 *
 * The spec offers "Prices include GST" as the default, but GST treatment is
 * not confirmed, and an inclusive-price claim that turns out to be wrong is
 * a claim about money. It stays empty until finance says otherwise.
 */
export const GST_NOTE = ''

/** e.g. 'Charged today. Cancel before dispatch for a full refund.' (§0.2 A4) */
export const PAYMENT_TERMS = ''

/** What deleting a recording removes, and whether copies remain. (§0.3) */
export const PRIVACY_DELETE = ''

/** How long audio and transcripts are kept. (§0.3) */
export const PRIVACY_RETENTION = ''

/** Who at LYZN can access audio, and whether it trains models. (§0.3) */
export const PRIVACY_ACCESS = ''

/** Whether the pendant buzzes when it starts recording. (§0.3) */
export const PRIVACY_HAPTIC_START = ''

/** e.g. 'hello@lyzn.in'. Footer. */
export const CONTACT_EMAIL = ''

/** Joins the parts that exist, dropping the slots that do not. */
export function join(parts: (string | undefined | null | false)[], separator = ' ') {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(separator)
}

/* ─────────────────────────────────────────────────────────────
   Navigation
   ───────────────────────────────────────────────────────────── */

export const NAV_LINKS = [
  { label: 'Product', href: '#product' },
  { label: 'How it works', href: '#how' },
  { label: 'Pricing', href: '#pricing' },
] as const

/* ─────────────────────────────────────────────────────────────
   01 Hero
   ───────────────────────────────────────────────────────────── */

export const HERO = {
  eyebrow: 'LYZN · AI pendant · Preorder',
  /**
   * Three parts, because the contrast is the sentence: the weight lands on
   * "notes" and "receipts" and the clause between them steps back.
   */
  headline: {
    one: 'Other AI hands you notes.',
    twoQuiet: 'We hand you',
    twoLoud: 'receipts.',
  },
  /**
   * The reference mock for this line ended "on your own laptop, not our
   * cloud". That is not what this product does — §06 says audio is
   * transcribed and summarised on LYZN's servers — so the claim is written
   * to what the privacy section can actually stand behind.
   */
  sub: 'A pendant that hears what you promised, then goes and does it — on your own laptop, not our cloud.',
  ghost: 'See how it works',
  scrollCue: 'Scroll',
  caption: ['Anodised graphite · Glass front', 'Two microphones · 19 g'],
  /** For screen readers and for anyone the 3D never reaches. */
  objectDescription:
    'A rounded square pendant, 35 millimetres across, in bead-blasted graphite, with a dark glass front, two microphone pinholes and a braided cord.',
} as const

/* ─────────────────────────────────────────────────────────────
   03 Conversation → Action

   One conversation, carried through five steps. The transcript,
   summary and tasks below are all derived from the same two
   spoken lines, which is the whole point of the section.
   ───────────────────────────────────────────────────────────── */

export const STORY_EYEBROW = 'How it works'

/**
 * One person, one promise. There is only one voice on the pendant's side of
 * the scene, because the claim is about what happens to *your* word, not
 * to a meeting.
 */
export const SPOKEN = [
  {
    speaker: 'You',
    initial: 'Y',
    text: "Ravi bhai, I'll send you the revised quote before lunch.",
  },
] as const

export const TRANSCRIPT = [
  { t: '11:04:22', speaker: 'You', text: "Ravi bhai, I'll send you the revised quote before lunch." },
  { t: '11:04:29', speaker: 'Ravi', text: 'Super. Same terms?' },
  { t: '11:04:31', speaker: 'You', text: 'Same terms, new thickness.' },
] as const

export const SUMMARY = {
  title: 'Revised quote to Ravi, before lunch',
  bullets: [
    'You committed to sending Ravi the revised quote before lunch.',
    'Same terms as before; only the thickness changes.',
  ],
} as const

export const TASKS = [
  { text: 'Send revised quote to Ravi K.', due: 'Before lunch' },
  { text: 'Update thickness on the quote', due: 'First' },
] as const

/**
 * The laptop, as much of it as the site ever shows. Three lines, in the
 * order the work happens; the last one is the moment the message leaves.
 * Transcription is not one of them — that happened the moment the audio
 * reached the phone, and the laptop only ever sees the commitment.
 */
export const LAPTOP_LINES = [
  { label: 'Commitment found', value: 'Send revised quote to Ravi K.' },
  { label: 'Drafting', value: 'Quote_v2.pdf' },
  { label: 'Sending', value: 'WhatsApp · Ravi K.' },
] as const

/** Ravi's side of it. The one message the whole scene exists to send. */
export const WHATSAPP = {
  header: 'Ravi K.',
  sub: 'WhatsApp',
  text: 'Revised quote attached, Ravi bhai. Same terms, new thickness.',
  attachment: 'Quote_v2.pdf',
  time: '11:05',
} as const

/**
 * The receipt that closes the scene. The same promise, carried out — every
 * row is something the reader watched happen in the stations before it.
 */
export const STORY_RECEIPT = {
  title: 'LYZN · PROOF OF WORK',
  meta: 'Hyderabad · 11:05',
  rows: [
    { k: 'Heard', v: '11:04:22' },
    { k: 'Task', v: 'Send quote' },
    { k: 'To', v: 'Ravi K.' },
    { k: 'Via', v: 'WhatsApp' },
    { k: 'Delivered', v: '11:05:07', ok: true },
  ],
  total: { k: 'YOUR EFFORT', v: '0 min' },
  txn: 'TXN 8841-A',
  footer: 'KEPT WITHOUT BEING REMEMBERED',
} as const

/**
 * The slips that travel between stations. Each is what the previous
 * station produced, printed small — the reader watches the same promise
 * change form three times and arrive as a message.
 */
export const SLIPS = {
  heard: { head: 'Heard · 11:04:22', line: "Ravi bhai, I'll send you the revised quote before lunch." },
  task: { head: 'Task · Before lunch', line: 'Send revised quote to Ravi K.' },
  draft: { head: 'Drafted · 11:04:39', line: 'Quote_v2.pdf · Same terms, new thickness' },
} as const

export const STORY_STEPS = [
  {
    n: '01',
    eyebrow: 'Speaking',
    title: 'You talk.',
    line: 'One promise, said the way you would say it.',
  },
  {
    n: '02',
    eyebrow: 'Transcript',
    title: 'Every word, kept.',
    line: 'Who said what, and when — in the languages you spoke.',
  },
  {
    n: '03',
    eyebrow: 'Task',
    title: 'One promise, found.',
    line: 'Named, dated, and handed to your laptop.',
  },
  {
    n: '04',
    eyebrow: 'Drafting',
    title: 'Your laptop does the work.',
    line: 'The quote is written and attached while you are still talking.',
  },
  {
    n: '05',
    eyebrow: 'Delivered',
    title: 'Sent to Ravi.',
    line: 'On WhatsApp, from you, with the file. Two ticks.',
  },
  {
    n: '06',
    eyebrow: 'Done',
    title: 'You never opened your laptop.',
    line: 'Elapsed 45 seconds. Your effort: none.',
  },
] as const

export const STORY_CAPTION = 'Anything sensitive is approval gated · Nothing leaves your laptop without you'

/* ─────────────────────────────────────────────────────────────
   05 It can act
   ───────────────────────────────────────────────────────────── */

/**
 * A day, in receipts.
 *
 * Three moments from one ordinary day, in the languages people actually
 * mix. The section replaced a four-state animation of a single sentence:
 * three finished slips say the same thing faster and prove it three times
 * instead of once.
 *
 * Every slip is a different shape of outcome — one bought something, one
 * sent something, one is holding something until Monday — because the claim
 * is not "it can send a WhatsApp", it is that whatever you promised is
 * carried to its end.
 */
export const RECEIPTS = {
  eyebrow: 'Proof of work',
  headline: 'A day, in receipts.',
  sub: "You talk like you always talk. What you committed to gets done, and the proof arrives before you have thought about it again.",
  footer: 'Anything sensitive is approval gated · Your laptop, your key, your data',
  slips: [
    {
      meta: '09:41 · Meeting',
      quote: 'Cake order pettali amma birthday ki, Saturday.',
      rows: [
        { k: 'Lang', v: 'TE + EN' },
        { k: 'Ordered', v: 'Karachi Bakery' },
        { k: 'For', v: 'Sat 06 Sep' },
        { k: 'Paid', v: '₹540', ok: true },
      ],
      txn: 'TXN 8842-B',
      tilt: -1.6,
    },
    {
      meta: '13:26 · Site visit',
      quote: 'Tell the vendor no thickness increase. Send it today.',
      stamp: 'Filed',
      rows: [
        { k: 'Drafted', v: 'CN + EN' },
        { k: 'Sent', v: 'WeChat' },
        { k: 'Read', v: '13:31', ok: true },
      ],
      txn: 'TXN 8843-C',
      tilt: 1.1,
    },
    {
      meta: '18:02 · Car',
      quote: 'Remind me to call the CA about the filing on Monday.',
      rows: [
        { k: 'Held for', v: 'Mon 09:00' },
        { k: 'Contact', v: 'Found' },
        { k: 'Status', v: 'Queued', ok: true },
      ],
      txn: 'TXN 8844-D',
      tilt: -0.7,
    },
  ],
} as const

/* ─────────────────────────────────────────────────────────────
   06 Privacy

   Only what the app and the handoff documents actually confirm.
   Nothing here says "private", "encrypted" or "never stored".
   ───────────────────────────────────────────────────────────── */

export const PRIVACY = {
  headline: 'Your conversations are yours.',
  facts: [
    {
      label: 'Captured',
      body: 'It records while people are talking and stops itself about ten seconds after they stop.',
    },
    {
      label: 'Checked',
      body: 'Anything with no speech in it is deleted on your phone before it goes anywhere.',
    },
    {
      label: 'Processed',
      body: "Audio is transcribed and summarised on LYZN's servers. You see every recording in the app, with its transcript.",
    },
    {
      label: 'Yours',
      body: join([PRIVACY_DELETE, PRIVACY_RETENTION], ' '),
    },
  ].filter((fact) => fact.body !== ''),
  link: 'Read the full privacy policy',
} as const


/* ─────────────────────────────────────────────────────────────
   07 Pricing
   ───────────────────────────────────────────────────────────── */

export const PRICING = {
  /** The number printed beside the heading. The page is numbered, not titled. */
  no: '02',
  eyebrow: 'Pricing',
  headline: 'What it costs',
  sub: 'Three ways to buy it. The device is the same in all three — what changes is how much work it does for you.',
  /**
   * The counter under the sub-line: `{count}` and `{of}` are useOrderCount's
   * read of GET /orders/count, real and server-clamped (see
   * backend/go/internal/api/orders.go for the floor and the freeze).
   */
  counter: '{count}/{of} people already bought',
  /** Names the tier radio group for a screen reader; the cards are its labels. */
  legend: 'Choose a tier',
  fine: 'Pre-order · Ships NOVEMBER 2026 · Batch 01 · India only, for now · Refundable until dispatch',
  footnote: join(['Prices in INR', GST_NOTE, PAYMENT_TERMS], ' · '),
  /**
   * The whole order, in four stages of one form: a number to reach you on
   * and an address to send the receipt to, the code that proves the
   * address, the deposit, and then the slip. The errors say what a valid
   * answer looks like rather than that the answer was wrong.
   */
  form: {
    phone: {
      label: 'Phone',
      placeholder: '98765 43210',
      /** Under the field. The number format is the tell; say the reason. */
      note: 'Indian mobile numbers only — LYZN ships in India for now.',
      error: 'Enter a 10-digit Indian mobile starting 6-9.',
    },
    email: {
      label: 'Email',
      placeholder: 'you@company.in',
      error: 'Enter a valid email address.',
    },
    code: {
      label: 'Code',
      placeholder: '000000',
      /** Says where to look, that a miss is worth a spam-folder check, and that the wait is measured in seconds. */
      note: "Six digits, sent to the address above — check spam if it doesn't land in a minute. Good for ten minutes.",
      verify: 'Verify',
      /** While Clerk is being asked. */
      sending: 'Sending',
      checking: 'Checking',
      /** Offered only once the countdown is up; `{s}` is the seconds left. */
      resend: 'Send another code',
      resendIn: 'Send another code in {s}s',
      /** Goes back to the first stage with the attempt thrown away. */
      change: 'Use another email',
    },
    pay: {
      /** Prefixes the deposit: `Pay ₹999`. */
      label: 'Pay',
      opening: 'Opening',
      /** A provider cancel, a failed payment, or a server that said no. */
      failure: 'That payment did not go through. Nothing has been charged.',
    },
    done: {
      /** Struck across the slip once the deposit has been taken. */
      stamp: 'Pre-ordered',
      /** The one line that replaces the form. */
      line: 'Reserved. Your place in Batch 01 is held.',
      /** `{email}` is the address the code went to. */
      note: 'A confirmation is on its way to {email}',
      /** Under the slip, in place of the tier's own footer. */
      footer: 'Balance on dispatch · NOVEMBER 2026',
    },
    /** The mobile pay sheet's bar, where there is no room for the tier name. */
    reserve: 'Reserve',
  },
} as const

/* ─────────────────────────────────────────────────────────────
   08 Preorder
   ───────────────────────────────────────────────────────────── */

export const PREORDER = {
  headline: 'Join the first wave.',
  sub: join(['Preorders are open.', SHIP_MONTH && `First units ship ${SHIP_MONTH}.`]),
} as const

/* ─────────────────────────────────────────────────────────────
   Checkout
   ───────────────────────────────────────────────────────────── */

export const CHECKOUT = {
  choose: {
    eyebrow: 'Choose your plan',
    headline: 'Three ways in.',
  },
  details: {
    eyebrow: 'Your details',
    headline: { pendant: 'Where should it go?', software: 'Where should we send access?' },
    softwareNote: 'Nothing to ship. Your access details go to this email.',
    signIn: {
      eyebrow: 'Sign in to continue',
      body: 'Your order is tied to your account, so the app knows what you chose.',
    },
  },
  pay: {
    eyebrow: 'Payment',
    headline: 'Almost there.',
    terms: 'I agree to the',
    termsLink: 'Terms and refund policy',
    failure: "Payment didn't go through. Nothing was charged.",
  },
  confirmed: {
    headline: "You're in.",
    sub: 'Your LYZN is being prepared.',
    back: 'Back to LYZN',
  },
} as const

/**
 * The rows under "What happens next", assembled around the empty slots.
 *
 * `balance` is what dispatch will take — nothing on a tier whose deposit is
 * its whole price, which is why the row is conditional rather than a
 * sentence with a ₹0 in it.
 */
export function nextSteps(options: { email: string; renewal: boolean; balance?: number }) {
  const rows: string[] = [
    `A confirmation is on its way to ${options.email}.`,
    join(["We'll email you before your pendant ships", SHIP_MONTH && `, ${SHIP_MONTH}`], '') + '.',
    'Your app invite arrives before dispatch.',
  ]
  if (options.balance) {
    rows.push(
      `The balance of ${money(options.balance)} is taken when your pendant is dispatched — not before, and not if you cancel first.`,
    )
  }
  if (options.renewal) {
    rows.push(
      'Your subscription starts when you activate the pendant: ₹499 a month, set up from the app — or bring your own key and pay nothing.',
    )
  }
  return rows
}

/* ─────────────────────────────────────────────────────────────
   Footer
   ───────────────────────────────────────────────────────────── */

export const FOOTER = {
  copyright: `© ${new Date().getFullYear()} LYZN`,
} as const
