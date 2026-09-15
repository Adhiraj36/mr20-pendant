import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Ground = 'ink' | 'charcoal' | 'void' | 'paper' | 'paper-2'

const TONE: Record<Ground, string> = {
  ink: 'on-ink',
  charcoal: 'on-charcoal',
  void: 'on-void',
  paper: 'on-paper',
  'paper-2': 'on-paper-2',
}

type SectionProps = {
  id?: string
  ground: Ground
  /**
   * Leaves the background unpainted — which every section on the landing
   * page now does. The body carries the one ground the site has, the desk,
   * and the fixed canvas shows through the four sections the pendant
   * appears in. The prop stays for a section that one day wants a band of
   * its own; nothing has one today.
   */
  transparent?: boolean
  labelledBy?: string
  className?: string
  children: ReactNode
}

export function Section({
  id,
  ground,
  transparent,
  labelledBy,
  className,
  children,
}: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-ground={ground}
      className={cn('relative z-10', TONE[ground], !transparent && 'bg-tone-bg', className)}
    >
      {children}
    </section>
  )
}

/** A mono label. The site's only uppercase, and nothing decorating it. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('label text-tone-muted', className)}>{children}</p>
}
