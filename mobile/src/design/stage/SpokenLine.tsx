/**
 * An initial box beside a line of Mira's spoken reply — app spec §3.4, a
 * port of `web/src/components/Stage.tsx`'s `SpokenLine`.
 */
import React, { type ReactNode } from 'react';
import { View, Text } from 'react-native';
import { useTone } from '../tone';
import { fontFamily } from '../tokens';

export function SpokenLine({ initial, children }: { initial: string; children: ReactNode }) {
  const t = useTone();
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 28, height: 28, marginTop: 2,
          alignItems: 'center', justifyContent: 'center',
          borderRadius: 6, borderWidth: 1, borderColor: t.line2,
        }}
      >
        <Text style={{ fontFamily: fontFamily.mono[400], fontSize: 11, color: t.muted }}>
          {initial}
        </Text>
      </View>
      <Text
        style={{
          flex: 1, fontFamily: fontFamily.sans[400], fontSize: 16, lineHeight: 26, color: t.fg,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
