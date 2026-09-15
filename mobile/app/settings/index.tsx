/**
 * Settings — canvas SET, "one flat list, no submenu maze".
 *
 * Reached from the gear on Home and from the Pendant tab. Four sections in
 * the canvas' order, and which of them exist is `settingsSections`' answer,
 * not this file's: a section whose every row is behind a flag that is off
 * must not render its eyebrow over nothing.
 *
 * The three destructive actions live here and nowhere else. Each one says
 * what it destroys before it asks, and the last one asks twice.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Button, Card, Field, InkPicker, Label, Screen, Segments, SettingsRow, Toggle,
  TopRow, Txt, useInk, useToast,
} from '@/design/kit';
import { SETTINGS } from '@/design/copy';
import { useTheme } from '@/design/tone';
import {
  RETENTION, THEME_ROWS, settingsSections, showsDaemonRow, showsGatesRow, themeNote,
} from '@/settings/model';
import { useFeatures } from '@/home/features';
import { tierName } from '@/plan/slip';
import { resolvePlan } from '@/plan/resolve';
import { useApp } from '@/state/store';
import * as library from '@/sync/library';
import { api } from '@/api/client';
import { daemonsApi, type Daemon } from '@/api/daemons';
import { daemonRowValue } from '@/daemon/model';

export default function SettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const features = useFeatures();
  const sections = settingsSections(features);
  const [ink, setInk] = useInk();
  const { theme, setTheme: chooseTheme } = useTheme();

  const email = useApp((s) => s.email);
  const profile = useApp((s) => s.profile);
  const paired = useApp((s) => s.paired);
  const info = useApp((s) => s.info);
  const autoSync = useApp((s) => s.autoSync);
  const setAutoSync = useApp((s) => s.setAutoSync);
  const loadProfile = useApp((s) => s.loadProfile);
  const unpair = useApp((s) => s.unpair);
  const signOut = useApp((s) => s.signOut);
  const cleanupDevice = useApp((s) => s.cleanupDevice);
  const factoryResetDevice = useApp((s) => s.factoryResetDevice);
  const deleteEverything = useApp((s) => s.deleteEverything);
  /** `n of m` while the loop runs, so the row is not a frozen alert. */
  const [wiping, setWiping] = useState<string | undefined>(undefined);
  // Derived here rather than through a selector: `resolvePlan` builds a new
  // object on every call, and a zustand selector that never returns the same
  // reference re-renders forever (the launch gate carries the same note).
  const apiPlan = useApp((s) => s.plan);
  const clerkPlan = useApp((s) => s.clerkPlan);
  const appConfig = useApp((s) => s.appConfig);
  const plan = useMemo(
    () => resolvePlan(clerkPlan, apiPlan, appConfig),
    [clerkPlan, apiPlan, appConfig],
  );

  useFocusEffect(useCallback(() => { void loadProfile(); }, [loadProfile]));

  /**
   * The machines, only when there is a row to put them in.
   *
   * The row has to say something true — a laptop that is paired and asleep is
   * not "NOT INSTALLED" — and the only way to know is to ask. One small GET,
   * skipped entirely when the daemon is switched off, and a failure leaves
   * the row saying nothing rather than saying something wrong.
   */
  const [daemons, setDaemons] = useState<Daemon[]>([]);
  const wantsDaemons = showsDaemonRow(features);
  useFocusEffect(useCallback(() => {
    if (!wantsDaemons) return;
    void daemonsApi.list()
      .then(({ daemons: rows }) => setDaemons(rows))
      .catch(() => undefined);
  }, [wantsDaemons]));

  /**
   * The name commits on blur — and on the keyboard's own Done, and on leaving
   * the screen.
   *
   * Blur alone was not enough (round eight). Nothing on this screen takes
   * focus away from a text field, so on a device with a hardware keyboard —
   * or when the person simply goes back — the field kept its new value on
   * screen and never sent it. Three ways out of the field, one commit, and
   * the commit is idempotent: it does nothing when the value has not moved.
   */
  const [name, setName] = useState<string | undefined>(undefined);
  const shownName = name ?? profile?.name ?? '';
  const commitName = useCallback(async () => {
    const next = (name ?? '').trim();
    if (!next || next === profile?.name) return;
    try {
      await api.updateProfile({ name: next });
      await loadProfile();
      toast.show(SETTINGS.nameSaved, { tone: 'success' });
    } catch {
      toast.show(SETTINGS.nameFailed, { tone: 'error' });
    }
  }, [name, profile?.name, loadProfile, toast]);

  // Leaving the screen is the last chance to send it. A ref, because the
  // cleanup runs once and must see the value as it was when it ran, not the
  // one this callback closed over on first render.
  const pendingName = useRef(commitName);
  pendingName.current = commitName;
  useEffect(() => () => { void pendingName.current(); }, []);

  const confirmUnpair = useCallback(() => {
    Alert.alert(SETTINGS.unpairTitle, SETTINGS.unpairLine, [
      { text: SETTINGS.cancel, style: 'cancel' },
      {
        text: SETTINGS.unpairConfirm,
        style: 'destructive',
        onPress: () => {
          void unpair()
            .then(() => toast.show(SETTINGS.unpaired))
            .catch(() => toast.show(SETTINGS.unpairFailed, { tone: 'error' }));
        },
      },
    ]);
  }, [unpair, toast]);

  const confirmErase = useCallback(() => {
    Alert.alert(SETTINGS.eraseTitle, SETTINGS.eraseLine, [
      { text: SETTINGS.cancel, style: 'cancel' },
      {
        text: SETTINGS.eraseNext,
        style: 'destructive',
        onPress: () => {
          // Two stages, because this one cannot be taken back and the phone's
          // own copies are the only thing that survives it.
          Alert.alert(SETTINGS.eraseFinalTitle, SETTINGS.eraseFinalLine, [
            { text: SETTINGS.keepIt, style: 'cancel' },
            {
              text: SETTINGS.eraseConfirm,
              style: 'destructive',
              onPress: () => {
                void factoryResetDevice()
                  .then(() => toast.show(SETTINGS.erased))
                  .catch(() => toast.show(SETTINGS.eraseFailed, { tone: 'error' }));
              },
            },
          ]);
        },
      },
    ]);
  }, [factoryResetDevice, toast]);

  const freeSpace = useCallback(() => {
    void cleanupDevice()
      .then((result) => toast.show(SETTINGS.freed(result.deleted)))
      .catch(() => toast.show(SETTINGS.freeFailed, { tone: 'error' }));
  }, [cleanupDevice, toast]);

  const clearCache = useCallback(() => {
    Alert.alert(SETTINGS.cacheTitle, SETTINGS.cacheLine, [
      { text: SETTINGS.cancel, style: 'cancel' },
      {
        text: SETTINGS.cacheConfirm,
        style: 'destructive',
        onPress: () => {
          void library.clearLibrary()
            .then(() => toast.show(SETTINGS.cacheCleared))
            .catch(() => toast.show(SETTINGS.cacheFailed, { tone: 'error' }));
        },
      },
    ]);
  }, [toast]);

  /**
   * `DELETE EVERYTHING`, and exactly what it can promise.
   *
   * There is no account-deletion endpoint — the API has `DELETE
   * /recordings/:id` and `DELETE /chats/:id` and nothing that closes an
   * account (audited, round eight) — so this deletes the record, in a loop,
   * counting as it goes, and the confirmation says so rather than implying
   * the account goes with it. A row that promised more than the API can do
   * would be the one dishonest control on the screen.
   */
  const confirmDeleteAll = useCallback(() => {
    if (wiping) return;
    Alert.alert(SETTINGS.deleteAllTitle, SETTINGS.deleteAllLine, [
      { text: SETTINGS.cancel, style: 'cancel' },
      {
        text: SETTINGS.deleteAllNext,
        style: 'destructive',
        onPress: () => {
          Alert.alert(SETTINGS.deleteAllFinalTitle, SETTINGS.deleteAllFinalLine, [
            { text: SETTINGS.keep, style: 'cancel' },
            {
              text: SETTINGS.deleteAllConfirm,
              style: 'destructive',
              onPress: () => {
                setWiping(SETTINGS.deleteAllProgress(0, 0));
                void deleteEverything((done, total) => {
                  setWiping(SETTINGS.deleteAllProgress(done, total));
                })
                  .then(({ deleted, failed }) => {
                    toast.show(SETTINGS.deleteAllDone(deleted, failed), {
                      tone: failed ? 'error' : undefined,
                    });
                  })
                  .catch((err: unknown) => {
                    toast.show(SETTINGS.deleteAllFailed, {
                      detail: (err as Error)?.message, tone: 'error',
                    });
                  })
                  .finally(() => setWiping(undefined));
              },
            },
          ]);
        },
      },
    ]);
  }, [wiping, deleteEverything, toast]);

  const confirmSignOut = useCallback(() => {
    Alert.alert(SETTINGS.signOutTitle, SETTINGS.signOutLine, [
      { text: SETTINGS.cancel, style: 'cancel' },
      { text: SETTINGS.signOut, style: 'destructive', onPress: () => void signOut() },
    ]);
  }, [signOut]);

  return (
    <Screen edges={['top']}>
      <TopRow back={SETTINGS.back} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-[18px] pb-[14px]">
          <Txt variant="screen">{SETTINGS.screenTitle}</Txt>
        </View>

        <View className="px-[18px] gap-[16px]">
          {/* YOU */}
          <View className="gap-[8px]">
            <Label variant="eyebrow">{SETTINGS.you}</Label>
            <Card pad="none">
              <View className="px-[15px] py-[12px] gap-[8px]">
                <Label variant="tag">{SETTINGS.name}</Label>
                <Field
                  value={shownName}
                  onChangeText={(next) => setName(next)}
                  onBlur={commitName}
                  onSubmitEditing={commitName}
                  returnKeyType="done"
                  placeholder={SETTINGS.namePlaceholder}
                />
              </View>
            </Card>
            <SettingsRow label={SETTINGS.account} value={email ?? SETTINGS.accountUnknown} />
            <SettingsRow
              label={SETTINGS.planRow}
              value={(tierName(plan.tier) ?? SETTINGS.planNone).toUpperCase()}
              valueTone={plan.tier === 'none' ? 'stamp' : 'faint'}
              onPress={plan.tier === 'none' ? () => router.push('/onboarding/plan') : undefined}
            />
            <Card pad="none">
              <View className="px-[15px] py-[12px] gap-[10px]">
                <Label variant="tag">{SETTINGS.ink}</Label>
                <InkPicker value={ink} onChange={setInk} />
              </View>
            </Card>
            <Card pad="none">
              <View className="px-[15px] py-[12px] gap-[10px]">
                <Label variant="tag">{SETTINGS.appearance}</Label>
                <Segments
                  options={THEME_ROWS.map((row) => ({ value: row.value, label: row.label }))}
                  value={theme}
                  onChange={chooseTheme}
                />
                <Label variant="value" tone="faint">{themeNote(theme)}</Label>
              </View>
            </Card>
          </View>

          {/* WHAT LYZN MAY DO — only when there is something it may do. */}
          {sections.includes('permissions') ? (
            <View className="gap-[8px]">
              <Label variant="eyebrow">{SETTINGS.permissions}</Label>
              {showsGatesRow(features) ? (
                <SettingsRow label={SETTINGS.gates} value={SETTINGS.gatesValue} valueTone="stamp" />
              ) : null}
              {features.whatsapp ? (
                <SettingsRow label={SETTINGS.whatsapp} value={SETTINGS.whatsappValue} />
              ) : null}
            </View>
          ) : null}

          {/* DEVICES */}
          <View className="gap-[8px]">
            <Label variant="eyebrow">{SETTINGS.devices}</Label>
            <SettingsRow
              label={SETTINGS.pendant}
              value={
                paired
                  ? [paired.name?.toUpperCase(), info?.batteryPercent !== undefined ? `${info.batteryPercent}%` : undefined]
                      .filter(Boolean).join(' · ')
                  : SETTINGS.pendantNone
              }
              onPress={() => router.push('/pendant')}
            />
            {showsDaemonRow(features) ? (
              <SettingsRow
                label={SETTINGS.daemon}
                value={daemonRowValue(daemons, new Date())}
                valueTone={daemons.length > 0 ? 'faint' : 'stamp'}
                onPress={() => router.push('/settings/daemon')}
              />
            ) : null}
            <SettingsRow
              label={SETTINGS.autoSync}
              note={autoSync ? SETTINGS.autoSyncOn : SETTINGS.autoSyncOff}
              right={<Toggle value={autoSync} onChange={(next) => void setAutoSync(next)} />}
            />
          </View>

          {/* YOUR RECORD */}
          <View className="gap-[8px]">
            <Label variant="eyebrow">{SETTINGS.record}</Label>
            <SettingsRow label={SETTINGS.transcripts} value={RETENTION.transcripts} />
            <SettingsRow label={SETTINGS.audio} value={RETENTION.audio} />
            <SettingsRow
              label={SETTINGS.categories}
              onPress={() => router.push('/settings/categories')}
            />
            <SettingsRow label={SETTINGS.cache} onPress={clearCache} />
            {paired ? <SettingsRow label={SETTINGS.freeSpace} onPress={freeSpace} /> : null}
          </View>

          {/* The three that cannot be taken back. */}
          <View className="gap-[8px] mt-[8px]">
            <Label variant="eyebrow" tone="danger">{SETTINGS.danger}</Label>
            {paired ? (
              <>
                <SettingsRow label={SETTINGS.unpairRow} danger onPress={confirmUnpair} />
                <SettingsRow label={SETTINGS.erase} danger onPress={confirmErase} />
              </>
            ) : null}
            <SettingsRow label={SETTINGS.signOut} danger onPress={confirmSignOut} />
            <SettingsRow
              label={SETTINGS.deleteAll}
              value={wiping ?? SETTINGS.deleteAllValue}
              danger
              onPress={wiping ? undefined : confirmDeleteAll}
            />
          </View>

          <Button
            title={SETTINGS.done}
            variant="secondary"
            onPress={() => router.back()}
            className="mt-[8px]"
            full
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
