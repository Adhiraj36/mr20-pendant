import { Link } from 'react-router-dom'
import { wordmark } from '@lyzn/design'
import { InkFooter, InkRow } from '@/components/InkRow'
import { Mark } from '@/components/Mark'
import { CONTACT_EMAIL, FOOTER } from '@/data/content'

/**
 * The end of the page, and no band of its own: the desk runs under the
 * footer as it runs under everything else, and a hairline is enough to
 * say the reading is over.
 */
export function Footer() {
  return (
    <footer className="on-paper relative z-10 border-t border-tone-line">
      <div className="shell flex flex-col gap-6 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-5">
          {/* The hexagon and the name. The name is `wordmark` in
              @lyzn/design, the same the bar sets, and its dots are the ink
              picker here as they are up there — a pointer on the mark turns
              each period into the colour it sets. */}
          <div className="flex items-center gap-2 text-tone">
            <Mark />
            <div className="mark-ink mark">
              <span className="mark-name">{wordmark.name}</span>
              <InkRow id="ink-mark-foot" variant="mark" />
            </div>
          </div>

          {/* The labelled row, for the readers the mark cannot reach.
              A screen with no pointer has no hover, so it has no easter egg
              and the dots up there are inert type; this is what those
              readers change the ink with. Where there is a pointer it is
              hidden, because a labelled picker six inches under a hidden
              one is not a hidden one. */}
          <InkFooter id="ink-footer" className="ink-foot-fallback" />
        </div>

        <nav aria-label="Site" className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <Link to="/privacy" className="label-sm text-tone-faint transition-colors hover:text-tone">
            Privacy
          </Link>
          <Link to="/terms" className="label-sm text-tone-faint transition-colors hover:text-tone">
            Terms
          </Link>
          {CONTACT_EMAIL && (
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="label-sm text-tone-faint transition-colors hover:text-tone"
            >
              {CONTACT_EMAIL}
            </a>
          )}
          <p className="label-sm text-tone-faint">{FOOTER.copyright}</p>
        </nav>
      </div>
    </footer>
  )
}
