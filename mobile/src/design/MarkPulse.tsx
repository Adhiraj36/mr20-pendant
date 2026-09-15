/**
 * M0 — the mark, breathing (app spec §2.1, §6).
 *
 * The one spinner-like element in the app: the launch gate, the OAuth
 * landing screen and the recording detail's loading state show the LYZN
 * mark at `fg`, opacity 0.4 to 1 and back on a 1.4 s ease-in-out loop, and
 * nothing else. The mark's own fill stays imperative (`useTone()`): this is
 * the app's launch gate, which renders above every provider, and a
 * `fill-tone-fg` there would resolve against no variable at all. It is on the loop rule's short list of things allowed to
 * move without a cause; reduced motion is a static 1.0, so the loop never
 * starts (spec §6, §9 "Reanimated").
 */
import { useEffect } from 'react';
import Animated, {
  useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { Mark } from './icons';
import { ease, useReducedMotionFlag } from './motion';

/** Half the 1.4 s loop: 0.4 up to 1, then the reverse pass back down. */
const HALF_LOOP_MS = 700;

export function MarkPulse({ size = 40 }: { size?: number }) {
  const reduced = useReducedMotionFlag();
  const level = useSharedValue(reduced ? 1 : 0.4);

  useEffect(() => {
    if (reduced) {
      level.value = 1;
      return;
    }
    level.value = withRepeat(
      withTiming(1, { duration: HALF_LOOP_MS, easing: ease.inOut }),
      -1,
      true,
    );
  }, [reduced, level]);

  const pulse = useAnimatedStyle(() => ({ opacity: level.value }));

  return (
    <Animated.View style={pulse} accessibilityRole="image" accessibilityLabel="Lyzn">
      <Mark size={size} />
    </Animated.View>
  );
}
