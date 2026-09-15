import { useEffect, useRef } from 'react'
import { OrderButtonLink } from '@/order/OrderButton'
import { ButtonAnchor } from '@/components/Button'
import { Reveal } from '@/components/Reveal'
import { Section } from '@/components/Section'
import { PREORDER } from '@/data/content'
import { PLANS, depositLabel, money } from '@/data/pricing'
import { useMedia, useScrollFrame, useStage } from '@/lib/hooks'
import { drawn } from '@/lib/scroll'
import { offsetTopWithin } from '@/lib/utils'
import { setPreorderAnchor } from '@/three/preorderAnchor'
import { C_PRODUCT, C_PRODUCT_MOBILE, HERO_HEIGHT_VH } from '@/three/rig'

/** The bar, and the clear air under it and over the headline. */
const NAV_H = 64
const GAP_INSET = 14

/**
 * The object, one last time, and the ask.
 *
 * The pendant comes back for this and nothing else is on the screen. After
 * two paper sections of facts and prices, the last thing the reader looks
 * at should be the thing they would own.
 *
 * The object is in the fixed canvas, not in this section, so the section
 * tells the rig where its headline is every frame and the rig keeps the
 * object above it — through the footer arriving underneath, and on a
 * screen too short for the tuned height. See preorderAnchor.ts.
 */
export function Preorder() {
  const stage = useStage<HTMLDivElement>('preorder')
  const title = useRef<HTMLHeadingElement>(null)
  // The same query the canvas asks, so the reference size is the rig's own.
  const mobile = useMedia('(max-width: 639px)')

  useScrollFrame(() => {
    const el = stage.current
    if (!el || !title.current) return
    // The drawn box, not the frame's — see `drawn()` in lib/scroll.ts.
    const { h: vh, w: vw } = drawn()
    // The headline's top by layout, not by rect: its entrance is a rise.
    const offset = offsetTopWithin(title.current, el)
    const headlineTop = el.getBoundingClientRect().top + offset

    // Sized where the section rests — its bottom on the fold — and not
    // where it happens to be this frame: sized live, the object shrank to
    // a dot as the footer carried the headline up under the bar. The band
    // is the bar to the headline at rest; the object is as tall as the
    // band allows, never taller than the tuned size, and then rides the
    // headline wherever the scroll takes it.
    const restTop = vh - (el.offsetHeight - offset)
    const band = restTop - GAP_INSET - (NAV_H + GAP_INSET)
    if (band <= 0) return

    // Never larger than the size the rig was tuned at. What is published is
    // that size in pixels, which each renderer converts with its own figure
    // — see heroAnchorFor.
    const reference = (mobile ? C_PRODUCT_MOBILE : C_PRODUCT).scale * HERO_HEIGHT_VH * vh
    const height = Math.min(reference, band, vw - 48)
    // Sat on the headline rather than centred in the band: centred, the
    // object would move at half the section's speed while the band is
    // taller than it, and the two would visibly drift apart.
    // What is left of that band now, against what the object needs. The
    // object holds its size and its place on the headline and simply goes
    // when the room does; see the note on `fade`.
    const room = (headlineTop - GAP_INSET - (NAV_H + GAP_INSET)) / height
    setPreorderAnchor({
      active: true,
      y: headlineTop - GAP_INSET - height / 2,
      height,
      fade: Math.max(0, Math.min(1, (room - 0.45) / 0.35)),
    })
  })

  useEffect(() => () => setPreorderAnchor({ active: false }), [])

  return (
    <Section ground="paper" transparent labelledBy="preorder-title">
      {/* Positioned, so the headline's offset chain ends here and not at the
          section — the measurement above is relative to this element. */}
      <div ref={stage} className="relative flex min-h-screen flex-col justify-end pb-[12vh]">
        <div className="shell text-center">
          <Reveal>
            <h2 ref={title} id="preorder-title" className="display-xl mx-auto max-w-[14ch]">
              {PREORDER.headline}
            </h2>
            <p className="body-l mx-auto mt-5 max-w-[36ch] text-tone-muted">{PREORDER.sub}</p>
          </Reveal>

          <Reveal delay={120}>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <OrderButtonLink plan="act" className="w-full sm:w-auto">
                Reserve Act · {depositLabel()}
              </OrderButtonLink>
              {/* The tiers are a section of this page, not a route. */}
              <ButtonAnchor href="#pricing" variant="ghost" className="sm:ml-2">
                All tiers · from {money(PLANS.capture.price)}
              </ButtonAnchor>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  )
}
