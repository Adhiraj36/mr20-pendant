/**
 * Where the preorder section wants the pendant.
 *
 * The final view is the object with the ask under it. The rig placed it at
 * a fixed height of the viewport, tuned on a 900px screen with the section's
 * bottom at the fold — and the section does not stay there: the footer
 * scrolls in under it and pushes the headline up into the object, and a
 * shorter screen starts the headline higher than the object ends. So the
 * section publishes, every frame, the band between the bar and its headline
 * as it actually is, and the rig sizes the object to that band and rides
 * the section with it.
 *
 * A mutable record read inside requestAnimationFrame, not React state.
 */
import { drawn } from '@/lib/scroll'

export type PreorderAnchor = {
  /** The object's centre, in CSS pixels from the top of the screen. */
  y: number
  /** How tall the object should be drawn, in CSS pixels. */
  height: number
  /**
   * How much of the object the room still justifies, 0 to 1.
   *
   * The section rides up as the footer arrives, and on a short screen its
   * headline ends up against the bar with the whole object above the top of
   * the window. An object cropped in half by the nav is worse than no
   * object, and by then the reader is at the footer and looking at the ask.
   * So it leaves: full while most of the band is still there, gone by the
   * time the band is under half the object.
   */
  fade: number
  /** False until the section has measured itself. */
  active: boolean
}

const anchor: PreorderAnchor = { y: 0, height: 0, fade: 1, active: false }

export function setPreorderAnchor(next: Partial<PreorderAnchor>) {
  Object.assign(anchor, next)
}

/** The measurement as a rig scale. See `heroAnchorFor` for why it is not one. */
export function preorderAnchorFor(figure: number) {
  const { h } = drawn()
  return {
    y: h > 0 ? anchor.y / h : 0.5,
    scale: h > 0 ? anchor.height / (figure * h) : 0,
    fade: anchor.fade,
    active: anchor.active && anchor.height > 0,
  }
}
