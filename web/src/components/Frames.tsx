import { cn } from '@/lib/utils'

/**
 * A laptop, drawn.
 *
 * The site has one of these and two places that need it: the story's third
 * station, where a promise becomes work, and the daemon page, where the app
 * that does that work is shown running. Both draw the same machine because
 * it is the same machine.
 *
 * The outline is the site's line weight and nothing else — the screen is a
 * hole, and whatever is put inside it is laid out in the ordinary way.
 */
export function LaptopFrame({
  label,
  dense,
  children,
}: {
  /**
   * The mono caption inside the screen, above the content. Omitted where
   * what is drawn carries a title bar of its own — two names for the same
   * window, one under the other, is one too many.
   */
  label?: string
  dense?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative h-full w-full">
      <svg
        aria-hidden="true"
        viewBox="0 0 640 440"
        className="absolute inset-0 h-full w-full text-tone"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      >
        <rect x="30" y="2" width="580" height="394" rx="18" />
        <rect x="44" y="16" width="552" height="366" rx="10" strokeWidth="1.2" opacity="0.35" />
        <path d="M2 400 H638 L624 432 Q320 440 16 432 Z" />
        <line x1="280" y1="416" x2="360" y2="416" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      </svg>
      <div className="absolute top-[calc(100%*28/440)] right-[calc(100%*58/640)] bottom-[calc(100%*70/440)] left-[calc(100%*58/640)] flex flex-col">
        {/* 125% of the screen at 0.8 is the screen, exactly — so the two
            rigs lay the same content out and only the last step differs. */}
        <div
          className={cn(
            'flex flex-col',
            dense ? 'h-[125%] w-[125%] origin-top-left scale-[0.8]' : 'flex-1',
          )}
        >
          {label && <p className="label-sm mb-5 text-tone-faint">{label}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}
