// A past turn, folded to the question that started it.
import { ChevronRight } from 'lucide-react'

export function TurnFoldRow({ label, onUnfold }: { label: string; onUnfold: () => void }) {
  return (
    <button
      onClick={onUnfold}
      className="mb-3 flex w-full items-center gap-2 text-left text-[12px] text-[var(--fg-faint)] transition-colors duration-150 hover:text-[var(--fg-dim)]"
    >
      <ChevronRight size={10} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}
