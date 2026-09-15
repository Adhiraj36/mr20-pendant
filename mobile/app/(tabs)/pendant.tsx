/**
 * The Pendant tab — canvas P1, P2, P3.
 *
 * One screen that tells the truth about the device: what it is doing, how
 * much charge and room it has, and when it last handed anything over. Which
 * of the three states it is in is `pendantView`'s decision, not this file's,
 * and every number on screen either came off the device or was measured from
 * what this phone has already pulled. A figure the app cannot derive is
 * omitted rather than guessed — the plan's slot rule.
 *
 * The dangerous actions are not here. Unpairing, erasing the pendant and
 * clearing the phone's copy live in Settings behind their confirmations;
 * this screen offers the two a person reaches for daily — pause listening,
 * and sync now.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Banner, Button, Card, EmptyCard, KeyValue, Label, MetaLine, Progress,
  RecordingPill, Screen, Txt, useToast,
} from '@/design/kit';
import { useTabBarPadding } from '@/design/useTabBarPadding';
import { PENDANT } from '@/design/copy';
import {
  batteryLeftLabel, bytesPerSecond, durationLabel, pendantMeta, pendantView,
  pushBatterySample, roomLeftLabel, storageFraction, storageLine, syncedLine,
  unsyncedSeconds, type BatterySample,
} from '@/pendant/model';
import { PhoneCaptureCard } from '@/capture/PhoneCaptureCard';
import { entitledToPhoneCapture } from '@/capture/model';
import { useFeatures } from '@/home/features';
import { resolvePlan } from '@/plan/resolve';
import { useApp } from '@/state/store';
import * as library from '@/sync/library';

export default function PendantScreen() {
  const router = useRouter();
  const toast = useToast();
  const pad = useTabBarPadding();

  const paired = useApp((s) => s.paired);
  const info = useApp((s) => s.info);
  const link = useApp((s) => s.link);
  const progress = useApp((s) => s.progress);
  const lastSyncAt = useApp((s) => s.lastSyncAt);
  const recordIntent = useApp((s) => s.recordIntent);
  const connect = useApp((s) => s.connect);
  const disconnect = useApp((s) => s.disconnect);
  const sync = useApp((s) => s.sync);
  const cancelSync = useApp((s) => s.cancelSync);
  const refreshInfo = useApp((s) => s.refreshInfo);
  const toggleRecording = useApp((s) => s.toggleRecording);
  const loadRecordings = useApp((s) => s.loadRecordings);

  // Whether this account may use the phone as the microphone: the deployment
  // offers it, and the plan is something rather than nothing.
  const features = useFeatures();
  const apiPlan = useApp((s) => s.plan);
  const clerkPlan = useApp((s) => s.clerkPlan);
  const appConfig = useApp((s) => s.appConfig);
  const plan = useMemo(
    () => resolvePlan(clerkPlan, apiPlan, appConfig),
    [clerkPlan, apiPlan, appConfig],
  );
  const canRecordOnPhone = entitledToPhoneCapture({
    phoneCaptureEnabled: features.phoneCapture,
    tier: plan.tier,
  });

  const connected = link === 'connected' || link === 'syncing';
  const view = pendantView({
    paired: !!paired,
    connected,
    freeMb: info?.freeMb,
    totalMb: info?.totalMb,
  });

  /**
   * The battery's own history, kept for this launch only.
   *
   * An estimate of hours left needs two readings far enough apart to mean
   * something; a fresh launch has none and says nothing, which is correct.
   */
  const [trail, setTrail] = useState<BatterySample[]>([]);
  useEffect(() => {
    const percent = info?.batteryPercent;
    if (percent === undefined) return;
    setTrail((was) => pushBatterySample(was, { percent, at: Date.now() }));
  }, [info?.batteryPercent]);

  /** What a second of audio costs on this device, from files already pulled. */
  const [rate, setRate] = useState<number | undefined>(undefined);
  const [pending, setPending] = useState<{ durationSeconds: number }[]>([]);
  const loadLocal = useCallback(async () => {
    const all = await library.loadManifest().catch(() => ({}) as Record<string, never>);
    const entries = Object.values(all) as { sizeBytes: number; durationSeconds: number; uploadedAt?: string }[];
    setRate(bytesPerSecond(entries));
    setPending(entries.filter((entry) => !entry.uploadedAt));
  }, []);
  useFocusEffect(useCallback(() => { void loadLocal(); }, [loadLocal]));

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (connected) await refreshInfo();
      else await connect({ sync: false });
      await loadLocal();
    } catch {
      // The link's own error is already on the screen; a toast would repeat it.
    } finally {
      setRefreshing(false);
    }
  }, [connected, refreshInfo, connect, loadLocal]);

  const busy = useRef(false);
  const onPause = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const on = await toggleRecording();
      toast.show(on ? PENDANT.listeningToast : PENDANT.pausedToast);
    } catch {
      toast.show(PENDANT.pauseFailed, { tone: 'error' });
    } finally {
      busy.current = false;
    }
  }, [toggleRecording, toast]);

  const onDisconnect = useCallback(async () => {
    await disconnect();
    toast.show(PENDANT.disconnected);
  }, [disconnect, toast]);

  const onSync = useCallback(async () => {
    try {
      const result = await sync();
      toast.show(PENDANT.syncedToast(result.pulled), { tone: 'success' });
      await loadLocal();
    } catch {
      toast.show(PENDANT.syncFailed, { tone: 'error' });
    }
  }, [sync, toast, loadLocal]);

  if (view === 'none') {
    return (
      <Screen edges={['top']}>
        <View className="px-[18px] pt-[10px] pb-[14px]">
          <Txt variant="screen">{PENDANT.screenTitle}</Txt>
          <MetaLine parts={[PENDANT.noneMeta]} className="mt-[4px]" />
        </View>
        <View className="px-[18px] gap-[12px]">
          <EmptyCard
            eyebrow={PENDANT.noneEyebrow}
            statement={PENDANT.none}
            line={PENDANT.noneLine}
            action={PENDANT.pairAction}
            onAction={() => router.push('/onboarding/pair')}
          />
          {/* No pendant in hand, but the plan already bought capture: the
              phone stands in until the device arrives. */}
          {canRecordOnPhone ? <PhoneCaptureCard onFiled={loadRecordings} /> : null}
        </View>
      </Screen>
    );
  }

  const recording =
    info?.recording === true ||
    (info?.recording === undefined && recordIntent === 'on' && connected);
  const waiting = unsyncedSeconds(pending);
  const synced = syncedLine(lastSyncAt, pending.length);

  return (
    <Screen edges={['top']}>
      {view === 'away' ? <Banner variant="carbon" label={PENDANT.awayBanner} /> : null}
      {view === 'full' ? <Banner variant="void" label={PENDANT.fullBanner} /> : null}

      <ScrollView
        contentContainerStyle={{ paddingBottom: pad }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="px-[18px] pt-[10px] pb-[14px]">
          <Txt variant="screen">{PENDANT.screenTitle}</Txt>
          <MetaLine
            className="mt-[4px]"
            parts={pendantMeta(view, {
              name: paired?.name,
              lastSeenAt: paired?.lastSeenAt,
              freeMb: info?.freeMb,
              totalMb: info?.totalMb,
            })}
          />
        </View>

        <View className="px-[18px] gap-[12px]">
          {view === 'connected' && recording ? (
            <RecordingPill detail={PENDANT.recordingDetail(paired?.name)} />
          ) : null}

          {view === 'away' ? (
            <Card variant="carbon" pad="roomy">
              <Txt variant="statement">{PENDANT.awayTitle}</Txt>
              <Txt variant="bodyL" tone="muted" className="mt-[9px]">{PENDANT.awayLine}</Txt>
              <Card variant="paper" pad="tight" className="mt-[14px] border-tone-carbon-line">
                <Label variant="tag">{PENDANT.awayEyebrow}</Label>
                <View className="mt-[6px]">
                  <KeyValue k={PENDANT.unsynced} v={durationLabel(waiting) ?? PENDANT.nothingWaiting} />
                  <KeyValue k={PENDANT.roomLeft} v={roomLeftLabel(info?.freeMb, rate) ?? '—'} />
                </View>
              </Card>
              <MetaLine className="mt-[12px]" parts={[...PENDANT.awayFooter]} />
            </Card>
          ) : null}

          {view === 'full' ? (
            <>
              <Card variant="void" pad="roomy">
                <Txt variant="statement">{PENDANT.fullTitle}</Txt>
                <Txt variant="bodyL" tone="muted" className="mt-[9px]">{PENDANT.fullLine}</Txt>
                <Progress value={1} tone="danger" size={6} className="mt-[14px]" />
                <View className="flex-row justify-between mt-[8px]">
                  <Label variant="tag">{durationLabel(waiting) ?? PENDANT.unsynced}</Label>
                  <Label variant="tag">{PENDANT.freeNone}</Label>
                </View>
              </Card>
              <Label variant="eyebrow" className="mt-[4px]">{PENDANT.fullHow}</Label>
              <Card variant="carbon">
                <Txt variant="strong">{PENDANT.fullSyncTitle}</Txt>
                <Txt variant="small" tone="muted" className="mt-[4px]">{PENDANT.fullSyncLine}</Txt>
                <Button
                  title={PENDANT.syncNowFor(durationLabel(waiting))}
                  onPress={onSync}
                  className="mt-[12px]"
                  full
                />
              </Card>
            </>
          ) : null}

          <Card>
            <View className="flex-row items-end justify-between">
              <View>
                <Label variant="tag">{PENDANT.battery}</Label>
                <Label variant="code" tone="fg" className="mt-[2px]">
                  {info?.batteryPercent !== undefined ? `${info.batteryPercent}%` : '—'}
                </Label>
              </View>
              <MetaLine parts={[batteryLeftLabel(trail, info?.batteryPercent)]} />
            </View>
            <Progress value={(info?.batteryPercent ?? 0) / 100} tone="ink" size={6} className="mt-[12px]" />
          </Card>

          <Card>
            <View className="flex-row items-baseline justify-between">
              <Label variant="tag">{PENDANT.storage}</Label>
              <Label variant="value" tone="fg">{storageLine(info?.freeMb, info?.totalMb) ?? '—'}</Label>
            </View>
            <Progress value={storageFraction(info?.freeMb, info?.totalMb)} tone="ink" size={6} className="mt-[12px]" />
            <MetaLine className="mt-[8px]" parts={[synced]} />
          </Card>

          <Card>
            <Txt variant="strong">
              {info?.firmware ? PENDANT.firmware(info.firmware) : PENDANT.firmwareUnknown}
            </Txt>
            {info?.firmware ? (
              <Label variant="tag" tone="settled" className="mt-[3px]">{PENDANT.upToDate}</Label>
            ) : null}
          </Card>

          {progress ? (
            <Card variant="carbon">
              <Label variant="tag">{PENDANT.syncing}</Label>
              <Progress
                value={progress.expected ? (progress.received ?? 0) / progress.expected : 0}
                tone="stamp"
                className="mt-[8px]"
              />
              <View className="flex-row justify-between items-center mt-[8px]">
                <Label variant="tag">{progress.phase.toUpperCase()}</Label>
                <Button title={PENDANT.stop} variant="ghost" size="compact" onPress={cancelSync} />
              </View>
            </Card>
          ) : null}

          {view === 'connected' ? (
            <>
              <Button
                title={recording ? PENDANT.pause : PENDANT.resume}
                variant={recording ? 'void' : 'primary'}
                onPress={onPause}
                className="mt-[4px]"
                full
              />
              {/* Sync now, and let go on purpose. The store has always had
                  both — `disconnect()` is what suppresses the auto-reconnect,
                  so walking away can be a decision rather than a fault — and
                  neither had a control until round eight. */}
              <View className="flex-row gap-[9px]">
                <Button
                  title={PENDANT.syncNowShort}
                  variant="secondary"
                  onPress={onSync}
                  className="flex-1"
                  disabled={link === 'syncing'}
                />
                <Button
                  title={PENDANT.disconnect}
                  variant="secondary"
                  onPress={onDisconnect}
                  className="flex-1"
                  disabled={link === 'syncing'}
                />
              </View>
            </>
          ) : null}
          {view === 'away' ? (
            <Button
              title={PENDANT.reconnect}
              onPress={() => void connect({ sync: false })}
              className="mt-[4px]"
              full
            />
          ) : null}

          <Button
            title={PENDANT.settings}
            variant="ghost"
            onPress={() => router.push('/settings')}
            className="self-center"
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
