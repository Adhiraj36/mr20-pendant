/**
 * The appearance: light by default, dark by choice — plan §2.3.
 *
 * `theme.ts` is deliberately React-free so this file can reach it: the whole
 * of the light/dark decision is four pure functions, and everything else —
 * AsyncStorage, NativeWind's colour scheme, the provider — is plumbing
 * around them. A regression in the *decision* is caught here rather than on
 * a simulator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tones } from '@lyzn/design';
import {
  DEFAULT_THEME, THEMES, THEME_STORAGE_KEY,
  isTheme, parseTheme, resolveGround, resolveScheme,
  type Theme,
} from '../../src/design/theme';

test('light is the default, and it is a choice rather than the phone\'s', () => {
  assert.equal(DEFAULT_THEME, 'light');
  // Not 'system': the canvas is a lit desk, and a phone in dark mode still
  // gets the desk until its owner says otherwise.
  assert.notEqual(DEFAULT_THEME as Theme, 'system');
});

test('there are three themes, in the order a settings screen offers them', () => {
  assert.deepEqual([...THEMES], ['light', 'dark', 'system']);
});

/**
 * The key is pinned because it is a contract with the phone, not with the
 * code: renaming it silently resets everyone's choice on the next release.
 */
test('the choice is kept under lyzn.theme', () => {
  assert.equal(THEME_STORAGE_KEY, 'lyzn.theme');
});

test('only the three are themes', () => {
  for (const theme of THEMES) assert.ok(isTheme(theme));
  for (const other of ['Light', 'auto', '', null, undefined, 0, {}]) {
    assert.equal(isTheme(other), false, String(other));
  }
});

/**
 * Storage can answer with anything: a key that was never written, a value
 * from a build that spelled it differently, half of a write that did not
 * land. None of them is worth failing over — there is no sensible way to
 * fail at picking a colour.
 */
test('anything that is not a theme reads back as the default', () => {
  assert.equal(parseTheme('dark'), 'dark');
  assert.equal(parseTheme('system'), 'system');
  assert.equal(parseTheme(null), DEFAULT_THEME);
  assert.equal(parseTheme(undefined), DEFAULT_THEME);
  assert.equal(parseTheme(''), DEFAULT_THEME);
  assert.equal(parseTheme('DARK'), DEFAULT_THEME);
  assert.equal(parseTheme({ theme: 'dark' }), DEFAULT_THEME);
});

test('an explicit theme ignores the phone; system defers to it', () => {
  assert.equal(resolveScheme('light', 'dark'), 'light');
  assert.equal(resolveScheme('dark', 'light'), 'dark');
  assert.equal(resolveScheme('system', 'dark'), 'dark');
  assert.equal(resolveScheme('system', 'light'), 'light');
});

/**
 * A phone that has not answered yet — a cold start, or an appearance
 * override that has just been cleared and reads back as `unspecified` — is
 * light. The alternative is a screen that flashes dark and then corrects
 * itself.
 */
test('a silent phone is light', () => {
  assert.equal(resolveScheme('system', null), 'light');
  assert.equal(resolveScheme('system', undefined), 'light');
  assert.equal(resolveScheme('system', 'unspecified'), 'light');
});

test('a theme resolves to a ground, and only ever to those two', () => {
  assert.equal(resolveGround('light', 'dark'), 'desk');
  assert.equal(resolveGround('dark', 'light'), 'night');
  assert.equal(resolveGround('system', 'dark'), 'night');
  assert.equal(resolveGround('system', 'light'), 'desk');
  assert.equal(resolveGround('system', null), 'desk');
});

/**
 * The two grounds a theme can name are real grounds. Ink and paper are not
 * reachable this way on purpose: a receipt is paper in both themes, so it
 * names its ground rather than inheriting one.
 */
test('the grounds a theme resolves to exist in the design package', () => {
  for (const theme of THEMES) {
    const ground = resolveGround(theme, 'dark');
    assert.ok(ground in tones, `${ground} is not a ground`);
  }
  assert.ok('paper' in tones);
  // Said in the type as well as here: `ThemeGround` is 'desk' | 'night', so
  // a theme cannot resolve to paper or ink even by accident.
  const reachable = new Set(THEMES.flatMap((t) => [
    resolveGround(t, 'light'), resolveGround(t, 'dark'), resolveGround(t, null),
  ]));
  assert.deepEqual([...reachable].sort(), ['desk', 'night']);
});
