/**
 * Twelve bars — the only thing that loops without a cause while audio is
 * live (spec §6 "the loop rule"; §3.4). A port of `web/src/components/
 * Stage.tsx`'s `Waveform`, whose `@keyframes level` is `0%, 100%: scaleY
 * (0.22)`, `50%: scaleY(1)` — a symmetric triangle, not a spring.
 *
 * Round seven made the colour a class rather than a resolved value: the
 * canvas draws the recording waveform in void red (C1, H1), which the kit's
 * own `Waveform` asks for; this one keeps `muted` so the screens that have
 * not been rebuilt yet do not change. The scale stays in `style`, because it
 * is a `SharedValue` on the UI thread and cannot be a class.
 */
import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { ease, useReducedMotionFlag } from '../motion';

/** Relative heights, bottom-anchored (spec §3.4, verbatim from the site). */
const BASE_HEIGHTS = [0.35, 0.7, 0.45, 1, 0.6, 0.85, 0.3, 0.75, 0.5, 0.9, 0.4, 0.65];

/** Which signal the bars are painted in. Red while recording, by default. */
export type WaveformTone = 'danger' | 'stamp' | 'muted' | 'fg' | 'settled';

const BAR_FILL: Record<WaveformTone, string> = {
  danger: 'bg-tone-danger',
  stamp: 'bg-tone-stamp',
  muted: 'bg-tone-muted',
  fg: 'bg-tone-fg',
  settled: 'bg-tone-settled',
};

function WaveformBar({
  index, base, active, level, reduced, fill, grow, width,
}: {
  index: number;
  base: number;
  active: boolean;
  level?: SharedValue<number>;
  reduced: boolean;
  fill: string;
  grow: boolean;
  width: number;
}) {
  const loop = useSharedValue(0.22);

  useEffect(() => {
    if (level) return; // driven live, in the animated style below.
    if (!active || reduced) {
      loop.value = 0.22;
      return undefined;
    }
    const delay = (index % 6) * 110;
    loop.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 550, easing: ease.inOut }), -1, true),
    );
    return () => { loop.value = 0.22; };
  }, [active, reduced, level, index, loop]);

  // `base` scales the envelope (the loop, or the live level) rather than
  // the box: spec §3.4's own formula for the live path is `scaleY = base ×
  // (0.22 + 0.78 × level)`, so every bar shares one box and `base` lives
  // entirely in the animated style.
  const style = useAnimatedStyle(() => {
    'worklet';
    const envelope = level ? (active ? 0.22 + 0.78 * level.value : 0.22) : loop.value;
    return { transform: [{ scaleY: base * envelope }] };
  });

  // The animated view carries the scale and nothing else; the class-painted
  // bar is a plain `View` inside it. A className and a Reanimated style on one
  // element cancel each other out — see `src/design/interop.ts`'s header.
  return (
    <Animated.View
      style={[
        grow ? { flex: 1, transformOrigin: 'bottom' } : { width, transformOrigin: 'bottom' },
        { height: '100%' },
        style,
      ]}
    >
      <View className={`w-full h-full rounded-[1px] ${fill}`} />
    </Animated.View>
  );
}

export function Waveform({
  bars = 12, level, active, tone = 'muted', height = 32, gap = 3,
  barWidth = 3, grow = false, width, style, className,
}: {
  bars?: number;
  /** 0..1, live: derives `scaleY` on the UI thread rather than looping. */
  level?: SharedValue<number>;
  active: boolean;
  tone?: WaveformTone;
  /** The box the bars scale inside. C1 draws it at 74, a card at 24. */
  height?: number;
  gap?: number;
  barWidth?: number;
  /** Bars share the width equally instead of taking `barWidth` each. */
  grow?: boolean;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  const reduced = useReducedMotionFlag();

  return (
    <View
      className={className}
      style={[
        { flexDirection: 'row', alignItems: 'flex-end', gap, height, width },
        style,
      ]}
    >
      {Array.from({ length: bars }, (_, i) => (
        <WaveformBar
          key={i}
          index={i}
          base={BASE_HEIGHTS[i % BASE_HEIGHTS.length] ?? 0.5}
          active={active}
          level={level}
          reduced={reduced}
          fill={BAR_FILL[tone]}
          grow={grow}
          width={barWidth}
        />
      ))}
    </View>
  );
}
