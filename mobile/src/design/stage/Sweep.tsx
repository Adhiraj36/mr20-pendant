/**
 * The swept underline — app spec §3.4, §6 M4. A port of `web/src/
 * components/Stage.tsx`'s `mark()`/`.sweep`, which relies on a CSS
 * `background-size` trick RN has no equivalent for: "the matched words are
 * their own Text inside the wrapper" — each phrase `Sweep` wraps is its own
 * small block (a `View` around a `Text`) with the rule drawn beneath it,
 * meant to sit as a sibling among plain `Txt` nodes in a wrapping row.
 */
import React, { type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { colors } from '../tokens';
import { Txt } from '../primitives';

export function Sweep({ progress, children }: { progress: SharedValue<number>; children: ReactNode }) {
  const lineStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  return (
    <View style={{ position: 'relative' }}>
      <Txt variant="body">{children}</Txt>
      <Animated.View
        style={[
          { position: 'absolute', left: 0, bottom: -2, height: 1, backgroundColor: colors.signal },
          lineStyle,
        ]}
      />
    </View>
  );
}
