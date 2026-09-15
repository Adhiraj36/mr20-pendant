// Reasoning, kept quieter than the answer.
//
// Closed by default: it is evidence of work, not the thing that was asked for.
import { ChevronRight } from 'lucide-react'

export function ThoughtRow({
  text,
  expanded,
  onToggle,
}: {
  text: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="lz-ledger-line">
        <span className="grid w-3 shrink-0 place-items-center">
          <ChevronRight
            size={10}
            className="transition-transform duration-200 [transition-timing-function:var(--ease-out-soft)]"
            style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
          />
        </span>
        <span>Reasoning</span>
      </button>
      {expanded && <p className="lz-thought">{text}</p>}
    </div>
  )
}
