// The plan it is working to, as it currently stands: a checklist on a slip.
import { Check } from 'lucide-react'
import type { PlanEntry } from '@lyzn/chat-core'
import { cn } from '@/lib/util'

export function PlanRow({ entries }: { entries: PlanEntry[] }) {
  const done = entries.filter((e) => e.status === 'completed').length
  return (
    <div className="mb-5 border border-[var(--edge)] bg-[var(--skin-2)] px-4 pt-2.5 pb-3">
      <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-[var(--fg-faint)]">
        <span>Plan</span>
        <span>
          {done} of {entries.length}
        </span>
      </div>
      <ol>
        {entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2.5 py-[3px] text-[13.5px] leading-snug">
            <span
              className={cn(
                'mt-[2px] grid size-[13px] shrink-0 place-items-center border',
                e.status === 'completed'
                  ? 'border-[var(--fg)] bg-[var(--fg)] text-[var(--skin-1)]'
                  : e.status === 'in_progress'
                    ? 'border-[var(--accent)]'
                    : 'border-[var(--edge-strong)]',
              )}
            >
              {e.status === 'completed' && <Check size={9} strokeWidth={3} />}
              {e.status === 'in_progress' && <span className="size-[5px] bg-[var(--accent)]" />}
            </span>
            <span
              className={
                e.status === 'completed'
                  ? 'text-[var(--fg-faint)] line-through decoration-[var(--edge-strong)]'
                  : e.status === 'in_progress'
                    ? 'text-[var(--fg)]'
                    : 'text-[var(--fg-dim)]'
              }
            >
              {e.status === 'in_progress' ? (e.activeForm ?? e.content) : e.content}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
