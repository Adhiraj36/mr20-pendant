import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { button, colors, fonts, dur, ease, inks, typeScale } from '../src/tokens.ts'

/* tokens.css is generated and committed, so it can go stale between a change
   here and the next `npm run gen:css`. These tests read the committed file and
   check it against the tokens it was generated from: every variable the web
   is about to read is present, spelled the way the web spells it, holding the
   value the TS holds. A stale file fails here rather than on the site. */

const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')

/** Every declaration in the file, by name, with its value. The first wins:
    the only name declared twice is the headline size, whose second
    declaration is the wide floor, and that one is asserted on its own. */
const vars = new Map<string, string>()
for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
  if (!vars.has(name!)) vars.set(name!, value!.trim())
}

const has = (name: string, value: string) => {
  assert.ok(vars.has(name), `${name} is missing from tokens.css — run npm run gen:css`)
  assert.equal(vars.get(name), value, `${name} is stale in tokens.css — run npm run gen:css`)
}

test('every colour reaches the CSS under the name the web reads', () => {
  const names: Record<string, string> = {
    inkFg: 'inkfg', inkMuted: 'inkmuted', inkFaint: 'inkfaint',
    graphite2: 'graphite-2', paper2: 'paper-2', paper3: 'paper-3',
    fgMuted: 'fg-muted', fgFaint: 'fg-faint',
  }
  const kebab = (s: string) => s.replace(/([A-Z0-9])/g, (m) => '-' + m.toLowerCase())
  for (const [k, v] of Object.entries(colors)) has(`--color-${names[k] ?? kebab(k)}`, v.toLowerCase())
})

test('the four the pricing section is about to stop spelling itself', () => {
  has('--color-sheet', '#fbfbf8')
  has('--color-faded', '#6e6f64')
  has('--color-rule', '#d5d5cc')
  has('--color-settled', '#1b6b45')
})

test('the faces come from fonts.web', () => {
  has('--font-sans', fonts.web.sans)
  has('--font-mono', fonts.web.mono)
})

test('the easings and durations are unchanged', () => {
  has('--ease-out', `cubic-bezier(${ease.out.join(', ')})`)
  has('--ease-in-out', `cubic-bezier(${ease.inOut.join(', ')})`)
  has('--ease-in', `cubic-bezier(${ease.in.join(', ')})`)
  for (const [k, v] of Object.entries(dur)) has(`--dur-${k}`, `${v}ms`)
})

test('the display sizes carry the clamps index.css uses today', () => {
  has('--type-display-xl-size', 'clamp(2.5rem, 7vw, 6.5rem)')
  has('--type-display-l-size', 'clamp(2rem, 4.5vw, 4rem)')
  has('--type-display-m-size', 'clamp(1.5rem, 2.6vw, 2.25rem)')
})

test('the phone’s lower headline floor is the one responsive value', () => {
  assert.match(css, /@media \(min-width: 640px\) \{\s*:root \{\s*--type-display-xl-size: clamp\(2\.75rem, 7vw, 6\.5rem\);/)
})

test('weight, tracking and leading come off the scale, tracking in em', () => {
  for (const [key, css_] of [['displayXL', 'xl'], ['displayL', 'l'], ['displayM', 'm']] as const) {
    const t = typeScale[key]
    has(`--type-display-${css_}-weight`, String(t.weight))
    has(`--type-display-${css_}-tracking`, `${t.tracking}em`)
    has(`--type-display-${css_}-leading`, String(t.leading))
  }
})

test('the button set, in the units CSS wants them in', () => {
  has('--btn-size', `${button.size}px`)
  has('--btn-weight', String(button.weight))
  has('--btn-tracking', `${button.tracking}em`)
  has('--btn-pad-y', `${button.padding.y}px`)
  has('--btn-pad-x', `${button.padding.x}px`)
  has('--btn-pad-y-compact', `${button.compact.y}px`)
  has('--btn-pad-x-compact', `${button.compact.x}px`)
  has('--btn-fill', button.fill.toLowerCase())
  has('--btn-ink', button.ink.toLowerCase())
  has('--btn-hover', button.hover.toLowerCase())
  has('--btn-hover-ink', button.hoverInk.toLowerCase())
})

test('a rule for every ink but the default, which has none by design', () => {
  for (const ink of inks) {
    const rule = `[data-ink="${ink.id}"] {\n  --heading: ${ink.hex.toLowerCase()};\n}`
    if ('default' in ink && ink.default) assert.ok(!css.includes(`[data-ink="${ink.id}"]`))
    else assert.ok(css.includes(rule), `${rule} is missing from tokens.css — run npm run gen:css`)
  }
  assert.equal(css.match(/\[data-ink="/g)?.length, inks.length - 1)
})

test('nothing hand-written has crept in', () => {
  assert.match(css, /^\/\* Generated from @lyzn\/design\/src\/tokens\.ts — do not edit\. \*\//)
})
