import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useCanRender3D, useMedia, useScrollFrame } from '@/lib/hooks'
import { crossProgress, pinProgress } from '@/lib/scroll'
import { PosterFallback } from './PosterFallback'
import { HERO_HEIGHT_VH, timeline } from './rig'
import { heroAnchorFor } from './heroAnchor'
import { preorderAnchorFor } from './preorderAnchor'
import { storyAnchorFor } from './storyAnchor'

/** Everything three.js is on the far side of this import. */
const PendantStage = lazy(() => import('./PendantStage'))

/**
 * The one canvas the landing page has.
 *
 * Fixed behind every section, never mounted on the checkout, and switched
 * off entirely for the four sections in the middle where the pendant is not
 * on screen — `frameloop="never"` genuinely stops the render loop rather
 * than drawing an invisible object sixty times a second.
 *
 * The poster underneath is not a spinner. It is the same object at the same
 * angle, so the moment the model arrives the swap is a change of medium
 * rather than a change of picture, and if the model never arrives the page
 * is still finished.
 */
export function PendantCanvas() {
  const able = useCanRender3D()
  const mobile = useMedia('(max-width: 639px)')

  const [ready, setReady] = useState(false)
  const [idle, setIdle] = useState(false)
  const [active, setActive] = useState(true)
  const activeRef = useRef(true)
  const canvasEl = useRef<HTMLCanvasElement | null>(null)

  // Whether the model is on screen at all. This flips a handful of times in
  // a whole page, so it is allowed to be React state; the opacity it is
  // derived from is not, and never causes a render.
  useScrollFrame((y, vh) => {
    const rig = timeline({
      hero: pinProgress('hero', y, vh),
      handoff: pinProgress('hero', y, vh),
      story: pinProgress('story', y, vh),
      preorder: crossProgress('preorder', y, vh),
      mobile,
      storyAnchor: storyAnchorFor(HERO_HEIGHT_VH),
      // Only `opacity` is read from what comes back here, so the figure
      // this converts with cannot show; it is the still's for consistency
      // with the fallback drawn in the same component.
      heroAnchor: heroAnchorFor(HERO_HEIGHT_VH),
      preorderAnchor: preorderAnchorFor(HERO_HEIGHT_VH),
    })
    const on = rig.opacity > 0.004
    if (on !== activeRef.current) {
      activeRef.current = on
      setActive(on)
    }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-3d', ready ? 'ready' : 'poster')
  }, [ready])

  /**
   * The 3D bundle is a megabyte of JavaScript and about a second of
   * evaluation. The poster is already a complete hero, so none of that
   * belongs on the critical path: the page paints, becomes interactive,
   * and only then is the model fetched and built. Nobody scrolling sees a
   * difference; everybody's first tap happens sooner.
   */
  useEffect(() => {
    const start = () => setIdle(true)
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    }
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(start, { timeout: 2500 })
      return () => (window as unknown as { cancelIdleCallback?: (h: number) => void })
        .cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(start, 1200)
    return () => window.clearTimeout(id)
  }, [])

  const onOpacity = useCallback((value: number) => {
    if (canvasEl.current) canvasEl.current.style.opacity = String(value)
  }, [])

  const onReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasEl.current = canvas
    setReady(true)
  }, [])

  // `able` is null while the capability probe runs, and `idle` is false
  // until the page has settled. The poster covers both gaps, so the hero is
  // never empty on the first frame.
  const showStage = able === true && idle

  return (
    <>
      {showStage && (
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
          <Suspense fallback={null}>
            <PendantStage
              mobile={mobile}
              active={active}
              onOpacity={onOpacity}
              onReady={onReady}
            />
          </Suspense>
        </div>
      )}

      {/* Above the canvas, not below it: the swap is this fading out over a
          model that is already drawn, which is why neither ever flickers. */}
      <div
        className="pointer-events-none fixed inset-0 z-[1] transition-opacity duration-500 ease-[var(--ease-out)]"
        style={{ opacity: ready ? 0 : 1 }}
      >
        <PosterFallback mobile={mobile} />
      </div>
    </>
  )
}
