/**
 * Pair the pendant — canvas O3, and O3b once it answers.
 *
 * The scan is unfiltered and matched by name, because this firmware does not
 * advertise its service UUID; what arrives is sorted by signal and drawn
 * with the strength it came in at, so a person can tell their own pendant
 * from the one at the next desk. The device the app believes is ours wears
 * the carbon card and the LYZN badge; anything else is paper and recedes.
 *
 * Nothing here is decoration. A row's ticks are `signalLevel`'s answer, the
 * hint after four fruitless seconds is the one thing that actually fixes a
 * pendant that will not show up (it is plugged in), and the screen offers a
 * way out — a person who has left the pendant at home should not be stuck
 * in setup.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Banner, Button, Card, Label, MetaLine, Screen, TickRow, Touchable, TopRow, Txt,
} from '@/design/kit';
import { PAIR } from '@/design/copy';
import {
  ONBOARDING_STEPS, pairStatus, pairingToken, signalLevel, tickValue, type PairStage,
} from '@/onboarding/pairing';
import {
  requestPermissions, scanForPendants, waitForPoweredOn, type DiscoveredDevice,
} from '@/ble/manager';
import { useApp } from '@/state/store';
import { useGoBack } from '@/nav/back';

/** Four ticks, as the canvas draws a signal. */
const TICKS = 4;

export default function PairScreen() {
  const router = useRouter();
  // Reached from the launch gate there is nothing under this screen, so the
  // arrow is only drawn when it has somewhere to go. "Not now" is the way
  // out either way.
  const { canGoBack, goBack } = useGoBack('/(tabs)');
  const pair = useApp((s) => s.pair);

  const [stage, setStage] = useState<PairStage>('permissions');
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  /** Android asks for permission; iOS only takes a moment to power the radio. */
  const [needsPermission, setNeedsPermission] = useState(false);
  const [connectingId, setConnectingId] = useState<string | undefined>(undefined);
  const stopScan = useRef<(() => void) | undefined>(undefined);

  const scan = useCallback(async () => {
    setError(undefined);
    setStage('permissions');
    try {
      const { granted } = await requestPermissions();
      setNeedsPermission(!granted);
      if (!granted) {
        setError(PAIR.nothingFound);
        setStage('failed');
        return;
      }
      await waitForPoweredOn();
      setStage('scanning');
      stopScan.current = scanForPendants(setDevices, (err) => {
        setError(err.message);
        setStage('failed');
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : PAIR.nothingFound);
      setStage('failed');
    }
  }, []);

  useEffect(() => {
    void scan();
    return () => stopScan.current?.();
  }, [scan]);

  /** The hint that fixes most empty scans: it is still on the cable. */
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (stage !== 'scanning' || devices.length > 0) { setElapsed(false); return; }
    const timer = setTimeout(() => setElapsed(true), 4000);
    return () => clearTimeout(timer);
  }, [stage, devices.length]);

  const connect = useCallback(async (device: DiscoveredDevice) => {
    setConnectingId(device.id);
    setStage('connecting');
    try {
      stopScan.current?.();
      await pair(device.id);
      // The token is what lets Ready print its receipt exactly once.
      router.replace({ pathname: '/onboarding/ready', params: { pairing: pairingToken() } });
    } catch (e) {
      setError(e instanceof Error ? e.message : PAIR.nothingFound);
      setStage('failed');
      setConnectingId(undefined);
      void scan();
    }
  }, [pair, router, scan]);

  const status = pairStatus(stage, devices.length, needsPermission);

  return (
    <Screen edges={['top']}>
      <TopRow
        back={canGoBack ? ONBOARDING_STEPS[1].toUpperCase() : undefined}
        onBack={canGoBack ? goBack : undefined}
        right={
          <Touchable onPress={() => router.replace('/(tabs)')} hitSlop={8} accessibilityRole="button">
            <Label variant="back" tone="faint">{PAIR.notNow}</Label>
          </Touchable>
        }
      />

      <View className="px-[26px] pt-[10px] flex-1">
        <Txt variant="title">{PAIR.title}</Txt>

        <View className="flex-row items-center gap-[10px] mt-[14px]">
          <View
            className={
              stage === 'failed'
                ? 'w-[9px] h-[9px] rounded-full bg-tone-danger'
                : 'w-[9px] h-[9px] rounded-full bg-tone-stamp'
            }
          />
          <Label variant="action" tone={stage === 'failed' ? 'danger' : 'stamp'}>{status ?? ''}</Label>
        </View>

        <View className="gap-[9px] mt-[18px]">
          {devices.map((device) => {
            const ours = !!device.advertisedService || !!device.name?.startsWith('YLF20');
            const busy = connectingId === device.id;
            return (
              <Card
                key={device.id}
                variant={ours ? 'carbon' : 'paper'}
                onPress={() => void connect(device)}
                accessibilityLabel={(device.name ?? PAIR.unknown)}
                className={connectingId && !busy ? 'opacity-40' : undefined}
              >
                <View className="flex-row items-center gap-[12px]">
                  <View className="w-[44px] h-[44px] border border-tone-line bg-tone-panel items-center justify-center">
                    <TickRow ticks={TICKS} value={tickValue(signalLevel(device.rssi ?? -100), TICKS)} />
                  </View>
                  <View className="flex-1">
                    <Txt variant="strong">{device.name ?? PAIR.unknown}</Txt>
                    <MetaLine
                      parts={[
                        device.name?.toUpperCase(),
                        device.id.slice(0, 8).toUpperCase(),
                        device.rssi !== undefined ? `${device.rssi} dBm` : undefined,
                      ]}
                    />
                  </View>
                  <Label variant="action" tone={busy ? 'faint' : 'fg'}>{PAIR.pairAction}</Label>
                </View>
              </Card>
            );
          })}

          {stage === 'scanning' && devices.length === 0 && elapsed ? (
            <Card variant="dashed" pad="roomy">
              <Txt variant="strong">{PAIR.nothingFound}</Txt>
              <Txt variant="small" tone="muted" className="mt-[6px]">{PAIR.photoNote}</Txt>
            </Card>
          ) : null}
        </View>

        {stage === 'failed' ? (
          <Banner variant="void" label={error ?? PAIR.nothingFound} action={PAIR.pairAction} onAction={() => void scan()} />
        ) : null}
      </View>

      <View className="px-[26px] pb-[34px] gap-[12px]">
        <Button title={PAIR.notNow} variant="secondary" onPress={() => router.replace('/(tabs)')} full />
      </View>
    </Screen>
  );
}
