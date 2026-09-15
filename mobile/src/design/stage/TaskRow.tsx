/**
 * One action item — app spec §3.4, a port of `web/src/components/Stage.tsx`'s
 * `TaskRow`. Radius 12, 1 px `line`, `panel2` bg, padding 12/14.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Checkbox } from '../primitives';
import { Touchable } from '../Touchable';
import { useTone } from '../tone';
import { fontFamily, radius, space } from '../tokens';

export function TaskRow({
  text, meta, done, onToggle, onPress,
}: {
  text: string;
  meta?: string;
  done: boolean;
  onToggle?: () => void;
  onPress?: () => void;
}) {
  const t = useTone();

  const row = (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space.md,
        borderRadius: radius.task, borderWidth: 1, borderColor: t.line,
        backgroundColor: t.panel2, paddingVertical: 12, paddingHorizontal: 14,
      }}
    >
      <Checkbox checked={done} onToggle={onToggle} label={text} />
      <Text
        style={{
          flex: 1, fontFamily: fontFamily.sans[400], fontSize: 14, lineHeight: 21,
          color: done ? t.muted : t.fg,
          textDecorationLine: done ? 'line-through' : 'none',
          textDecorationColor: t.faint,
        }}
        numberOfLines={2}
      >
        {text}
      </Text>
      {meta ? (
        <Text
          style={{ fontFamily: fontFamily.mono[400], fontSize: 11, color: t.muted }}
          numberOfLines={1}
        >
          {meta}
        </Text>
      ) : null}
    </View>
  );

  if (onPress) return <Touchable onPress={onPress}>{row}</Touchable>;
  return row;
}
