import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildTheme } from '../src/theme.ts'
import { colors, stampAngle, toggle, tones, typeScale } from '../src/tokens.ts'

/* tokens.json is the app's Tailwind theme. It is generated and committed —
   tailwind.config.js is loaded under plain Node and cannot import the .ts —
   so it can go stale between a change to the tokens and the next
   `npm run gen:css`. The first test is the whole stale guard: the committed
   file must equal a fresh generation, character for character. The rest pin
   the names the app is about to type in a className. */

const raw = readFileSync(new URL('../tokens.json', import.meta.url), 'utf8')
const json = JSON.parse(raw) as ReturnType<typeof buildTheme>
const fresh = buildTheme()

test('the committed theme is what the tokens generate today', () => {
  assert.deepEqual(json, JSON.parse(JSON.stringify(fresh)),
    'tokens.json is stale — run npm run gen:css')
  assert.equal(raw, JSON.stringify(fresh, null, 2) + '\n',
    'tokens.json is stale — run npm run gen:css')
})

test('the namespaces the config spreads into theme.extend', () => {
  assert.deepEqual(Object.keys(json), [
    'colors', 'spacing', 'radius', 'fontFamily', 'fontSize', 'letterSpacing',
    'duration', 'ease', 'tones', 'stampAngle', 'toggle',
  ])
})

test('every colour reaches the theme, under the name the CSS uses', () => {
  assert.equal(Object.keys(json.colors).length, Object.keys(colors).length)
  assert.equal(json.colors['inkfg'], colors.inkFg)
  assert.equal(json.colors['paper-2'], colors.paper2)
  assert.equal(json.colors['desk-ink'], colors.deskInk)
  assert.equal(json.colors['carbon-line'], colors.carbonLine)
  assert.equal(json.colors['carbon-deep-ink'], colors.carbonDeepInk)
  assert.equal(json.colors['stamp-night'], colors.stampNight)
  assert.equal(json.colors['danger'], '#B03A2E')
})

test('spacing and radius arrive with units on', () => {
  assert.equal(json.spacing['lg'], '16px')
  assert.equal(json.radius['button'], '0px')
  assert.equal(json.radius['card-lg'], '24px')
})

test('one family per weight, because React Native takes a name and not a stack', () => {
  assert.deepEqual(json.fontFamily['sans-800'], ['Archivo_800ExtraBold'])
  assert.deepEqual(json.fontFamily['mono-700'], ['MartianMono_700Bold'])
  assert.deepEqual(json.fontFamily['sans'], ['Archivo_400Regular'])
  assert.deepEqual(json.fontFamily['mono'], ['MartianMono_400Regular'])
})

test('the size keys are the nine the app writes, display spelled xl/l/m', () => {
  assert.deepEqual(Object.keys(json.fontSize), [
    'display-xl', 'display-l', 'display-m',
    'body-l', 'body', 'small', 'label', 'label-sm', 'mono-11',
  ])
  assert.deepEqual(Object.keys(json.letterSpacing), Object.keys(json.fontSize))
})

test('tracking is multiplied out at the size it belongs to; leading stays unitless', () => {
  assert.deepEqual(json.fontSize['display-xl'], ['44px', { lineHeight: '0.97', letterSpacing: '-1.672px' }])
  assert.deepEqual(json.fontSize['label'], ['12px', { lineHeight: '1.2', letterSpacing: '1.44px' }])
  assert.deepEqual(json.fontSize['label-sm'], ['10px', { lineHeight: '1.2', letterSpacing: '1.4px' }])
  assert.deepEqual(json.fontSize['mono-11'], ['11px', { lineHeight: '1.2', letterSpacing: '1.1px' }])
  for (const [key, size] of Object.entries(json.fontSize)) {
    assert.equal(json.letterSpacing[key], size[1].letterSpacing)
  }
  // em × px, and nothing rounded away: the scale's numbers are still the scale's.
  assert.equal(json.fontSize['display-m'][1].letterSpacing,
    `${typeScale.displayM.tracking * typeScale.displayM.size}px`)
})

test('durations and easings come across as CSS values', () => {
  assert.equal(json.duration['ui'], '160ms')
  assert.equal(json.ease['in-out'], 'cubic-bezier(0.65, 0, 0.35, 1)')
})

test('the whole tone table travels, for the vars() the app sets a ground with', () => {
  assert.deepEqual(json.tones, JSON.parse(JSON.stringify(tones)))
  assert.deepEqual(Object.keys(json.tones), ['ink', 'paper', 'desk', 'night'])
  assert.equal(json.tones.desk.carbon, colors.carbon)
  assert.equal(json.tones.night.stamp, colors.stampNight)
})

test('the stamp’s angle and the one pill ride along', () => {
  assert.equal(json.stampAngle, stampAngle)
  assert.deepEqual(json.toggle, toggle)
})
