import { useEffect, useRef, useState } from 'react'
import {ButtonAnchor} from '@/components/Button'
import { OrderButtonLink } from '@/order/OrderButton'
import { Eyebrow, Section } from '@/components/Section'
import { HERO } from '@/data/content'
import { depositLabel } from '@/data/pricing'
import { useMedia, usePrefersReducedMotion, useScrollFrame, useStage } from '@/lib/hooks'
import { drawn, pinProgress } from '@/lib/scroll'
import { offsetTopWithin } from '@/lib/utils'
import { setHeroAnchor } from '@/three/heroAnchor'
import { HERO_HEIGHT_VH, A_HERO_MOBILE } from '@/three/rig'

/** Clear air between the object and the type above or below it. */
const HERO_GAP_INSET = 14

/**
 * Clear air between the object and the type beside it.
 *
 * Three times the gap above it, and a tenth of a phone's width. Type with
 * an object alongside reads as crowded long before the two actually touch,
 * and this is the one measurement that buys the separation directly: the
 * object hangs from the right margin, so widening the gap costs size rather
 * than moving the object, and on a short screen it is the width this leaves
 * that decides how big the object may be at all.
 */
const HERO_SIDE_INSET = 40

/**
 * How far the object stops short of the screen's edge.
 *
 * Not the shell's gutter, which is 24 and is where the type stops: the
 * object is not type and the desktop hero already lets it into the margin —
 * at 1440 it sits about 40px from the edge against a 64px gutter. The same
 * licence here is what buys the sentence beside it a wider berth without
 * making the object smaller.
 */
const HERO_EDGE = 16

/**
 * The headline's line boxes: one entry a line, with the right edge that
 * line's type actually reaches.
 *
 * A range over the whole heading rather than the heading's own box, because
 * the box is `max-w-[10ch]` and every line inside it is shorter than that —
 * "hands" reaches a third of the way across. The object is placed against
 * the ink, so the ink is what is measured.
 *
 * Rects on the same line arrive adjacent (the quiet span splits one line
 * into two), so they are merged on their top edge.
 */
function headlineLines(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  const lines: { top: number; bottom: number; right: number }[] = []
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue
    const last = lines[lines.length - 1]
    if (last && Math.abs(r.top - last.top) < 2) {
      last.right = Math.max(last.right, r.right)
      last.bottom = Math.max(last.bottom, r.bottom)
    } else {
      lines.push({ top: r.top, bottom: r.bottom, right: r.right })
    }
  }
  return lines
}

/**
 * The first screen: the object, one sentence, one button.
 *
 * The pendant is not in this file. It is in the fixed canvas behind every
 * section, and this is the type that stands in front of it — which is why
 * there is no image here and no layout holding a space for one.
 *
 * The section is 220vh of runway around a 100vh sticky frame. Scrolling it
 * does one thing: the camera walks in from the whole object to the glass,
 * the sentence leaves, and the material takes its place. That is the entire
 * argument of the hero, made by moving rather than by explaining.
 */
export function Hero() {
  const stage = useStage<HTMLDivElement>('hero')
  const frame = useRef<HTMLDivElement>(null)
  const eyebrow = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const [entered, setEntered] = useState(false)
  const reduced = usePrefersReducedMotion()
  // The same query the canvas asks, so the two agree on which hero this is.
  const mobile = useMedia('(max-width: 639px)')

  useScrollFrame((y, vh) => {
    const el = frame.current
    if (!el) return
    el.style.setProperty('--p', String(pinProgress('hero', y, vh)))

    // ── The object's corner, handed to the rig ──
    //
    // The largest square that fits under the eyebrow, against the right
    // margin, and clear of every line of the headline it reaches down
    // beside. The candidates are the lines' own bottom edges: stopping
    // above the headline gives the object the full width and little
    // height; going down past "Other AI" and "hands" — which reach a third
    // of the way across — costs width and buys much more height. The best
    // of them is usually the second or third line, and on a phone that is
    // an object twice the size of one squeezed into the gap above the
    // type.
    //
    // Measured every frame rather than once: the faces swap in, the
    // headline re-wraps, the browser's bars come and go. Vertical
    // positions come from offsets and horizontal ones from rects, because
    // the entrance's rise and the headline's exit are both translations —
    // an object placed by rect alone would ride up and down with the type
    // it is meant to stand beside.
    if (!mobile || !eyebrow.current || !title.current) return
    const shell = title.current.closest('.shell') as HTMLElement | null
    if (!shell) return

    const frameTop = el.getBoundingClientRect().top
    const top =
      frameTop + offsetTopWithin(eyebrow.current, el) + eyebrow.current.offsetHeight + HERO_GAP_INSET
    const titleTop = frameTop + offsetTopWithin(title.current, el)

    // The box the object is drawn into, which on iOS is not the box the
    // frame around this type was cut to. See `drawn()` in lib/scroll.ts.
    const box = drawn()
    const shellBox = shell.getBoundingClientRect()
    const style = getComputedStyle(shell)
    const left = shellBox.left + parseFloat(style.paddingLeft)
    const right = Math.min(shellBox.right, box.w) - HERO_EDGE

    // Line tops as layout, not as painted: the delta from the heading's own
    // rect survives a translation, its absolute position does not.
    const titleRectTop = title.current.getBoundingClientRect().top
    const lines = headlineLines(title.current).map((line) => ({
      top: titleTop + (line.top - titleRectTop),
      bottom: titleTop + (line.bottom - titleRectTop),
      right: line.right,
    }))

    // Never larger than the size the rig was tuned at, and never wider than
    // the column. What is published is that size in pixels: the canvas and
    // the still do not draw one scale the same, so each converts it with
    // its own figure. See heroAnchorFor.
    const reference = Math.min(A_HERO_MOBILE.scale * HERO_HEIGHT_VH * box.h, right - left)
    let best = 0
    let bestBottom = 0
    for (const bottom of [titleTop - HERO_GAP_INSET, ...lines.map((l) => l.bottom)]) {
      const height = bottom - top
      if (height <= 0) continue
      let edge = left
      for (const line of lines) {
        // Every line that starts above this candidate's floor is a line the
        // object would stand beside, so its ink sets the left limit.
        if (line.top < bottom - 1) edge = Math.max(edge, line.right + HERO_SIDE_INSET)
      }
      const size = Math.min(height, right - edge, reference)
      if (size > best) {
        best = size
        bestBottom = bottom
      }
    }
    if (best <= 0) return

    // Against the right margin, and hung from the top of the space rather
    // than centred in it: centred in a box taller than itself, the object
    // would drift down the screen every time the headline re-wrapped a line
    // longer.
    const centre = bestBottom - top > best ? top + best / 2 : (top + bestBottom) / 2
    setHeroAnchor({
      active: true,
      x: right - best / 2,
      y: centre,
      height: best,
    })
  })

  // A desktop hero publishes nothing; the rig falls back to its table.
  useEffect(() => {
    if (!mobile) setHeroAnchor({ active: false })
    return () => setHeroAnchor({ active: false })
  }, [mobile])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setEntered(true)
      return
    }
    const id = window.setTimeout(() => setEntered(true), 200)
    return () => window.clearTimeout(id)
  }, [])

  const rise = (delay: number) => ({
    transitionDelay: `${delay}ms`,
    opacity: entered ? 1 : 0,
    transform: entered ? 'translateY(0)' : 'translateY(16px)',
  })

  const enter =
    'transition-[opacity,transform] duration-[var(--dur-slow)] ease-[var(--ease-out)] motion-reduce:transition-none'

  return (
    <Section id="product" ground="paper" transparent labelledBy="hero-title">
      {/* Runway and frame in `--svh`, not `vh`: on iOS the toolbar collapses
          partway down this section, and a frame that grew sixty pixels
          while `pinProgress` was still dividing by the old height moved the
          headline out from under the reader. See the unit's note in
          index.css; everywhere else it is exactly `vh`. */}
      <div
        ref={stage}
        className="relative h-[calc(180*var(--svh))] sm:h-[calc(220*var(--svh))]"
      >
        <div
          ref={frame}
          className="sticky top-0 flex h-[calc(100*var(--svh))] flex-col justify-between"
        >
          <div className="shell pt-24 sm:pt-28">
            <div ref={eyebrow} className={enter} style={rise(0)}>
              <Eyebrow>{HERO.eyebrow}</Eyebrow>
            </div>
          </div>

          {/* The object is described for anyone the canvas never reaches. */}
          <p className="sr-only">{HERO.objectDescription}</p>

          <div className="shell relative pb-12 sm:pb-16">
            {/* The sentence and the material caption share this corner: one
                leaves as the other arrives, so the eye never moves. */}
            <div className="relative z-10 grid">
              <div className={`${enter} col-start-1 row-start-1`} style={rise(80)}>
                <div className="hero-lede">
                  {/* Narrower than the 15ch it was on ink. The sentence used
                      to run under the pendant and stay readable because it
                      was light type on a dark object; on paper it has to
                      stop before the object starts.

                      Narrower again at 800 than it was at 500: "Other AI
                      hands" sets 688px wide at the 1440 size, which put its
                      last letter under the pendant's lanyard at every
                      measure above 10.7ch. At 10ch the line breaks a word
                      earlier and the sentence clears the object by about a
                      hundred pixels — measured at 1440, 1280 and 390. */}
                  <h1 ref={title} id="hero-title" className="display-xl max-w-[10ch]">
                    {HERO.headline.one}
                    <br />
                    <span className="text-tone-faint">{HERO.headline.twoQuiet} </span>
                    {HERO.headline.twoLoud}
                  </h1>
                  <p className="body-l mt-5 max-w-[38ch] text-tone-muted">{HERO.sub}</p>
                </div>
              </div>

              {/* The caption takes the sentence's place as the camera
                  reaches the glass. With motion switched off there is no
                  handover to make, so it moves out from under the headline
                  and becomes a line of its own beneath the buttons. */}
              {!reduced && (
                <div
                  aria-hidden="true"
                  className="hero-caption col-start-1 row-start-1 hidden self-end sm:block"
                >
                  <p className="label text-tone-muted">{HERO.caption[0]}</p>
                  <p className="label mt-2 text-tone-faint">{HERO.caption[1]}</p>
                </div>
              )}
            </div>

            <div
              className={`${enter} relative z-10 mt-8 flex flex-col gap-3 sm:flex-row sm:items-center`}
              style={rise(160)}
            >
              <OrderButtonLink plan="act" className="sm:w-auto">
                Preorder · {depositLabel()}
              </OrderButtonLink>
              <ButtonAnchor href="#how" variant="ghost" className="sm:ml-2">
                {HERO.ghost}
              </ButtonAnchor>
            </div>

            {reduced && (
              <p className="label mt-8 text-tone-faint">
                {HERO.caption[0]} · {HERO.caption[1]}
              </p>
            )}
          </div>

          <div
            aria-hidden="true"
            className="hero-cue pointer-events-none absolute inset-x-0 bottom-8 hidden flex-col items-center gap-3 lg:flex"
          >
            <span className="h-10 w-px bg-[linear-gradient(to_bottom,transparent,var(--color-fg-faint))]" />
            <span className="label-sm text-tone-faint">{HERO.scrollCue}</span>
          </div>
        </div>
      </div>
    </Section>
  )
}
