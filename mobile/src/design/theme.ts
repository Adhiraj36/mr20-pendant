/**
 * The appearance: light by default, dark by choice — round seven, §2.3.
 *
 * A **theme** is what the person picked. A **ground** is what a screen
 * stands on. They are not the same thing and the app needs both: the theme
 * has three values because "follow the phone" is a real answer, and the
 * ground has four because a receipt is paper whichever theme is on and the
 * legacy ink screens have not been rebuilt yet. This module is the one place
 * that turns one into the other.
 *
 * Light is the default, and deliberately so: the canvas is a desk with paper
 * on it, and the desk is lit. A phone in dark mode gets the desk too until
 * its owner says otherwise — `'system'` is a choice, not the starting point.
 *
 * No React and no react-native here: this is the file `node --test` reads
 * directly. The hook that persists the choice lives in `tone.tsx`, next to
 * the provider that consumes it.
 */

/** The appearance the person picked. Three values, one of them deferred. */
export type Theme = 'light' | 'dark' | 'system';

/** In the order a settings screen offers them. */
export const THEMES = ['light', 'dark', 'system'] as const satisfies readonly Theme[];

/**
 * Where the choice is kept. `lyzn.` rather than the older `pendant.`
 * namespace: this is the app's setting, not the device's.
 */
export const THEME_STORAGE_KEY = 'lyzn.theme';

/**
 * Light, and not `'system'`.
 *
 * NativeWind's `colorScheme.set()` does not survive an OTA reload — it writes
 * through `Appearance.setColorScheme()` and reads the value back off RN's
 * change listener, which a reload discards (nativewind PR #1776). So the
 * app owns the choice, re-applies it on boot, and this is what it starts
 * from before AsyncStorage has answered.
 */
export const DEFAULT_THEME: Theme = 'light';

/**
 * What the OS says, when it has been asked. React Native's own
 * `ColorSchemeName` is this: `null` and `'unspecified'` are both "no answer",
 * the second being what an appearance override reads as once it is cleared.
 */
export type SystemScheme = 'light' | 'dark' | 'unspecified' | null | undefined;

/** The two grounds a theme can put a screen on. */
export type ThemeGround = 'desk' | 'night';

/** Anything that is not one of the three is not a theme. */
export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * What came out of storage, made safe. A key that was never written, a value
 * from an older build, a half-finished write — all of them are the default,
 * because there is no sensible way to fail at picking a colour.
 */
export function parseTheme(stored: unknown): Theme {
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

/**
 * The theme, as a scheme: what `dark:` and NativeWind's `colorScheme` see.
 * `'system'` defers to the phone, and to light while the phone is silent.
 */
export function resolveScheme(theme: Theme, system: SystemScheme): 'light' | 'dark' {
  if (theme === 'system') return system === 'dark' ? 'dark' : 'light';
  return theme;
}

/**
 * The theme, as a ground: the desk under a light app, the night under a dark
 * one. `Screen` calls this when a route does not name a ground of its own,
 * which from round seven is how every rebuilt route works.
 */
export function resolveGround(theme: Theme, system: SystemScheme): ThemeGround {
  return resolveScheme(theme, system) === 'dark' ? 'night' : 'desk';
}
