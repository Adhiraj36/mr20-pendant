/**
 * Ground: the desk, the night, ink or paper — round seven §2.3.
 *
 * "Ink is where things are happening. Paper is where they are kept" was the
 * whole system when there were two grounds. There are four now. The desk is
 * the app's daylight — the ground the canvas lays its sheets on — and the
 * night is the same room with the lights off. Ink and paper stay because a
 * receipt is paper whichever theme is on (canvas D2: receipts never go dark)
 * and because the screens that have not been rebuilt yet still stand on ink.
 *
 * Two mechanisms, and the difference between them is the point:
 *
 * - **A tone is CSS variables.** `ToneProvider` writes `--tone-*` on a real
 *   View and everything below reads `bg-tone-bg`, `text-tone-fg`,
 *   `border-tone-line`. Variables inherit and re-resolve reactively, so a
 *   paper subtree inside a night screen is one nested provider — which is
 *   exactly what `dark:` structurally cannot express, since there is one
 *   colour scheme for the whole tree.
 * - **`dark:` is the appearance switch**, and nothing else. It belongs to
 *   `theme.ts` and the person's light/dark choice.
 *
 * `useTone()` stays for the imperative consumers — the status bar, Skia, a
 * Reanimated worklet, anything that needs a resolved colour in JS rather
 * than a class. A component that reaches for `colors.signal` directly is
 * still a sign the design is wrong.
 */
import React, {
  createContext, useContext, useEffect, useMemo, useSyncExternalStore,
} from 'react';
import { View, useColorScheme, type ViewStyle, type StyleProp } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { vars, colorScheme } from 'nativewind';
import { colors, tones, type Ground } from './tokens';
import {
  DEFAULT_THEME, THEME_STORAGE_KEY, parseTheme, resolveGround,
  type Theme, type ThemeGround,
} from './theme';

export type { Ground };

export interface Tone {
  /** Which ground this is. `PanelInverted` needs to know so it can pick the other. */
  ground: Ground;
  bg: string;
  fg: string;
  muted: string;
  faint: string;
  line: string;
  line2: string;
  panel: string;
  panel2: string;
  invBg: string;
  invFg: string;
  statusBar: 'light' | 'dark';
  /** The waiting state, and its hairline. Nothing else is ever on carbon. */
  carbon: string;
  carbonLine: string;
  /** The live action. */
  stamp: string;
  /** Done. */
  settled: string;
  /** Failed, cancelled, recording. */
  danger: string;
}

const toneFor = (ground: Ground): Tone => ({ ground, ...tones[ground] });

/**
 * Ink by default: a component rendered outside any `Screen` — a toast, a
 * modal host — is chrome, and chrome is ink on every ground (spec §1.6).
 */
const ToneContext = createContext<Tone>(toneFor('ink'));

export function useTone(): Tone {
  return useContext(ToneContext);
}

/**
 * The tone as Tailwind sees it. Fifteen variables, kebab-cased, so a class
 * names the role and the ground decides the colour: `bg-tone-bg`,
 * `text-tone-muted`, `border-tone-carbon-line`, `text-tone-danger`.
 *
 * Exported because the imperative consumers occasionally need to put a tone
 * on a View they build themselves — a portal, an animated wrapper Reanimated
 * owns — without a second provider in the tree.
 */
export function toneVars(t: Tone): ViewStyle {
  return vars({
    '--tone-bg': t.bg,
    '--tone-fg': t.fg,
    '--tone-muted': t.muted,
    '--tone-faint': t.faint,
    '--tone-line': t.line,
    '--tone-line2': t.line2,
    '--tone-panel': t.panel,
    '--tone-panel2': t.panel2,
    '--tone-inv-bg': t.invBg,
    '--tone-inv-fg': t.invFg,
    '--tone-carbon': t.carbon,
    '--tone-carbon-line': t.carbonLine,
    '--tone-stamp': t.stamp,
    '--tone-settled': t.settled,
    '--tone-danger': t.danger,
  }) as ViewStyle;
}

/**
 * Puts a ground into scope, as context for `useTone()` and as variables for
 * every class below it. `Screen` and `PanelInverted` are the only callers; a
 * screen never uses this directly.
 *
 * `style` exists because the variables have to live on a real View, and a
 * View that is only there to hold them is a View in the layout — an extra
 * box between an absolutely positioned card and the frame it positions
 * against. So the caller hands its own surface style down and the boundary
 * *is* the surface, rather than a wrapper around it.
 */
export function ToneProvider({ ground, className, style, children }: {
  ground: Ground;
  /**
   * Layout for the boundary View — flex, padding, position. **Not colour.**
   * The variables this View writes are read by its *descendants*; a
   * `bg-tone-bg` on the provider itself would be resolving a variable
   * against the ground above it, which is the ground it exists to leave.
   */
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const value = useMemo(() => toneFor(ground), [ground]);
  return (
    <ToneContext.Provider value={value}>
      <View className={className} style={[toneVars(value), style]}>{children}</View>
    </ToneContext.Provider>
  );
}

// -- the appearance --------------------------------------------------------

/**
 * One theme for the app, held outside React.
 *
 * A context would need a provider above every consumer and would still have
 * to be read imperatively by the storage write; a module-level observable
 * read through `useSyncExternalStore` is the smaller thing, and it means a
 * settings screen and the status bar see the same value on the same frame.
 */
type ThemeState = { theme: Theme; hydrated: boolean };

let state: ThemeState = { theme: DEFAULT_THEME, hydrated: false };
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => state;
const emit = () => { for (const listener of listeners) listener(); };

/**
 * Push the choice at NativeWind, which is what `dark:` reads.
 *
 * This is a write-only relationship on purpose. `colorScheme.set()` does not
 * write NativeWind's own observable outside `NODE_ENV === 'test'` — it goes
 * through `Appearance.setColorScheme()` and reads the value back off React
 * Native's change listener (nativewind PR #1776), and that listener is lost
 * across an OTA reload. We ship expo-updates, so the app owns the choice and
 * re-applies it on every boot; NativeWind is told, never asked.
 */
const apply = (theme: Theme) => { colorScheme.set(theme); };

let hydration: Promise<void> | null = null;

/**
 * Read the stored choice and apply it. Idempotent and safe to call from
 * anywhere: the first caller does the work and everyone else waits on it.
 * `app/_layout.tsx` calls it at boot so the appearance is right before the
 * first screen paints; `useTheme()` calls it too, so a screen mounted in a
 * test or a story is not left on the default.
 */
export function hydrateTheme(): Promise<void> {
  hydration ??= AsyncStorage.getItem(THEME_STORAGE_KEY)
    .then((raw) => parseTheme(raw))
    .catch(() => DEFAULT_THEME)
    .then((theme) => {
      state = { theme, hydrated: true };
      apply(theme);
      emit();
    });
  return hydration;
}

/**
 * Change the appearance. The value is live before the write lands — a
 * setting that waits for the disk feels broken — and a failed write costs
 * the choice on the next cold start, not the current session.
 */
export function setTheme(next: Theme): void {
  // Hydration must not overwrite a choice made while it was still in flight.
  hydration ??= Promise.resolve();
  state = { theme: next, hydrated: true };
  apply(next);
  emit();
  AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => undefined);
}

export interface ThemeControl {
  /** What the person picked. `'system'` is a choice, not the default. */
  theme: Theme;
  /** The ground that choice puts a screen on, now: `desk` or `night`. */
  ground: ThemeGround;
  /** False until AsyncStorage has answered. */
  hydrated: boolean;
  setTheme: (next: Theme) => void;
}

/**
 * The appearance, and the ground it resolves to. `Screen` uses it for the
 * ground; the settings screen uses it for the setting.
 */
export function useTheme(): ThemeControl {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  // What the phone says. While the theme is `'light'` or `'dark'` we have
  // told `Appearance` to answer with that instead, and this value is ignored
  // — `resolveGround` only consults it for `'system'`, which is precisely
  // when the override has been cleared and the OS is answering again.
  const system = useColorScheme();

  useEffect(() => { hydrateTheme().catch(() => undefined); }, []);

  return useMemo(() => ({
    theme: current.theme,
    hydrated: current.hydrated,
    ground: resolveGround(current.theme, system),
    setTheme,
  }), [current, system]);
}

// -- the screen ------------------------------------------------------------

/** Which safe-area edges the screen insets itself. */
export type ScreenEdge = 'top' | 'bottom';

type ScreenBase = {
  /**
   * A darker ground than the tone's own, for the two ink screens that want
   * one. Ink only.
   */
  bg?: 'ink' | 'charcoal' | 'void';
  /**
   * Safe-area edges `Screen` pads. Defaults to the top. Pass `[]` on a
   * screen that still does its own inset arithmetic.
   */
  edges?: ScreenEdge[];
  /**
   * Layout for the screen's own View — a gutter, a gap, a flex direction.
   * Not a ground: the ground is `ground`, and it is painted here from the
   * tone rather than from a class, so that a screen cannot disagree with the
   * status bar about which one it is standing on.
   */
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * `ground` is the plan's word for it in §2.5's route table; the older app
 * spec §3.1 calls the same prop `tone`. Both are accepted and at most one
 * may be given.
 *
 * Neither is now allowed too, and that is the round-seven default: a screen
 * that does not name a ground stands on the theme's — the desk in light, the
 * night in dark. A screen that *does* name one is saying it is not part of
 * the appearance: a receipt is `paper` in both themes, and the legacy ink
 * screens name `ink` until they are rebuilt.
 */
export type ScreenProps = ScreenBase &
  ({ ground?: Ground; tone?: never } | { tone?: Ground; ground?: never });

/**
 * A route's ground.
 *
 * Fills the window with the tone's background, provides the tone to
 * everything below — as context and as `--tone-*` variables, on this one
 * View, so no box is added to the layout — and sets the status bar from it.
 * The flip lands on the same frame as a tab switch, which is the whole of
 * the ground transition (spec §1.4, M9: a hard edge, no wipe, no crossfade).
 */
export function Screen({ ground, tone, bg, edges = ['top'], className, style, children }: ScreenProps) {
  const theme = useTheme();
  const which: Ground = ground ?? tone ?? theme.ground;
  const value = useMemo(() => toneFor(which), [which]);
  const insets = useSafeAreaInsets();
  // `expo-status-bar` writes through RN's StatusBar, whose props merge in
  // *mount* order — and `NativeTabs` keeps a visited tab mounted. Without
  // this gate, Library → Mira → Library leaves the bar light on paper,
  // because nothing remounted. Only the focused screen writes, so the flip
  // lands on the same frame as the tab switch (spec §1.3, §1.4 M9).
  const focused = useIsFocused();

  const background = which === 'ink' && bg ? colors[bg] : value.bg;

  return (
    <ToneContext.Provider value={value}>
      {focused ? <StatusBar style={value.statusBar} /> : null}
      <View
        className={className}
        style={[
          toneVars(value),
          { flex: 1, backgroundColor: background },
          edges.includes('top') && { paddingTop: insets.top },
          edges.includes('bottom') && { paddingBottom: insets.bottom },
          style,
        ]}
      >
        {children}
      </View>
    </ToneContext.Provider>
  );
}
