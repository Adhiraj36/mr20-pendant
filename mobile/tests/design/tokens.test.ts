/**
 * The app's tokens read from @lyzn/design correctly, and every entry in the
 * type scale carries the family it needs (app spec §4.2: never a weight
 * without its family — Android synthesises a fake bold otherwise).
 *
 * Since round six the package is the description and this file is the seam:
 * the faces, the display end of the scale and the whole button come from
 * `@lyzn/design`, so these tests pin both the absolute numbers the app ships
 * and the conversions it does on the way — em to points, a weight to a file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fonts, typeScale, tones as sharedTones } from '@lyzn/design';
import {
  colors, tones, radius, type, fontFamily, button, buttonLabel, joinLabel,
} from '../../src/design/tokens';

test('colors come from @lyzn/design', () => {
  assert.equal(colors.signal, '#C9A76A');
  assert.equal(colors.ink, '#0B0B0C');
  assert.equal(colors.paper, '#F3F1EC');
});

/**
 * The reference site's page-level colours reach the app through the same
 * re-export, so a screen that wants the sheet's secondary text or its
 * hairline does not invent one.
 */
test('the website page colours arrive through the re-export', () => {
  assert.equal(colors.sheet, '#FBFBF8');
  assert.equal(colors.faded, '#6E6F64');
  assert.equal(colors.rule, '#D5D5CC');
  assert.equal(colors.settled, '#1B6B45');
});

/**
 * Four grounds since round seven, not two. The desk *is* one now — it is the
 * app's daylight, the ground the canvas lays its sheets on — and the night
 * is the same room with the lights off. Ink and paper stay: a receipt is
 * paper whichever theme is on (canvas D2), and the screens that have not
 * been rebuilt still stand on ink.
 */
test('the app has four grounds, and the desk is one of them', () => {
  assert.deepEqual(Object.keys(tones).sort(), ['desk', 'ink', 'night', 'paper']);
  assert.equal(tones.desk.bg, colors.desk);
  assert.equal(tones.night.bg, colors.night);
});

/**
 * Every ground answers every question, so a component never has to ask which
 * ground it is on before reaching for a colour. This is the assertion the
 * kit leans on: `bg-tone-carbon` has to mean something on all four.
 */
const TONE_KEYS = [
  'bg', 'fg', 'muted', 'faint', 'line', 'line2', 'panel', 'panel2',
  'invBg', 'invFg', 'statusBar',
  'carbon', 'carbonLine', 'stamp', 'settled', 'danger',
] as const;

test('every tone is complete', () => {
  for (const [name, tone] of Object.entries(tones)) {
    assert.deepEqual(
      Object.keys(tone).sort(),
      [...TONE_KEYS].sort(),
      `${name} does not answer the same questions as the others`,
    );
    for (const key of TONE_KEYS) {
      const value = (tone as Record<string, string>)[key];
      assert.equal(typeof value, 'string', `${name}.${key}`);
      assert.ok(value.length > 0, `${name}.${key} is empty`);
    }
  }
});

/**
 * The app keeps no tone table of its own: `tones` here *is* the package's,
 * re-exported. A ground added to @lyzn/design is a ground the app has.
 */
test('the tones are the package\'s, not a copy of them', () => {
  assert.equal(tones, sharedTones);
});

test('each ground inverts into its opposite', () => {
  assert.equal(tones.ink.invBg, colors.fg);
  assert.equal(tones.ink.invFg, colors.ink);
  assert.equal(tones.paper.invBg, colors.inkFg);
  assert.equal(tones.paper.invFg, colors.paper);
  assert.equal(tones.desk.invBg, colors.deskInk);
  assert.equal(tones.desk.invFg, colors.sheet);
  assert.equal(tones.night.invBg, colors.sheet);
  assert.equal(tones.night.invFg, colors.night);
  assert.equal(tones.ink.statusBar, 'light');
  assert.equal(tones.paper.statusBar, 'dark');
  // The desk is lit and the night is not, so the bar follows the ground and
  // not the theme's name for it.
  assert.equal(tones.desk.statusBar, 'dark');
  assert.equal(tones.night.statusBar, 'light');
});

/**
 * The signals are the same four roles on every ground, each already lifted
 * or darkened for what it will be read against — the app never picks the
 * night variant of a colour itself.
 */
test('the signals are read for the ground they are on', () => {
  assert.equal(tones.desk.stamp, colors.stamp);
  assert.equal(tones.desk.carbon, colors.carbon);
  assert.equal(tones.desk.danger, colors.danger);
  assert.equal(tones.night.stamp, colors.stampNight);
  assert.equal(tones.night.carbon, colors.carbonDeep);
  assert.equal(tones.night.danger, colors.dangerNight);
  // The reference's own void red, on both surfaces, since round seven.
  assert.equal(colors.danger, '#B03A2E');
});

/**
 * The app keeps no private list of family names: `fontFamily` *is*
 * `fonts.native`, and `app/_layout.tsx` registers one file per entry.
 */
test('the faces are the package\'s, not a copy of them', () => {
  assert.equal(fontFamily, fonts.native);
  assert.deepEqual(Object.keys(fontFamily.sans), ['400', '500', '600', '800']);
  assert.deepEqual(Object.keys(fontFamily.mono), ['400', '500', '600', '700']);
  assert.equal(fontFamily.sans[800], 'Archivo_800ExtraBold');
  assert.equal(fontFamily.mono[700], 'MartianMono_700Bold');
});

/**
 * App spec §4.2's table, verbatim: size, letter-spacing and line-height in
 * points — set in the faces ruling R17 gave the app, Archivo and Martian
 * Mono, in place of §4.2's Geist. These are the numbers every screen
 * inherits, so a drift here is a drift everywhere — pinned, not described.
 *
 * The three display rows are Archivo 800 as of round six, with the
 * reference's tracking and leading converted from `typeScale`. Their sizes
 * are unchanged: 40/32/24 are the phone floors of the web's own clamps
 * (`2.5rem`/`2rem`/`1.5rem`), so the app is the site at phone width.
 */
const SCALE: Record<string, [string, number, number, number]> = {
  //          family                    size  tracking  line-height
  displayXL:  ['Archivo_800ExtraBold',    40,   -1.52,   39],
  displayL:   ['Archivo_800ExtraBold',    32,   -1.12,   33],
  displayM:   ['Archivo_800ExtraBold',    24,   -0.48,   26],
  bodyL:      ['Archivo_400Regular',      18,   -0.09,   27],
  body:       ['Archivo_400Regular',      16,    0,      25],
  bodyStrong: ['Archivo_500Medium',       16,    0,      25],
  small:      ['Archivo_400Regular',      14,    0,      21],
  smallStrong:['Archivo_500Medium',       14,    0,      21],
  label:      ['MartianMono_500Medium',   12,    1.44,   14],
  labelSm:    ['MartianMono_500Medium',   11,    1.32,   13],
  mono11:     ['MartianMono_400Regular',  11,    0,      14],
};

test('the type scale is spec §4.2, to the point', () => {
  for (const [name, [family, size, tracking, leading]] of Object.entries(SCALE)) {
    const entry = type[name as keyof typeof type];
    assert.ok(entry, `${name} is missing from the scale`);
    assert.equal(entry.fontFamily, family, `${name} family`);
    assert.equal(entry.fontSize, size, `${name} size`);
    assert.equal(entry.letterSpacing, tracking, `${name} tracking`);
    assert.equal(entry.lineHeight, leading, `${name} line-height`);
  }
});

/**
 * …and the display end of it is derived, not restated: `typeScale` holds the
 * weight, the tracking as a fraction of the em and the leading as a multiple
 * of the size, and the app converts each to what React Native takes. A
 * package change therefore lands here first, and fails the table above.
 */
test('the display variants are read from typeScale', () => {
  for (const name of ['displayXL', 'displayL', 'displayM'] as const) {
    const shared = typeScale[name];
    const entry = type[name];
    assert.equal(shared.weight, 800, `${name} is the reference's heading weight`);
    assert.equal(entry.fontFamily, fontFamily.sans[shared.weight], `${name} family`);
    assert.equal(
      entry.letterSpacing,
      Math.round(entry.fontSize * shared.tracking * 100) / 100,
      `${name} tracking is ${shared.tracking}em at ${entry.fontSize}`,
    );
    assert.equal(
      entry.lineHeight,
      Math.round(entry.fontSize * shared.leading),
      `${name} leading is ${shared.leading} × ${entry.fontSize}`,
    );
  }
});

test('every type entry has a fontFamily, and only families the app registers', () => {
  const registered: string[] = [
    ...Object.values(fontFamily.sans),
    ...Object.values(fontFamily.mono),
  ];
  const entries = Object.values(type);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.equal(typeof entry.fontFamily, 'string');
    assert.ok(registered.includes(entry.fontFamily), `${entry.fontFamily} is not a package face`);
  }
});

/**
 * The old rule was "never 700", and the display variants broke it at 800.
 * What survives is the narrower true thing: a mono *label* is 400 or 500,
 * and the heavier mono cuts belong to the receipt (600) and the button (700)
 * rather than to the scale.
 */
test('mono labels are uppercase and stay at 400/500', () => {
  assert.equal(type.label.fontFamily, fontFamily.mono[500]);
  assert.equal(type.label.textTransform, 'uppercase');
  assert.equal(type.labelSm.fontFamily, fontFamily.mono[500]);
  assert.equal(type.labelSm.textTransform, 'uppercase');
  assert.equal(type.mono11.fontFamily, fontFamily.mono[400]);
  for (const entry of Object.values(type)) {
    if (!entry.fontFamily.startsWith('MartianMono')) continue;
    assert.match(entry.fontFamily, /_[45]00/, `${entry.fontFamily} is heavier than a label`);
  }
});

/**
 * The button is one object on both surfaces, and @lyzn/design is where it
 * lives: Martian Mono 11/700, uppercase, a tenth of an em apart, square, ink
 * on a sheet. `hover`/`hoverInk` are the two fields the app does not read —
 * a finger has no hover — so they are not asserted here.
 */
test('the button is the package\'s button', () => {
  assert.equal(button.font, 'mono');
  assert.equal(button.size, 11);
  assert.equal(button.weight, 700);
  assert.equal(button.tracking, 0.1);
  assert.equal(button.uppercase, true);
  assert.deepEqual(button.padding, { y: 12, x: 18 });
  assert.deepEqual(button.compact, { y: 11, x: 14 });
  assert.equal(button.fill, colors.inkFg);
  assert.equal(button.ink, colors.sheet);
  // Said twice on purpose: `button.radius` is `radius.button` at the point of
  // use, and R17b is the reason both are 0.
  assert.equal(button.radius, 0);
  assert.equal(button.radius, radius.button);
});

test('the button label converts the two CSS-shaped fields', () => {
  assert.equal(buttonLabel.fontFamily, fontFamily.mono[button.weight]);
  assert.equal(buttonLabel.fontFamily, 'MartianMono_700Bold');
  assert.equal(buttonLabel.fontSize, 11);
  // A tenth of an em at 11 points.
  assert.equal(buttonLabel.letterSpacing, 1.1);
  assert.equal(buttonLabel.textTransform, 'uppercase');
});

test('radius answers to both the package name and the spec name', () => {
  assert.equal(radius.card, 20);
  assert.equal(radius.panel, radius.card);
  // Square, as the site shipped them (R17b, and spec §0.2: the code wins
  // over a spec it moved past). §4.4's "12 | buttons" is the older number.
  assert.equal(radius.button, 0);
  assert.equal(radius.input, 10);
  assert.equal(radius.chip, 6);
  assert.equal(radius.tick, 2);
  // Ruling R17b: a button is square. It is the only member of app spec
  // §4.4's 12-group that moved — the surfaces below keep their corner.
  assert.equal(radius.button, 0);
  assert.equal(radius.task, 12);
  assert.equal(radius.bubble, 12);
  assert.equal(radius.toast, 12);
});

/**
 * The site squared its buttons and its inputs and nothing else — its task
 * row and its status block are still `rounded-[12px]` in `Stage.tsx`. These
 * aliased `button` and would have gone square with it, so they are pinned.
 */
test('the 12s of §4.4 do not follow the button to zero', () => {
  assert.equal(radius.task, 12);
  assert.equal(radius.toast, 12);
  assert.equal(radius.bubble, 12);
  assert.equal(radius.play, 12);
});

test('a label drops its empty fragments rather than printing the token', () => {
  assert.equal(joinLabel(['PULLING', undefined, '3 OF 9']), 'PULLING · 3 OF 9');
  assert.equal(joinLabel([false, '', undefined]), '');
});
