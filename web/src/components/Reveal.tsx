import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSeen } from '@/lib/hooks'
import { cn } from '@/lib/utils'

/**
 * The page's one entrance.
 *
 * A single rise-and-fade shared by every block that is not scroll-scrubbed,
 * so the rhythm of the page is one idea rather than a different trick per
 * section. It starts visible for anyone who has asked for less motion, and
 * it never runs twice.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
  onMount,
}: {
  children: ReactNode
  className?: string
  delay?: number
  as?: 'div' | 'li' | 'article' | 'figure' | 'p'
  /**
   * Runs on arrival rather than on scroll. For a page that is entered
   * rather than scrolled through — the confirmation — where waiting for an
   * intersection would leave content below the fold invisible.
   */
  onMount?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scrolledInto = useSeen(ref)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (!onMount) return
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [onMount])

  const seen = onMount ? mounted : scrolledInto
  // One concrete element type for the ref; the tag is only ever swapped to
  // keep the surrounding markup semantic.
  const T = Tag as 'div'

  return (
    <T
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-[opacity,transform] duration-[var(--dur-reveal)] ease-[var(--ease-out)]',
        'motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none',
        seen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        className,
      )}
    >
      {children}
    </T>
  )
}
