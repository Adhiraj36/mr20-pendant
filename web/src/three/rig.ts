/**
 * Where the pendant is, at any point on the page.
 *
 * Spec: docs/superpowers/specs/2026-09-04-lyzn-website-design.md §6.3, §6.4
 *
 * The model never spins. It has four resting places — the hero
 * three-quarter, a macro on the glass, a small anchor beside the story, and
 * a final full view — and the scroll moves the camera between them. This
 * file is the table of those places and the maths that mixes two of them.
 * It knows nothing about React or three.js so the numbers can be read, and
 * argued with, on their own.
 *
 * ── Orientation ──
 * +Z is the front: the flat glass panel with the microphone opening.
 * `Pendant_Glass` occupies the highest Z in the export, which is how this
 * was settled — from the mesh bounds, never by eye. Positive yaw turns the
 * model's −X side, the button edge, toward the camera.
 *
 * ── Sizes ──
 * The model is normalised so its longest edge is TARGET_SIZE world units.
 * A state's on-screen height is then
 *     TARGET_SIZE × scale ÷ (2 · distance · tan(fov / 2))
 * as a fraction of the viewport height, which is what the `heightVh` note
 * on each state records. Change a distance and that note is a lie; check it.
 */

export const TARGET_SIZE = 1.9

export const FOV_DESKTOP = 26
export const FOV_MOBILE = 32

export type Vec3 = [number, number, number]

export type RigState = {
  /** Camera position before the screen-anchor offset is applied. */
  cam: Vec3
  /** What the camera looks at. */
  target: Vec3
  /** Radians about Y. Positive turns the button edge toward the camera. */
  yaw: number
  /** Radians about X. */
  pitch: number
  scale: number
  /** Where the model's centre lands, as fractions of the viewport. */
  anchor: [number, number]
  /** Canvas opacity, 0 to 1. Applied to the element, not the material. */
  opacity: number
  /** Contact shadow strength, 0 to 1. */
  shadow: number
  /** How much cursor parallax this state accepts. */
  parallax: number
}

/** Front three-quarter. The silhouette, the button edge, the chamfer. ~64vh. */
export const A_HERO: RigState = {
  cam: [0.35, 0.2, 6.4],
  target: [0, 0, 0],
  yaw: 0.28,
  pitch: -0.1,
  scale: 1,
  // Up and to the right of centre, which is what keeps the object clear of
  // the headline's corner. On ink the two could overlap — light type over a
  // dark pendant stayed legible — but on paper both are dark, and the only
  // fix that does not put a visible panel over the object is to not stack
  // them in the first place. The poster fallback reads this same anchor, so
  // it follows without being re-rendered.
  anchor: [0.775, 0.42],
  opacity: 1,
  shadow: 1,
  parallax: 0,
}

/**
 * The close-up: the glass, its edge, the lip and the microphone opening,
 * tilted up toward the key light so the surfaces separate.
 *
 * Whole, not cropped. The first version pushed the camera in until the
 * object was half again the height of the screen, which reads as "too big"
 * rather than "closer" — the eye has nothing to hold on to once the
 * silhouette is gone. At 4.7 units the pendant fills about 88% of the
 * viewport height and every edge is still on screen.
 */
export const B_MATERIAL: RigState = {
  cam: [0.45, 0.95, 4.75],
  target: [0, 0.25, 0.15],
  yaw: 0.3,
  pitch: -0.22,
  scale: 1,
  anchor: [0.56, 0.5],
  opacity: 1,
  shadow: 0,
  parallax: 0,
}

/**
 * On a phone "closer" cannot mean "bigger": the object is square and the
 * screen is narrow, so the hero is already as wide as it can be. The
 * material read comes from the tilt instead — the same size, turned
 * further toward the light.
 */
export const B_MATERIAL_MOBILE: RigState = {
  ...B_MATERIAL,
  cam: [0.35, 0.6, 6.2],
  target: [0, 0.15, 0.1],
  yaw: 0.32,
  pitch: -0.3,
  scale: 0.72,
  anchor: [0.5, 0.3],
}

/**
 * On a phone the pendant takes the top of the screen and the headline sits
 * under it, so the hero is centred and high rather than offset right.
 *
 * Scaled down because on a phone the binding constraint is width, not
 * height: the pendant is square, and at the desktop scale a 52vh-tall
 * object is 440px across on a 390px screen — cropped on both sides.
 */
export const A_HERO_MOBILE: RigState = {
  ...A_HERO,
  /*
   * Sized to the gap, not to the screen.
   *
   * A phone hero is one column: the eyebrow, then the object, then a
   * five-line headline, a sub-line and two buttons. The object's whole
   * allowance is the space between the eyebrow's baseline and the top of
   * the headline, and at 390 that space is about 260px. 0.56 drew the
   * object 306px tall and it landed on "Other AI" — measured at 39px of
   * overlap — while its top edge sat 7px into the eyebrow.
   *
   * 0.45 draws it 246px at 390 and 272px at 430. At 390 — the tighter of
   * the two, and the one that failed — it clears the eyebrow by 17px and
   * the headline by 16; at 430 by 31 and 66. The anchor moves down a hair
   * with it, because the object is being centred in that gap rather than
   * placed at a fixed height. The headline's clamp floor comes down four
   * points at the same time, which is where a third of that room came from.
   *
   * Measured against the poster, which is the larger of the two things
   * that draw this object and the one most phones actually get:
   * `useCanRender3D` refuses four cores or four gigabytes. The model, at
   * FOV_MOBILE, comes out a fifth smaller again and clears by more.
   *
   * The scale and the anchor here are the ceiling and the fallback only:
   * the phone hero measures the corner its headline leaves and publishes
   * it, and the rig puts the object there. See heroAnchor.ts.
   */
  scale: 0.45,
  anchor: [0.5, 0.2975],
  /*
   * No contact shadow, unlike the desktop hero.
   *
   * The shadow is a horizontal plane under the model, and a plane is only
   * a soft pool while the camera looks down on it. The phone's object sits
   * high in its corner, which the camera reaches by panning up — and from
   * there the plane is edge-on: a hard line straight across the screen a
   * line-height below the object, lying over the headline. There is
   * nothing under a pendant held at the top corner of a page for it to
   * fall onto anyway.
   */
  shadow: 0,
}

/**
 * The model's on-screen height at scale 1, as a fraction of the viewport
 * height — TARGET_SIZE ÷ (2 · distance · tan(fov / 2)) at A_HERO's camera,
 * which is the `heightVh` note at the top of this file, evaluated.
 *
 * Anything that wants the pendant a particular number of pixels tall — the
 * story scene, which places it on a drawn chest — divides by this to get
 * the rig scale that produces it. The two differ because a phone renders
 * at FOV_MOBILE, and a scene that used the desktop figure on a phone would
 * hand the canvas a pendant a fifth too small for the cord it hangs on.
 */
export const HERO_HEIGHT_VH = 0.643
export const HERO_HEIGHT_VH_MOBILE = 0.5175

/**
 * Small, on the chest of the person in the story. ~29vh at rest; the scene
 * overrides scale and anchor every frame.
 *
 * Yawed slightly away from the camera. The camera reaches the anchor by
 * panning in its own plane, and an object that far left of the optical axis
 * shows its near side — the button edge — as if it were turned. A pendant
 * on a chest hangs flat, so this turns it back by about the same amount.
 */
export const ANCHOR: RigState = {
  cam: [0, 0, 6.4],
  target: [0, 0, 0],
  yaw: -0.16,
  pitch: -0.06,
  scale: 0.45,
  anchor: [0.17, 0.36],
  opacity: 1,
  shadow: 0,
  parallax: 0,
}

/** Off-screen and switched off. */
export const HIDDEN: RigState = {
  ...ANCHOR,
  anchor: [-0.4, 0.5],
  opacity: 0,
  shadow: 0,
  parallax: 0,
}

/**
 * The complete object again, mirrored from the hero so the clean +X edge is
 * the one seen this time.
 *
 * Deviation from the spec table, noted rather than hidden: scale is 0.62,
 * not 1.00, which renders about 42vh rather than the 54vh the section's
 * prose asks for. Measured on a 900px-tall viewport, 54vh plus a Display
 * XL headline, a sub-line and two buttons does not fit in one screen: the
 * object is cropped by the nav at the top and the headline lands across
 * its lower third. This is the largest the pendant can be and still be a
 * whole object with the ask underneath it.
 */
export const C_PRODUCT: RigState = {
  cam: [-0.35, 0.15, 6.2],
  target: [0, 0, 0],
  yaw: -0.3,
  pitch: -0.08,
  scale: 0.62,
  // Higher than the middle: the headline, its line and two buttons live
  // under this, and an object centred at 0.42 lands on top of all three.
  anchor: [0.5, 0.27],
  opacity: 1,
  shadow: 1,
  parallax: 1,
}

/**
 * On a phone the ask stacks: a headline, its line, and two buttons one
 * under the other, and the block starts a little above the middle of the
 * screen. The object lives in the band above it — a third of the screen
 * tall, centred at a quarter — so nothing is read through a dark render.
 * Measured at 390×844 and 430×932; on a 667 screen the block starts
 * around 0.48 and the object ends at 0.43.
 */
export const C_PRODUCT_MOBILE: RigState = {
  ...C_PRODUCT,
  scale: 0.5,
  anchor: [0.5, 0.26],
  parallax: 0,
  /* Edge-on here too, and lying over the ask. See A_HERO_MOBILE. */
  shadow: 0,
}

/**
 * Where the final view enters from: smaller, lower, not yet visible.
 *
 * `drop` is how far below its place it starts, in viewport heights. It is
 * the rise-in for an object placed against the viewport; an object placed
 * against its section already arrives with the scroll, and a drop on top
 * of that would carry it down onto the headline it is meant to sit above.
 */
export function cEnter(product: RigState, drop = 0.18): RigState {
  return {
    ...product,
    scale: product.scale * 0.85,
    anchor: [product.anchor[0], product.anchor[1] + drop],
    opacity: 0,
    shadow: 0,
    parallax: 0,
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function mixNumber(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function mixVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [mixNumber(a[0], b[0], t), mixNumber(a[1], b[1], t), mixNumber(a[2], b[2], t)]
}

/** Interpolates the short way round, so a turn never takes the long path. */
function mixAngle(a: number, b: number, t: number) {
  let delta = (b - a) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return a + delta * t
}

export function mixStates(a: RigState, b: RigState, t: number): RigState {
  const k = clamp01(t)
  if (k <= 0) return a
  if (k >= 1) return b
  return {
    cam: mixVec(a.cam, b.cam, k),
    target: mixVec(a.target, b.target, k),
    yaw: mixAngle(a.yaw, b.yaw, k),
    pitch: mixNumber(a.pitch, b.pitch, k),
    scale: mixNumber(a.scale, b.scale, k),
    anchor: [
      mixNumber(a.anchor[0], b.anchor[0], k),
      mixNumber(a.anchor[1], b.anchor[1], k),
    ],
    opacity: mixNumber(a.opacity, b.opacity, k),
    shadow: mixNumber(a.shadow, b.shadow, k),
    parallax: mixNumber(a.parallax, b.parallax, k),
  }
}

export type TimelineInput = {
  /** Pinned progress of the hero stage. */
  hero: number
  /**
   * The hero's tail, and the one thing that carries the pendant out of the
   * hero and into the story. It used to be the cross progress of the "what
   * it does" section, which sat between the two; with that section gone the
   * hero hands straight to the story, so the travel is driven by the end of
   * the hero's own runway rather than by a section that no longer exists.
   */
  handoff: number
  /** Pinned progress of the story stage. */
  story: number
  /** Cross progress of the final preorder stage. */
  preorder: number
  mobile: boolean
  /**
   * Reduced motion: the hero view and the final view, and no travel
   * between them. The poster fallback passes this only when the reader
   * asked for less motion; otherwise it travels like the canvas.
   */
  simple?: boolean
  /** Where the story's scene has put the pendant this frame, if it has. */
  storyAnchor?: { x: number; y: number; scale: number; opacity?: number; active: boolean }
  /**
   * Where the phone hero has room for the pendant this frame, if it has
   * measured. Only the phone publishes one; a desktop hero is A_HERO.
   */
  heroAnchor?: { x: number; y: number; scale: number; active: boolean }
  /**
   * Where the preorder section has room for the pendant this frame, if it
   * has measured: the band between the bar and its headline. The final
   * view used to be placed against the viewport on the assumption that the
   * ask was at the bottom of it — and once the footer scrolls in under the
   * section, or the screen is shorter than the one it was tuned on, it is
   * not. Measured, the object rides the section and stays above the line.
   */
  preorderAnchor?: { y: number; scale: number; fade: number; active: boolean }
}

const remap = (v: number, a: number, b: number) => clamp01((v - a) / (b - a || 1))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeIn = (t: number) => t * t * t
/**
 * Smoothstep. Gentler through the middle than a cubic in-out, which is what
 * the hero dolly needs: the cubic spent its whole travel in the middle
 * third of the runway and sat still either side of it, so the object
 * appeared to lurch toward the reader and then stop.
 */
const smooth = (t: number) => t * t * (3 - 2 * t)

/**
 * The whole page as one state.
 *
 * Written as a chain of mixes rather than a switch: each link only starts
 * once the one before it has finished, because the stages are sequential
 * down the page. Scrolling back up unwinds it exactly, which a switch on
 * "which section am I in" does not.
 */
export function timeline(input: TimelineInput): RigState {
  // The phone hero is sized and placed by the hero itself: the corner the
  // headline leaves it, measured, rather than a fraction of a screen the
  // rig has guessed the height of.
  //
  // The close-up keeps its proportion to that — 1.6×, which is what the two
  // constants are at the size they were tuned at — so a shorter screen gets
  // a smaller close-up rather than one cropped by the eyebrow. It is also
  // the one state that leaves the corner: it walks in to the middle of the
  // screen as it grows, which the sentence has faded out of by then.
  const ha = input.mobile && input.heroAnchor?.active ? input.heroAnchor : null
  const hero = ha
    ? { ...A_HERO_MOBILE, anchor: [ha.x, ha.y] as [number, number], scale: ha.scale }
    : input.mobile
      ? A_HERO_MOBILE
      : A_HERO
  const material = ha
    ? { ...B_MATERIAL_MOBILE, scale: ha.scale * 1.6 }
    : input.mobile
      ? B_MATERIAL_MOBILE
      : B_MATERIAL
  const pa = input.preorderAnchor?.active ? input.preorderAnchor : null
  const productAt = input.mobile ? C_PRODUCT_MOBILE : C_PRODUCT
  const product = pa ? { ...productAt, anchor: [0.5, pa.y] as [number, number], scale: pa.scale } : productAt

  // The final view is an entrance, not a continuation of the chain: the
  // model has been off-screen for four sections, so it fades up in place
  // rather than sliding in from wherever it was left.
  // Starts once the section is a third of the way across the viewport, not
  // the moment its top edge clears the bottom. Every section is transparent
  // now, so an entrance that began at first contact faded the object in
  // behind the pricing cards above it — a ghost where the opaque band used
  // to hide one.
  if (input.preorder > 0.3) {
    const t = easeOut(remap(input.preorder, 0.3, 0.62))
    // Copied: mixStates hands back `product` itself at the end of the mix,
    // and that may be a shared constant.
    const state = { ...mixStates(cEnter(product, pa ? 0 : 0.18), product, t) }
    // Two fades, and they are different questions: the first is the
    // entrance, the second is whether the section still has room to show
    // the object at all.
    state.opacity = remap(input.preorder, 0.3, 0.46) * (pa ? pa.fade : 1)
    return state
  }

  let state = hero
  // The whole runway, from the first pixel of scroll: movement that starts
  // the moment the page does is what makes a scrubbed camera feel attached
  // to the hand rather than triggered by it.
  state = mixStates(state, material, smooth(remap(input.hero, 0, 0.7)))

  if (input.simple) {
    // Reduced motion only: the hero view and the final view, and no travel
    // between them — the story is static cards there, with a still of its
    // own on the chest. Every other reader, canvas or poster, takes the
    // journey below: the poster is a picture the compositor can move and
    // scale exactly as the canvas moves the model, so a phone that cannot
    // run WebGL — most of them — sees the same pendant leave the hero and
    // land on the person, not a fade and a swap.
    return mixStates(state, HIDDEN, easeIn(remap(input.handoff, 0.72, 1)))
  }

  // The story decides where the pendant sits while it is on screen: its
  // scene pans, and the object has to pan with it.
  const sa = input.storyAnchor
  const anchor: RigState = sa?.active
    ? { ...ANCHOR, anchor: [sa.x, sa.y], scale: sa.scale, opacity: sa.opacity ?? 1 }
    : ANCHOR
  // The travel is the last stretch of the hero's own runway: the close-up
  // is held, the material caption is read, and then the object leaves the
  // hero for the person who is about to wear it. Smoothstep rather than
  // ease-out, so it departs as gently as it arrives — this is the one
  // journey on the page the reader is meant to watch, not a cut.
  //
  // The object stays lit the whole way. It used to go dark for the section
  // that sat between the hero and the story; with that section gone there
  // is nothing to travel through, and a pendant that dims mid-flight reads
  // as a glitch rather than a handover.
  state = mixStates(state, anchor, smooth(remap(input.handoff, 0.72, 1)))

  // The last 30vh of a 500vh stage, whose pinned run is 400vh.
  state = mixStates(state, HIDDEN, easeIn(remap(input.story, 0.925, 1)))
  return state
}

/** Idle drift. Never a spin — just enough that the object is not a photograph. */
export function idle(time: number) {
  return {
    float: Math.sin(time * ((Math.PI * 2) / 6)) * 0.02,
    yaw: Math.sin(time * ((Math.PI * 2) / 9)) * 0.03,
  }
}
