import type { ReactNode } from 'react'
import { barcodeBars } from '@lyzn/design'
import { cn } from '@/lib/utils'

/**
 * Proof of work, as a till slip.
 *
 * The site's argument is that other assistants hand you notes and this one
 * hands you receipts, so the receipt is not decoration — it is the claim.
 * Everything about it is a real slip: a heading, a cut, the thing that was
 * said, the rows that were carried out, a total, and a barcode nobody is
 * meant to scan.
 *
 * It carries its own paper and ink (see `.receipt` in index.css) so the same
 * component drops onto the ink hero and the paper pricing section without a
 * variant, and without ever reading the tone variables around it.
 */

export type Row = {
  k: string
  v: string
  /** Marks the value as a confirmation — the one place the accent appears. */
  ok?: boolean
}

/**
 * A barcode derived from the transaction id.
 *
 * Deterministic, because a barcode that reshuffles on every render is a
 * barcode that admits it is a decoration. `barcodeBars` (from @lyzn/design)
 * hashes the seed into bar widths, so one id always draws the same code —
 * on this platform and on the app's.
 */
function Barcode({ seed }: { seed: string }) {
  const bars = barcodeBars(seed)

  return (
    <div aria-hidden="true" className="flex h-11 w-full items-stretch overflow-hidden">
      {bars.map((w, i) => (
        <span
          key={i}
          style={{ flex: `${w} 1 0` }}
          className={i % 2 === 0 ? 'bg-receipt-ink' : 'bg-transparent'}
        />
      ))}
    </div>
  )
}

export function ReceiptRow({ k, v, ok }: Row) {
  return (
    <p className="r-row">
      <span className="r-key">{k}</span>
      <span className="lead" aria-hidden="true" />
      <span className={cn('r-val', ok && 'text-signal')}>
        {v}
        {ok && <span className="ml-1.5">✓</span>}
      </span>
    </p>
  )
}

export function Receipt({
  title = 'LYZN · PROOF OF WORK',
  meta,
  stamp,
  quote,
  rows,
  total,
  barcode,
  footer,
  className,
  children,
  style,
}: {
  title?: string
  /** The second heading line: a time, a place, a kind of moment. */
  meta?: string
  /** DONE, FILED, PAID ONCE. Absent on a slip that is still open. */
  stamp?: string
  /** What was actually said, in the speaker's own words. */
  quote?: string
  rows?: Row[]
  /** The one figure the slip is really about. */
  total?: { k: string; v: string }
  /** Seeds the barcode; also the transaction id printed under it. */
  barcode?: string
  footer?: string
  className?: string
  children?: ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div className={cn('receipt', className)} style={style}>
      <header className="text-center">
        <p className="text-[12.5px] font-semibold tracking-[0.16em]">{title}</p>
        {meta && (
          <p className="mt-1 text-[11px] tracking-[0.14em] text-[#8a8880] uppercase">{meta}</p>
        )}
      </header>

      <div className="r-cut relative mt-4 pt-4">
        {stamp && <span className="r-stamp -top-5">{stamp}</span>}

        {quote && (
          <p
            className={cn(
              'font-sans text-[15px] leading-snug font-medium tracking-[-0.01em]',
              stamp && 'pr-24',
            )}
          >
            “{quote}”
          </p>
        )}

        {children}

        {rows && rows.length > 0 && (
          <div className={cn(quote || children ? 'r-cut mt-4 pt-3' : stamp && 'mt-3')}>
            {rows.map((row) => (
              <ReceiptRow key={row.k} {...row} />
            ))}
          </div>
        )}

        {total && (
          <div className="r-cut mt-4 flex items-baseline justify-between gap-4 pt-3">
            <span className="r-key text-[12px]">{total.k}</span>
            <span className="text-[20px] font-semibold tracking-[0.02em] tabular-nums">
              {total.v}
            </span>
          </div>
        )}

        {barcode && (
          <div className="mt-5">
            <Barcode seed={barcode} />
          </div>
        )}

        {footer && (
          <p className="mt-3 text-center text-[10.5px] tracking-[0.1em] text-[#8a8880] uppercase">
            {footer}
          </p>
        )}
      </div>
    </div>
  )
}
