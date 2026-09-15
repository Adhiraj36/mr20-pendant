/**
 * The end of setup, and the app's first receipt — canvas O7.
 *
 * The slip is not decoration: the pendant has just been linked, and this is
 * the proof of it arriving. It is the one screen whose receipt prints on its
 * own mount, band by band, and then stands still.
 *
 * Ruling R14 governs the other half. A receipt that is not arriving does not
 * animate, so a Ready re-entered with a pendant that was already paired
 * renders the slip finished. Pair mints a token when a connection succeeds
 * and hands it over as a route param; this screen claims it once and the
 * claim is spent. A deep link, a remount, a restored screen: no unclaimed
 * token, no print.
 *
 * Notifications are asked for here rather than at launch, because this is
 * the first moment the app has something worth interrupting a person about.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Receipt, Screen, Txt } from '@/design/kit';
import { receiptBands } from '@/design/receiptLogic';
import { Enter } from '@/design/Enter';
import { dur, useReducedMotionFlag } from '@/design/motion';
import { READY } from '@/design/copy';
import {
  PAIRING_FOOTER, PAIRING_STAMP, PAIRING_TITLE,
  claimPairingPrint, pairingMeta, pairingRows,
} from '@/onboarding/pairing';
import { registerForPush } from '@/notifications/push';
import { useApp } from '@/state/store';

export default function ReadyScreen() {
  const router = useRouter();
  const paired = useApp((s) => s.paired);
  const info = useApp((s) => s.info);
  const { pairing } = useLocalSearchParams<{ pairing?: string }>();
  const reduced = useReducedMotionFlag();

  const facts = useMemo(
    () => ({
      name: paired?.name,
      firmware: info?.firmware,
      batteryPercent: info?.batteryPercent,
      freeMb: info?.freeMb,
      recording: info?.recording,
    }),
    [paired?.name, info?.firmware, info?.batteryPercent, info?.freeMb, info?.recording],
  );

  const meta = useMemo(() => pairingMeta(facts), [facts]);
  const rows = useMemo(() => pairingRows(facts), [facts]);
  /** The MAC is this pairing's transaction id, so it seeds the barcode. */
  const seed = paired?.mac;

  // Claimed in render rather than in an effect, so the very first frame
  // already knows whether it is printing — and in a ref rather than
  // `useState`'s lazy initialiser, which runs twice under a double-invoked
  // render and would spend the token on itself.
  const arrival = useRef<boolean | undefined>(undefined);
  if (arrival.current === undefined) arrival.current = claimPairingPrint(pairing);

  // Reduce motion is M2's "slip complete" column: `printing` is dropped
  // entirely, which is also what puts `Receipt` on its static path (R14).
  const printing = arrival.current && !reduced;

  const bandCount = useMemo(
    () => receiptBands({ rows, barcodeSeed: seed, footer: PAIRING_FOOTER }).length + 1,
    [rows, seed],
  );
  const [printed, setPrinted] = useState(1);

  useEffect(() => {
    if (!printing || printed >= bandCount) return;
    // One band per `dur.slow` — each starts as the one above lands.
    const timer = setTimeout(() => setPrinted((n) => n + 1), dur.slow);
    return () => clearTimeout(timer);
  }, [printing, printed, bandCount]);

  /**
   * Ask for notifications once the slip has finished printing: the question
   * lands after the person has seen what the app does, not before.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || printed < bandCount) return;
    asked.current = true;
    void registerForPush();
  }, [printed, bandCount]);

  return (
    <Screen edges={['top']}>
      <View className="flex-1 px-[26px] pt-[44px]">
        <Enter index={0}>
          <Txt variant="title">{READY.title}</Txt>
        </Enter>

        <Enter index={1} style={{ marginTop: 22 }}>
          <Receipt
            title={PAIRING_TITLE}
            meta={meta || undefined}
            stamp={PAIRING_STAMP}
            rows={rows}
            barcodeSeed={seed}
            footer={PAIRING_FOOTER}
            printing={printing ? { bands: printed } : undefined}
          />
        </Enter>

        <Enter index={2} style={{ marginTop: 24 }}>
          <Txt variant="bodyL" tone="muted">{READY.line}</Txt>
        </Enter>
      </View>

      <View className="px-[26px] pb-[34px]">
        <Button title={READY.start} onPress={() => router.replace('/(tabs)')} full />
      </View>
    </Screen>
  );
}
