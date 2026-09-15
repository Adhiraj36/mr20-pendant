/**
 * A row of ticks, reading as an instrument rather than a progress bar —
 * app spec §3.3. It replaces the dial, the mini arc and the LED numerals the
 * old design measured things with; all three files are gone.
 */
import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ease, useReducedMotionFlag } from './motion';

/** The lit tick is the tone's ink; the last one lit is the signal. */
const TICK_FILL = 'bg-tone-fg';
const TICK_FILL_LAST = 'bg-signal';

function Tick({
  lit, isLast, reduced,
}: {
  lit: boolean;
  isLast: boolean;
  reduced: boolean;
}) {
  const opacity = useSharedValue(lit ? 0.85 : 0.16);

  useEffect(() => {
    const target = lit ? 0.85 : 0.16;
    // 240 ms, per spec §3.3 — not one of `dur`'s named steps (RollingNumber's
    // M12 roll is the only other one-off; both are literal here on purpose).
    opacity.value = reduced ? target : withTiming(target, { duration: 240, easing: ease.out });
  }, [lit, reduced, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: isLast && lit ? 1 : opacity.value }));

  // The animated view carries the motion and nothing else; the class-painted
  // box is a plain `View` inside it. A className and a Reanimated style on one
  // element cancel each other out — see `src/design/interop.ts`'s header.
  return (
    <Animated.View style={[{ flex: 1 }, style]}>
      <View className={`w-full h-full rounded-[1px] ${isLast && lit ? TICK_FILL_LAST : TICK_FILL}`} />
    </Animated.View>
  );
}

export function TickRow({
  ticks, value, width = '100%', height = 14, className, style,
}: {
  ticks: number;
  value: number;
  width?: number | `${number}%`;
  height?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotionFlag();
  const clamped = Math.max(0, Math.min(1, value));
  const lastLit = Math.floor(clamped * ticks) - (clamped >= 1 ? 1 : 0);

  return (
    <View
      className={['flex-row gap-[2px] items-stretch', className].filter(Boolean).join(' ')}
      style={[{ width, height }, style]}
    >
      {Array.from({ length: ticks }, (_, i) => {
        const lit = i / ticks <= clamped;
        return (
          <Tick
            key={i}
            lit={lit}
            isLast={i === lastLit}
            reduced={reduced}
          />
        );
      })}
    </View>
  );
}
