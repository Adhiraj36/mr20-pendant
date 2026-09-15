import { useRef } from 'react'
import { Receipt } from '@/components/Receipt'
import { Eyebrow, Section } from '@/components/Section'
import { RECEIPTS } from '@/data/content'
import { usePrefersReducedMotion, useScrollFrame, useStage } from '@/lib/hooks'
import { crossProgress } from '@/lib/scroll'

/**
 * Three slips from one ordinary day.
 *
 * This is where the site stops describing the product and shows finished
 * work. It replaced a four-state animation of a single sentence: three
 * completed receipts make the same claim faster, and make it three times.
 *
 * The slips drift at slightly different rates as the section crosses the
 * viewport — a few dozen pixels each, no pin, no hijack. The reader's scroll
 * is never held; the parallax is only a function of where the section is.
 */
export function Receipts() {
  const stage = useStage<HTMLDivElement>('receipts')
  const row = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  useScrollFrame((y, vh) => {
    const el = row.current
    if (!el || reduced) return
    // −1 → 1 across the crossing, so the middle of the section is rest.
    el.style.setProperty('--d', String(crossProgress('receipts', y, vh) * 2 - 1))
  })

  return (
    <Section id="proof" ground="paper" transparent labelledBy="receipts-title">
      <div ref={stage} className="shell section-pad">
        <div className="flex items-start gap-6">
          <span className="label-sm mt-2 hidden text-tone-faint sm:block">01</span>
          <div>
            <Eyebrow>{RECEIPTS.eyebrow}</Eyebrow>
            <h2 id="receipts-title" className="display-l mt-5">
              {RECEIPTS.headline}
            </h2>
            <p className="body-l mt-5 max-w-[52ch] text-tone-muted">{RECEIPTS.sub}</p>
          </div>
        </div>

        <div
          ref={row}
          className="mt-16 grid gap-8 sm:grid-cols-2 lg:mt-20 lg:grid-cols-3 lg:gap-10"
        >
          {RECEIPTS.slips.map((slip, i) => (
            <Receipt
              key={slip.txn}
              meta={slip.meta}
              quote={slip.quote}
              stamp={'stamp' in slip ? slip.stamp : undefined}
              rows={[...slip.rows]}
              barcode={slip.txn}
              footer={slip.txn}
              className="drift"
              style={{
                // Each slip sits at its own angle and travels at its own
                // rate, so the row reads as three pieces of paper on a desk
                // rather than three copies of one card.
                '--tilt': `${slip.tilt}deg`,
                '--rate': String(10 + i * 9),
              } as React.CSSProperties}
            />
          ))}
        </div>

        <p className="label-sm mt-14 text-tone-faint">{RECEIPTS.footer}</p>
      </div>
    </Section>
  )
}
