import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Paperclip } from 'lucide-react'
import { LaptopFrame } from '@/components/Frames'
import { Person } from '@/components/Person'
import { Receipt } from '@/components/Receipt'
import { Eyebrow, Section } from '@/components/Section'
import {
  SpokenLine,
  Stage,
  StatusBlock,
  SummaryCard,
  TaskRow,
  TranscriptLine,
} from '@/components/Stage'
import {
  LAPTOP_LINES,
  SLIPS,
  SPOKEN,
  STORY_CAPTION,
  STORY_EYEBROW,
  STORY_RECEIPT,
  STORY_STEPS,
  SUMMARY,
  TASKS,
  TRANSCRIPT,
  WHATSAPP,
} from '@/data/content'
import { useMedia, usePrefersReducedMotion, useScrollFrame, useStage } from '@/lib/hooks'
import { drawn, pinProgress } from '@/lib/scroll'
import { cn } from '@/lib/utils'
import { setStoryAnchor } from '@/three/storyAnchor'

/* ─────────────────────────────────────────────────────────────
   The scene, in its own units.

   A strip 3200 wide and 720 tall, laid out left to right in the order
   the promise travels: the person who made it, their phone, their
   laptop, and Ravi's phone — then the receipt. It is scaled to fit the
   viewport and the camera pans along it. Everything below is a position
   on that strip.
   ───────────────────────────────────────────────────────────── */

/**
 * The "Speaking" label, wherever the reader is at station 1: a red dot that
 * blinks like a recorder's, and the word itself in pink — neither is a site
 * token, both stand in for a live-recording convention nothing else on the
 * page needs. Every other station's label (Transcript, Task, Drafting,
 * Delivered, Done) stays the tone it always was; this wraps only the one.
 */
function Speaking({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-[#ff3b30] motion-safe:animate-pulse"
      />
      <span style={{ color: '#ec4899' }}>{children}</span>
    </span>
  )
}

const CAM_W = 3200
const CAM_H = 720

/** On the figure's chest: the cord in Person.tsx ends where this begins. */
const PENDANT = { x: 270, y: 458 }
const SPEECH = { x: 440, y: 150, w: 760 }
const PHONE = { x: 1000, y: 100, w: 340, h: 540 }
const LAPTOP = { x: 1620, y: 130, w: 640, h: 440 }
const WA = { x: 2440, y: 100, w: 340, h: 540 }
const RECEIPT = { x: 2820, y: 140, w: 300 }

const cx = (b: { x: number; w: number }) => b.x + b.w / 2
const LAST = (WA.x + RECEIPT.x + RECEIPT.w) / 2

/** Three flights. Each slip leaves the station that printed it. */
const FLY_A = { from: { x: 600, y: 300 }, to: { x: cx(PHONE), y: 330 } }
const FLY_B = { from: { x: cx(PHONE), y: 520 }, to: { x: cx(LAPTOP), y: 300 } }
const FLY_C = { from: { x: cx(LAPTOP), y: 470 }, to: { x: cx(WA), y: 330 } }

/** Camera keyframes: [progress, centre x]. Held at each station, then panned. */
const CAM: [number, number][] = [
  [0, 640],
  [0.18, 640],
  [0.28, cx(PHONE)],
  [0.48, cx(PHONE)],
  [0.56, cx(LAPTOP)],
  [0.72, cx(LAPTOP)],
  [0.8, LAST],
  [1, LAST],
]

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const outCubic = (t: number) => 1 - Math.pow(1 - t, 3)

function camX(p: number) {
  for (let i = 0; i < CAM.length - 1; i++) {
    const [p0, x0] = CAM[i]!
    const [p1, x1] = CAM[i + 1]!
    if (p <= p1) return lerp(x0, x1, inOut(seg(p, p0, p1)))
  }
  return CAM[CAM.length - 1]![1]
}

/* ─────────────────────────────────────────────────────────────
   The same scene, stood on end.

   A phone has no width to pan across and a great deal of height, so the
   portrait rig lays the identical five stations out top to bottom — the
   person, their phone, their laptop, Ravi's phone, the receipt — on a strip
   360 wide, and pans the camera *down* it. Every window below is the one
   the wide rig uses: both cameras are driven by the same `pinProgress`, so
   the two rigs reach every beat at the same point in the scroll and only
   the axis is different.

   The units are phone-native. The strip is about the width of the screen it
   is read on, which means the drawn phone is the size of a phone, the type
   inside it is the size type is in an app, and nothing is a thumbnail of
   something meant to be seen larger.
   ───────────────────────────────────────────────────────────── */

const STRIP_W = 360

/**
 * The figure, at 73% of the scene's own units and cut at the waist — the
 * same 410 × 520 window the reduced-motion panel uses, and for the same
 * reason: below that the drawing is two shoulder lines running off the
 * bottom of the page, and here the spoken line has to go somewhere.
 *
 * 300 and not 320, which was drawn first and looked better on its own: the
 * figure and the sentence are one station, and at 320 that station was
 * 530 units tall in a band of 592, which left it two pixels clear of the
 * fade at the top and none at the bottom. A drawing whose crown dissolves
 * is worse than a drawing 6% smaller.
 */
const FIG = 300 / 410
const PERSON_P = { x: 30, y: 0, w: 300, h: 520 * FIG }
/** The cord in Person.tsx ends here, converted out of the scene's units. */
const PENDANT_P = { x: 30 + (270 - 60) * FIG, y: (458 - 40) * FIG }
/** The crown of the head. The drawing's box starts above its own ink. */
const HEAD_TOP = (84 - 40) * FIG
/** 52 scene-px on the wide rig; the same pendant on the same chest. */
const PEND_P = 52 * FIG
/**
 * What was said, under the figure who said it rather than beside them.
 *
 * The height is measured, not set: the eyebrow, the speaker's initial and
 * four lines of 30px come to 128 strip units at every width, because the
 * strip is in its own units. The camera needs it to know where the first
 * station ends.
 */
const SPEECH_P = { x: 12, y: 412, w: 336, h: 128 }
/** Both phones at their drawn size, 340 × 540. A phone, on a phone. */
const PHONE_P = { x: 10, y: 700, w: 340, h: 540 }
const LAPTOP_P = { x: 0, y: 1400, w: 360, h: 248 }
const WA_P = { x: 10, y: 1780, w: 340, h: 540 }
const RECEIPT_P = { x: 30, y: 2440, w: 300, h: 400 }
const STRIP_H = 2900

/** The chapter title above the scene and the caption and rail below it. */
const TOP_UI = 190
const BOT_UI = 62
/**
 * The band's own edges.
 *
 * The wide rig needs none of this: a station it has finished with leaves at
 * the side of the screen, and the screen edge does the cutting. A strip has
 * no such edge to leave by — everything travels up through the chapter
 * title and down past the caption — so the band the scene lives in fades
 * its own top and bottom, and a station on its way out dissolves at exactly
 * the line where the type begins. It is the frame edge, drawn.
 */
const BAND_FADE = 30
const BAND_MASK =
  `linear-gradient(to bottom, transparent, #000 ${BAND_FADE}px,` +
  ` #000 calc(100% - ${BAND_FADE}px), transparent)`
/**
 * The tallest station, plus both fades: what the band has to be able to
 * hold. That is the figure and their sentence — 508 units from the crown
 * of the head to the last line of what was said — and neither end of it
 * may sit in a fade.
 */
const STATION_H = 572

const cyP = (b: { y: number; h: number }) => b.y + b.h / 2
/**
 * The person and their sentence are one station; the camera holds on both.
 * Centred on the ink rather than on the boxes, because the drawing's box
 * carries 32 units of nothing above the head.
 */
const STATION_1 = (PERSON_P.y + HEAD_TOP + SPEECH_P.y + SPEECH_P.h) / 2

/**
 * The three flights, down the strip.
 *
 * Each lands where the wide rig lands it — the same fraction into the same
 * station — so a slip still arrives on the transcript rather than beside
 * it, and still leaves from the bottom of the screen that printed it.
 */
const FLY_PA = { from: { x: 180, y: 476 }, to: { x: 180, y: 930 } }
const FLY_PB = { from: { x: 180, y: 1120 }, to: { x: 180, y: 1494 } }
const FLY_PC = { from: { x: 180, y: 1587 }, to: { x: 180, y: 2010 } }
/** Narrower than the wide rig's 280: the strip is 360, not 1150. */
const SLIP_P = 230

/**
 * Camera keyframes: [progress, centre y]. The wide rig's, with one addition
 * — it frames Ravi's phone and the receipt side by side and holds from 0.8
 * to the end, which cannot be done on a strip 360 wide. So there is one
 * more move, 0.875 to 0.925: after the ticks have landed at 0.86 and while
 * the receipt is printing from 0.88, so the slip prints into the frame it
 * is arriving in rather than being panned to afterwards.
 */
const CAM_P: [number, number][] = [
  [0, STATION_1],
  [0.18, STATION_1],
  [0.28, cyP(PHONE_P)],
  [0.48, cyP(PHONE_P)],
  [0.56, cyP(LAPTOP_P)],
  [0.72, cyP(LAPTOP_P)],
  [0.8, cyP(WA_P)],
  [0.875, cyP(WA_P)],
  [0.925, cyP(RECEIPT_P)],
  [1, cyP(RECEIPT_P)],
]

function camY(p: number) {
  for (let i = 0; i < CAM_P.length - 1; i++) {
    const [p0, y0] = CAM_P[i]!
    const [p1, y1] = CAM_P[i + 1]!
    if (p <= p1) return lerp(y0, y1, inOut(seg(p, p0, p1)))
  }
  return CAM_P[CAM_P.length - 1]![1]
}

/** Which of the six steps the reader is in, for the chapter title. */
function stepAt(p: number) {
  if (p < 0.19) return 0
  if (p < 0.42) return 1
  if (p < 0.5) return 2
  if (p < 0.73) return 3
  if (p < 0.88) return 4
  return 5
}

/** The line under the scene. Mostly the step names; three are the journeys. */
function captionAt(p: number) {
  if (p < 0.18) return STORY_STEPS[0]!.eyebrow
  if (p < 0.29) return 'To your phone'
  if (p < 0.42) return STORY_STEPS[1]!.eyebrow
  if (p < 0.5) return STORY_STEPS[2]!.eyebrow
  if (p < 0.57) return 'To your laptop'
  if (p < 0.73) return STORY_STEPS[3]!.eyebrow
  if (p < 0.81) return 'To Ravi'
  if (p < 0.88) return STORY_STEPS[4]!.eyebrow
  if (p < 0.945) return STORY_STEPS[5]!.eyebrow
  return STORY_CAPTION
}

/** The phrases the task is lifted from. */
const MARKS = ['the revised quote before lunch', 'thickness']
const WORDS_ALL = SPOKEN.reduce((n, line) => n + line.text.split(' ').length, 0)

/**
 * One promise, carried all the way to a delivered message.
 *
 * A single sticky screen and a wide scene behind it. As the reader scrolls,
 * the camera pans from the person to their phone, to their laptop, to the
 * phone of the man they made the promise to — following a slip of paper
 * that is the promise itself, printed smaller each time it changes hands.
 * Nothing appears that was not derived from something already on screen,
 * which is the claim the product is making, made visible.
 *
 * The pendant on the person's chest is the real one, in the fixed canvas.
 * The scene publishes where it has put it every frame and the rig places
 * the model there, so the object pans off with the rest of the scene.
 *
 * On a phone and on a short screen the same scene is stood on end: a strip
 * 360 wide with the stations down it and a camera that pans vertically, on
 * the same progress and through the same beats. Only for a reader who has
 * asked for less motion do the six steps become six panels — there, and
 * only there, does information stop living in the movement.
 */
export function Story() {
  const stage = useStage<HTMLDivElement>('story')

  const reduced = usePrefersReducedMotion()
  const narrow = useMedia('(max-width: 1023px)')
  const short = useMedia('(max-height: 699px)')

  if (reduced) return <StackedStory stage={stage} />
  if (narrow || short) return <PortraitStory stage={stage} />
  return <PannedStory stage={stage} />
}

function PannedStory({ stage }: { stage: React.RefObject<HTMLDivElement | null> }) {
  const frame = useRef<HTMLDivElement>(null)
  const zoom = useRef<HTMLDivElement>(null)
  const cam = useRef<HTMLDivElement>(null)
  const person = useRef<HTMLDivElement>(null)
  const speech = useRef<HTMLDivElement>(null)
  const slipA = useRef<HTMLDivElement>(null)
  const slipB = useRef<HTMLDivElement>(null)
  const slipC = useRef<HTMLDivElement>(null)
  const phone = useRef<HTMLDivElement>(null)
  const summary = useRef<HTMLDivElement>(null)
  const laptop = useRef<HTMLDivElement>(null)
  const wa = useRef<HTMLDivElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const ticks = useRef<HTMLSpanElement>(null)
  const receipt = useRef<HTMLDivElement>(null)
  const scene = useRef<HTMLDivElement>(null)
  const payoff = useRef<HTMLDivElement>(null)
  const chapter = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLSpanElement>(null)

  const [step, setStep] = useState(0)
  const [caption, setCaption] = useState(captionAt(0))
  const [ticked, setTicked] = useState(false)

  useEffect(() => {
    setStoryAnchor({ active: true })
    return () => setStoryAnchor({ active: false })
  }, [])

  useScrollFrame((y, vh) => {
    const el = frame.current
    if (!el) return
    // The frame the scene is laid out in is `vh`; the layer the pendant is
    // drawn into is `box`. On a desktop they are the same number.
    const box = drawn()
    const vw = box.w
    const p = pinProgress('story', y, vh)

    // ── Fit and pan ──
    // Leave the top for the chapter title and the bottom for the caption.
    const s = Math.min((box.h - 230) / CAM_H, (vw * 0.92) / 1150, 1.1)
    const c = camX(p)
    if (zoom.current) zoom.current.style.transform = `scale(${s.toFixed(4)})`
    if (cam.current) cam.current.style.transform = `translate3d(${(CAM_W / 2 - c).toFixed(1)}px, 0, 0)`

    // ── The pendant, handed to the canvas ──
    // Screen x of a scene point: the viewport centre plus its distance from
    // the camera centre, scaled. On the chest the object is 52 scene-px
    // tall — a little bigger than it is in life, small enough to be worn.
    //
    // In screen pixels, not fractions: the canvas is a fixed layer and the
    // scene is inside a frame, and on iOS those are two different boxes.
    // See `drawn()` in lib/scroll.ts.
    setStoryAnchor({
      x: vw / 2 + s * (PENDANT.x - c),
      y: box.h / 2 + s * (PENDANT.y - CAM_H / 2),
      height: 52 * s,
    })

    // ── 1. Speak ──
    const sp = seg(p, 0.03, 0.15)
    el.style.setProperty('--reveal', String(sp * WORDS_ALL))
    if (person.current) person.current.dataset.talking = sp > 0 && sp < 1 ? 'true' : 'false'

    // ── 2. The words fold into a slip ──
    const f = inOut(seg(p, 0.16, 0.2))
    if (speech.current) {
      speech.current.style.opacity = String(1 - f)
      speech.current.style.transform = `translate(${lerp(0, 120, f)}px, ${lerp(0, 90, f)}px) scale(${lerp(1, 0.5, f)})`
    }

    // ── 3. Three flights ──
    // Each slip lifts, arcs, and lands — printed paper does not glide. The
    // fold is a squash on Y at the top of the arc, which is what a slip
    // being carried edge-on looks like.
    fly(slipA.current, FLY_A, seg(p, 0.19, 0.29), seg(p, 0.18, 0.21), seg(p, 0.28, 0.3))
    fly(slipB.current, FLY_B, seg(p, 0.5, 0.58), seg(p, 0.49, 0.52), seg(p, 0.57, 0.59))
    fly(slipC.current, FLY_C, seg(p, 0.73, 0.81), seg(p, 0.72, 0.75), seg(p, 0.8, 0.82))

    // ── 4. Your phone: the transcript, then what was understood ──
    el.style.setProperty('--lines', String(seg(p, 0.29, 0.37) * TRANSCRIPT.length))
    const sm = outCubic(seg(p, 0.37, 0.41))
    if (summary.current) {
      summary.current.style.opacity = String(sm)
      summary.current.style.transform = `translateY(${lerp(10, 0, sm)}px)`
    }
    el.style.setProperty('--sweep', String(seg(p, 0.41, 0.44)))
    el.style.setProperty('--tasks', String(seg(p, 0.43, 0.48) * TASKS.length))
    // The phone scrolls its page up as the tasks arrive: the transcript,
    // the summary and two tasks are taller than the screen, and a phone
    // shows the newest thing, not the top of the page.
    if (phone.current) phone.current.style.setProperty('--phone-scroll', String(seg(p, 0.43, 0.5)))

    // ── 5. Your laptop: four lines of work, and a scan that reads them ──
    const work = seg(p, 0.57, 0.71)
    el.style.setProperty('--status', String(work * LAPTOP_LINES.length))
    el.style.setProperty('--scan', String(work))

    // ── 6. Ravi's phone: the message lands, then the ticks ──
    const bb = outCubic(seg(p, 0.81, 0.85))
    if (bubble.current) {
      bubble.current.style.opacity = String(bb)
      bubble.current.style.transform = `translateY(${lerp(14, 0, bb)}px)`
    }
    if (ticks.current) ticks.current.style.opacity = p > 0.86 ? '1' : '0.35'

    // ── 7. The receipt prints ──
    const pr = outCubic(seg(p, 0.88, 0.93))
    if (receipt.current) {
      receipt.current.style.opacity = String(pr)
      receipt.current.style.transform = `translateY(${lerp(18, 0, pr)}px)`
    }

    // ── Focus: each station exists only while it is the subject ──
    if (phone.current) phone.current.style.opacity = p < 0.18 || p > 0.6 ? '0' : '1'
    if (laptop.current) laptop.current.style.opacity = p < 0.49 || p > 0.84 ? '0' : '1'
    if (wa.current) wa.current.style.opacity = p < 0.72 ? '0' : '1'

    // ── Payoff ──
    // The scene leaves completely: a ghost of the last station behind the
    // headline reads as a transition that has not finished.
    const po = seg(p, 0.945, 0.98)
    if (scene.current) {
      scene.current.style.opacity = String(1 - po)
      scene.current.style.transform = `scale(${lerp(1, 0.97, po)})`
      scene.current.style.visibility = po >= 1 ? 'hidden' : 'visible'
    }
    if (payoff.current) {
      payoff.current.style.opacity = String(po)
      payoff.current.style.transform = `translate(-50%, calc(-50% + ${lerp(12, 0, po)}px))`
    }
    if (chapter.current) chapter.current.style.opacity = String(1 - po)
    if (rail.current) rail.current.style.transform = `scaleX(${p.toFixed(4)})`

    // The few things that are genuinely discrete.
    const st = stepAt(p)
    setStep((was) => (was === st ? was : st))
    const cap = captionAt(p)
    setCaption((was) => (was === cap ? was : cap))
    const tk = p > 0.86
    setTicked((was) => (was === tk ? was : tk))
  })

  return (
    <Section id="how" ground="paper" transparent labelledBy="story-title">
      {/* Runway and frame in `--svh` — see the unit's note in index.css.
          On a desktop it is `vh` to the pixel and nothing here moves. */}
      <div ref={stage} className="relative h-[calc(700*var(--svh))]">
        <div ref={frame} className="sticky top-0 h-[calc(100*var(--svh))] overflow-hidden">
          <h2 id="story-title" className="sr-only">
            How it works: one promise, from your mouth to a delivered message
          </h2>

          {/* Chapter: which of the six steps this is. */}
          <div ref={chapter} className="shell absolute inset-x-0 top-24 z-10 sm:top-28">
            <Eyebrow>{STORY_EYEBROW}</Eyebrow>
            <div className="mt-3 grid">
              {STORY_STEPS.map((item, i) => (
                <p
                  key={item.n}
                  aria-hidden={i !== step}
                  className={cn(
                    'display-m col-start-1 row-start-1 text-tone transition-[opacity,transform] duration-500 ease-[var(--ease-out)]',
                    i === step ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
                  )}
                >
                  {item.title}
                </p>
              ))}
            </div>
          </div>

          {/* The scene. */}
          <div ref={scene} className="absolute inset-0 flex items-center justify-center pt-14">
            <div ref={zoom} className="origin-center">
              <div
                ref={cam}
                className="relative will-change-transform"
                style={{ width: CAM_W, height: CAM_H }}
              >
                <div
                  ref={person}
                  className="absolute"
                  style={{ left: 60, top: 40, width: 410, height: 680 }}
                >
                  <Person className="h-full w-full" />
                </div>

                <div
                  ref={speech}
                  className="absolute origin-bottom-left"
                  style={{ left: SPEECH.x, top: SPEECH.y, width: SPEECH.w }}
                >
                  <p className="label-sm text-tone-faint">
                    <Speaking>{STORY_STEPS[0]!.eyebrow}</Speaking>
                  </p>
                  {/* Display size. This line is the whole premise — the one
                      promise everything after it is derived from — and it
                      is read at the distance of a headline, not a caption.
                      Nothing under it: a level meter said "recording",
                      which is the wrong thing to say about a promise. */}
                  <div className="mt-6 [&_p]:text-[50px] [&_p]:leading-[1.06] [&_p]:tracking-[-0.025em]">
                    <SpokenLine
                      initial={SPOKEN[0].initial}
                      speaker={SPOKEN[0].speaker}
                      text={SPOKEN[0].text}
                      reveal
                    />
                  </div>
                </div>

                {/* The three slips. Printed once, carried three times. */}
                <Slip ref={slipA} head={SLIPS.heard.head} line={SLIPS.heard.line} />
                <Slip ref={slipB} head={SLIPS.task.head} line={SLIPS.task.line} />
                <Slip ref={slipC} head={SLIPS.draft.head} line={SLIPS.draft.line} />

                {/* Station 2: your phone. */}
                <div
                  ref={phone}
                  className="absolute transition-opacity duration-300"
                  style={{ left: PHONE.x, top: PHONE.y, width: PHONE.w, height: PHONE.h }}
                >
                  <PhoneFrame label="LYZN · Your phone">
                    <div className="flex flex-1 flex-col gap-5">
                      <ul className="flex flex-col gap-3">
                        {TRANSCRIPT.map((line, i) => (
                          <TranscriptLine
                            key={line.t}
                            className="count-line"
                            style={{ '--i': String(i) } as CSSProperties}
                            t={line.t}
                            speaker={line.speaker}
                            text={line.text}
                            recede={step >= 2}
                          />
                        ))}
                      </ul>
                      <div ref={summary} className="opacity-0">
                        <SummaryCard title={SUMMARY.title} bullets={SUMMARY.bullets} marks={MARKS} />
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {TASKS.map((task, i) => (
                          <TaskRow
                            key={task.text}
                            index={i}
                            text={task.text}
                            due={task.due}
                          />
                        ))}
                      </div>
                    </div>
                  </PhoneFrame>
                </div>

                {/* Station 3: your laptop. */}
                <div
                  ref={laptop}
                  className="absolute transition-opacity duration-300"
                  style={{ left: LAPTOP.x, top: LAPTOP.y, width: LAPTOP.w, height: LAPTOP.h }}
                >
                  <LaptopFrame label="LYZN · Your laptop">
                    <div className="flex flex-1 flex-col gap-4">
                      <TaskRow text={TASKS[0].text} due={TASKS[0].due} done={ticked} running={!ticked && step === 3} />
                      {/* The scan is scoped to the block it reads, not the
                          whole screen — measured against the column it
                          ended up as a rule floating under the lines. */}
                      {/* The block appears with its first line rather than
                          before it: an empty panel waiting for text reads
                          as a placeholder that never loaded. */}
                      <div className="relative" style={{ opacity: 'min(1, calc(var(--status, 0) * 4))' }}>
                        <StatusBlock lines={LAPTOP_LINES} />
                        <span aria-hidden="true" className="laptop-scan" />
                      </div>
                    </div>
                  </LaptopFrame>
                </div>

                {/* Station 4: Ravi's phone. */}
                <div
                  ref={wa}
                  className="absolute transition-opacity duration-300"
                  style={{ left: WA.x, top: WA.y, width: WA.w, height: WA.h }}
                >
                  <PhoneFrame label={WHATSAPP.sub} contact={WHATSAPP.header}>
                    <div className="flex flex-1 flex-col justify-end">
                      <div
                        ref={bubble}
                        className="self-end rounded-[16px] rounded-br-[4px] bg-tone-inv-bg p-3 text-tone-inv-fg opacity-0"
                        style={{ maxWidth: '88%' }}
                      >
                        <p className="flex items-center gap-2 rounded-[8px] bg-white/10 px-2.5 py-2 font-mono text-[10.5px]">
                          <Paperclip className="size-3.5 shrink-0" strokeWidth={1.75} />
                          {WHATSAPP.attachment}
                        </p>
                        <p className="mt-2.5 text-[13px] leading-snug">{WHATSAPP.text}</p>
                        <p className="mt-1.5 text-right font-mono text-[10px] opacity-80">
                          {WHATSAPP.time}{' '}
                          <span ref={ticks} className="transition-opacity duration-200">
                            ✓✓
                          </span>
                        </p>
                      </div>
                    </div>
                  </PhoneFrame>
                </div>

                {/* The receipt. What the reader is handed at the end. */}
                <div
                  ref={receipt}
                  className="absolute opacity-0 will-change-transform"
                  style={{ left: RECEIPT.x, top: RECEIPT.y, width: RECEIPT.w }}
                >
                  <Receipt
                    stamp="DONE"
                    title={STORY_RECEIPT.title}
                    meta={STORY_RECEIPT.meta}
                    rows={[...STORY_RECEIPT.rows]}
                    total={STORY_RECEIPT.total}
                    barcode={STORY_RECEIPT.txn}
                    footer={STORY_RECEIPT.footer}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Payoff. Centred by the same inline transform the frame writes:
              Tailwind's translate utilities set the separate `translate`
              property, and stacking that under a written `transform` put
              the headline half its own width to the left. */}
          <div
            ref={payoff}
            className="pointer-events-none absolute top-1/2 left-1/2 w-full max-w-[720px] px-6 text-center"
            style={{ opacity: 0, transform: 'translate(-50%, -50%)' }}
          >
            <p className="display-l text-tone">{STORY_STEPS[5]!.title}</p>
            <p className="body-l mx-auto mt-5 max-w-[34ch] text-tone-muted">{STORY_STEPS[5]!.line}</p>
          </div>

          {/* Caption and rail. */}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0">
            <p className="label-sm pb-8 text-center text-tone-muted transition-opacity duration-200">
              {caption === STORY_STEPS[0]!.eyebrow ? <Speaking>{caption}</Speaking> : caption}
            </p>
            <span className="block h-px w-full bg-tone-faint/25">
              <span
                ref={rail}
                className="block h-full w-full origin-left bg-signal"
                style={{ transform: 'scaleX(0)' }}
              />
            </span>
          </div>
        </div>
      </div>
    </Section>
  )
}

/**
 * The same promise, carried down a phone instead of across a desk.
 *
 * Everything in `PannedStory` is here: the one sticky screen, the six
 * steps, the captions, the rail, the three slips, the pendant handed to the
 * canvas every frame. The scene is a vertical strip rather than a wide one
 * and the camera pans down it, and that is the whole of the difference —
 * every `seg()` window below is the wide rig's, to the digit, so a reader
 * who turns their phone sideways mid-section lands on the same beat.
 *
 * The pendant rides the strip too. It used to be switched off for the whole
 * section on a phone, which is why the section had nothing to be about
 * there; the rig honours the anchor this scene publishes now, and where
 * there is no canvas the still on the chest stands in exactly as it does on
 * a desktop with no WebGL.
 */
function PortraitStory({ stage }: { stage: React.RefObject<HTMLDivElement | null> }) {
  // Nothing here needs to know which field of view will draw the pendant:
  // the scene publishes how many pixels tall it wants the object, and each
  // renderer converts that with its own figure. See three/storyAnchor.ts.
  const frame = useRef<HTMLDivElement>(null)
  const zoom = useRef<HTMLDivElement>(null)
  const cam = useRef<HTMLDivElement>(null)
  const person = useRef<HTMLDivElement>(null)
  const speech = useRef<HTMLDivElement>(null)
  const slipA = useRef<HTMLDivElement>(null)
  const slipB = useRef<HTMLDivElement>(null)
  const slipC = useRef<HTMLDivElement>(null)
  const phone = useRef<HTMLDivElement>(null)
  const summary = useRef<HTMLDivElement>(null)
  const laptop = useRef<HTMLDivElement>(null)
  const wa = useRef<HTMLDivElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const ticks = useRef<HTMLSpanElement>(null)
  const receipt = useRef<HTMLDivElement>(null)
  const scene = useRef<HTMLDivElement>(null)
  const payoff = useRef<HTMLDivElement>(null)
  const chapter = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLSpanElement>(null)

  const [step, setStep] = useState(0)
  const [caption, setCaption] = useState(captionAt(0))
  const [ticked, setTicked] = useState(false)

  useEffect(() => {
    setStoryAnchor({ active: true })
    // The record is shared with the wide rig, which never writes an opacity
    // because it never wants one: hand it back the way it was found.
    return () => setStoryAnchor({ active: false, opacity: 1 })
  }, [])

  useScrollFrame((y, vh) => {
    const el = frame.current
    if (!el) return
    // The scene fills the frame, and the frame fills the screen the reader
    // has — which on iOS grows as the browser's bars collapse. Both are
    // this box; only the scroll progress still divides by `--svh`.
    const box = drawn()
    const vw = box.w
    const p = pinProgress('story', y, vh)

    // ── Fit and pan ──
    // The strip takes 92% of the screen's width and never grows past 1.15,
    // which is where the drawn phone stops being a phone and starts being a
    // poster of one. The height term only ever binds on a screen too short
    // to hold a whole station — on a real phone the width does, which is
    // why a station is nearly life size there.
    const s = Math.min(
      (vw * 0.92) / STRIP_W,
      (box.h - TOP_UI - BOT_UI) / STATION_H,
      1.15,
    )
    const c = camY(p)
    if (zoom.current) zoom.current.style.transform = `scale(${s.toFixed(4)})`
    if (cam.current) cam.current.style.transform = `translate3d(0, ${(STRIP_H / 2 - c).toFixed(1)}px, 0)`

    // ── The pendant, handed to the canvas ──
    // The scene sits between the chapter title and the caption, so the
    // point the camera is centred on lands at the middle of *that* band and
    // not of the screen. Everything else is the wide rig's arithmetic with
    // the axes swapped: the strip is centred horizontally and panned
    // vertically, where it centres vertically and pans horizontally.
    //
    // The figure leaves over the window the wide rig cuts its still at, and
    // everything it is wearing leaves with it: the drawn still, which the
    // band's mask would have faded anyway, and the model in the canvas,
    // which is behind the page and so outside that mask entirely.
    const leave1 = 1 - seg(p, 0.2, 0.28)
    const mid = (TOP_UI + box.h - BOT_UI) / 2
    setStoryAnchor({
      x: vw / 2 + s * (PENDANT_P.x - STRIP_W / 2),
      y: mid + s * (PENDANT_P.y - c),
      height: PEND_P * s,
      opacity: leave1,
    })
    if (person.current) person.current.style.opacity = String(leave1)

    // ── 1. Speak ──
    const sp = seg(p, 0.03, 0.15)
    el.style.setProperty('--reveal', String(sp * WORDS_ALL))
    if (person.current) person.current.dataset.talking = sp > 0 && sp < 1 ? 'true' : 'false'

    // ── 2. The words fold into a slip ──
    // Straight down rather than down and to the right: the slip they become
    // leaves down the strip, and a fold that went sideways would be the
    // sentence heading somewhere the paper does not.
    const f = inOut(seg(p, 0.16, 0.2))
    if (speech.current) {
      speech.current.style.opacity = String(1 - f)
      speech.current.style.transform = `translate(0, ${lerp(0, 70, f)}px) scale(${lerp(1, 0.5, f)})`
    }

    // ── 3. Three flights ──
    flyDown(slipA.current, FLY_PA, seg(p, 0.19, 0.29), seg(p, 0.18, 0.21), seg(p, 0.28, 0.3))
    flyDown(slipB.current, FLY_PB, seg(p, 0.5, 0.58), seg(p, 0.49, 0.52), seg(p, 0.57, 0.59))
    flyDown(slipC.current, FLY_PC, seg(p, 0.73, 0.81), seg(p, 0.72, 0.75), seg(p, 0.8, 0.82))

    // ── 4. Your phone: the transcript, then what was understood ──
    el.style.setProperty('--lines', String(seg(p, 0.29, 0.37) * TRANSCRIPT.length))
    const sm = outCubic(seg(p, 0.37, 0.41))
    if (summary.current) {
      summary.current.style.opacity = String(sm)
      summary.current.style.transform = `translateY(${lerp(10, 0, sm)}px)`
    }
    el.style.setProperty('--sweep', String(seg(p, 0.41, 0.44)))
    el.style.setProperty('--tasks', String(seg(p, 0.43, 0.48) * TASKS.length))
    // The phone scrolls its page up as the tasks arrive: the transcript,
    // the summary and two tasks are taller than the screen, and a phone
    // shows the newest thing, not the top of the page.
    if (phone.current) phone.current.style.setProperty('--phone-scroll', String(seg(p, 0.43, 0.5)))

    // ── 5. Your laptop: three lines of work, and a scan that reads them ──
    const work = seg(p, 0.57, 0.71)
    el.style.setProperty('--status', String(work * LAPTOP_LINES.length))
    el.style.setProperty('--scan', String(work))

    // ── 6. Ravi's phone: the message lands, then the ticks ──
    const bb = outCubic(seg(p, 0.81, 0.85))
    if (bubble.current) {
      bubble.current.style.opacity = String(bb)
      bubble.current.style.transform = `translateY(${lerp(14, 0, bb)}px)`
    }
    if (ticks.current) ticks.current.style.opacity = p > 0.86 ? '1' : '0.35'

    // ── 7. The receipt prints ──
    const pr = outCubic(seg(p, 0.88, 0.93))
    if (receipt.current) {
      receipt.current.style.opacity = String(pr)
      receipt.current.style.transform = `translateY(${lerp(18, 0, pr)}px)`
    }

    // ── Focus: each station exists only while it is the subject ──
    // The wide rig's boundaries, ramped rather than cut. It can cut and let
    // a 300ms transition smooth it because the scroll is the only clock it
    // has; written every frame the fade is the reader's own hand instead,
    // which on a phone — where a flick covers a whole station — is the
    // difference between a station leaving and a station blinking.
    if (phone.current) {
      phone.current.style.opacity = String(seg(p, 0.175, 0.2) * (1 - seg(p, 0.56, 0.6)))
    }
    if (laptop.current) {
      laptop.current.style.opacity = String(seg(p, 0.485, 0.51) * (1 - seg(p, 0.8, 0.84)))
    }
    if (wa.current) wa.current.style.opacity = String(seg(p, 0.715, 0.74))

    // ── Payoff ──
    const po = seg(p, 0.945, 0.98)
    if (scene.current) {
      scene.current.style.opacity = String(1 - po)
      scene.current.style.transform = `scale(${lerp(1, 0.97, po)})`
      scene.current.style.visibility = po >= 1 ? 'hidden' : 'visible'
    }
    if (payoff.current) {
      payoff.current.style.opacity = String(po)
      payoff.current.style.transform = `translate(-50%, calc(-50% + ${lerp(12, 0, po)}px))`
    }
    if (chapter.current) chapter.current.style.opacity = String(1 - po)
    if (rail.current) rail.current.style.transform = `scaleX(${p.toFixed(4)})`

    const st = stepAt(p)
    setStep((was) => (was === st ? was : st))
    const cap = captionAt(p)
    setCaption((was) => (was === cap ? was : cap))
    const tk = p > 0.86
    setTicked((was) => (was === tk ? was : tk))
  })

  return (
    <Section id="how" ground="paper" transparent labelledBy="story-title">
      <div ref={stage} className="relative h-[calc(700*var(--svh))]">
        {/* The frame is the *dynamic* viewport, not the small one: a phone
            collapses its bars a flick into this section, the screen grows
            by seventy-odd pixels, and a frame pinned at the small height
            left that much bare desk under the rail for the whole play. The
            runway above stays in `--svh` and so does the band below, so the
            progress and the scene it scrubs still agree; only the caption
            and the rail, pinned to the frame's bottom, follow the screen. */}
        <div ref={frame} className="pin-frame-fill sticky top-0 overflow-hidden">
          <h2 id="story-title" className="sr-only">
            How it works: one promise, from your mouth to a delivered message
          </h2>

          {/* Chapter: which of the six steps this is. */}
          <div ref={chapter} className="shell absolute inset-x-0 top-24 z-10">
            <Eyebrow>{STORY_EYEBROW}</Eyebrow>
            <div className="mt-3 grid">
              {STORY_STEPS.map((item, i) => (
                <p
                  key={item.n}
                  aria-hidden={i !== step}
                  className={cn(
                    'display-m col-start-1 row-start-1 text-tone transition-[opacity,transform] duration-500 ease-[var(--ease-out)]',
                    i === step ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
                  )}
                >
                  {item.title}
                </p>
              ))}
            </div>
          </div>

          {/* The scene. Bounded rather than inset-0: the band between the
              chapter title and the caption is the frame, and the scroll
              frame above computes the pendant's place against the same two
              numbers. */}
          <div
            ref={scene}
            className="absolute inset-x-0 flex items-center justify-center"
            style={{
              top: TOP_UI,
              bottom: BOT_UI,
              maskImage: BAND_MASK,
              WebkitMaskImage: BAND_MASK,
            }}
          >
            <div ref={zoom} className="origin-center">
              <div
                ref={cam}
                className="relative will-change-transform"
                style={{ width: STRIP_W, height: STRIP_H }}
              >
                {/* Station 1: the person, wearing the pendant, and what
                    they said beneath them. */}
                <div
                  ref={person}
                  className="absolute overflow-hidden"
                  style={{
                    left: PERSON_P.x,
                    top: PERSON_P.y,
                    width: PERSON_P.w,
                    height: PERSON_P.h,
                  }}
                >
                  <Person
                    className="absolute inset-x-0 top-0 h-auto w-full"
                    style={{ aspectRatio: '410 / 680' }}
                  />
                </div>

                <div
                  ref={speech}
                  className="absolute origin-top"
                  style={{ left: SPEECH_P.x, top: SPEECH_P.y, width: SPEECH_P.w }}
                >
                  <p className="label-sm text-tone-faint">
                    <Speaking>{STORY_STEPS[0]!.eyebrow}</Speaking>
                  </p>
                  {/* 30px across a 360 strip is the same weight in the frame
                      that 50px is across the wide one: the premise is read
                      at the size of a headline on whichever screen it is
                      read on, not shrunk to a caption on the smaller. */}
                  <div className="mt-4 [&_p]:text-[30px] [&_p]:leading-[1.1] [&_p]:tracking-[-0.022em]">
                    <SpokenLine
                      initial={SPOKEN[0].initial}
                      speaker={SPOKEN[0].speaker}
                      text={SPOKEN[0].text}
                      reveal
                    />
                  </div>
                </div>

                {/* The three slips. Printed once, carried three times. */}
                <Slip ref={slipA} w={SLIP_P} head={SLIPS.heard.head} line={SLIPS.heard.line} />
                <Slip ref={slipB} w={SLIP_P} head={SLIPS.task.head} line={SLIPS.task.line} />
                <Slip ref={slipC} w={SLIP_P} head={SLIPS.draft.head} line={SLIPS.draft.line} />

                {/* Station 2: your phone. */}
                <div
                  ref={phone}
                  className="absolute opacity-0"
                  style={{ left: PHONE_P.x, top: PHONE_P.y, width: PHONE_P.w, height: PHONE_P.h }}
                >
                  <PhoneFrame label="LYZN · Your phone">
                    <div className="flex flex-1 flex-col gap-5">
                      <ul className="flex flex-col gap-3">
                        {TRANSCRIPT.map((line, i) => (
                          <TranscriptLine
                            key={line.t}
                            className="count-line"
                            style={{ '--i': String(i) } as CSSProperties}
                            t={line.t}
                            speaker={line.speaker}
                            text={line.text}
                            recede={step >= 2}
                          />
                        ))}
                      </ul>
                      <div ref={summary} className="opacity-0">
                        <SummaryCard title={SUMMARY.title} bullets={SUMMARY.bullets} marks={MARKS} />
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {TASKS.map((task, i) => (
                          <TaskRow key={task.text} index={i} text={task.text} due={task.due} />
                        ))}
                      </div>
                    </div>
                  </PhoneFrame>
                </div>

                {/* Station 3: your laptop. Scaled to the strip's width, so
                    the drawing loses more than half its area and the type
                    inside it none — which is why the rows are set closer
                    here than on the wide rig rather than smaller. */}
                <div
                  ref={laptop}
                  className="absolute opacity-0"
                  style={{
                    left: LAPTOP_P.x,
                    top: LAPTOP_P.y,
                    width: LAPTOP_P.w,
                    height: LAPTOP_P.h,
                  }}
                >
                  <LaptopFrame label="LYZN · Your laptop" dense>
                    <div className="flex flex-1 flex-col gap-4">
                      <TaskRow
                        text={TASKS[0].text}
                        due={TASKS[0].due}
                        done={ticked}
                        running={!ticked && step === 3}
                      />
                      <div
                        className="relative"
                        style={{ opacity: 'min(1, calc(var(--status, 0) * 4))' }}
                      >
                        <StatusBlock lines={LAPTOP_LINES} />
                        <span aria-hidden="true" className="laptop-scan" />
                      </div>
                    </div>
                  </LaptopFrame>
                </div>

                {/* Station 4: Ravi's phone. */}
                <div
                  ref={wa}
                  className="absolute opacity-0"
                  style={{ left: WA_P.x, top: WA_P.y, width: WA_P.w, height: WA_P.h }}
                >
                  <PhoneFrame label={WHATSAPP.sub} contact={WHATSAPP.header}>
                    <div className="flex flex-1 flex-col justify-end">
                      <div
                        ref={bubble}
                        className="self-end rounded-[16px] rounded-br-[4px] bg-tone-inv-bg p-3 text-tone-inv-fg opacity-0"
                        style={{ maxWidth: '88%' }}
                      >
                        <p className="flex items-center gap-2 rounded-[8px] bg-white/10 px-2.5 py-2 font-mono text-[10.5px]">
                          <Paperclip className="size-3.5 shrink-0" strokeWidth={1.75} />
                          {WHATSAPP.attachment}
                        </p>
                        <p className="mt-2.5 text-[13px] leading-snug">{WHATSAPP.text}</p>
                        <p className="mt-1.5 text-right font-mono text-[10px] opacity-80">
                          {WHATSAPP.time}{' '}
                          <span ref={ticks} className="transition-opacity duration-200">
                            ✓✓
                          </span>
                        </p>
                      </div>
                    </div>
                  </PhoneFrame>
                </div>

                {/* The receipt. What the reader is handed at the end. */}
                <div
                  ref={receipt}
                  className="absolute opacity-0 will-change-transform"
                  style={{ left: RECEIPT_P.x, top: RECEIPT_P.y, width: RECEIPT_P.w }}
                >
                  <Receipt
                    stamp="DONE"
                    title={STORY_RECEIPT.title}
                    meta={STORY_RECEIPT.meta}
                    rows={[...STORY_RECEIPT.rows]}
                    total={STORY_RECEIPT.total}
                    barcode={STORY_RECEIPT.txn}
                    footer={STORY_RECEIPT.footer}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Payoff. Centred by the same inline transform the frame writes. */}
          <div
            ref={payoff}
            className="pointer-events-none absolute top-1/2 left-1/2 w-full max-w-[720px] px-6 text-center"
            style={{ opacity: 0, transform: 'translate(-50%, -50%)' }}
          >
            <p className="display-l text-tone">{STORY_STEPS[5]!.title}</p>
            <p className="body-l mx-auto mt-5 max-w-[34ch] text-tone-muted">{STORY_STEPS[5]!.line}</p>
          </div>

          {/* Caption and rail. */}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0">
            <p className="label-sm px-6 pb-6 text-center text-tone-muted transition-opacity duration-200">
              {caption === STORY_STEPS[0]!.eyebrow ? <Speaking>{caption}</Speaking> : caption}
            </p>
            <span className="block h-px w-full bg-tone-faint/25">
              <span
                ref={rail}
                className="block h-full w-full origin-left bg-signal"
                style={{ transform: 'scaleX(0)' }}
              />
            </span>
          </div>
        </div>
      </div>
    </Section>
  )
}

/**
 * Moves a slip along an arc. `t` is the flight, `enter` and `leave` the
 * fades either side of it. Written to the element directly; nothing here
 * touches React.
 */
function fly(
  el: HTMLDivElement | null,
  path: { from: { x: number; y: number }; to: { x: number; y: number } },
  t: number,
  enter: number,
  leave: number,
) {
  if (!el) return
  const k = inOut(t)
  const x = lerp(path.from.x, path.to.x, k)
  const y = lerp(path.from.y, path.to.y, k) - Math.sin(k * Math.PI) * 120
  const fold = 1 - Math.sin(k * Math.PI) * 0.75
  el.style.opacity = String(enter * (1 - leave))
  el.style.transform = `translate(${x - 140}px, ${y - 30}px) scale(${lerp(1, 0.62, k)}) scaleY(${fold}) rotate(${lerp(-3, 5, k)}deg)`
}

/**
 * The same flight, down a strip instead of across one.
 *
 * `fly` bows the slip *across* its line of travel, which for a slip
 * travelling sideways means up. A portrait slip bowed along its own line of
 * travel would only be a slip that speeds up and slows down, so the bow
 * moves to x. The fold stays on y: it is the axis a sheet of paper tips
 * about while it is carried, and it is the axis that leaves the words on it
 * readable through the flight.
 */
function flyDown(
  el: HTMLDivElement | null,
  path: { from: { x: number; y: number }; to: { x: number; y: number } },
  t: number,
  enter: number,
  leave: number,
) {
  if (!el) return
  const k = inOut(t)
  const x = lerp(path.from.x, path.to.x, k) + Math.sin(k * Math.PI) * 46
  const y = lerp(path.from.y, path.to.y, k)
  const fold = 1 - Math.sin(k * Math.PI) * 0.75
  el.style.opacity = String(enter * (1 - leave))
  el.style.transform = `translate(${x - SLIP_P / 2}px, ${y - 30}px) scale(${lerp(1, 0.62, k)}) scaleY(${fold}) rotate(${lerp(-3, 5, k)}deg)`
}

/** A slip of receipt paper: what one station hands the next. */
const Slip = ({
  ref,
  head,
  line,
  w = 280,
}: {
  ref: React.Ref<HTMLDivElement>
  head: string
  line: string
  /** Scene units. The strip it crosses is 1150 wide on a desktop and 360 here. */
  w?: number
}) => (
  <div
    ref={ref}
    aria-hidden="true"
    style={{ width: w }}
    className="slip absolute top-0 left-0 bg-receipt-paper px-4 pt-3.5 pb-5 text-receipt-ink opacity-0 will-change-transform"
  >
    <p className="font-mono text-[10px] tracking-[0.12em] text-receipt-faint uppercase">{head}</p>
    <p className="mt-1.5 text-[12.5px] leading-snug">{line}</p>
  </div>
)

/**
 * A phone, drawn. The bezel and the pill are the whole drawing: what makes
 * it a phone is that the content is inside one, on its screen.
 *
 * The screen is inset proportionally rather than in pixels, so the two rigs
 * can draw this phone at different sizes and have the content land inside
 * the bezel in both. Written as `100% × 28 ÷ 340` and not as the decimal it
 * comes to: the browser lays percentages out in 64ths of a pixel and rounds
 * down, so 8.235% falls a 64th short of the 28px it is meant to be and the
 * wide rig's phone moved. This is the same drawing at 340 × 540 to the
 * layout unit, which is the point.
 */
function PhoneFrame({
  label,
  contact,
  children,
}: {
  label: string
  contact?: string
  children: React.ReactNode
}) {
  // How far the page runs past the screen, measured, so the station can
  // scroll it by a fraction (`--phone-scroll`, 0..1) and the last thing
  // to arrive is always in view. Zero on a page that fits.
  const view = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = view.current
    if (!el) return
    const measure = () =>
      el.style.setProperty('--phone-over', `${Math.max(0, el.scrollHeight - el.clientHeight)}px`)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="relative h-full w-full">
      <svg
        aria-hidden="true"
        viewBox="0 0 340 540"
        className="absolute inset-0 h-full w-full text-tone"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
      >
        <rect x="2" y="2" width="336" height="536" rx="46" />
        <rect x="14" y="14" width="312" height="512" rx="36" strokeWidth="1.2" opacity="0.35" />
        <rect x="135" y="26" width="70" height="10" rx="5" strokeWidth="1.6" />
        <line x1="120" y1="518" x2="220" y2="518" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
      </svg>
      <div className="absolute inset-x-[calc(100%*28/340)] top-[calc(100%*52/540)] bottom-[calc(100%*36/540)] flex flex-col">
        {contact ? (
          // WhatsApp's own header colour, not a site token: this bar is
          // standing in for a specific app, not reading the page's ground.
          <div className="mb-4 flex items-center gap-3 rounded-[10px] bg-[#075E54] px-3 py-2.5">
            <span aria-hidden="true" className="size-8 shrink-0 rounded-full bg-white/90" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-white">{contact}</p>
              <p className="font-mono text-[10px] tracking-[0.1em] text-white/70 uppercase">{label}</p>
            </div>
          </div>
        ) : (
          <p className="label-sm mb-5 text-tone-faint">{label}</p>
        )}
        <div ref={view} className="min-h-0 flex-1 overflow-hidden">
          <div className="phone-page">{children}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * A laptop, drawn: a screen on a hinge over a base. Content on the screen.
 *
 * Inset proportionally for the same reason the phone is, and written the
 * same way: `100% × 58 ÷ 640` is the 58px it was at 640 wide, exactly.
 *
 * `dense` draws the screen's contents at four fifths, for the portrait rig,
 * where the laptop is scaled to a phone's width and the type on it is not.
 * That is not a compromise, it is the truth of the picture: on this strip a
 * laptop and a phone are the same width, and the only thing left to say
 * that one of them is a metre away is that its interface is smaller. Left
 * at full size the three lines of work spilled over the hinge.
 */

/**
 * The surface everything happens on, for the stacked version.
 *
 * Each block knows which steps it belongs to, so the content genuinely
 * carries over from one step to the next rather than being redrawn.
 */
function StoryStage({ step, className }: { step: number; className?: string }) {
  const show = (from: number, to: number) => step >= from && step <= to

  return (
    <Stage
      label={step === 0 ? <Speaking>{STORY_STEPS[0]!.eyebrow}</Speaking> : STORY_STEPS[step]?.eyebrow}
      className={cn('justify-center', className)}
    >
      <div className="flex flex-1 flex-col justify-center gap-6 overflow-hidden">
        {show(0, 0) && (
          <div className="[&_p]:text-[22px] [&_p]:leading-snug">
            <SpokenLine initial={SPOKEN[0].initial} speaker={SPOKEN[0].speaker} text={SPOKEN[0].text} />
          </div>
        )}

        {show(1, 2) && (
          <ul className="flex flex-col gap-4">
            {TRANSCRIPT.map((line) => (
              <TranscriptLine
                key={line.t}
                t={line.t}
                speaker={line.speaker}
                text={line.text}
                recede={step === 2}
              />
            ))}
          </ul>
        )}

        {show(2, 2) && (
          <>
            <SummaryCard title={SUMMARY.title} bullets={SUMMARY.bullets} marks={MARKS} />
            <div className="flex flex-col gap-2.5">
              {TASKS.map((task, i) => (
                <TaskRow key={task.text} index={i} text={task.text} due={task.due} />
              ))}
            </div>
          </>
        )}

        {show(3, 3) && (
          <div className="flex flex-col gap-3">
            <TaskRow text={TASKS[0].text} due={TASKS[0].due} running />
            <StatusBlock lines={LAPTOP_LINES} />
          </div>
        )}

        {show(4, 4) && (
          <div className="flex flex-col gap-4">
            {/* WhatsApp's own header colour, not a site token — see the
                matching comment on PhoneFrame's `contact` branch above. */}
            <div className="flex items-center gap-3 rounded-[10px] bg-[#075E54] px-3 py-2.5">
              <span aria-hidden="true" className="size-8 shrink-0 rounded-full bg-white/90" />
              <div>
                <p className="text-[14px] font-medium text-white">{WHATSAPP.header}</p>
                <p className="font-mono text-[10px] tracking-[0.1em] text-white/70 uppercase">{WHATSAPP.sub}</p>
              </div>
            </div>
            <div className="self-end rounded-[16px] rounded-br-[4px] bg-tone-inv-bg p-3 text-tone-inv-fg" style={{ maxWidth: '88%' }}>
              <p className="flex items-center gap-2 rounded-[8px] bg-white/10 px-2.5 py-2 font-mono text-[10.5px]">
                <Paperclip className="size-3.5 shrink-0" strokeWidth={1.75} />
                {WHATSAPP.attachment}
              </p>
              <p className="mt-2.5 text-[13px] leading-snug">{WHATSAPP.text}</p>
              <p className="mt-1.5 text-right font-mono text-[10px] opacity-80">{WHATSAPP.time} ✓✓</p>
            </div>
          </div>
        )}

        {show(5, 5) && (
          <div className="flex flex-col gap-4">
            <Receipt
              className="mx-auto w-full max-w-[300px]"
              stamp="DONE"
              title={STORY_RECEIPT.title}
              meta={STORY_RECEIPT.meta}
              rows={[...STORY_RECEIPT.rows]}
              total={STORY_RECEIPT.total}
              barcode={STORY_RECEIPT.txn}
              footer={STORY_RECEIPT.footer}
            />
            <p className="label-sm text-center text-tone-faint">{STORY_CAPTION}</p>
          </div>
        )}
      </div>
    </Stage>
  )
}

/**
 * The same six steps without the pin.
 *
 * Every panel shows where its step ends, so the section reads exactly the
 * same on a phone, on a short laptop screen, and for anyone who has turned
 * motion off. Only the choreography is missing.
 */
function StackedStory({ stage }: { stage: React.RefObject<HTMLDivElement | null> }) {
  return (
    <Section id="how" ground="paper" transparent labelledBy="story-title">
      <div ref={stage} className="shell section-pad">
        <h2 id="story-title" className="sr-only">
          How it works: one promise, from your mouth to a delivered message
        </h2>

        <Eyebrow>{STORY_EYEBROW}</Eyebrow>

        {/* The same figure as the panned scene, drawn still, with the
            poster on the chest where the canvas would put the object. */}
        <div className="relative mx-auto mt-6 aspect-[410/520] w-full max-w-[300px] overflow-hidden">
          <Person className="absolute inset-x-0 top-0 h-auto w-full" style={{ aspectRatio: '410 / 680' }} />
          <img
            src="/img/poster-a.webp"
            alt=""
            className="absolute -translate-x-1/2 -translate-y-1/2 object-contain"
            style={{ left: `${((270 - 60) / 410) * 100}%`, top: `${((458 - 40) / 680) * 100}%`, width: '19.7%' }}
            loading="lazy"
            decoding="async"
          />
        </div>

        <ol className="mt-10 flex flex-col gap-14">
          {STORY_STEPS.map((item, i) => (
            <li key={item.n} className="flex flex-col gap-5">
              <div>
                <p className="label text-signal">
                  {item.n} · {i === 0 ? <Speaking>{item.eyebrow}</Speaking> : item.eyebrow}
                </p>
                <p className="display-m mt-3 text-tone">{item.title}</p>
                <p className="mt-2 max-w-[34ch] text-tone-muted">{item.line}</p>
              </div>
              <StoryStage step={i} className="min-h-[280px] w-full" />
            </li>
          ))}
        </ol>
      </div>
    </Section>
  )
}
