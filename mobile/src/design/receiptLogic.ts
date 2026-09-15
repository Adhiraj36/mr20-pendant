/**
 * `Receipt`'s pure logic — the row model and the band order the print
 * animation (M2) reveals (spec §3.3, §9 "Receipt"). The animation itself
 * (each band's `maxHeight` from a `SharedValue`) lives in `Receipt.tsx`'s
 * `PrintBand`, which measures its own band directly rather than through a
 * cumulative height sum — there is no shared "how tall so far" math to pull
 * out here.
 *
 * Split out from `Receipt.tsx` so the node test runner can exercise it
 * directly: that file imports React Native and Skia, which the test suite
 * cannot load (see `tests/design/receipt.test.ts`). This file imports
 * neither — numbers and strings only, same discipline as `tokens.ts`.
 */
import { barcodeBars, RECEIPT_TITLE, type ReceiptRowSpec, type ReceiptSpec } from '@lyzn/design';

export { barcodeBars, RECEIPT_TITLE };
export type { ReceiptRowSpec, ReceiptSpec };

/** The bands after band 0 (title/meta), in the order the slip prints them. */
export type BandKey = 'quote' | 'rows' | 'total' | 'barcode' | 'footer';

/**
 * The rows band, either flat or cut into groups.
 *
 * A slip sometimes prints two kinds of row that belong apart — the Library's
 * facts and its tasks (spec §2.6: "a cut, then one `plain` row per item").
 * §3.3's band list has exactly one `rows` band, so groups are cut *inside*
 * that band rather than added as a sixth: the print order M2 enumerates is
 * unchanged, and a caller with one flat list writes exactly what it did.
 */
export type ReceiptRows = ReceiptRowSpec[] | ReceiptRowSpec[][];

export interface BandInput {
  quote?: string;
  rows?: ReceiptRows;
  total?: { k: string; v: string };
  barcodeSeed?: string;
  footer?: string;
}

/**
 * `rows` as groups, with the empty ones dropped — so a slip with facts but
 * no tasks prints no stray cut, and `[]` is not a band at all.
 */
export function rowGroups(rows: ReceiptRows | undefined): ReceiptRowSpec[][] {
  if (!rows || rows.length === 0) return [];
  const groups = Array.isArray(rows[0]) ? (rows as ReceiptRowSpec[][]) : [rows as ReceiptRowSpec[]];
  return groups.filter((group) => group.length > 0);
}

/**
 * Which bands this slip has, in print order. Band 0 (title/meta) is not in
 * this list — it is always the first thing on the slip, printed or not.
 */
export function receiptBands(spec: BandInput): BandKey[] {
  const bands: BandKey[] = [];
  if (spec.quote) bands.push('quote');
  if (rowGroups(spec.rows).length > 0) bands.push('rows');
  if (spec.total) bands.push('total');
  if (spec.barcodeSeed) bands.push('barcode');
  if (spec.footer) bands.push('footer');
  return bands;
}

/**
 * Whether the content band at `index` (0-based, into `receiptBands`'s
 * result) is visible under `printing.bands` (the count of bands printed so
 * far, band 0 — the header — counted as the first).
 *
 * `undefined` (no `printing` prop) means the slip is not printing: every
 * band is visible.
 */
export function bandVisible(index: number, printedBands: number | undefined): boolean {
  if (printedBands === undefined) return true;
  // Band 0 is the header; content band `index` is overall band `index + 1`.
  return printedBands >= index + 2;
}
