import { cn } from '@/lib/utils'

/**
 * The person wearing the pendant.
 *
 * Drawn, not photographed: one ink line, one weight, nothing filled — the
 * same hand as the receipts' barcodes and rules, and no more finished. The
 * pendant itself is not in here — the real one, rendered in the canvas,
 * lands on this chest — so the figure's only job is to be a convincing
 * place for it to hang, and to talk.
 *
 * Laid out in the story scene's own units. The viewBox is a window onto
 * those units rather than a private coordinate space, so every point below
 * is a position on the strip and the pendant anchor in Story.tsx can be
 * read against it directly: the cord ends where the object begins.
 *
 * Talking is two things and no more. The lower lip drops on a cadence, and
 * two arcs leave the mouth. A jaw that swings, eyes that blink, a head that
 * nods — each was tried and each turned the drawing into a cartoon. The
 * figure is a bystander to its own promise; the pendant is the one working.
 */
export function Person({
  className,
  style,
  talking,
}: {
  className?: string
  style?: React.CSSProperties
  /** Static drawing when false; the scene flips it while the line is spoken. */
  talking?: boolean
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="60 40 410 680"
      className={cn('person text-tone', talking && 'talking', className)}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Hair. A mass, not a line: the crown over the top of the head and
          the hairline across the forehead. Without the second contour it
          read as bald; with a strand between them it read as a scar. */}
      <path d="M338 138 C336 108 300 84 258 88 C214 92 190 130 194 178" />
      <path d="M338 138 C318 128 292 124 268 130 C250 134 240 142 232 156" />

      {/* Skull and nape, behind the ear. */}
      <path d="M194 178 C192 206 198 232 214 252 C222 262 232 270 240 274" />

      {/* Ear. */}
      <path d="M224 200 C208 194 206 222 226 226" />

      {/* Face: brow, nose, upper lip, chin, jaw back to the ear. Facing the
          speech, which sits to the right of the head. */}
      <path d="M338 138 C344 160 348 186 356 202 C360 208 352 212 344 212" />
      <path d="M344 212 C348 226 344 240 338 252 C330 268 310 278 288 278 C264 278 246 268 238 254 C232 244 228 232 226 220" />

      {/* Mouth. The upper lip holds; the lower one is the only thing that
          moves when the figure speaks. */}
      <path d="M322 228 Q334 233 348 228" strokeWidth="2.2" />
      <path className="lip" d="M324 231 Q334 238 348 231" strokeWidth="2.2" />

      {/* Neck. */}
      <path d="M300 278 C298 294 300 306 296 318" />
      <path d="M236 256 C232 278 232 300 226 316" />

      {/* Collar, open. The lapels meet at the sternum; the cord comes out
          from under them rather than from the neck, which is where a cord
          on an open collar actually shows. */}
      <path d="M226 316 C238 330 256 342 270 352" />
      <path d="M296 318 C288 332 280 344 270 352" />
      <path d="M226 316 C200 320 174 330 148 344" />
      <path d="M296 318 C324 322 352 332 382 346" />

      {/* Shoulders, down and out of the frame. */}
      <path d="M148 344 C108 356 82 402 72 470 C64 530 60 620 60 720" />
      <path d="M382 346 C422 358 448 404 458 470 C466 530 470 620 470 720" />

      {/* The cord. Two strands hanging from under the collar to the top of
          the pendant, which the canvas draws 52 tall, centred at (270, 458). */}
      <path d="M262 354 C262 382 262 408 266 432" strokeWidth="2" />
      <path d="M278 354 C278 382 278 408 274 432" strokeWidth="2" />

      {/* What is said, leaving the mouth. Invisible until the figure
          talks; then two arcs, one after the other. */}
      <g className="arcs" style={{ transformOrigin: '350px 230px' }}>
        <path className="arc arc-1" d="M372 210 A30 30 0 0 1 372 250" strokeWidth="2" />
        <path className="arc arc-2" d="M392 198 A48 48 0 0 1 392 262" strokeWidth="1.8" />
      </g>
    </svg>
  )
}
