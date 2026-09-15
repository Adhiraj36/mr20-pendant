/**
 * The LYZN visual system, as numbers.
 *
 * Four grounds, not two. The app is now drawn on the design canvas, and the
 * canvas is a desk: `desk` is the surface a screen is laid on, `sheet` the
 * paper lying on it, and `night` the same room with the lights off. `ink`
 * and `paper` are the two grounds the site was built in; they are unchanged,
 * because the web still reads them and because a receipt is printed on
 * `paper` whatever the screen around it is doing. Receipts never go dark —
 * that is the whole reason `paper` survives as a ground of its own rather
 * than being folded into `desk`.
 *
 * The web reads these through a generated @theme block; the app reads a
 * generated tokens.json as its Tailwind theme, and its tones as CSS
 * variables. Neither surface may hold a colour of its own — if something is
 * missing, it is added here.
 *
 * `desk`, `sheet` and `stamp` are the reference site's page-level colours.
 * The desk is the ground the whole website is laid on — one step below
 * paper, ruled with a 28px grid in web/src/index.css — and every section is
 * transparent over it, so a `sheet` panel reads as a sheet lying on a desk.
 * `faded` is that sheet's secondary text and `rule` its hairline; `settled`
 * is the green a receipt marks a paid line in. The stamp is the blue a
 * button fills with under the pointer, and the only place on the site it
 * appears at more than hairline size. In the app the stamp is the one live
 * action colour, and `carbon` — the yellow of a carbon copy — is the ground
 * of anything waiting on the reader.
 *
 * `void` is the darkest of the three ink grounds, and it is not a red.
 * `danger` is: it now holds the reference's own `--void`, the red a
 * cancelled line is printed in, on both surfaces. That is the one visible
 * change this round makes to the website.
 */
export const colors = {
  ink: '#0B0B0C', charcoal: '#131315', void: '#050506',
  graphite: '#1C1C1F', graphite2: '#242428',
  paper: '#F3F1EC', paper2: '#EAE7E0', paper3: '#DDD9D0',
  desk: '#E3E4DE', sheet: '#FBFBF8', faded: '#6E6F64', rule: '#D5D5CC',
  fg: '#EDEAE4', fgMuted: '#A6A39D', fgFaint: '#8D8C87',
  inkFg: '#141416', inkMuted: '#5B5A57', inkFaint: '#66655F',
  signal: '#C9A76A', danger: '#B03A2E', stamp: '#3B2FD4', settled: '#1B6B45',
  receiptPaper: '#FBFAF6', receiptInk: '#16181A', receiptFaint: '#8A8880',

  // The desk, and what is written on it. `deskFaint` is `faded` under the
  // name the desk calls it by; the desk's own hairline is a shade warmer
  // than the site's `rule`, because it is drawn on a warmer ground.
  deskInk: '#1C1C16', deskMuted: '#3B3B33', deskFaint: '#6E6F64', deskLine: '#D9D9D1',
  // Carbon: the yellow of a carbon copy. Everything waiting on the reader is
  // on it, and nothing else ever is — it is a state, not a decoration.
  carbon: '#F1E8CC', carbonLine: '#DDD2AE',

  // The same room with the lights off. `nightPanel` is below the ground, not
  // above it: at night a panel is a hole, not a card.
  night: '#1C1C16', nightPanel: '#111109', nightLine: '#4A4A3E', nightMuted: '#9C9C90', nightFaint: '#8A8A7E',
  carbonDeep: '#3A3323', carbonDeepLine: '#554C34', carbonDeepInk: '#EBDFB8', carbonDeepMuted: '#CFC7AE',
  stampNight: '#8B82FF', settledNight: '#6FCF9A', dangerNight: '#E0705E',
} as const

export type Ground = 'ink' | 'paper' | 'desk' | 'night'

/**
 * Every ground answers the same questions, so a component never asks which
 * ground it is on. The five at the end are the signals: `carbon` and its
 * line are the waiting state, `stamp` the live action, `settled` the done
 * one, `danger` the failed one — each already darkened or lifted for the
 * ground it is read against.
 */
export type Tone = {
  bg: string; fg: string; muted: string; faint: string
  line: string; line2: string; panel: string; panel2: string
  invBg: string; invFg: string; statusBar: 'light' | 'dark'
  carbon: string; carbonLine: string; stamp: string; settled: string; danger: string
}

export const tones = {
  ink: {
    bg: colors.ink, fg: colors.fg, muted: colors.fgMuted, faint: colors.fgFaint,
    line: 'rgba(237,234,228,0.10)', line2: 'rgba(237,234,228,0.22)',
    panel: colors.graphite, panel2: colors.graphite2,
    invBg: colors.fg, invFg: colors.ink, statusBar: 'light',
    carbon: colors.carbonDeep, carbonLine: colors.carbonDeepLine,
    stamp: colors.stampNight, settled: colors.settledNight, danger: colors.dangerNight,
  },
  paper: {
    bg: colors.paper, fg: colors.inkFg, muted: colors.inkMuted, faint: colors.inkFaint,
    line: 'rgba(20,20,22,0.10)', line2: 'rgba(20,20,22,0.24)',
    panel: colors.paper2, panel2: colors.paper3,
    invBg: colors.inkFg, invFg: colors.paper, statusBar: 'dark',
    carbon: colors.carbon, carbonLine: colors.carbonLine,
    stamp: colors.stamp, settled: colors.settled, danger: colors.danger,
  },
  desk: {
    bg: colors.desk, fg: colors.deskInk, muted: colors.deskMuted, faint: colors.deskFaint,
    line: colors.deskLine, line2: colors.deskInk,
    panel: colors.sheet, panel2: '#EDEDE8',
    invBg: colors.deskInk, invFg: colors.sheet, statusBar: 'dark',
    carbon: colors.carbon, carbonLine: colors.carbonLine,
    stamp: colors.stamp, settled: colors.settled, danger: colors.danger,
  },
  night: {
    bg: colors.night, fg: colors.sheet, muted: colors.nightMuted, faint: colors.nightFaint,
    line: colors.nightLine, line2: colors.sheet,
    panel: colors.nightPanel, panel2: '#1C1C16',
    invBg: colors.sheet, invFg: colors.night, statusBar: 'light',
    carbon: colors.carbonDeep, carbonLine: colors.carbonDeepLine,
    stamp: colors.stampNight, settled: colors.settledNight, danger: colors.dangerNight,
  },
} as const satisfies Record<Ground, Tone>

/** 4pt rhythm. The website's scale (§5.3) and the app's agree on the base. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48, giant: 64 } as const

/** Named by use, per the website spec §5.4 — not by size. */
/** Buttons are square: a button is a stamp on the receipt, not a pill. */
export const radius = { tick: 2, chip: 6, input: 10, button: 0, card: 20, cardLg: 24 } as const

/**
 * The one pill in the system. A settings toggle is the only control on
 * either surface that is allowed a round end, because a switch that looks
 * like a button reads as a button — the canvas' component sheet draws it at
 * exactly this size and nowhere else.
 */
export const toggle = { w: 44, h: 26, radius: 13 } as const

/**
 * The angle a stamp lands at. A stamp is pressed by hand, so it is never
 * square to the paper; the canvas presses every one of them at the same
 * eleven degrees counter-clockwise, which is what makes them read as one
 * stamp rather than as decoration applied per screen.
 */
export const stampAngle = -11

export const dur = { micro: 120, ui: 160, reveal: 700, slow: 900 } as const
export const ease = {
  out: [0.16, 1, 0.3, 1], inOut: [0.65, 0, 0.35, 1], in: [0.4, 0, 1, 1],
} as const

/**
 * Sizes in px at a phone-width viewport; the web wraps the three display
 * sizes in clamp() when it generates its CSS. The clamps live in
 * scripts/gen-css.mjs, because they are the web's fluid behaviour and not
 * the scale's numbers — the app uses the px straight.
 *
 * `labelSm` is the label one step down, the eyebrow the app sets above a
 * card; tracking opens as the size drops, which is why it is not the same
 * number as `label`'s. `mono11` is the button's own type promoted to a size
 * in the scale, so a stamp, a tab label and a button can name one entry
 * instead of three — a test pins it to `button` so the two cannot drift
 * apart.
 *
 * Body and label weights are 400 and 500. The three display sizes are
 * Archivo 800, pulled tight and set close: that is the reference's fit for a
 * heading, and at 500 a headline was not louder than the 11px mono labels
 * standing beside it. 800 needs a real file on both surfaces — the site asks
 * for it in `fonts.google.sans`, the app registers `fonts.native.sans`'s 800
 * — because Android synthesises a fake bold for any weight it has no file
 * for, and a synthesised 800 is not this face.
 */
export const typeScale = {
  displayXL: { size: 44, weight: 800, tracking: -0.038, leading: 0.97 },
  displayL:  { size: 32, weight: 800, tracking: -0.035, leading: 1.02 },
  displayM:  { size: 24, weight: 800, tracking: -0.02,  leading: 1.1 },
  bodyL:     { size: 18, weight: 400, tracking: -0.005, leading: 1.5 },
  body:      { size: 16, weight: 400, tracking: 0,      leading: 1.55 },
  small:     { size: 14, weight: 400, tracking: 0,      leading: 1.5 },
  label:     { size: 12, weight: 500, tracking: 0.12,   leading: 1.2, mono: true, uppercase: true },
  labelSm:   { size: 10, weight: 500, tracking: 0.14,   leading: 1.2, mono: true, uppercase: true },
  mono11:    { size: 11, weight: 700, tracking: 0.1,    leading: 1.2, mono: true, uppercase: true },
} as const

/**
 * The button, which is one object on both surfaces: Martian Mono at 11px/700
 * with a tenth of an em of tracking, uppercase, square, ink on a sheet, and
 * the stamp's blue under the pointer. It is the same object as the wordmark
 * and the labels — the site is set in two faces, and the button is not a
 * third.
 *
 * `padding` is the button at rest; `compact` is the narrower one the
 * reference switches to where there is less air. `radius` repeats
 * `radius.button` at the point of use, so a reader that wants the button
 * need not know the radius table exists — the two are one number, and both
 * are 0.
 */
export const button = {
  font: 'mono', size: 11, weight: 700, tracking: 0.1, uppercase: true,
  padding: { y: 12, x: 18 }, compact: { y: 11, x: 14 },
  fill: colors.inkFg, ink: colors.sheet, hover: colors.stamp, hoverInk: '#FFFFFF', radius: 0,
} as const

/**
 * The two faces, in the three forms the surfaces ask for them.
 *
 * Archivo for text and Martian Mono for everything set in mono — the
 * receipts, the labels, the buttons, the wordmark.
 *
 * `web` is the CSS family stack; its two fallbacks are local faces
 * metric-matched in web/src/index.css so the swap changes shapes, not line
 * breaks. `native` is the family name per weight, the way @expo-google-fonts
 * publishes them: React Native takes one family name rather than a stack and
 * a weight, so a style asks for the file by name and Android is never given
 * a reason to synthesise one. `google` is the family segment of the <link>
 * web/index.html requests, so the weights that are loaded and the weights
 * that are used are the same list in one place.
 */
export const fonts = {
  web: {
    sans: "'Archivo', 'Archivo Fallback', 'Archivo Fallback Arial', ui-sans-serif, system-ui, sans-serif",
    mono: "'Martian Mono', 'Martian Mono Fallback', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  native: {
    sans: { 400: 'Archivo_400Regular', 500: 'Archivo_500Medium', 600: 'Archivo_600SemiBold', 800: 'Archivo_800ExtraBold' },
    mono: { 400: 'MartianMono_400Regular', 500: 'MartianMono_500Medium', 600: 'MartianMono_600SemiBold', 700: 'MartianMono_700Bold' },
  },
  google: { sans: 'Archivo:wght@400;500;600;700;800', mono: 'Martian+Mono:wght@400;500;600;700' },
} as const

/**
 * The six printer inks. The reader picks the colour the headings are set in,
 * the way a press operator picks a plate, and nothing else on the page
 * changes — not the stamp, not the buttons, not a rule.
 *
 * The default ink is a rule nowhere: the web removes the `data-ink`
 * attribute rather than setting `data-ink="ink"`, so `--heading` goes
 * undefined and every heading falls back to the tone it would have had if
 * none of this existed. The generator therefore emits a `[data-ink]` block
 * for the other five only, and the default's `hex` is a swatch colour — what
 * the picker paints in its own row, not what any heading reads.
 *
 * The ids and the storage key are shared with the app so a future account
 * sync maps one-to-one, which is why they are plain strings and not an enum.
 */
type InkSwatch = { id: string; hex: string; label: string; default?: boolean }

export const inks = [
  { id: 'ink', hex: colors.inkFg, label: 'Ink', default: true },
  { id: 'red', hex: '#A30002', label: 'Red' }, { id: 'orange', hex: '#7D4600', label: 'Orange' },
  { id: 'green', hex: '#006826', label: 'Green' }, { id: 'blue', hex: '#0052A8', label: 'Blue' }, { id: 'purple', hex: '#8400A1', label: 'Purple' },
] as const satisfies readonly InkSwatch[]

export const INK_STORAGE_KEY = 'lyzn.ink'

/**
 * The name, set as a stamp: the button's face and tracking, half a step
 * larger.
 *
 * The ellipsis is the palette. There is one dot for each ink, because on the
 * website those dots *are* the picker — they sit in the bar looking like
 * type until a pointer crosses them, and then each one is the colour it
 * sets. A count typed here instead would be a mark that quietly stopped
 * meaning what it draws the day an ink was added.
 *
 * `name` and `dots` are for the places that need the two halves apart; the
 * `text` is the mark as one string, for the places that do not.
 */
export const wordmark = {
  name: 'LYZN',
  dots: inks.length,
  text: `LYZN${'.'.repeat(inks.length)}`,
  size: 15,
  weight: 700,
  tracking: 0.1,
} as const

/**
 * Code, set in the printer inks.
 *
 * A code block in a reply is printed, not lit. The five coloured inks a
 * reader can set headings in are the only colours a grammar gets, so nothing
 * in a code block borrows the stamp, the settled green or the void red — each
 * of those still means one thing. The night set lifts every ink until it
 * reads on the night panel; this is the one place those lifted values exist.
 */
const inkHex = (id: (typeof inks)[number]['id']): string => inks.find((i) => i.id === id)!.hex

export const codeInk = {
  desk: {
    fg: colors.deskInk, muted: colors.deskMuted, faint: colors.deskFaint,
    keyword: inkHex('blue'), string: inkHex('green'), number: inkHex('orange'),
    entity: inkHex('purple'), tag: inkHex('red'),
  },
  night: {
    fg: colors.fg, muted: colors.nightMuted, faint: colors.nightFaint,
    keyword: '#8DB6F2', string: '#86C79B', number: '#D9A55E', entity: '#C9A0E6', tag: '#EE8A80',
  },
} as const

/**
 * Charts and dashboards.
 *
 * `series` is the order data takes its colours in, and the order is the point:
 * it was chosen by enumerating every ordering of five on-brand hues (blue, teal,
 * amber, plum, ochre) and stepping each for its ground, then kept only because
 * it passes the palette checks in both modes — neighbours, including the last
 * against the first that a donut puts side by side, stay at least 16.6 apart
 * (OKLab ΔE×100) under protanopia and deuteranopia simulation and 17.7 apart
 * for everyone else, each at 3:1 or better on the sheet a chart sits on. Change
 * a value and the checks have to be run again; a sixth series is folded into
 * "Other", never given a colour of its own.
 *
 * None of these is a state. The stamp, settled green, carbon and red keep
 * their meanings on a dashboard exactly as everywhere else.
 */
export const chart = {
  series: {
    desk: ['#1F68BC', '#09A198', '#8A4B0B', '#D168A7', '#866C02'],
    night: ['#2971C6', '#14A49C', '#945418', '#CD65A4', '#896F09'],
  },
  /** A gridline one step off the sheet, and the stronger rule under a header. */
  rule: { desk: colors.deskLine, night: '#34342B' },
  rule2: { desk: '#BDBDB2', night: colors.nightLine },
  /** Waiting, as text: carbon is a ground and too light to read as a word. */
  wait: { desk: '#8A6A1C', night: '#D9BD7A' },
} as const
