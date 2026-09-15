/**
 * The desktop agent, as much of it as anyone needs to see — app spec §3.4,
 * a port of `web/src/components/Stage.tsx`'s `StatusBlock`. Also the sync
 * completion's home (spec §1.5): "the last row of a `StatusBlock` in
 * gold" is an `ok` row here, not a receipt.
 */
import React, { useEffect, type ReactNode } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useTone } from '../tone';
import { colors, fontFamily, radius, space, tabular } from '../tokens';
import { ease, useReducedMotionFlag } from '../motion';

export interface StatusRow {
  label: string;
  value?: string;
  ok?: boolean;
  /** The row currently updating — its value reads `fg`, not `faint`. */
  live?: boolean;
  /** A `small` muted sentence under the row. */
  line?: string;
  /**
   * A step that failed: label and value in `danger`, the mirror of `ok`.
   * Beyond §3.4's stated prop list, but §2.7's pipeline block asks for
   * "`FAILED` in `danger`" from this component and nothing else would give
   * it without a screen drawing its own status row.
   */
  danger?: boolean;
}

function Row({ row, index, reduced }: { row: StatusRow; index: number; reduced: boolean }) {
  const t = useTone();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) { progress.value = 1; return; }
    // M5's own stagger — 100 ms apart, capped the same way `enter()` caps
    // a screen's blocks (spec §6) so a long status list does not crawl in.
    const delay = Math.min(index, 8) * 100;
    progress.value = withDelay(delay, withTiming(1, { duration: 300, easing: ease.out }));
  }, [index, reduced, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * -6 }],
  }));

  const color = row.danger ? colors.danger : row.ok ? colors.signal : row.live ? t.fg : t.faint;
  const labelColor = row.danger ? colors.danger : row.ok ? colors.signal : t.muted;

  return (
    <Animated.View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.lg }}>
        <Text
          style={{
            fontFamily: fontFamily.mono[500], fontSize: 11, letterSpacing: 1.32,
            textTransform: 'uppercase', color: labelColor,
          }}
        >
          {row.label}
        </Text>
        {row.value ? (
          <Text
            style={[
              { fontFamily: fontFamily.mono[400], fontSize: 11, color },
              tabular,
            ]}
            numberOfLines={1}
          >
            {row.value}{row.ok ? ' ✓' : ''}
          </Text>
        ) : null}
      </View>
      {row.line ? (
        <Text style={{ marginTop: 4, fontFamily: fontFamily.sans[400], fontSize: 14, lineHeight: 21, color: t.muted }}>
          {row.line}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export function StatusBlock({
  rows, progress, right,
}: {
  rows: StatusRow[];
  /** Draws a 1 px `signal` rule along the inside bottom edge at this width. Hidden when undefined. */
  progress?: SharedValue<number>;
  /** An optional control at the block's edge — the ghost **Stop**. */
  right?: ReactNode;
}) {
  const t = useTone();
  const reduced = useReducedMotionFlag();

  const progressStyle = useAnimatedStyle(() => ({
    width: progress ? `${progress.value * 100}%` : '0%',
  }));

  return (
    <View
      style={{
        borderRadius: radius.task, borderWidth: 1, borderColor: t.line,
        backgroundColor: t.panel2, padding: space.lg, gap: 10, overflow: 'hidden',
      }}
    >
      {rows.map((row, i) => <Row key={row.label} row={row} index={i} reduced={reduced} />)}
      {right ? <View style={{ marginTop: space.xs, alignItems: 'flex-end' }}>{right}</View> : null}
      {progress ? (
        <Animated.View
          style={[
            { position: 'absolute', left: 0, bottom: 0, height: 1, backgroundColor: colors.signal },
            progressStyle,
          ]}
        />
      ) : null}
    </View>
  );
}
