import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { INKS, applyInk, hydrateInk, useInk, type InkId } from '@/lib/ink'
import { cn } from '@/lib/utils'

/**
 * Six squares of ink.
 *
 * A radiogroup, not a listbox and not a set of links: one of six, exactly
 * one chosen, arrows to move and Enter or Space to pick. Roving tabindex, so
 * the whole row is one tab stop and Tab still walks past it to the next
 * control rather than through six.
 *
 * The dots are square like everything else that can be pressed here. The
 * chosen one wears a double ring — a gap in the ground colour, then the ink
 * itself — because six flat squares with one outlined is the only way to
 * show a choice among colours without tinting the colour you are choosing.
 */
export function InkRow({
  id,
  size = 'sm',
  variant = 'swatch',
  onPick,
  className,
}: {
  /** DOM id — the header row's retire animation hangs off it. */
  id: string
  size?: 'sm' | 'lg'
  /**
   * `swatch` is the row of six squares. `mark` is the same six controls
   * wearing the wordmark's own ellipsis: a period each, which becomes the
   * ink it sets while a pointer is on the mark. Everything about the
   * behaviour is identical — this changes what they look like and nothing
   * else, which is why it is a variant here and not a second component
   * with its own copy of the arrow keys.
   */
  variant?: 'swatch' | 'mark'
  /** Called after a pick, with the id, so a row can get out of the way. */
  onPick?: (id: InkId) => void
  className?: string
}) {
  const ink = useInk()
  const row = useRef<HTMLDivElement>(null)
  const checked = Math.max(
    0,
    INKS.findIndex((i) => i.id === ink),
  )

  // Where Tab lands. It follows the arrow keys inside the row and snaps back
  // to the chosen ink on every pick, so leaving and returning puts you on
  // the dot that is actually lit rather than wherever you last wandered.
  const [roving, setRoving] = useState(checked)
  useEffect(() => setRoving(checked), [checked])

  // If the bootstrap in index.html never ran, this is what puts a stored ink
  // on the page — late, with a flash, but on the page.
  useEffect(() => {
    hydrateInk()
  }, [])

  const pick = (next: InkId) => {
    applyInk(next, true)
    onPick?.(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return

    const dots = row.current?.querySelectorAll<HTMLButtonElement>('button')
    if (!dots || dots.length === 0) return
    const from = [...dots].indexOf(document.activeElement as HTMLButtonElement)
    if (from < 0) return

    const last = dots.length - 1
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (from + 1) % dots.length
            : (from - 1 + dots.length) % dots.length

    // Arrows move focus; Enter and Space pick. A button does the second one
    // for us, which is the whole reason these are buttons.
    event.preventDefault()
    setRoving(to)
    dots[to]?.focus()
  }

  return (
    <div
      ref={row}
      id={id}
      role="radiogroup"
      aria-label="Heading ink colour"
      onKeyDown={onKeyDown}
      className={cn(
        variant === 'mark' ? 'mark-row' : 'ink-row',
        variant === 'swatch' && size === 'lg' && 'lg',
        className,
      )}
    >
      {INKS.map((i, index) => (
        <button
          key={i.id}
          type="button"
          role="radio"
          aria-checked={i.id === ink}
          aria-label={i.label}
          tabIndex={index === roving ? 0 : -1}
          onClick={() => pick(i.id)}
          className={variant === 'mark' ? 'mark-dot' : 'ink-dot'}
          style={{ '--sw': i.hex } as CSSProperties}
        >
          {/* The mark's own punctuation, so at rest this is the wordmark
              and not a drawing of it: same face, same tracking, same
              advance. The swatch is painted over it and changes no width. */}
          {variant === 'mark' ? <span aria-hidden="true">.</span> : null}
        </button>
      ))}
    </div>
  )
}

/**
 * The footer row: the label, then the six.
 *
 * This one never retires. It is the control of record — the place you go
 * back to when you want a different ink, and on a phone the only one there
 * is, since the header has no room for it.
 */
export function InkFooter({ id, className }: { id: string; className?: string }) {
  return (
    <div className={cn('ink-foot', className)}>
      <span className="ink-label label-sm">INK</span>
      <InkRow id={id} size="lg" />
    </div>
  )
}
