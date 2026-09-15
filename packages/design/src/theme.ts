/**
 * The Tailwind theme, derived from the tokens.
 *
 * The app's tailwind.config.js is loaded by `tailwindcss/loadConfig` under
 * plain Node — the same reason fonts.json exists — so it cannot import this
 * package's .ts entry. scripts/gen-css.mjs calls `buildTheme()` and writes
 * the result to tokens.json, which is what the config reads.
 *
 * Nothing here is a token. Every number and every colour comes from
 * tokens.ts; this file only renames them into Tailwind's namespaces and puts
 * the units on. A test asserts the committed tokens.json equals a fresh
 * `buildTheme()`, so a token added without a regeneration fails here rather
 * than at the app's next Metro start.
 */
import { colors, dur, ease, fonts, radius, space, stampAngle, toggle, tones, typeScale } from './tokens.ts'

/** `deskInk` → `desk-ink`. Digits split too, which is why `paper2` is below. */
export const kebab = (s: string): string => s.replace(/([A-Z0-9])/g, (m) => '-' + m.toLowerCase())

/** The web's existing names for the few colours that do not kebab cleanly. */
export const colorNames: Record<string, string> = {
  inkFg: 'inkfg', inkMuted: 'inkmuted', inkFaint: 'inkfaint',
  graphite2: 'graphite-2', paper2: 'paper-2', paper3: 'paper-3',
  fgMuted: 'fg-muted', fgFaint: 'fg-faint',
}

export const colorName = (k: string): string => colorNames[k] ?? kebab(k)

/** `displayXL` would kebab to `display-x-l`, and `mono11` to `mono-1-1`. */
const sizeNames: Record<string, string> = {
  displayXL: 'display-xl', displayL: 'display-l', displayM: 'display-m', mono11: 'mono-11',
}

const sizeName = (k: string): string => sizeNames[k] ?? kebab(k)

const px = (n: number): string => `${n}px`

/** The scale's tracking is in em, which is how a face is specified; React
    Native's letterSpacing is absolute, so it is multiplied out here at the
    size it belongs to. */
const track = (t: { size: number; tracking: number }): string => px(+(t.tracking * t.size).toFixed(3))

/** A size is Tailwind's [size, { lineHeight, letterSpacing }] pair. */
export type FontSize = readonly [string, { lineHeight: string; letterSpacing: string }]

export type DesignTheme = {
  colors: Record<string, string>
  spacing: Record<string, string>
  radius: Record<string, string>
  fontFamily: Record<string, string[]>
  fontSize: Record<string, FontSize>
  letterSpacing: Record<string, string>
  duration: Record<string, string>
  ease: Record<string, string>
  tones: typeof tones
  stampAngle: number
  toggle: typeof toggle
}

export function buildTheme(): DesignTheme {
  const fontSize: Record<string, FontSize> = {}
  const letterSpacing: Record<string, string> = {}
  for (const [k, t] of Object.entries(typeScale)) {
    /* leading stays unitless — NativeWind resolves a unitless line-height as
       em against the resolved font-size at runtime. */
    fontSize[sizeName(k)] = [px(t.size), { lineHeight: String(t.leading), letterSpacing: track(t) }]
    letterSpacing[sizeName(k)] = track(t)
  }

  /* One family per weight. React Native takes a family name, not a stack and
     a weight, so `font-bold` cannot exist — `font-sans-800` does. The names
     are fonts.native's, which is what the app registers at boot. */
  const fontFamily: Record<string, string[]> = {
    ...Object.fromEntries(Object.entries(fonts.native.sans).map(([w, f]) => [`sans-${w}`, [f]])),
    ...Object.fromEntries(Object.entries(fonts.native.mono).map(([w, f]) => [`mono-${w}`, [f]])),
    sans: [fonts.native.sans[400]],
    mono: [fonts.native.mono[400]],
  }

  return {
    colors: Object.fromEntries(Object.entries(colors).map(([k, v]) => [colorName(k), v])),
    spacing: Object.fromEntries(Object.entries(space).map(([k, v]) => [k, px(v)])),
    radius: Object.fromEntries(Object.entries(radius).map(([k, v]) => [kebab(k), px(v)])),
    fontFamily,
    fontSize,
    letterSpacing,
    duration: Object.fromEntries(Object.entries(dur).map(([k, v]) => [k, `${v}ms`])),
    ease: Object.fromEntries(Object.entries(ease).map(([k, v]) => [kebab(k), `cubic-bezier(${v.join(', ')})`])),

    /* The tone table, for the vars() call the app sets its ground with. */
    tones,

    stampAngle,
    toggle,
  }
}
