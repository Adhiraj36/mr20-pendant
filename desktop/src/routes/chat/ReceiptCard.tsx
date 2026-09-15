// The card the assistant hands back for something it made or started.
import { Gauge, ReceiptText, Repeat2 } from 'lucide-react'
import type { Card } from '@lyzn/chat-core'
import type { Route } from '@/components/Chrome'
import { StatusDot, type Tone } from '@/components/ui'
import { openDashboard } from '@/routes/Dashboard'

const KIND: Record<Card['kind'], { icon: typeof Gauge; route: Route; place: string }> = {
  ticket: { icon: ReceiptText, route: 'tasks', place: 'Tasks' },
  loop: { icon: Repeat2, route: 'loops', place: 'Loops' },
  dashboard: { icon: Gauge, route: 'dashboard', place: 'Dashboard' },
}

/** Something the assistant made or started.
 *
 *  One shape for tickets, loops and dashboards: kind, a live status, a title
 *  and a way in. A thing that now exists reads differently from a thing that
 *  happened, and these are the former — so a live one stays visibly unsettled
 *  (the frame itself runs stamp violet) and goes quiet, in one motion, the
 *  moment it is not. */
export function ReceiptCard({ card, onOpen }: { card: Card; onOpen: (route: Route) => void }) {
  const { icon: Icon, route, place } = KIND[card.kind]
  // The engine has not shipped a failure status yet, but the three-way palette
  // is the contract — read it from the words rather than wait for a new field.
  const tone: Tone = card.live ? 'busy' : /fail|error/i.test(card.status) ? 'bad' : 'ok'
  const toneColor = tone === 'busy' ? 'var(--accent)' : tone === 'bad' ? 'var(--bad)' : 'var(--ok)'

  return (
    <div
      className="my-1.5 max-w-[340px] border bg-[var(--skin-1)] transition-colors duration-300 [transition-timing-function:var(--ease-out-soft)]"
      style={{ borderColor: card.live ? 'var(--accent)' : 'var(--edge)' }}
    >
      <div className="flex items-center gap-1.5 border-b border-dashed px-3 py-1.5">
        <Icon size={12} className="shrink-0 text-[var(--fg-faint)]" />
        <span className="flex-1 truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--fg-faint)]">
          {card.kind}
        </span>
        <StatusDot tone={tone} pulse={card.live} />
        <span
          className="font-mono text-[9px] uppercase tracking-[0.08em]"
          style={{ color: toneColor }}
        >
          {card.status}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-[13px] leading-snug text-[var(--fg)]">{card.title}</p>
      </div>

      <button
        onClick={() => {
          if (card.kind === 'dashboard') openDashboard(card.id)
          onOpen(route)
        }}
        className="flex w-full items-center justify-between border-t border-dashed px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--accent)] transition-colors duration-150 hover:bg-[var(--skin-2)]"
      >
        <span>Open in {place}</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}
