/**
 * The page's one clock.
 *
 * Spec: docs/superpowers/specs/2026-09-04-lyzn-website-design.md §6.4, §12
 *
 * Everything that moves with the scroll — the pendant's camera, the hero
 * type, the five story steps — reads from here. There is one scroll
 * listener, one requestAnimationFrame loop and one damped value, and
 * subscribers pull from it rather than each installing their own listener.
 *
 * Two rules this file exists to enforce:
 *
 *   1. **Nothing hijacks the scroll.** No wheel handlers, no scrollTo. Pins
 *      are `position: sticky`, so the browser keeps its own behaviour and
 *      a trackpad, a keyboard and a screen reader all still work.
 *
 *   2. **Continuous values never touch React.** A scrubbed value changes
 *      sixty times a second; putting it in state would re-render a section
 *      sixty times a second. Subscribers write directly to the DOM (a CSS
 *      custom property) or to a three.js object. React state is only used
 *      for things that change a handful of times, like the active step.
 *
 * Sections register themselves by id so their geometry is measured once
 * rather than read back from the DOM every frame.
 */

/**
 * Damping, expressed as the lerp factor at 60 fps and rescaled per frame.
 *
 * 0.2, not 0.1. A trackpad already smooths its own scroll, and stacking a
 * ten-frame lag on top of that reads as the page floating behind the hand
 * rather than as smoothness. This is enough to swallow the steps of a
 * mouse wheel and no more.
 */
const LERP = 0.2

type Stage = {
  el: HTMLElement
  /** Distance from the top of the document to the top of the element. */
  top: number
  height: number
}

const stages = new Map<string, Stage>()
const subscribers = new Set<(y: number, vh: number) => void>()

let rawY = 0
let dampedY = 0
let viewportH = 0
let viewportW = 0
let running = false
let lastFrame = 0
let reduced = false
let started = false

/**
 * The small viewport height, measured rather than asked for.
 *
 * `window.innerHeight` is the *visual* viewport, and iOS Safari grows it by
 * about sixty pixels the moment its toolbar collapses. Every pinned frame
 * on this site is `100 × var(--svh)` — the height with the toolbar showing,
 * which does not move — so a `pinProgress` divided by `innerHeight` would
 * be scrubbing a frame it disagrees with, and the pinned scene would jump
 * mid-scroll. This probe is one element sized in the same unit the frames
 * are, so the two cannot drift apart by construction.
 *
 * Fixed rather than absolute: an element in flow this tall would lengthen
 * the document whose height it is being used to measure against.
 */
let probe: HTMLElement | null = null

function smallViewportHeight() {
  if (typeof document === 'undefined' || !document.body) return window.innerHeight
  if (!probe) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:calc(100 * var(--svh, 1vh));' +
      'visibility:hidden;pointer-events:none;z-index:-1'
    document.body.appendChild(probe)
  }
  return probe.offsetHeight || window.innerHeight
}

/**
 * The other viewport, and the reason there are two.
 *
 * `--svh` is the height the *frames* are cut to — the screen with the
 * browser's bars showing, which never moves, so a scrubbed pin cannot
 * disagree with the frame it is scrubbing. But the pendant is not in a
 * frame. It is in a fixed layer, and on iOS a fixed layer is none of the
 * things one would guess: not `100vh` (that is the screen with the bars
 * hidden, and is taller), not `--svh` (that is the screen with the bars
 * showing, and is shorter once they collapse), but the screen as it is
 * *right now*, changing under the reader's thumb as the bars come and go.
 *
 * So the probe is not a height at all. It is `position: fixed; inset: 0` —
 * character for character what the canvas layer and the poster layer are —
 * and whatever the browser decides that means, the probe means the same
 * thing by construction. That is the only way to be right about a box the
 * specification and three browsers disagree about.
 *
 * Everything the pendant is placed by measures itself against this, in
 * pixels. Everything scrubbed measures itself against the other. On a
 * desktop they are the same number and none of this is visible.
 */
let drawnProbe: HTMLElement | null = null
let drawnBox: { w: number; h: number } | null = null

function forgetDrawn() {
  drawnBox = null
}

/**
 * The box the fixed pendant layer occupies, in CSS pixels.
 *
 * Cached, because reading it is a layout and this is asked four times a
 * frame by things that are also writing styles. What invalidates it is
 * every event that can change it, the visual viewport's own included —
 * that is the one iOS fires when the bars collapse.
 */
export function drawn() {
  if (typeof document === 'undefined' || !document.body) {
    return { w: window.innerWidth, h: window.innerHeight }
  }
  if (!drawnProbe) {
    drawnProbe = document.createElement('div')
    drawnProbe.setAttribute('aria-hidden', 'true')
    drawnProbe.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;' +
      'visibility:hidden;pointer-events:none;z-index:-1'
    document.body.appendChild(drawnProbe)
    window.addEventListener('resize', forgetDrawn)
    window.addEventListener('orientationchange', forgetDrawn)
    const vv = (window as Window & { visualViewport?: EventTarget }).visualViewport
    vv?.addEventListener('resize', forgetDrawn)
    vv?.addEventListener('scroll', forgetDrawn)
  }
  if (!drawnBox) {
    drawnBox = {
      w: drawnProbe.offsetWidth || window.innerWidth,
      h: drawnProbe.offsetHeight || window.innerHeight,
    }
  }
  return drawnBox
}

function measure() {
  viewportH = smallViewportHeight()
  viewportW = window.innerWidth
  const scrollY = window.scrollY
  for (const stage of stages.values()) {
    const rect = stage.el.getBoundingClientRect()
    stage.top = rect.top + scrollY
    stage.height = rect.height
  }
}

function frame(now: number) {
  const dt = lastFrame ? Math.min(64, now - lastFrame) : 16.667
  lastFrame = now

  if (reduced) {
    dampedY = rawY
  } else {
    // Frame-rate independent: the same visual damping at 60 and at 120 fps.
    const k = 1 - Math.pow(1 - LERP, dt / 16.667)
    dampedY += (rawY - dampedY) * k
    if (Math.abs(rawY - dampedY) < 0.05) dampedY = rawY
  }

  for (const fn of subscribers) fn(dampedY, viewportH)

  if (dampedY === rawY) {
    running = false
    lastFrame = 0
    return
  }
  requestAnimationFrame(frame)
}

function wake() {
  if (running) return
  running = true
  lastFrame = 0
  requestAnimationFrame(frame)
}

function onScroll() {
  rawY = window.scrollY
  // The bars collapse as the reader scrolls, and that changes the box the
  // pendant is drawn into. Cheap: this only drops a cached number.
  forgetDrawn()
  wake()
}

function onResize() {
  measure()
  rawY = window.scrollY
  wake()
}

/** Idempotent: the first stage or subscriber to arrive starts the clock. */
function start() {
  if (started || typeof window === 'undefined') return
  started = true

  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  rawY = window.scrollY
  dampedY = rawY
  measure()

  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)

  // The page grows as fonts swap in and images decode, which moves every
  // stage below them. Watching the document height is cheaper and more
  // reliable than guessing at load events.
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      measure()
      wake()
    }).observe(document.documentElement)
  }
}

export function registerStage(id: string, el: HTMLElement) {
  start()
  stages.set(id, { el, top: 0, height: 0 })
  measure()
  wake()
  return () => {
    stages.delete(id)
  }
}

export function subscribe(fn: (y: number, vh: number) => void) {
  start()
  subscribers.add(fn)
  fn(dampedY, viewportH || window.innerHeight)
  wake()
  return () => {
    subscribers.delete(fn)
  }
}

export function scrollY() {
  return dampedY
}

export function viewport() {
  return { w: viewportW, h: viewportH }
}

export function setReducedMotion(value: boolean) {
  reduced = value
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * How far a pinned stage has travelled: 0 when its top reaches the top of
 * the viewport, 1 when its bottom does. This is the progress a sticky
 * child moves through while it is stuck.
 */
export function pinProgress(id: string, y: number, vh: number) {
  const stage = stages.get(id)
  if (!stage) return 0
  const run = stage.height - vh
  if (run <= 0) return 0
  return clamp01((y - stage.top) / run)
}

/**
 * How far a stage has crossed the viewport: 0 when its top is at the
 * bottom edge, 1 when its bottom has passed the top edge.
 */
export function crossProgress(id: string, y: number, vh: number) {
  const stage = stages.get(id)
  if (!stage) return 0
  const span = vh + stage.height
  if (span <= 0) return 0
  return clamp01((y + vh - stage.top) / span)
}

/** True once a stage exists. Guards the canvas before the page has laid out. */
export function hasStage(id: string) {
  return stages.has(id)
}

/* ─────────────────────────────────────────────────────────────
   Small maths the scrubbed sections share
   ───────────────────────────────────────────────────────────── */

/** Maps a value from one range to another, clamped at both ends. */
export function remap(value: number, inA: number, inB: number, outA = 0, outB = 1) {
  if (inB === inA) return outA
  return outA + (outB - outA) * clamp01((value - inA) / (inB - inA))
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeIn = (t: number) => t * t * t
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
