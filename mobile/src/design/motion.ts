/**
 * The motion system — app spec §6.
 *
 * Timing only; no springs — nothing bounces. Three curves, four durations and
 * one capped stagger cover every animation in the app. Layout changes use
 * `LinearTransition.duration(220)`; a press is scale 0.985 over 120 ms with a
 * light haptic and no dim.
 *
 * The loop rule: the only things that move without a cause are the waveform
 * while audio is live, the pendant's idle float, the recording dot, the orb
 * while Mira is present or working, and the mark pulse on the gate. Nothing
 * else loops, pulses or shimmers.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Easing, useReducedMotion, type WithTimingConfig } from 'react-native-reanimated';

export interface Durations {
  micro: number; ui: number; enter: number; slow: number;
}

export const ease = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.4, 0, 1, 1),
};

export const dur: Durations = { micro: 120, ui: 160, enter: 420, slow: 700 };

/** Stagger step for a screen's blocks, capped so a long list does not crawl in. */
export const enter = (i: number) => Math.min(i, 8) * 60;

/** Every duration at zero — what `useDur()` hands back under reduce motion. */
const stillDur: Durations = { micro: 0, ui: 0, enter: 0, slow: 0 };

/**
 * Whether the system asks us to hold still.
 *
 * Reanimated's own `useReducedMotion()` reads the flag once, at the moment
 * the runtime starts; `AccessibilityInfo` reports the live value and pushes
 * a change while the app is open. Either saying yes is a yes (spec §9,
 * "Reanimated"): when it is true `dur.*` are 0 and loops do not start.
 */
export function useReducedMotionFlag(): boolean {
  const fromReanimated = useReducedMotion();
  const [fromSystem, setFromSystem] = useState(false);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (live) setFromSystem(on); })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setFromSystem);
    return () => { live = false; sub.remove(); };
  }, []);

  return fromReanimated || fromSystem;
}

/**
 * The durations to animate with, zeroed when the system asks us to hold
 * still. One place to consult, so no screen has to branch on the flag to get
 * its timings right — only to decide whether a loop starts at all.
 */
export function useDur(): Durations {
  return useReducedMotionFlag() ? stillDur : dur;
}

/** A timing config on the standard ease-out curve. */
export const timing = (duration: number = dur.ui): WithTimingConfig => ({
  duration,
  easing: ease.out,
});
