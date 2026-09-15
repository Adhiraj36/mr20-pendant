/**
 * Design tokens — app spec §4.
 *
 * Warm monochrome: two grounds, ink and paper, and one signal colour that
 * never fills anything larger than 8pt. `colors`, `tones`, `space`, the two
 * faces, the display end of the type scale and the button all come straight
 * from @lyzn/design, the package the website reads its @theme from, so a
 * token means the same thing on both platforms.
 *
 * This file holds numbers and strings only — no React, no react-native — so
 * the node test runner can import it directly.
 */

import {
  colors,
  tones,
  space,
  radius as sharedRadius,
  fonts,
  typeScale,
  button,
  type Ground,
} from '@lyzn/design';

/**
 * `colors` now carries the website's page-level colours as well — `desk`,
 * `sheet`, `faded`, `rule`, `settled` — and they arrive here through this
 * re-export, available to any screen that wants one.
 *
 * None of them is a ground. **The app's two grounds stay ink and paper**
 * (spec §1.1): `desk` is the ground the *website* is laid on — one step
 * below paper, ruled with a 28px grid, with every section transparent over
 * it so a panel reads as a sheet lying on a desk — and a phone screen is not
 * a page you can lay a sheet on. `Screen` still chooses between ink and
 * paper and nothing else.
 *
 * `button` is the package's button object, re-exported so `primitives.tsx`
 * has one import site for the kit's numbers.
 */
export { colors, tones, space, button };
export type { Ground };

// -- radius ----------------------------------------------------------------

/**
 * App spec §4.4's 12: task rows, status blocks, message bubbles, the play
 * button, toasts.
 *
 * These used to alias `sharedRadius.button`, which *was* 12 until the site
 * squared its buttons (R17b). The site squared only the buttons and inputs —
 * `web/src/components/Stage.tsx` still draws its task row and its status
 * block `rounded-[12px]` — so the alias was carrying two meanings and only
 * one of them changed. This is its own number now, not a button's.
 */
const soft = 12;

/**
 * Named by use, not by size (website spec §5.4). The app spec §4.4 lists the
 * same numbers by the thing they sit on, so both names are exposed:
 * `radius.card` and `radius.panel` are the same 20.
 */
export const radius = {
  ...sharedRadius,
  /** Aliases from app spec §4.4, so a screen can name the thing it is drawing. */
  panel: sharedRadius.card,
  sheet: sharedRadius.card,
  task: soft,
  bubble: soft,
  toast: soft,
  play: soft,
  back: sharedRadius.input,
  segment: sharedRadius.input,
  thumb: sharedRadius.input,
  check: sharedRadius.chip,
  knob: 4,
  scrub: sharedRadius.tick,
  bar: 1,
} as const;

/** Avatars scale their corner with their size (spec §4.4). */
export const avatarRadius = (size: number) => Math.round(size * 0.22);

// -- typography ------------------------------------------------------------

/**
 * Font family per weight — `fonts.native` from @lyzn/design, whole.
 *
 * The package publishes the two faces in the three forms its readers ask
 * for: `web` (the CSS stack the site's @theme takes), `native` (the family
 * name per weight, the way @expo-google-fonts publishes its files) and
 * `google` (the family segment of the `<link>` the site requests). `native`
 * *is* the app's form, so there is no private map here any more — one table,
 * and `app/_layout.tsx` registers exactly the families it names.
 *
 * **Archivo and Martian Mono** (ruling R17), the faces the website took: the
 * app and the site set the same headline in the same shape. Spec §4.2 and §8
 * still say Geist; R17 supersedes them, and §0.2's rule — the shipped code
 * wins over a spec it has moved past — is why.
 *
 * Both ship as separate weighted files rather than one variable font RN can
 * pick a weight from, so a style needs the family name, not just a weight:
 * Android synthesises a fake bold otherwise (spec §4.2, §9 Fonts). That is
 * also why the package carries sans 800 and mono 700 rather than letting the
 * two heaviest things on screen — the display headings and the button — ask
 * for a weight nobody loaded a file for.
 *
 * Eight families, and every one of them is used: sans 400/500/600/800 and
 * mono 400/500/600/700. Mono 600 is the receipt's alone — §3.3 gives its
 * header, stamp and total value at 600 verbatim, three times, and
 * `Receipt.tsx` is a fixed-colour, tone-ignoring slip rather than a `type`
 * consumer. Mono 700 is the button's alone. Sans 600 is unused by `type` and
 * kept because the package names it and the site loads it.
 */
export const fontFamily = fonts.native;

/** Applied to any number that changes in place, so the layout does not twitch. */
export const tabular = { fontVariant: ['tabular-nums' as const] };

const sans = fontFamily.sans;
const mono = fontFamily.mono;

/**
 * The package states tracking as a fraction of the em and leading as a
 * multiple of the size, the way CSS wants them. React Native wants both in
 * points, so the two conversions live here and the numbers themselves stay
 * in one place.
 */
const track = (size: number, em: number) => Math.round(size * em * 100) / 100;
const lead = (size: number, factor: number) => Math.round(size * factor);

/**
 * The three display sizes, in points.
 *
 * These are deliberately *not* `typeScale.display*.size`. The package's
 * `size` is the figure the web's clamp settles on at its floor, and for
 * display-xl that floor is the one above 640px (`2.75rem` = 44). The site's
 * floor on a phone is `2.5rem` — 40 — and `2rem` and `1.5rem` for L and M,
 * which are 32 and 24. So these three numbers *are* the website at phone
 * width, and they are app spec §4.2's table as well; the two never disagreed.
 * The clamps live in the package's `scripts/gen-css.mjs` because they are CSS
 * and a phone has no viewport to interpolate against.
 */
const displaySize = { displayXL: 40, displayL: 32, displayM: 24 } as const;

/**
 * The type scale — spec §4.2's sizes, with the display end now read from
 * `typeScale` in @lyzn/design rather than restated here. Letter-spacing and
 * line-height are in points; every entry carries its family.
 *
 * The three display variants are **Archivo 800**, pulled tight and set
 * close: `typeScale` gives the weight, the tracking and the leading, and the
 * app converts them against the size above. That is the reference's fit for
 * a heading, and the reason the package carries an 800 file — at 500 a
 * headline was not louder than the 11pt mono labels standing beside it. The
 * old "never 700" rule went with it; what is still true is narrower and said
 * where it belongs, on the mono entries below.
 *
 * Mono entries are uppercase by contract (the spec's "mono labels"), so the
 * transform lives in the token rather than in every call site.
 */
export const type = {
  /** display-xl — the welcome headline. */
  displayXL: {
    fontFamily: sans[typeScale.displayXL.weight],
    fontSize: displaySize.displayXL,
    letterSpacing: track(displaySize.displayXL, typeScale.displayXL.tracking),
    lineHeight: lead(displaySize.displayXL, typeScale.displayXL.leading),
  },
  /** display-l — screen statements, detail title, greeting. */
  displayL: {
    fontFamily: sans[typeScale.displayL.weight],
    fontSize: displaySize.displayL,
    letterSpacing: track(displaySize.displayL, typeScale.displayL.tracking),
    lineHeight: lead(displaySize.displayL, typeScale.displayL.leading),
  },
  /** display-m — day headings, player clock, sheet titles, instrument values. */
  displayM: {
    fontFamily: sans[typeScale.displayM.weight],
    fontSize: displaySize.displayM,
    letterSpacing: track(displaySize.displayM, typeScale.displayM.tracking),
    lineHeight: lead(displaySize.displayM, typeScale.displayM.leading),
  },
  /** body-l — sub-lines, live transcript, Mira's spoken reply. */
  bodyL: {
    fontFamily: sans[400], fontSize: 18, letterSpacing: -0.09, lineHeight: 27,
  },
  /** body — everything else. */
  body: {
    fontFamily: sans[400], fontSize: 16, letterSpacing: 0, lineHeight: 25,
  },
  /** body at 500 — row titles. */
  bodyStrong: {
    fontFamily: sans[500], fontSize: 16, letterSpacing: 0, lineHeight: 25,
  },
  /** small — summaries, hints, task text, compact button. */
  small: {
    fontFamily: sans[400], fontSize: 14, letterSpacing: 0, lineHeight: 21,
  },
  /** small at 500 — a compact button's label. */
  smallStrong: {
    fontFamily: sans[500], fontSize: 14, letterSpacing: 0, lineHeight: 21,
  },
  /** label — eyebrows, section titles. Uppercase. */
  label: {
    fontFamily: mono[500], fontSize: 12, letterSpacing: 1.44, lineHeight: 14,
    textTransform: 'uppercase' as const,
  },
  /** label-sm — meta, chips, status, step numbers. Uppercase. */
  labelSm: {
    fontFamily: mono[500], fontSize: 11, letterSpacing: 1.32, lineHeight: 13,
    textTransform: 'uppercase' as const,
  },
  /** mono-11 — timestamps, values. Tabular, sentence case. */
  mono11: {
    fontFamily: mono[400], fontSize: 11, letterSpacing: 0, lineHeight: 14,
  },
} as const;

export type TypeVariant = keyof typeof type;

/**
 * The button's label, as a React Native text style — the package's `button`
 * with its two CSS-shaped fields converted: `weight` picks the family, and
 * `tracking` (a tenth of an em) becomes 1.1 points at 11.
 *
 * It is not a `type` variant because it is not a place in the scale: the
 * button is one object on both surfaces, and `button` in @lyzn/design is
 * where that object lives. The rest of it — the paddings, the square corner,
 * the fill and the ink — is read straight in `primitives.tsx`.
 */
export const buttonLabel = {
  fontFamily: mono[button.weight],
  fontSize: button.size,
  letterSpacing: track(button.size, button.tracking),
  textTransform: (button.uppercase ? 'uppercase' : 'none') as 'uppercase' | 'none',
} as const;

/**
 * The widest a column of content should get, whatever the screen (spec §4.2).
 * The app is laid out for a phone and this build supports iPad, where a
 * full-bleed layout stretches buttons across two thousand points.
 */
export const readableWidth = 560;

/** Screen gutter (spec §4.3). Was 16. */
export const gutter = 24;

/** The height of a `TopRow` (spec §1.3, §4.3). */
export const topRowHeight = 56;

// -- formatting ------------------------------------------------------------

/** "1h 04m", "3m 20s", "12s" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Clock form for a player: "4:07", "1:02:33" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return h ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

/** "Today, 5:36 pm" · "Yesterday, 9:02 am" · "19 Aug, 5:36 pm" */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const time = date
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase();

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);

  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${date.toLocaleDateString(undefined, { weekday: 'long' })}, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/** Relative, for "last seen" style strings. */
export function formatAgo(iso?: string): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Joins the fragments of a mono label with ` · `, dropping the empty ones —
 * the site's slot rule (spec §0.3, §3.1 `Label`). Never render the token.
 */
export function joinLabel(parts: (string | undefined | false | null)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' · ');
}
