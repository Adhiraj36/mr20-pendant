/**
 * A receipt is proof of work: a heading, a cut, what was said, the rows
 * carried out, a total, a barcode nobody is meant to scan. This is the
 * model; each platform draws it.
 */
export type ReceiptRowSpec = {
  k: string
  v?: string
  /** A confirmed value: the one place the signal colour appears. */
  ok?: boolean
  /** Sentence case rather than the uppercase key — task text. */
  plain?: boolean
}

export type ReceiptSpec = {
  title?: string
  meta?: string
  /** DONE, FILED, PAID. Absent on a slip still open. */
  stamp?: string
  quote?: string
  rows?: ReceiptRowSpec[]
  total?: { k: string; v: string }
  /** Seeds the barcode and is printed under it. */
  barcode?: string
  footer?: string
}

export const RECEIPT_TITLE = 'LYZN · PROOF OF WORK'
export const BARCODE_BARS = 84

/** Bar widths 1–3 from a cheap hash of the seed. Deterministic on purpose. */
export function barcodeBars(seed: string): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const bars: number[] = []
  for (let i = 0; i < BARCODE_BARS; i++) {
    h = (h * 1103515245 + 12345) >>> 0
    bars.push(1 + ((h >>> 8) % 3))
  }
  return bars
}
