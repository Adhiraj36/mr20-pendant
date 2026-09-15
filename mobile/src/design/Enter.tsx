/**
 * M1 — a screen's blocks arriving (app spec §6).
 *
 * opacity 0 and y +16 to 1 and 0 over `dur.enter` on the standard ease-out,
 * each block delayed by `enter(i)`. Written with a `SharedValue` rather than
 * one of Reanimated's `entering` presets because §9 asks for exactly that:
 * "prefer `useSharedValue` + `useAnimatedStyle` over `entering` presets for
 * anything staggered, so reduce-motion can zero it in one place." Reduced
 * motion is M1's "instant" column — the block is simply already there.
 */
import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { dur, ease, enter, useReducedMotionFlag } from './motion';

export function Enter({ index = 0, style, children }: {
  /** Position in the screen's reading order; the stagger is capped at 8. */
  index?: number;
  /**
   * Layout for the arriving block. **A style, not a className**: this is an
   * `Animated.View` carrying a `useAnimatedStyle`, and a class on the same
   * element would cancel both out (see `src/design/interop.ts`). A block that
   * needs classes wraps a `View` in the `Enter`, not the other way round.
   */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotionFlag();
  const shown = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      shown.value = 1;
      return;
    }
    shown.value = withDelay(
      enter(index),
      withTiming(1, { duration: dur.enter, easing: ease.out }),
    );
  }, [index, reduced, shown]);

  const arriving = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: 16 * (1 - shown.value) }],
  }));

  return <Animated.View style={[style, arriving]}>{children}</Animated.View>;
}
