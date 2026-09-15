/**
 * The feature flags, as the screens ask for them.
 *
 * Three of this product's screens describe things that do not exist yet — a
 * laptop daemon, approvals over WhatsApp, execution itself — and the canvas
 * draws all three. Rather than delete those branches and redraw them later,
 * they are behind flags that arrive with the rest of the remote
 * configuration and are **off** in the shipped defaults. A screen asks this
 * hook and gets the truth for this account on this launch.
 *
 * `askLyzn` is the exception that is on: asking questions of your own
 * memory needs nothing but the backend that is already there.
 */
import { useApp } from '../state/store';
import type { AppFeatures } from '../plan/config';

export type Features = AppFeatures;

/** Plan §2.4's defaults, verbatim — what a launch with no network shows. */
export const DEFAULT_FEATURES: Features = {
  daemon: false,
  whatsapp: false,
  execution: false,
  askLyzn: true,
  phoneCapture: true,
  darkMode: true,
};

/**
 * The flags this account is running under.
 *
 * Reads the configuration the store holds, which starts as the shipped
 * defaults, becomes the cached copy before the first frame, and becomes
 * `GET /config`'s answer a moment later. No screen has to know which of the
 * three it is looking at.
 */
export function useFeatures(): Features {
  return useApp((s) => s.appConfig.features);
}
