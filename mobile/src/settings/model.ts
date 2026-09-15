/**
 * What the settings screen contains — canvas SET, "one flat list, no submenu
 * maze".
 *
 * The canvas draws four sections and eleven rows, three of which describe
 * product that does not exist: the WhatsApp number, the digest and the
 * opt-out all belong to a channel with no webhook behind it, and the laptop
 * daemon has no entity. Which rows survive is therefore a function of the
 * feature flags, and that function is here rather than in a screen so it can
 * be asked directly: a section that has lost every row must not render its
 * eyebrow over nothing.
 *
 * Pure. The screen turns these into `SettingsRow`s; this decides what there
 * is to turn.
 */
import type { AppFeatures } from '../plan/config';
import type { Theme } from '../design/theme';

// -- the appearance --------------------------------------------------------

export interface ThemeRow {
  value: Theme;
  /** The word on the segment. Mono, so it is uppercase already. */
  label: string;
  /** What choosing it actually does, for the line under the control. */
  note: string;
}

/**
 * Light first, because light is the default and the canvas is a lit desk.
 * `SYSTEM` last because deferring is the least opinionated of the three.
 */
export const THEME_ROWS: ThemeRow[] = [
  { value: 'light', label: 'LIGHT', note: 'The desk, always.' },
  { value: 'dark', label: 'DARK', note: 'The night, always. Receipts stay paper.' },
  { value: 'system', label: 'SYSTEM', note: 'Whatever the phone is doing.' },
];

/** The note under the appearance control, for whichever is chosen. */
export function themeNote(theme: Theme): string {
  return THEME_ROWS.find((row) => row.value === theme)?.note ?? THEME_ROWS[0].note;
}

/** `LIGHT`, for the row's right-hand value. */
export function themeLabel(theme: Theme): string {
  return THEME_ROWS.find((row) => row.value === theme)?.label ?? 'LIGHT';
}

// -- which sections exist --------------------------------------------------

/** The four the canvas draws, in its order. */
export type SettingsSection = 'you' | 'permissions' | 'devices' | 'record';

/**
 * Which sections have anything in them.
 *
 * `you` and `record` are unconditional: an account and a retention policy
 * exist whatever is switched on. `permissions` is the approval gates and the
 * WhatsApp rows, all of which need `execution` or `whatsapp`. `devices`
 * always has the pendant, so it always renders — the daemon row is the part
 * that comes and goes.
 */
export function settingsSections(features: AppFeatures): SettingsSection[] {
  const sections: SettingsSection[] = ['you'];
  if (features.execution || features.whatsapp) sections.push('permissions');
  sections.push('devices', 'record');
  return sections;
}

/**
 * Whether the laptop daemon has a row.
 *
 * Both flags, and that is not belt-and-braces. `daemon` is whether this build
 * has the pairing surface; `execution` is whether the backend will mint a
 * pairing code at all — `POST /daemons/code` sits behind the same gate as
 * approving a task, and answers `402` when it is down. With only `daemon` on,
 * every tap of "Pair a laptop" would open the plan chooser at somebody whose
 * plan is perfectly good, which is a worse answer than no row.
 */
export function showsDaemonRow(features: AppFeatures): boolean {
  return features.daemon && features.execution;
}

/** Whether the approval gates have a row. `[EXECUTION]`. */
export function showsGatesRow(features: AppFeatures): boolean {
  return features.execution;
}

// -- retention -------------------------------------------------------------

/**
 * The two `YOUR RECORD` values the canvas prints.
 *
 * They are **copy, not controls**: the backend has no retention setting, so
 * offering a picker would be offering a thing that does nothing. These
 * state what actually happens today — transcripts are kept until the
 * recording is deleted, and audio is pruned off the phone as soon as the
 * account confirms it holds it (`pruneReadyLocal` in the store).
 */
export const RETENTION = {
  transcripts: 'UNTIL YOU DELETE IT',
  audio: 'CLEARED ONCE TRANSCRIBED',
} as const;
