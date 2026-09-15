import { Suspense, lazy, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { HERO } from '@/data/content'
import { PLANS, money } from '@/data/pricing'
import { A_HERO, B_MATERIAL, C_PRODUCT, type RigState } from '@/three/rig'

const PendantStage = lazy(() => import('@/three/PendantStage'))

/**
 * The still-image renderer. Development only; never routed in a build.
 *
 * The poster fallback has to line up with the canvas it replaces, and the
 * only way to guarantee that is to render it from the same scene at the
 * same camera. This page holds one rig state, centred and frozen, so a
 * screenshot of it is exactly the frame the canvas would have drawn.
 *
 *   npm run dev
 *   open http://localhost:5173/poster?state=a      (b, c, og)
 *
 * Screenshot at 1600 × 1600 at 2× device scale (1200 × 630, 1×, for og) with
 * the page background omitted, put the desk under the transparency, and
 * encode down with the alpha kept — the resize is a supersample, and it is
 * what keeps the silhouette smooth:
 *   node scripts/poster-desk-fill.mjs shot.png
 *   cwebp -resize 1600 1600 -q 90 -alpha_q 100 -exact -m 6 shot.desk.png \
 *     -o public/img/poster-a.webp
 *
 * The ground is transparent, and the colour hiding under that transparency
 * is the desk. Both halves of that matter. A baked-in square was never
 * invisible — on the deployed site it rendered a step lighter than the desk
 * around it — but a square with pure black under its alpha is worse: any
 * renderer that drops the alpha paints a black card behind the pendant,
 * which is what a screenshot leaves there and what `-exact` faithfully
 * keeps. Filled with the desk, the same failure shows nothing. See
 * scripts/poster-desk-fill.mjs. The 100vh square in PosterFallback is
 * unchanged — it is the framing that keeps the still in register with the
 * canvas, not a ground.
 *
 * `og` is the exception and stays on ink: it is composited by other
 * people's link previews rather than by this page, and its headline is
 * absolute light type rather than tone.
 */
export function Poster() {
  const [params] = useSearchParams()
  const which = params.get('state') ?? 'a'
  const [ready, setReady] = useState(false)

  const base: RigState =
    which === 'b' ? B_MATERIAL : which === 'c' ? C_PRODUCT : A_HERO

  // Centred, still, and no contact shadow: the poster is composited on more
  // than one ground, and a baked shadow only belongs on one of them.
  const override: RigState = {
    ...base,
    anchor: which === 'og' ? [0.72, 0.5] : [0.5, 0.5],
    opacity: 1,
    shadow: 0,
    parallax: 0,
  }

  // The body paints the desk. For a still it has to paint nothing, so the
  // screenshot's omitted background is genuinely empty behind the object.
  useEffect(() => {
    if (which === 'og') return
    const html = document.documentElement.style
    const body = document.body.style
    const was = [html.background, body.background]
    html.background = 'transparent'
    body.background = 'transparent'
    return () => {
      html.background = was[0]
      body.background = was[1]
    }
  }, [which])

  return (
    <div
      className={`fixed inset-0 overflow-hidden ${
        which === 'og' ? 'on-ink bg-tone-bg' : 'on-paper'
      }`}
    >
      <Suspense fallback={null}>
        <PendantStage
          mobile={false}
          active
          override={override}
          onOpacity={() => {}}
          onReady={() => setReady(true)}
        />
      </Suspense>

      {which === 'og' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-center p-16">
          <p className="label text-tone-muted">{HERO.eyebrow}</p>
          <h1 className="display-xl mt-6 max-w-[15ch] text-fg">
            {HERO.headline.one}
            <br />
            <span className="text-fg-faint">{HERO.headline.twoQuiet} </span>
            {HERO.headline.twoLoud}
          </h1>
          <p className="label mt-8 text-tone-muted">
            Preorder · from {money(PLANS.capture.price)}
          </p>
        </div>
      )}

      {/* The screenshot script waits for this. */}
      <span data-poster-ready={ready ? 'true' : 'false'} className="sr-only">
        {ready ? 'ready' : 'loading'}
      </span>
    </div>
  )
}
