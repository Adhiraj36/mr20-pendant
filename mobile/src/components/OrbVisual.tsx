/**
 * Mira's mark, with a graceful degrade.
 *
 * The real thing is thinking-orbs (dotted thought-orbs on Skia) — but Skia
 * is a native module, so a dev client built before it simply does not have
 * it. Loading is therefore lazy and guarded: with Skia present the orb
 * animates; without it the drawn SVG sphere stands in, and nothing crashes.
 */
import { useMemo, type ReactElement } from 'react';
import { TurboModuleRegistry, type ViewStyle } from 'react-native';
import { Orb } from './Orb';

export type OrbState =
  | 'working' | 'searching' | 'solving' | 'listening' | 'connecting'
  | 'weaving' | 'composing' | 'breathing' | 'shaping';

type OrbComponent = (props: {
  state?: OrbState;
  size?: 64 | 20;
  renderSize?: number;
  theme?: 'auto' | 'dark' | 'light';
  speed?: number;
  paused?: boolean;
  style?: ViewStyle;
}) => ReactElement;

let resolved: OrbComponent | null | undefined;

function loadThinkingOrb(): OrbComponent | null {
  if (resolved !== undefined) return resolved;
  try {
    // Probe for the native module WITHOUT importing Skia: its JS entry uses
    // getEnforcing, whose failure goes through the global exception handler
    // and cannot be contained by this try/catch. The non-enforcing get()
    // simply answers null on a client built before Skia was added.
    if (!TurboModuleRegistry.get('RNSkiaModule')) {
      resolved = null;
      return resolved;
    }
    /* eslint-disable @typescript-eslint/no-var-requires */
    resolved = (require('./thinking-orb') as { ThinkingOrb: OrbComponent }).ThinkingOrb;
    /* eslint-enable */
  } catch {
    resolved = null;
  }
  return resolved;
}

/** A hero orb: animated where the build allows, still where it does not. */
export function OrbVisual({
  state = 'breathing',
  size,
  small = false,
  speed,
  style,
}: {
  state?: OrbState;
  /** Rendered dp. Tuning comes from the 64 (or 20, when `small`) preset. */
  size: number;
  /** Use the inline 20 dp tuning — for text-scale orbs. */
  small?: boolean;
  speed?: number;
  style?: ViewStyle;
}) {
  const ThinkingOrb = useMemo(loadThinkingOrb, []);
  if (ThinkingOrb) {
    return (
      <ThinkingOrb
        state={state}
        size={small ? 20 : 64}
        renderSize={size}
        theme="dark"
        speed={speed}
        style={style}
      />
    );
  }
  return <Orb size={size} />;
}
