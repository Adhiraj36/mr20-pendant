import { useRef } from 'react'
import { usePrefersReducedMotion, useScrollFrame } from '@/lib/hooks'
import { crossProgress, drawn, pinProgress } from '@/lib/scroll'
import { A_HERO, C_PRODUCT, HERO_HEIGHT_VH, timeline } from './rig'
import { heroAnchorFor } from './heroAnchor'
import { preorderAnchorFor } from './preorderAnchor'
import { storyAnchorFor } from './storyAnchor'

/**
 * The pendant as two still frames.
 *
 * Shown when WebGL is unavailable, when the device is too small to be asked,
 * and whenever the reader has said they do not want motion. It is not a
 * placeholder: it is rendered from the same three.js scene at the same
 * camera states, so the page loses the model's rotation and nothing else —
 * the still is a picture the compositor can move and scale exactly as the
 * canvas moves the model, and it is driven by the same rig.
 *
 * Two frames, not three. The three-quarter view is the one still from the
 * top of the page to the person's chest: the rig's walk-in scales it up and
 * the handoff scales it down, and one picture changing size is continuous.
 * A close-up frame for the walk-in was tried and cross-faded with this one
 * at the same size, and two renders of the same object from two angles,
 * half-and-half, read as two objects — a ghost around the pendant for
 * most of the hero. The final view is a different framing on a different
 * page, and swaps in only once the first has gone.
 *
 * Each poster is a square render whose camera framing matches its state
 * exactly, which is why every one of them is displayed at 100vh square and
 * simply positioned on its state's anchor. Get that invariant wrong and the
 * fallback will not line up with the canvas it replaces.
 */
export function PosterFallback({ mobile }: { mobile: boolean }) {
  const reduced = usePrefersReducedMotion()
  const hero = useRef<HTMLImageElement>(null)
  const product = useRef<HTMLImageElement>(null)

  useScrollFrame((y, vh) => {
    const box = drawn()
    const preorder = crossProgress('preorder', y, vh)
    const rig = timeline({
      hero: pinProgress('hero', y, vh),
      handoff: pinProgress('hero', y, vh),
      story: pinProgress('story', y, vh),
      preorder,
      mobile,
      // Reduced motion gets the hero view and the final view, and no travel
      // between them: a still image that moves is still motion.
      simple: reduced,
      storyAnchor: storyAnchorFor(HERO_HEIGHT_VH),
      heroAnchor: heroAnchorFor(HERO_HEIGHT_VH),
      preorderAnchor: preorderAnchorFor(HERO_HEIGHT_VH),
    })

    const finale = preorder > 0.0005

    /**
     * Positioned by transform alone.
     *
     * Writing `left` and `top` here moved a viewport-sized image on the
     * first frame, which the browser scores as a layout shift — 0.26 of
     * one, most of the page's total. The element is pinned at the centre
     * in CSS and the anchor is expressed as a translation, which the
     * compositor handles and which no shift metric counts.
     */
    const place = (el: HTMLImageElement | null, reference: number, opacity: number) => {
      if (!el) return
      el.style.opacity = String(opacity)
      if (opacity < 0.004) {
        el.style.visibility = 'hidden'
        return
      }
      el.style.visibility = 'visible'
      // Pixels off the layer's own box, not `vw`/`vh`. The square below is
      // cut to that box too, so the still and the canvas are framed by the
      // same rectangle — which on iOS is neither of the two the units name.
      const x = (rig.anchor[0] - 0.5) * box.w
      const y = (rig.anchor[1] - 0.5) * box.h
      el.style.transform =
        `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px))` +
        ` scale(${(rig.scale / reference).toFixed(4)})`
    }

    place(hero.current, A_HERO.scale, finale ? 0 : rig.opacity)
    place(product.current, C_PRODUCT.scale, finale ? rig.opacity : 0)
  })

  /**
   * Pinned at the centre; every state is a translation away from here.
   *
   * `h-full aspect-square`, not `100vh` square: the height is the layer's,
   * whatever the layer turns out to be, and the width follows it. Written
   * as `100vh` the still was cut to a different rectangle than the canvas
   * on iOS, where a fixed layer and `100vh` are eighty pixels apart.
   */
  const common =
    'pointer-events-none absolute top-1/2 left-1/2 aspect-square h-full max-w-none object-contain'
  const rest = { transform: 'translate(-50%, -50%)' }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <img
        ref={hero}
        src="/img/poster-a.webp"
        alt=""
        className={common}
        decoding="async"
        style={rest}
      />
      <img
        ref={product}
        src="/img/poster-c.webp"
        alt=""
        className={common}
        loading="lazy"
        decoding="async"
        style={{ ...rest, opacity: 0, visibility: 'hidden' }}
      />
    </div>
  )
}
