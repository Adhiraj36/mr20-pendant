/**
 * The daemon's own window, drawn rather than photographed.
 *
 * Not a screenshot, and not because one would be dishonest — the app exists
 * and this is what it looks like. It is drawn because a screenshot of an
 * Electron window is a picture of somebody's desktop at a moment: a theme, a
 * machine name, a port, a font that is not this site's. The site sets its own
 * type in its own two faces, and a photograph would put another product's
 * typography in its hero and go stale the day the app's changed.
 *
 * What is drawn is the Overview screen as `desktop/src/routes/Overview.tsx`
 * builds it, with the rail from `Chrome.tsx` beside it: the same six
 * destinations in the same order, the engine card with its state and the
 * loopback address beneath, and the promises card with its three figures
 * under the labels the app actually gives them. Change a route or a figure
 * there and this drawing is wrong. It is a likeness, and a likeness has to be
 * kept.
 *
 * **Everything is sized in `em`**, off a root font-size that is a percentage
 * of the frame it is drawn into. A window is a fixed layout — it does not
 * reflow at 300px, it gets smaller — so this scales the way a photograph of
 * one would rather than wrapping into a column that no version of the app has
 * ever looked like.
 *
 * The numbers are a sample, and they are small ones. A dashboard boasting
 * four hundred kept promises, on a product that has shipped nothing, is the
 * one thing a drawing like this must not do.
 */

/** The rail, in the order Chrome.tsx lists it. */
const ROUTES = ['Overview', 'Tickets', 'Apps', 'Automations', 'Memory', 'Settings'] as const

/** The three figures the Promises card counts, with the app's own labels. */
const PROMISES: readonly { n: string; label: string; accent?: boolean }[] = [
  { n: '1', label: 'happening now', accent: true },
  { n: '2', label: 'waiting' },
  { n: '9', label: 'kept' },
]

export function DaemonScreen() {
  return (
    <div className="h-full w-full" style={{ containerType: 'inline-size' }}>
      <div
        aria-hidden="true"
        className="flex h-full w-full flex-col text-tone"
        // Two thirds of a percent of the frame per pixel of the design, and
        // clamped at both ends: below the floor the type is a smudge, above
        // the ceiling the window stops looking like a window on a desk.
        style={{ fontSize: 'clamp(4.6px, 2.3cqw, 11px)' }}
      >
        {/* The title bar. On a Mac the app leaves room for the traffic lights
            and puts its own name in mono beside them; that is what this is. */}
        <div className="flex shrink-0 items-center gap-[0.7em] border-b border-tone-line pb-[0.8em]">
          <span className="flex gap-[0.4em]">
            <span className="size-[0.5em] rounded-full bg-tone-faint/70" />
            <span className="size-[0.5em] rounded-full bg-tone-faint/70" />
            <span className="size-[0.5em] rounded-full bg-tone-faint/70" />
          </span>
          <span className="font-mono text-[0.7em] font-medium tracking-[0.32em] text-tone-faint">
            LYZN
          </span>
        </div>

        <div className="flex min-h-0 flex-1 gap-[1.2em] pt-[1.2em]">
          <nav className="flex w-[27%] shrink-0 flex-col gap-[0.55em] border-r border-tone-line pr-[1.2em]">
            {ROUTES.map((route, i) => (
              <span
                key={route}
                className={
                  i === 0
                    ? 'rounded-[0.4em] bg-tone-panel-2 px-[0.6em] py-[0.4em] text-[0.85em] text-tone'
                    : 'px-[0.6em] py-[0.4em] text-[0.85em] text-tone-faint'
                }
              >
                {route}
              </span>
            ))}
            <span className="mt-auto flex items-center gap-[0.6em] px-[0.6em]">
              <span className="size-[0.5em] rounded-full bg-signal" />
              <span className="font-mono text-[0.7em] tracking-[0.14em] text-tone-faint">
                RUNNING
              </span>
            </span>
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-[1em]">
            {/* The engine card: the state, one sentence, where it listens. */}
            <div className="rounded-[0.4em] border border-tone-line bg-tone-panel-2 p-[1.2em]">
              <div className="flex items-center gap-[0.6em]">
                <span className="size-[0.6em] rounded-full bg-signal" />
                <span className="text-[1.1em] font-semibold tracking-[-0.01em] text-tone">
                  Running
                </span>
              </div>
              <p className="mt-[0.7em] text-[0.8em] leading-[1.5] text-tone-muted">
                The engine is up and listening. It does the work you approve and nothing else.
              </p>
              <p className="mt-[0.7em] font-mono text-[0.7em] text-tone-faint">
                Started 4 minutes ago · 127.0.0.1:8787
              </p>
            </div>

            {/* The promises card, which is the reason the engine is running. */}
            <div className="flex-1 rounded-[0.4em] border border-tone-line bg-tone-panel-2 p-[1.2em]">
              <p className="font-mono text-[0.7em] tracking-[0.14em] text-tone-faint">PROMISES</p>
              <div className="mt-[1em] flex items-baseline gap-[2em]">
                {PROMISES.map((figure) => (
                  <span key={figure.label}>
                    <span
                      className={`block font-mono text-[1.5em] leading-none tabular-nums ${
                        figure.accent ? 'text-signal' : 'text-tone'
                      }`}
                    >
                      {figure.n}
                    </span>
                    <span className="mt-[0.5em] block text-[0.75em] text-tone-faint">
                      {figure.label}
                    </span>
                  </span>
                ))}
              </div>
              <span className="mt-[1.2em] inline-block font-mono text-[0.7em] tracking-[0.14em] text-tone-muted underline underline-offset-2">
                SEE THEM
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
