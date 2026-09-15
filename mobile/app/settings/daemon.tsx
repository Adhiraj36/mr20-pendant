/**
 * The laptop daemon — Settings → Laptop daemon.
 *
 * This screen is one half of a handshake whose other half is a program on
 * somebody's own laptop. The phone can only ever do two things about that
 * machine: hand out an invitation, and take the invitation back. It cannot
 * reach the laptop — there is no address for a machine behind a home router —
 * so everything that follows the code being typed happens because the laptop
 * asks, and this screen finds out by watching its own list grow.
 *
 * Hence the two clocks: the code counts down because it is worth typing for
 * five minutes, and the list refreshes underneath it because the moment a
 * machine redeems the code is the moment this screen has something to say.
 * Both stop the instant the code is spent or gone, so a screen left open
 * costs nothing.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Banner, Button, Card, CodePlate, EmptyCard, Label, Screen, SettingsRow, TopRow, Txt,
  metaLine, useToast,
} from '@/design/kit';
import { DAEMON } from '@/design/copy';
import { UnlockSheet } from '@/home/UnlockSheet';
import { daemonsApi, type Daemon, type PairCode } from '@/api/daemons';
import { isPaymentRequired } from '@/api/tasks';
import {
  codeClock, codeSecondsLeft, presence, presenceLabel, presenceTone,
} from '@/daemon/model';

/** How often the list is re-read while a code is on screen, in milliseconds. */
const WATCH_EVERY = 4000;

export default function DaemonScreen() {
  const router = useRouter();
  const toast = useToast();

  const [daemons, setDaemons] = useState<Daemon[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [code, setCode] = useState<PairCode | undefined>(undefined);
  const [minting, setMinting] = useState(false);
  const [unlock, setUnlock] = useState(false);
  /** Re-rendered once a second while a code is live, to move the countdown. */
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async (): Promise<Daemon[] | undefined> => {
    try {
      const { daemons: rows } = await daemonsApi.list();
      setDaemons(rows);
      setError(undefined);
      return rows;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : DAEMON.listFailed);
      return undefined;
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /**
   * The countdown, and the watch for the machine that redeems the code.
   *
   * One effect for both because they have the same life: they start when a
   * code is minted and end when it is spent or expires. `paired` compares
   * against the count the code was minted under, so a machine that appears
   * while this screen is open is unmistakably the one that just typed it.
   */
  const knownAt = useRef(0);
  // Through a ref, because the toast context hands out a new object whenever
  // a toast appears — as a dependency it would tear down and rebuild both
  // intervals in the middle of the countdown they are driving.
  const say = useRef(toast);
  say.current = toast;
  useEffect(() => {
    if (!code) return undefined;
    const tick = setInterval(() => setNow(new Date()), 1000);
    const watch = setInterval(() => {
      void load().then((rows) => {
        if (!rows || rows.length <= knownAt.current) return;
        setCode(undefined);
        say.current.show(DAEMON.paired, { tone: 'success' });
      });
    }, WATCH_EVERY);
    return () => { clearInterval(tick); clearInterval(watch); };
  }, [code, load]);

  const pair = useCallback(async () => {
    setMinting(true);
    try {
      knownAt.current = daemons?.length ?? 0;
      setCode(await daemonsApi.mintCode());
      setNow(new Date());
    } catch (err) {
      // The price, not a failure: the answer to a 402 is the chooser.
      if (isPaymentRequired(err)) setUnlock(true);
      else toast.show(DAEMON.codeFailed, { tone: 'error' });
    } finally {
      setMinting(false);
    }
  }, [daemons?.length, toast]);

  const unpair = useCallback((daemon: Daemon) => {
    Alert.alert(DAEMON.unpairTitle, DAEMON.unpairLine, [
      { text: DAEMON.cancel, style: 'cancel' },
      {
        text: DAEMON.unpairConfirm,
        style: 'destructive',
        onPress: () => {
          void daemonsApi
            .unpair(daemon.daemonId)
            .then(() => { toast.show(DAEMON.unpaired); return load(); })
            .catch(() => toast.show(DAEMON.unpairFailed, { tone: 'error' }));
        },
      },
    ]);
  }, [load, toast]);

  const seconds = code ? codeSecondsLeft(code.expiresAt, now) : 0;
  const expired = Boolean(code) && seconds <= 0;
  const machines = daemons ?? [];

  return (
    <Screen edges={['top']}>
      <TopRow back={DAEMON.back} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-[18px] pb-[16px]">
          <Txt variant="title">{DAEMON.screenTitle}</Txt>
        </View>

        {error ? (
          <Banner
            variant="void"
            label={error}
            action={DAEMON.retry}
            onAction={() => void load()}
            className="mb-[14px]"
          />
        ) : null}

        <View className="px-[18px] gap-[8px]">
          {machines.length > 0 ? (
            <>
              <Label variant="eyebrow">{DAEMON.machines}</Label>
              {machines.map((daemon) => (
                <SettingsRow
                  key={daemon.daemonId}
                  label={daemon.name}
                  note={metaLine([
                    daemon.os,
                    daemon.version && `v${daemon.version}`,
                    daemon.capabilities.length
                      ? daemon.capabilities.join(' · ').toUpperCase()
                      : DAEMON.capabilitiesNone,
                  ])}
                  noteTone="faint"
                  value={presenceLabel(daemon, now)}
                  valueTone={presenceTone(presence(daemon, now))}
                  onPress={() => unpair(daemon)}
                />
              ))}
            </>
          ) : null}

          {/* The invitation. Three faces: the offer, the live code, and the
              code that ran out — the last of which is not an error, so it
              keeps the plate and changes only the line under it. */}
          {code ? (
            <Card pad="roomy" className="gap-[10px] mt-[6px]">
              <Label variant="eyebrow">{DAEMON.codeEyebrow}</Label>
              <CodePlate code={code.code} className="mt-[2px]" />
              {expired ? (
                <>
                  <Txt variant="small" tone="danger">{DAEMON.codeExpired}</Txt>
                  <Button
                    title={DAEMON.codeAgain}
                    onPress={() => void pair()}
                    busy={minting}
                    full
                  />
                </>
              ) : (
                <>
                  <Txt variant="bodyL" tone="muted">{DAEMON.codeLine}</Txt>
                  <View className="flex-row items-center justify-between mt-[2px]">
                    <Label variant="tag" tone="stamp">{DAEMON.waiting}</Label>
                    <Label variant="tag" tone="faint">
                      {DAEMON.codeExpires(codeClock(seconds))}
                    </Label>
                  </View>
                  <Button
                    title={DAEMON.cancel}
                    variant="secondary"
                    onPress={() => setCode(undefined)}
                    full
                  />
                </>
              )}
            </Card>
          ) : machines.length === 0 ? (
            <EmptyCard
              eyebrow={DAEMON.machines}
              statement={DAEMON.emptyStatement}
              line={DAEMON.emptyLine}
              action={DAEMON.pair}
              onAction={() => void pair()}
            />
          ) : (
            <Button
              title={DAEMON.pairAnother}
              variant="secondary"
              onPress={() => void pair()}
              busy={minting}
              className="mt-[6px]"
              full
            />
          )}

          {/* Said once, on the screen that pairs the machine, because the
              honest limits of the arrangement are the reason to trust it. */}
          <Card variant="carbon" pad="roomy" className="gap-[8px] mt-[10px]">
            <Label variant="eyebrow">{DAEMON.howEyebrow}</Label>
            <Txt variant="bodyL" tone="muted">{DAEMON.howLine}</Txt>
            <Txt variant="small" tone="fg">{DAEMON.howNever}</Txt>
          </Card>
        </View>
      </ScrollView>

      <UnlockSheet visible={unlock} onClose={() => setUnlock(false)} />
    </Screen>
  );
}
