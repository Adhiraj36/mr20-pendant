import { writeFileSync } from 'node:fs'
import { button, colors, fonts, dur, ease, inks, typeScale } from '../src/tokens.ts'
// The colour spellings and the Tailwind theme both live in src/theme.ts, so
// tokens.css and tokens.json cannot disagree about what a colour is called.
import { buildTheme, colorName, kebab } from '../src/theme.ts'

const hex = (v) => v.toLowerCase()
const px = (n) => `${n}px`
const em = (n) => `${n}em`

/* The display sizes are fluid on the web and fixed in the app, so the scale
   carries the px and this table carries the clamps index.css has always used.

   XL's floor is the one value here that moves with the viewport. On a phone
   the hero headline is not competing with the margins, it is competing with
   the object above it: at 10ch the sentence sets five lines whatever the
   size, so 40px rather than 44 buys the pendant about twenty pixels. Above
   640px the floor goes back to 44, where 7vw already binds — so the wider
   page is untouched and only the phone sees the difference. */
const display = [
  { key: 'displayXL', css: 'xl', size: 'clamp(2.5rem, 7vw, 6.5rem)', wide: 'clamp(2.75rem, 7vw, 6.5rem)' },
  { key: 'displayL', css: 'l', size: 'clamp(2rem, 4.5vw, 4rem)' },
  { key: 'displayM', css: 'm', size: 'clamp(1.5rem, 2.6vw, 2.25rem)' },
]
const wideAt = '640px'

let out = `/* Generated from @lyzn/design/src/tokens.ts — do not edit. */\n@theme {\n`
for (const [k, v] of Object.entries(colors)) out += `  --color-${colorName(k)}: ${hex(v)};\n`
out += `  --font-sans: ${fonts.web.sans};\n  --font-mono: ${fonts.web.mono};\n`
for (const [k, v] of Object.entries(ease)) out += `  --ease-${kebab(k)}: cubic-bezier(${v.join(', ')});\n`
for (const [k, v] of Object.entries(dur)) out += `  --dur-${k}: ${v}ms;\n`
out += `}\n`

/* Everything below sits outside @theme. None of it is in a Tailwind
   namespace, the XL floor needs a media query, and the inks are selectors —
   so these are plain custom properties and plain rules. */

out += `\n/* The three display sizes: the fit index.css sets .display-xl/l/m and\n   h1, h2, h3 in, so the heading and the token are one thing. */\n:root {\n`
for (const d of display) {
  const t = typeScale[d.key]
  out += `  --type-display-${d.css}-size: ${d.size};\n`
  out += `  --type-display-${d.css}-weight: ${t.weight};\n`
  out += `  --type-display-${d.css}-tracking: ${em(t.tracking)};\n`
  out += `  --type-display-${d.css}-leading: ${t.leading};\n`
}
out += `}\n`
out += `\n/* The phone's lower floor for the headline — see the note in gen-css.mjs. */\n`
out += `@media (min-width: ${wideAt}) {\n  :root {\n    --type-display-xl-size: ${display[0].wide};\n  }\n}\n`

out += `\n/* The button: one object, one size, one face. The compact pair is the\n   narrower button, not a second one. */\n:root {\n`
out += `  --btn-size: ${px(button.size)};\n`
out += `  --btn-weight: ${button.weight};\n`
out += `  --btn-tracking: ${em(button.tracking)};\n`
out += `  --btn-pad-y: ${px(button.padding.y)};\n`
out += `  --btn-pad-x: ${px(button.padding.x)};\n`
out += `  --btn-pad-y-compact: ${px(button.compact.y)};\n`
out += `  --btn-pad-x-compact: ${px(button.compact.x)};\n`
out += `  --btn-fill: ${hex(button.fill)};\n`
out += `  --btn-ink: ${hex(button.ink)};\n`
out += `  --btn-hover: ${hex(button.hover)};\n`
out += `  --btn-hover-ink: ${hex(button.hoverInk)};\n`
out += `}\n`

/* The ink the reader picked, as the only thing it changes. The default ink
   gets no rule: the picker removes the attribute instead of setting it, so
   --heading goes undefined and every heading falls back to its tone. */
out += `\n/* The reader's ink. One attribute on <html>, and this is the whole effect. */\n`
for (const ink of inks) {
  if ('default' in ink && ink.default) continue
  out += `[data-ink="${ink.id}"] {\n  --heading: ${hex(ink.hex)};\n}\n`
}

writeFileSync(new URL('../tokens.css', import.meta.url), out)
// The Google Fonts request, as JSON: web/vite.config.ts builds the <link>
// from it, and Vite loads its config under plain Node, which cannot import
// this package's .ts entry.
writeFileSync(new URL('../fonts.json', import.meta.url), JSON.stringify({ google: fonts.google }, null, 2) + '\n')

/* The Tailwind theme, as JSON: the app's tailwind.config.js is loaded by
   tailwindcss/loadConfig under plain Node, the same reason fonts.json
   exists. The shapes are Tailwind's namespaces, not new tokens — every
   number still comes from src/tokens.ts, by way of src/theme.ts. */
writeFileSync(new URL('../tokens.json', import.meta.url), JSON.stringify(buildTheme(), null, 2) + '\n')

console.log('wrote tokens.css, fonts.json and tokens.json')
