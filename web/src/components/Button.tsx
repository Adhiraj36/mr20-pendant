import { Link } from 'react-router-dom'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'compact'

const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
}

type Common = {
  variant?: Variant
  size?: Size
  full?: boolean
  className?: string
  children: ReactNode
}

/**
 * One button, three weights.
 *
 * Colour comes from the tone variables rather than a light and a dark
 * variant, so the same primary button is white-on-ink in the hero and
 * black-on-paper in the pricing section without being told which it is.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  full,
  className,
  ...props
}: Common & Omit<ComponentProps<'button'>, keyof Common>) {
  return (
    <button
      {...props}
      className={cn('btn', VARIANTS[variant], size === 'compact' && 'btn-compact', full && 'btn-full', className)}
    />
  )
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  full,
  className,
  to,
  ...props
}: Common & { to: string } & Omit<ComponentProps<typeof Link>, keyof Common | 'to'>) {
  return (
    <Link
      {...props}
      to={to}
      className={cn('btn', VARIANTS[variant], size === 'compact' && 'btn-compact', full && 'btn-full', className)}
    />
  )
}

/** For in-page anchors, which are links to a place, not to a route. */
export function ButtonAnchor({
  variant = 'ghost',
  size = 'md',
  full,
  className,
  ...props
}: Common & Omit<ComponentProps<'a'>, keyof Common>) {
  return (
    <a
      {...props}
      className={cn('btn', VARIANTS[variant], size === 'compact' && 'btn-compact', full && 'btn-full', className)}
    />
  )
}
