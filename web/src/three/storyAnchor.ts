/**
 * Where the story wants the pendant.
 *
 * The "how it works" section is a camera panning across a wide scene, and
 * the pendant is the first thing in that scene. But the pendant is not in
 * the DOM — it is in the fixed canvas behind the page — so the section
 * publishes, once a frame, the screen position and size its scene has
 * given the pendant, and the rig places the model there.
 *
 * A mutable record read inside requestAnimationFrame, not React state: it
 * changes sixty times a second while the section is on screen.
 *
 * In pixels, like the other two anchors. The box these are a fraction of
 * belongs to the fixed layer, and on iOS that is neither `100vh` nor
 * `--svh` — see `drawn()` in lib/scroll.ts. Publishing a fraction here
 * meant dividing by the frame's height and multiplying back by the layer's,
 * which is what hung the pendant below the chest it is supposed to be on.
 */
import { drawn } from '@/lib/scroll'

export type StoryAnchor = {
  /** The object's centre, in CSS pixels from the left of the screen. */
  x: number
  /** The object's centre, in CSS pixels from the top of the screen. */
  y: number
  /** How tall the object should be drawn, in CSS pixels. */
  height: number
  /**
   * How visible the scene wants the object to be, 0 to 1.
   *
   * The wide rig never asks for less than 1: it carries the person off the
   * side of the screen and the pendant simply goes with them. The portrait
   * rig carries them off the *top*, past the chapter title, so it fades the
   * figure out there — and the object on that figure's chest has to leave
   * at the same moment, or the reader watches a pendant float up over a
   * headline on its own.
   */
  opacity: number
  /** False while the stacked version is showing, or before the section mounts. */
  active: boolean
}

const anchor: StoryAnchor = { x: 0, y: 0, height: 0, opacity: 1, active: false }

export function setStoryAnchor(next: Partial<StoryAnchor>) {
  Object.assign(anchor, next)
}

/** The measurement as the rig wants it. See `heroAnchorFor` for the figure. */
export function storyAnchorFor(figure: number) {
  const { w, h } = drawn()
  return {
    x: w > 0 ? anchor.x / w : 0.5,
    y: h > 0 ? anchor.y / h : 0.5,
    scale: h > 0 ? anchor.height / (figure * h) : 0,
    opacity: anchor.opacity,
    active: anchor.active && anchor.height > 0,
  }
}
