/* Detached as of round four: the order is the paysheet in sections/Pricing.tsx, and nothing mounts this. Kept whole for the day the full checkout is needed again. */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Choose } from '@/pages/Choose'
import { Confirmed } from '@/pages/Confirmed'
import { Details } from '@/pages/Details'
import { Pay } from '@/pages/Pay'
import { useOrder } from '@/order/OrderContext'
import { cn } from '@/lib/utils'

/** Everything inside the panel that can take focus while it is open. */
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * The order, on the page it was asked for.
 *
 * Buying is no longer somewhere you go: the four steps arrive in a panel
 * over the landing page, which stays where it was — same scroll position,
 * same pendant, dimmed. Nothing about the checkout itself changed; the
 * steps are the same components, and the frame around them moved here
 * from the page they used to have to themselves.
 *
 * The step lives in the URL (`?order=…`), so this component holds no state
 * beyond the one frame it needs to slide in on.
 */
export function OrderSheet() {
  const { step, closeOrder } = useOrder()
  const panel = useRef<HTMLDivElement>(null)
  const open = step !== null

  // Off-canvas for the first frame, so the browser has a position to
  // animate from. Reduced motion skips the slide, not the sheet.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!open) {
      setShown(false)
      return
    }
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  // The panel takes the screen, so it takes the scroll with it — and hands
  // it back, along with the focus, on the way out.
  useEffect(() => {
    if (!open) return

    const returnTo = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [open])

  // Every step is a new screen. Focus starts at the top of it rather than
  // on whichever button was pressed to get here — which by then is gone.
  useEffect(() => {
    if (step) panel.current?.focus()
  }, [step])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Razorpay's sheet opens over this one and owns the keyboard while
        // it is up: Escape then belongs to the payment, not to the order.
        if (document.querySelector('.razorpay-container')) return
        closeOrder()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, closeOrder])

  if (!step) return null

  return (
    <div className="fixed inset-0 z-[70]">
      {/* The page behind stays legible through the scrim — it is what the
          order is for, and covering it would make this a page again. A
          keyboard closes with Escape or the button in the header, so the
          scrim itself is not a control. */}
      <div
        aria-hidden="true"
        onClick={closeOrder}
        className={cn(
          'absolute inset-0 bg-ink/45 transition-opacity duration-300 ease-[var(--ease-out)]',
          'motion-reduce:transition-none',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Your order"
        tabIndex={-1}
        className={cn(
          'on-paper absolute inset-y-0 right-0 flex w-full flex-col bg-tone-bg outline-none sm:max-w-[480px]',
          'transition-transform duration-300 ease-[var(--ease-out)] motion-reduce:transition-none',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-tone-line px-6 py-4">
          <p className="label-sm text-tone-faint">LYZN · Order</p>
          <button
            type="button"
            onClick={closeOrder}
            aria-label="Close"
            className="-mr-2 flex size-10 shrink-0 items-center justify-center text-tone-muted transition-colors duration-[var(--dur-ui)] hover:text-tone"
          >
            <X className="size-5" strokeWidth={1.5} />
          </button>
        </header>

        {step === 'choose' && <Choose />}
        {step === 'details' && <Details />}
        {step === 'pay' && <Pay />}
        {step === 'confirmed' && <Confirmed />}
      </div>
    </div>
  )
}
