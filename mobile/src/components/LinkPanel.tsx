/**
 * The link between the phone and the pendant — app spec §2.6 step 2, §3.5.
 *
 * "This is the only ink surface on the page": a `PanelInverted` on the
 * Library's paper, the mark at the left with one mono label beside it and a
 * compact button at the right. It replaces `LinkStrip` and the gradient card
 * that one was built on; the store actions, toasts and reconnect behaviour
 * behind it are untouched (spec §0.4).
 *
 * The phase text is §7's, verbatim, and a fragment with nothing behind it is
 * dropped rather than printed empty.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue,
} from 'react-native-reanimated';
import { Button, Label, PanelInverted } from '../design/primitives';
import { Mark } from '../design/icons';
import { useToast } from '../design/Toast';
import { useApp } from '../state/store';
import { colors, formatBytes, joinLabel, space } from '../design/tokens';
import type { SyncProgress } from '../sync/engine';

/** §7's sync phase text. The mono `Label` uppercases it. */
const PHASE: Record<SyncProgress['phase'], string> = {
  listing: 'reading the pendant',
  pausing: 'pausing recording',
  wifi: 'switching to pendant wifi',
  pulling: 'pulling',
  uploading: 'uploading',
  resuming: 'resuming recording',
  idle: 'syncing',
  done: 'up to date',
};

/** `SYNCING · PULLING 2 / 5 · 1.2 MB OF 3.4 MB` — §2.6 and §7 together. */
function syncingLabel(progress: SyncProgress): string {
  const phase = PHASE[progress.phase] ?? 'syncing';
  const counted = progress.phase === 'pulling' && progress.index && progress.total
    ? `${phase} ${progress.index} / ${progress.total}`
    : phase;
  const bytes = progress.received !== undefined && progress.expected
    ? `${formatBytes(progress.received)} of ${formatBytes(progress.expected)}`
    : undefined;
  return joinLabel(['syncing', counted, bytes]);
}

export function LinkPanel() {
  const toast = useToast();
  const {
    paired, link, progress, btOn, connect, sync, cancelSync, lastSync,
  } = useApp();

  const syncing = link === 'syncing';
  // Only a phase that knows its byte count draws the 1 px gold rule along
  // the panel's inside bottom edge; an indeterminate phase draws none
  // (spec §2.6) — progress is a rule and a label, never a spinner (§6).
  const determinate = syncing && progress?.received !== undefined && !!progress?.expected;
  const fraction = useSharedValue(0);

  useEffect(() => {
    fraction.value = determinate
      ? Math.max(0, Math.min(1, progress!.received! / progress!.expected!))
      : 0;
  }, [determinate, progress, fraction]);

  const ruleStyle = useAnimatedStyle(() => ({ width: `${fraction.value * 100}%` }));

  if (!paired) return null;

  const label = syncing && progress
    ? syncingLabel(progress)
    : link === 'connecting'
      ? 'connecting…'
      : !btOn
        ? 'bluetooth is off'
        : link === 'disconnected'
          ? 'not in range'
          : joinLabel([
            'linked',
            lastSync && lastSync.pulled > 0 ? `pulled ${lastSync.pulled} new` : 'up to date',
          ]);

  const action = syncing ? (
    <Button size="compact" variant="ghost" title="Stop" onPress={cancelSync} />
  ) : link === 'connected' ? (
    <Button
      size="compact"
      variant="secondary"
      title="Sync"
      onPress={() =>
        sync().catch((e: Error) => toast.show('Sync failed', { detail: e.message, tone: 'error' }))
      }
    />
  ) : link === 'disconnected' && btOn ? (
    <Button
      size="compact"
      variant="secondary"
      title="Connect"
      onPress={() =>
        connect()
          .then(() => toast.show('Connected', { tone: 'success' }))
          .catch((e: Error) => toast.show('Could not connect', { detail: e.message, tone: 'error' }))
      }
    />
  ) : null;

  return (
    <Animated.View
      entering={FadeIn}
      exiting={FadeOut}
      layout={LinearTransition.duration(220)}
      style={styles.host}
    >
      <PanelInverted padded={false} style={styles.panel}>
        <View style={styles.inner}>
          {/* Inside a `PanelInverted` the tone is already the other ground,
              so the mark and the label take the inverted `fg` on their own. */}
          <Mark size={20} />
          <Label size="sm" tone="fg" style={styles.label} numberOfLines={2}>
            {label}
          </Label>
          {action}
        </View>
        {determinate ? <Animated.View style={[styles.rule, ruleStyle]} /> : null}
      </PanelInverted>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { paddingHorizontal: space.xl, marginBottom: space.lg },
  panel: { minHeight: 64, overflow: 'hidden' },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    minHeight: 64,
  },
  label: { flex: 1 },
  rule: { position: 'absolute', left: 0, bottom: 0, height: 1, backgroundColor: colors.signal },
});
