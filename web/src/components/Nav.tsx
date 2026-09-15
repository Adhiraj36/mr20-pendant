import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { wordmark } from '@lyzn/design'
import {Button} from '@/components/Button'
import { InkFooter, InkRow } from '@/components/InkRow'
import { OrderButtonLink } from '@/order/OrderButton'
import { NAV_LINKS } from '@/data/content'
import { DEFAULT_CONFIG } from '@/data/pricing'
import { useMedia, useScrollFrame } from '@/lib/hooks'
import { cn } from '@/lib/utils'

/**
 * The bar.
 *
 * Always dark, whatever it is over: it crosses two paper sections, and a bar
 * that changes colour halfway down a page draws attention to itself rather
 * than to the page. Transparent at the top of the hero, then a hairline and
 * a blurred ink backdrop once there is anything behind it worth separating.
 *
 * On a phone it gets out of the way on the way down and comes back on the
 * way up, so Preorder is always one flick away without ever sitting on top
 * of the thing being read.
 */
export function Nav({ variant = 'site' }: { variant?: 'site' | 'checkout' }) {
  // Only a phone gets a bar that leaves. On a desktop there is room for
  // both the page and the nav, and a header that disappears while you read
  // is a header you have to go looking for.
  const mobile = useMedia('(max-width: 1023px)')
  const checkout = variant === 'checkout'
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)


  const last = useRef(0)
  const sheet = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  useScrollFrame((y) => {
    setScrolled((was) => {
      // A little hysteresis, so a nav does not strobe at exactly 80px.
      if (!was && y > 80) return true
      if (was && y < 56) return false
      return was
    })

    const delta = y - last.current
    if (Math.abs(delta) > 6) {
      setHidden(mobile && !checkout && delta > 0 && y > 240)
      last.current = y
    }
  })

  // Which section is being read. Only the four anchored ones are candidates,
  // so the underline never lands on a section with no link.
  useEffect(() => {
    if (variant === 'checkout') return
    const ids = NAV_LINKS.map((l) => l.href.slice(1))
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el))
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.2, 0.5] },
    )
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [variant])

  // The sheet takes the whole screen, so it takes the keyboard with it.
  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        menuButton.current?.focus()
        return
      }
      if (event.key !== 'Tab') return
      // `:not([tabindex="-1"])` keeps the ink row's parked dots out of it:
      // a roving tabindex means five of the six are not tab stops, and
      // wrapping focus onto one of them would drop it out of the sheet.
      const focusable = sheet.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (!first || !lastEl) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        lastEl.focus()
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    sheet.current?.querySelector<HTMLElement>('a[href]')?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 border-b transition-[transform,background-color,border-color] duration-200 ease-[var(--ease-out)]',
        // Every page is paper now, so the bar is too — a dark bar over a
        // light page reads as something left switched on. The site bar is
        // the more transparent of the two: it sits over the pendant, and
        // the object should stay visible through it.
        'on-paper',
        scrolled || open
          ? checkout
            ? 'border-tone-line bg-[color-mix(in_srgb,var(--color-paper)_85%,transparent)] backdrop-blur-xl'
            : // The site bar crosses the desk, so it is the desk: a paper
              // tint over that ground reads as a band the page does not have.
              // The checkout above keeps paper, which is what its pages are.
              'border-tone-line bg-[color-mix(in_srgb,var(--color-desk)_72%,transparent)] backdrop-blur-xl'
          : 'border-transparent bg-transparent',
        hidden && !open ? '-translate-y-full' : 'translate-y-0',
      )}
    >
      <div className="shell flex h-14 items-center justify-between gap-4 sm:h-16">
        {/* The wordmark is type, and it is the reference's .mark: the same
            face and tracking as the button beside it. The name is
            `wordmark` in @lyzn/design.
        
            On the site bar the dots are the ink picker. There is one for
            each ink and at rest they are the mark's own punctuation — the
            same periods, in the same face, at the same advance — so the bar
            shows a wordmark and nothing else. Bring a pointer near and each
            period becomes the colour it sets. Nothing moves when it does:
            the swatch is painted over the period rather than in place of
            it, so the mark is the same width revealed as hidden.
        
            The checkout bar keeps the plain string. Somebody paying should
            not discover a colour picker under the logo. */}
        {checkout ? (
          <Link to="/" className="mark text-tone">
            {wordmark.text}
          </Link>
        ) : (
          <div className="mark-ink mark text-tone">
            <Link to="/" className="mark-name">
              {wordmark.name}
            </Link>
            <InkRow id="ink-mark" variant="mark" />
          </div>
        )}

        {variant === 'site' && (
          <nav aria-label="Sections" className="hidden items-center gap-8 lg:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                aria-current={active === link.href.slice(1) ? 'true' : undefined}
                className={cn(
                  'rounded-[4px] text-[15px] underline-offset-[6px] transition-colors duration-200',
                  active === link.href.slice(1)
                    ? 'text-tone underline decoration-2'
                    : 'text-tone-muted hover:text-tone',
                )}
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          {variant === 'checkout' ? (
            <p className="label-sm text-tone-muted">Secure checkout</p>
          ) : (
            <>
              {/* The bar carries no tier of its own, so it opens on the
                  one the site argues for. */}
              <OrderButtonLink plan={DEFAULT_CONFIG.plan} size="compact">
                Preorder
              </OrderButtonLink>
              <Button
                ref={menuButton}
                variant="ghost"
                size="compact"
                aria-expanded={open}
                aria-controls="nav-sheet"
                aria-label={open ? 'Close menu' : 'Open menu'}
                onClick={() => setOpen((v) => !v)}
                className="size-10 shrink-0 px-0 lg:hidden"
              >
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </Button>
            </>
          )}
        </div>
      </div>

      {variant === 'site' && (
        <div
          id="nav-sheet"
          ref={sheet}
          hidden={!open}
          className="on-paper border-t border-tone-line bg-[color-mix(in_srgb,var(--color-desk)_96%,transparent)] backdrop-blur-xl lg:hidden"
        >
          <nav aria-label="Sections" className="shell flex flex-col py-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="display-m border-b border-tone-line py-4 text-tone last:border-b-0"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* The stacked nav gets the footer's row, not the header's: there
              is no bar to clear on a phone, so it has no reason to retire. */}
          <InkFooter id="ink-nav" className="shell border-t border-tone-line py-5" />
        </div>
      )}
    </header>
  )
}
