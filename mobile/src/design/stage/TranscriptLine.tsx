/**
 * One line of a transcript — app spec §3.4, a port of `web/src/components/
 * Stage.tsx`'s `TranscriptLine`. Columns `[time][speaker][text]`; `state`
 * steps the colour as the playhead passes (M3, recording detail §2.7).
 *
 * `initial` renders the same 20 pt box the Speakers section uses (spec
 * §2.7 step 7: "the first line of each speaker's run carries the 20 pt
 * initial box") — the caller decides which line in a run gets one.
 */
import React, { useEffect, type ReactNode } from 'react';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolateColor, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { Touchable } from '../Touchable';
import { useTone } from '../tone';
import { fontFamily, space } from '../tokens';
import { ease, useReducedMotionFlag } from '../motion';

export type TranscriptLineState = 'spoken' | 'active' | 'upcoming';

export function TranscriptLine({
  time, speaker, initial, state, onPress, style, children, body,
}: {
  time: string;
  speaker?: string;
  initial?: string;
  state: TranscriptLineState;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** The utterance itself — the column the spec calls `[text]`. */
  children?: ReactNode;
  /**
   * The `[text]` column as a block rather than a `Text`, for the one line
   * carrying the sweep (M4, spec §2.7 step 5). `Sweep` draws a rule beneath
   * a run of words, which is a `View`, and RN cannot lay a `View` inside a
   * `Text` — so the caller composes the wrapping row of runs and hands it
   * over whole. Wins over `children` when both are given.
   */
  body?: ReactNode;
}) {
  const t = useTone();
  const reduced = useReducedMotionFlag();
  const active = state === 'active';
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = reduced ? (active ? 1 : 0) : withTiming(active ? 1 : 0, {
      duration: 500,
      easing: ease.out,
    });
  }, [active, reduced, progress]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ['transparent', t.panel]),
    borderRadius: 12,
    paddingVertical: progress.value > 0 ? 12 : 0,
    paddingHorizontal: progress.value > 0 ? 16 : 0,
    borderLeftWidth: 2,
    borderLeftColor: interpolateColor(progress.value, [0, 1], ['transparent', t.fg]),
  }));

  // spoken recedes to `muted`; active and upcoming both read as `fg`.
  const textColor = state === 'spoken' ? t.muted : t.fg;

  const content = (
    <Animated.View style={[{ flexDirection: 'row', gap: space.sm }, containerStyle]}>
      <Text
        style={{
          fontFamily: fontFamily.mono[400], fontSize: 11, color: t.faint,
          fontVariant: ['tabular-nums'], width: 44,
        }}
      >
        {time}
      </Text>
      <View style={{ width: initial || speaker ? 64 : 0 }}>
        {initial ? (
          <View
            style={{
              width: 20, height: 20, marginBottom: speaker ? 4 : 0,
              alignItems: 'center', justifyContent: 'center',
              borderRadius: 6, borderWidth: 1, borderColor: t.line2,
            }}
          >
            <Text style={{ fontFamily: fontFamily.mono[400], fontSize: 11, color: t.muted }}>
              {initial}
            </Text>
          </View>
        ) : null}
        {speaker ? (
          <Text
            style={{
              fontFamily: fontFamily.mono[500], fontSize: 11, letterSpacing: 1.32,
              textTransform: 'uppercase', color: t.muted,
            }}
            numberOfLines={1}
          >
            {speaker}
          </Text>
        ) : null}
      </View>
      {body ? (
        <View style={{ flex: 1 }}>{body}</View>
      ) : (
        <Text style={{ flex: 1, fontFamily: fontFamily.sans[400], fontSize: 16, lineHeight: 25, color: textColor }}>
          {children}
        </Text>
      )}
    </Animated.View>
  );

  if (onPress) {
    return <Touchable onPress={onPress} style={style}>{content}</Touchable>;
  }
  return <View style={style}>{content}</View>;
}
