// A choice in the composer's toolbar: a quiet label that opens a short list.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/util'

export type Choice = { id: string; label: string; hint?: string }

export function Picker({
  name,
  prefix,
  value,
  choices,
  onChange,
}: {
  /** What is being chosen, for the menu's heading and for screen readers. */
  name: string
  prefix?: string
  value: string
  choices: Choice[]
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    // Captured, so Escape closes the menu without also stopping a running turn.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const current = choices.find((c) => c.id === value) ?? choices[0]

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${name}: ${current?.label ?? ''}`}
        className={cn(
          'flex h-[31px] items-center gap-1.5 px-2 font-mono text-[10.5px] transition-colors duration-150',
          open ? 'bg-[var(--skin-2)] text-[var(--fg)]' : 'text-[var(--fg-dim)] hover:bg-[var(--skin-2)] hover:text-[var(--fg)]',
        )}
      >
        {prefix && <span className="text-[var(--fg-faint)]">{prefix}</span>}
        <span>{current?.label}</span>
        <ChevronDown size={10} className={cn('transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={name}
          className="lz-menu absolute bottom-full left-0 z-30 mb-2 min-w-[220px] border border-[var(--fg)] bg-[var(--skin-1)] py-1"
        >
          <p className="px-3 pt-1.5 pb-1 font-mono text-[10px] text-[var(--fg-faint)]">{name}</p>
          {choices.map((c) => {
            const on = c.id === current?.id
            return (
              <button
                key={c.id || 'default'}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(c.id)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left text-[13px] transition-colors hover:bg-[var(--skin-2)]"
              >
                <span className="grid w-3 shrink-0 place-items-center">{on && <Check size={12} strokeWidth={2.5} />}</span>
                <span className="flex-1">{c.label}</span>
                {c.hint && <span className="font-mono text-[10px] text-[var(--fg-faint)]">{c.hint}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
