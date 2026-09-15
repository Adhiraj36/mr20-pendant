/**
 * The player's seek bar — app spec §2.7 step 3, §3.5. Rewrites `ScrubBar`:
 * same RN responder as before (a touch anywhere seeks; a drag follows the
 * finger and seeks on release), but the knob and the played rule now follow
 * a `SharedValue` on the UI thread rather than React state, so a scrub does
 * not re-render on every touch move.
 */
import { useEffect, useRef } from 'react';
import {
  View,
  type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

export function Scrub({
  value, onSeek, height = 32, className, style,
}: {
  /** 0..1, the player's current position. */
  value: number;
  /** Called once, on release, with the chosen fraction. */
  onSeek: (fraction: number) => void;
  /** The touch target's height (spec: 32 pt hit height). */
  height?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const width = useRef(0);
  const isDragging = useRef(false);
  const fraction = useSharedValue(Math.max(0, Math.min(1, value)));

  useEffect(() => {
    if (!isDragging.current) fraction.value = Math.max(0, Math.min(1, value));
  }, [value, fraction]);

  const fractionAt = (event: GestureResponderEvent) =>
    width.current
      ? Math.max(0, Math.min(1, event.nativeEvent.locationX / width.current))
      : 0;

  const playedStyle = useAnimatedStyle(() => ({ width: `${fraction.value * 100}%` }));
  const knobStyle = useAnimatedStyle(() => ({ left: `${fraction.value * 100}%` }));

  return (
    <View
      // The visible track is a hairline; the touch target must not be.
      className={['justify-center', className].filter(Boolean).join(' ')}
      style={[{ height }, style]}
      onLayout={(event: LayoutChangeEvent) => { width.current = event.nativeEvent.layout.width; }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      // Once a scrub starts, the enclosing scroll view must not steal it:
      // half a drag followed by a jump the user did not choose feels broken.
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        isDragging.current = true;
        fraction.value = fractionAt(event);
      }}
      onResponderMove={(event) => { fraction.value = fractionAt(event); }}
      onResponderRelease={(event) => {
        const f = fractionAt(event);
        fraction.value = f;
        isDragging.current = false;
        onSeek(f);
      }}
      // The scroll view stole the gesture: abandon the scrub, seek nowhere.
      onResponderTerminate={() => {
        isDragging.current = false;
        fraction.value = Math.max(0, Math.min(1, value));
      }}
    >
      {/* Each animated view carries the motion and nothing else; the
          class-painted box is a plain `View` inside it. A className and a
          Reanimated style on one element cancel each other out — see
          `src/design/interop.ts`'s header. */}
      <View className="h-[1px] overflow-hidden bg-tone-line2">
        <Animated.View style={playedStyle}>
          <View className="w-full h-[1px] bg-signal" />
        </Animated.View>
      </View>
      {/* A square knob at radius 2 (spec §4.4) — no pill, no circle. */}
      <Animated.View style={[{ position: 'absolute', width: 8, height: 8, marginLeft: -4 }, knobStyle]}>
        <View className="w-full h-full rounded-[2px] bg-tone-fg" />
      </Animated.View>
    </View>
  );
}
