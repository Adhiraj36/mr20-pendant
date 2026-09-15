/**
 * Where the phone hero wants the pendant.
 *
 * The phone hero is the desktop hero in one column: the type down the left,
 * the object up and to the right of it. What the object may occupy is the
 * corner the headline does not — from under the eyebrow to the right margin,
 * and as far down as the short opening lines leave clear — and none of that
 * is a constant. The headline re-wraps, the faces swap in, the browser's
 * bars come and go, and a screen 664px tall (a phone showing its bars) has
 * a hundred pixels less of it than the 844 the rig's fixed anchor was tuned
 * at. Measured there, the object landed on the headline by 84px.
 *
 * So the hero measures that corner and publishes it, the way the story
 * publishes the chest, and the rig sizes and places the object in it. A
 * mutable record read inside requestAnimationFrame, not React state.
 */
import { drawn } from '@/lib/scroll'

export type HeroAnchor = {
  /** The object's centre, in CSS pixels from the left of the screen. */
  x: number
  /** The object's centre, in CSS pixels from the top of the screen. */
  y: number
  /** How tall the object should be drawn, in CSS pixels. */
  height: number
  /** False on a desktop, and before the hero has measured itself. */
  active: boolean
}

const anchor: HeroAnchor = { x: 0, y: 0, height: 0, active: false }

export function setHeroAnchor(next: Partial<HeroAnchor>) {
  Object.assign(anchor, next)
}

/**
 * The measurement as the rig wants it: a scale rather than a height.
 *
 * A height in pixels is the thing the hero actually knows, and it is not
 * one scale — the canvas renders at FOV_MOBILE and the still was rendered
 * at the desktop's, so the same object is a fifth smaller on the canvas at
 * the same scale. Each renderer converts with its own figure (the two
 * `HERO_HEIGHT_VH` constants in rig.ts) and gets the object the hero
 * measured room for.
 *
 * Everything here is pixels for the same reason: the box these are a
 * fraction *of* is the fixed layer's, not the frame's, and on iOS it is
 * neither `100vh` nor `--svh` but the screen as it is this instant. Only
 * `drawn()` knows it. See lib/scroll.ts.
 */
export function heroAnchorFor(figure: number) {
  const { w, h } = drawn()
  return {
    x: w > 0 ? anchor.x / w : 0.5,
    y: h > 0 ? anchor.y / h : 0.5,
    scale: h > 0 ? anchor.height / (figure * h) : 0,
    active: anchor.active && anchor.height > 0,
  }
}
