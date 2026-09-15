import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Ground, Tone } from '../src/tokens.ts'
import { button, colors, fonts, inks, INK_STORAGE_KEY, radius, stampAngle, toggle, tones, typeScale, wordmark } from '../src/tokens.ts'

/* The package is the description of the system, and both surfaces are about
   to read it. These tests pin the names a consumer types, not only the values
   behind them: a rename here is a silent breakage there, and the two surfaces
   land on separate branches where nothing else would catch it. */

test('the sheet the site is printed on, and the three colours that go with it', () => {
  assert.equal(colors.sheet, '#FBFBF8')
  assert.equal(colors.faded, '#6E6F64')
  assert.equal(colors.rule, '#D5D5CC')
  assert.equal(colors.settled, '#1B6B45')
})

test('danger is the reference’s own cancelled-line red, on both surfaces', () => {
  assert.equal(colors.danger, '#B03A2E')
  // `void` is still the darkest ink ground, and it is still not a red.
  assert.equal(colors.void, '#050506')
  // The colour the site used to print a cancelled line in is gone.
  assert.ok(!Object.values(colors).includes('#B5483C' as never))
})

test('every colour name the CSS is generated from', () => {
  assert.deepEqual(Object.keys(colors), [
    'ink', 'charcoal', 'void', 'graphite', 'graphite2',
    'paper', 'paper2', 'paper3', 'desk', 'sheet', 'faded', 'rule',
    'fg', 'fgMuted', 'fgFaint', 'inkFg', 'inkMuted', 'inkFaint',
    'signal', 'danger', 'stamp', 'settled',
    'receiptPaper', 'receiptInk', 'receiptFaint',
    'deskInk', 'deskMuted', 'deskFaint', 'deskLine',
    'carbon', 'carbonLine',
    'night', 'nightPanel', 'nightLine', 'nightMuted', 'nightFaint',
    'carbonDeep', 'carbonDeepLine', 'carbonDeepInk', 'carbonDeepMuted',
    'stampNight', 'settledNight', 'dangerNight',
  ])
})

test('the desk and the night, at the values the canvas draws them at', () => {
  assert.equal(colors.desk, '#E3E4DE')
  assert.equal(colors.sheet, '#FBFBF8')
  assert.deepEqual(
    [colors.deskInk, colors.deskMuted, colors.deskFaint, colors.deskLine],
    ['#1C1C16', '#3B3B33', '#6E6F64', '#D9D9D1'],
  )
  assert.deepEqual([colors.carbon, colors.carbonLine], ['#F1E8CC', '#DDD2AE'])
  assert.deepEqual(
    [colors.night, colors.nightPanel, colors.nightLine, colors.nightMuted, colors.nightFaint],
    ['#1C1C16', '#111109', '#4A4A3E', '#9C9C90', '#8A8A7E'],
  )
  assert.deepEqual(
    [colors.carbonDeep, colors.carbonDeepLine, colors.carbonDeepInk, colors.carbonDeepMuted],
    ['#3A3323', '#554C34', '#EBDFB8', '#CFC7AE'],
  )
  assert.deepEqual(
    [colors.stampNight, colors.settledNight, colors.dangerNight],
    ['#8B82FF', '#6FCF9A', '#E0705E'],
  )
})

/* The tone table is the whole of the design discipline: a component asks for
   `line` or `carbon` and never asks which ground it is on. That only holds
   if every ground answers every question, so this is the one assertion the
   kit's correctness rests on. */

const TONE_KEYS = [
  'bg', 'fg', 'muted', 'faint', 'line', 'line2', 'panel', 'panel2',
  'invBg', 'invFg', 'statusBar',
  'carbon', 'carbonLine', 'stamp', 'settled', 'danger',
] as const satisfies readonly (keyof Tone)[]

test('four grounds, not two — the desk and the night join ink and paper', () => {
  assert.deepEqual(Object.keys(tones), ['ink', 'paper', 'desk', 'night'])
  const grounds: Ground[] = ['ink', 'paper', 'desk', 'night']
  for (const g of grounds) assert.ok(g in tones)
})

test('every tone answers every question, in the same order', () => {
  for (const [name, tone] of Object.entries(tones)) {
    assert.deepEqual(Object.keys(tone), [...TONE_KEYS], `tone ${name} is missing a key`)
    for (const k of TONE_KEYS) assert.equal(typeof tone[k], 'string', `${name}.${k} is not a colour`)
  }
})

test('the two light grounds carry the light signals, the two dark ones the lifted', () => {
  for (const t of [tones.paper, tones.desk]) {
    assert.deepEqual([t.carbon, t.carbonLine], [colors.carbon, colors.carbonLine])
    assert.deepEqual([t.stamp, t.settled, t.danger], [colors.stamp, colors.settled, colors.danger])
    assert.equal(t.statusBar, 'dark')
  }
  for (const t of [tones.ink, tones.night]) {
    assert.deepEqual([t.carbon, t.carbonLine], [colors.carbonDeep, colors.carbonDeepLine])
    assert.deepEqual([t.stamp, t.settled, t.danger], [colors.stampNight, colors.settledNight, colors.dangerNight])
    assert.equal(t.statusBar, 'light')
  }
})

test('paper is untouched, because a receipt is printed on it whatever the theme', () => {
  assert.equal(tones.paper.bg, colors.paper)
  assert.equal(tones.paper.fg, colors.inkFg)
  assert.equal(tones.paper.line, 'rgba(20,20,22,0.10)')
  assert.equal(tones.paper.panel, colors.paper2)
})

test('the desk is a sheet lying on a ground; at night the panel is a hole', () => {
  assert.equal(tones.desk.bg, colors.desk)
  assert.equal(tones.desk.panel, colors.sheet)
  assert.equal(tones.desk.panel2, '#EDEDE8')
  assert.equal(tones.night.bg, colors.night)
  assert.equal(tones.night.panel, colors.nightPanel)
  assert.equal(tones.night.panel2, '#1C1C16')
})

test('the stamp lands at eleven degrees, counter-clockwise, everywhere', () => {
  assert.equal(stampAngle, -11)
})

test('the toggle is the one pill, at the size the component sheet draws it', () => {
  assert.deepEqual(toggle, { w: 44, h: 26, radius: 13 })
  // Half the height: a pill, and the only radius in the system that is one.
  assert.equal(toggle.radius, toggle.h / 2)
  assert.ok(!Object.values(radius).includes(toggle.radius as never))
})

test('the display sizes are Archivo 800, pulled tight and set close', () => {
  assert.deepEqual(typeScale.displayXL, { size: 44, weight: 800, tracking: -0.038, leading: 0.97 })
  assert.deepEqual(typeScale.displayL, { size: 32, weight: 800, tracking: -0.035, leading: 1.02 })
  assert.deepEqual(typeScale.displayM, { size: 24, weight: 800, tracking: -0.02, leading: 1.1 })
})

test('body and label are untouched', () => {
  assert.deepEqual(typeScale.bodyL, { size: 18, weight: 400, tracking: -0.005, leading: 1.5 })
  assert.deepEqual(typeScale.body, { size: 16, weight: 400, tracking: 0, leading: 1.55 })
  assert.deepEqual(typeScale.small, { size: 14, weight: 400, tracking: 0, leading: 1.5 })
  assert.deepEqual(typeScale.label, { size: 12, weight: 500, tracking: 0.12, leading: 1.2, mono: true, uppercase: true })
})

test('the two mono sizes the app adds: the small label and the button’s own', () => {
  assert.deepEqual(typeScale.labelSm, { size: 10, weight: 500, tracking: 0.14, leading: 1.2, mono: true, uppercase: true })
  assert.deepEqual(typeScale.mono11, { size: 11, weight: 700, tracking: 0.1, leading: 1.2, mono: true, uppercase: true })
  // Tracking opens as the size drops.
  assert.ok(typeScale.labelSm.tracking > typeScale.label.tracking)
  assert.ok(typeScale.labelSm.size < typeScale.label.size)
})

test('mono11 is the button’s type, so the two cannot drift apart', () => {
  assert.equal(typeScale.mono11.size, button.size)
  assert.equal(typeScale.mono11.weight, button.weight)
  assert.equal(typeScale.mono11.tracking, button.tracking)
  assert.equal(typeScale.mono11.mono, button.font === 'mono')
  assert.equal(typeScale.mono11.uppercase, button.uppercase)
})

test('the button is one object: mono, 11/700, uppercase, square', () => {
  assert.deepEqual(button, {
    font: 'mono', size: 11, weight: 700, tracking: 0.1, uppercase: true,
    padding: { y: 12, x: 18 }, compact: { y: 11, x: 14 },
    fill: '#141416', ink: '#FBFBF8', hover: '#3B2FD4', hoverInk: '#FFFFFF', radius: 0,
  })
})

test('the button fills with ink on a sheet, and hovers to the stamp', () => {
  assert.equal(button.fill, colors.inkFg)
  assert.equal(button.ink, colors.sheet)
  assert.equal(button.hover, colors.stamp)
})

test('a button is a stamp, not a pill — in both places the radius is named', () => {
  assert.equal(radius.button, 0)
  assert.equal(button.radius, 0)
})

test('the web asks for its faces as CSS stacks', () => {
  assert.equal(fonts.web.sans, "'Archivo', 'Archivo Fallback', 'Archivo Fallback Arial', ui-sans-serif, system-ui, sans-serif")
  assert.equal(fonts.web.mono, "'Martian Mono', 'Martian Mono Fallback', ui-monospace, SFMono-Regular, Menlo, monospace")
})

test('the app asks for one family name per weight', () => {
  assert.deepEqual(fonts.native.sans, {
    400: 'Archivo_400Regular', 500: 'Archivo_500Medium', 600: 'Archivo_600SemiBold', 800: 'Archivo_800ExtraBold',
  })
  assert.deepEqual(fonts.native.mono, {
    400: 'MartianMono_400Regular', 500: 'MartianMono_500Medium', 600: 'MartianMono_600SemiBold', 700: 'MartianMono_700Bold',
  })
})

test('the weights the site loads cover the weights it sets', () => {
  assert.equal(fonts.google.sans, 'Archivo:wght@400;500;600;700;800')
  assert.equal(fonts.google.mono, 'Martian+Mono:wght@400;500;600;700')
  // The display weight and the button's weight each have a file behind them.
  assert.ok(fonts.google.sans.includes(String(typeScale.displayXL.weight)))
  assert.ok(fonts.google.mono.includes(String(button.weight)))
})

test('the old flat font stacks are gone — every reader moves to web or native', () => {
  assert.ok(!('sans' in fonts))
  assert.ok(!('mono' in fonts))
})

test('six inks, in the order the picker prints them', () => {
  assert.deepEqual(inks, [
    { id: 'ink', hex: '#141416', label: 'Ink', default: true },
    { id: 'red', hex: '#A30002', label: 'Red' },
    { id: 'orange', hex: '#7D4600', label: 'Orange' },
    { id: 'green', hex: '#006826', label: 'Green' },
    { id: 'blue', hex: '#0052A8', label: 'Blue' },
    { id: 'purple', hex: '#8400A1', label: 'Purple' },
  ])
})

test('exactly one ink is the default, and it is the first', () => {
  const defaults = inks.filter((i) => 'default' in i && i.default)
  assert.equal(defaults.length, 1)
  assert.equal(defaults[0]?.id, 'ink')
  assert.equal(inks[0].id, 'ink')
})

test('the storage key is shared with the app, verbatim', () => {
  assert.equal(INK_STORAGE_KEY, 'lyzn.ink')
})

test('the wordmark is the button’s type, half a step larger', () => {
  assert.deepEqual(wordmark, {
    name: 'LYZN',
    dots: 6,
    text: 'LYZN......',
    size: 15,
    weight: 700,
    tracking: 0.1,
  })
  assert.equal(wordmark.weight, button.weight)
  assert.equal(wordmark.tracking, button.tracking)
})

/* The ellipsis is the palette: on the website each dot is the ink it sets,
   so a mark with the wrong number of them is a mark that lies about what it
   does. Pinned as a relationship rather than a count, because the count is
   allowed to change and the relationship is not. */
test('the mark has one dot for each ink', () => {
  assert.equal(wordmark.dots, inks.length)
  assert.equal(wordmark.text, wordmark.name + '.'.repeat(inks.length))
})

test('chart series keep the validated order and values in both modes', async () => {
  const { chart } = await import('../src/tokens.ts')
  assert.deepEqual(chart.series.desk, ['#1F68BC', '#09A198', '#8A4B0B', '#D168A7', '#866C02'])
  assert.deepEqual(chart.series.night, ['#2971C6', '#14A49C', '#945418', '#CD65A4', '#896F09'])
  const states = [colors.stamp, colors.settled, colors.danger, colors.carbon, colors.stampNight, colors.settledNight, colors.dangerNight]
  for (const c of [...chart.series.desk, ...chart.series.night]) assert.ok(!states.includes(c as never), `${c} doubles as a state colour`)
})
