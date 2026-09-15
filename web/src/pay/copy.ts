/**
 * Everything this page says.
 *
 * It is read inside an in-app browser, by somebody who tapped RESERVE in the
 * app twenty milliseconds ago and expects a payment sheet — not a web page.
 * So the words are few, they never explain the mechanism, and every one of
 * them assumes the reader wants to be somewhere else.
 */
export const PAY = {
  title: 'Payment — LYZN',
  slip: 'LYZN · PAYMENT',
  order: 'ORDER',
  dueToday: 'DUE TODAY',

  /** The whole of the happy path, as far as this page is concerned. */
  opening: 'Opening the payment sheet…',
  openingNote: 'Do not close this window.',

  /** Checkout's handler fired. The app decides what it means. */
  paid: 'Paid. Taking you back to LYZN…',
  /** The sheet was dismissed, or the payment failed and was given up on. */
  cancelled: 'Nothing was charged. Taking you back to LYZN…',

  /** The two ways this page can fail before Checkout is ever shown. */
  brokenTitle: 'This link is incomplete.',
  brokenLine: 'Start the payment again from the app.',
  failedTitle: 'The payment sheet did not open.',
  failedLine: 'Usually a network that dropped. Nothing was charged.',
  retry: 'TRY AGAIN',

  /**
   * The line that makes the page safe.
   *
   * Returning to the app is a `lyzn://` navigation, and an in-app browser is
   * allowed to refuse one it did not get from a tap. So the same link is
   * always on the page, as a link, whatever state it is in.
   */
  fallback: 'Not going back on its own?',
  fallbackLink: 'RETURN TO LYZN',
} as const
