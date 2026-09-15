/**
 * One receipt — canvas R1, and D2, which is the same screen at night.
 *
 * The slip is paper in both themes. That is not a styling choice made here:
 * the kit's `Receipt` opens a `paper` tone around itself, so everything
 * inside it reads the paper's own roles and the night ground never reaches
 * it (canvas D2, "receipts never go dark"). The chrome around it — the back
 * row, the `FROM` card, the two buttons — is the screen's theme, which is
 * exactly what D2 draws.
 *
 * `?printed=1` is the difference between arriving and visiting. A receipt
 * that has just been printed by `MARK DONE` plays M2 once; one opened from
 * the roll, from a notification, or on a second look renders finished and
 * still (ruling R14). The parameter is claimed by the first mount and then
 * spent, so a remount does not re-print.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Share } from 'react-native';
import {
  Screen, TopRow, TopAction, Txt, Label, Card, Button, Receipt, Sheet,
  Touchable, Icon, useToast,
} from '../../src/design/kit';
import { receiptBands, RECEIPT_TITLE } from '../../src/design/receiptLogic';
import { dur, useReducedMotionFlag } from '../../src/design/motion';
import { RECEIPTS_COPY } from '../../src/design/copy';
import { api, type Recording } from '../../src/api/client';
import { useTasks } from '../../src/state/tasks';
import {
  clock, receiptAsText, receiptFooter, receiptRef, receiptRowsFor, sourceLine,
} from '../../src/tasks/models';

export default function ReceiptDetail() {
  const router = useRouter();
  const toast = useToast();
  const { id, printed: printedParam } = useLocalSearchParams<{
    id: string; printed?: string;
  }>();
  const reduced = useReducedMotionFlag();

  const receipts = useTasks((s) => s.receipts);
  const error = useTasks((s) => s.receiptsError);
  const ensureReceipt = useTasks((s) => s.ensureReceipt);
  const receipt = useMemo(
    () => receipts.find((r) => r.receiptId === id),
    [receipts, id],
  );

  const [looked, setLooked] = useState(false);
  const [menu, setMenu] = useState(false);
  const [source, setSource] = useState<Recording | undefined>(undefined);
  const slip = useRef<View>(null);

  useEffect(() => {
    if (!id) return;
    ensureReceipt(id).finally(() => setLooked(true));
  }, [id, ensureReceipt]);

  useEffect(() => {
    let live = true;
    if (!receipt?.recordingId) return;
    api.getRecording(receipt.recordingId)
      .then((result) => { if (live) setSource(result.recording); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [receipt?.recordingId]);

  // Claimed in render, not in an effect, so the very first frame already
  // knows whether this slip is arriving — and claimed into a ref rather than
  // through `useState`'s initialiser, which a double-invoked render runs
  // twice and would spend on itself.
  const arrival = useRef<boolean | undefined>(undefined);
  if (arrival.current === undefined) arrival.current = printedParam === '1';
  const printing = arrival.current && !reduced;

  const rows = useMemo(() => (receipt ? receiptRowsFor(receipt) : []), [receipt]);
  const bandCount = useMemo(() => (receipt
    ? receiptBands({
      quote: receipt.quote,
      rows,
      barcodeSeed: receipt.receiptId,
      footer: receiptFooter(receipt.receiptId),
    }).length + 1
    : 1), [receipt, rows]);
  const [bands, setBands] = useState(1);

  useEffect(() => {
    if (!printing || bands >= bandCount) return;
    const timer = setTimeout(() => setBands((n) => n + 1), dur.slow);
    return () => clearTimeout(timer);
  }, [printing, bands, bandCount]);

  /**
   * Share the slip as its own text.
   *
   * `[RECEIPT_IMAGE]`: the canvas asks for "share as image", and the way to
   * photograph a view — `react-native-view-shot` — cannot be linked into
   * this app. Its static library, force-loaded by React Native's `-ObjC`,
   * drags in an autolink directive for SwiftUICore, which Apple allows only
   * SwiftUI itself to link, and the build fails at ld. So the receipt goes
   * out as the text it already is: the same rows, the same order, readable
   * in any message. React Native's own `Share` needs nothing native.
   */
  const share = useCallback(async () => {
    if (!receipt) return;
    try {
      await Share.share({ message: receiptAsText(receipt, RECEIPT_TITLE) });
    } catch {
      toast.show('That would not share', { tone: 'error' });
    }
  }, [receipt, toast]);

  if (!receipt) {
    // `GET /receipts/:id` either answered that there is no such slip, or did
    // not answer at all. Only the second of those is worth asking again.
    return (
      <Screen>
        <TopRow back="RECEIPTS" onBack={() => router.back()} />
        <View className="px-[20px] pt-[10px] gap-[11px]">
          <Txt variant="statement">
            {!looked
              ? RECEIPTS_COPY.looking
              : error
                ? 'That receipt could not be loaded.'
                : RECEIPTS_COPY.notHere}
          </Txt>
          {looked && error ? (
            <>
              <Txt variant="bodyL" tone="muted">{error}</Txt>
              <Button
                title={RECEIPTS_COPY.retry}
                onPress={() => {
                  setLooked(false);
                  ensureReceipt(id).finally(() => setLooked(true));
                }}
              />
            </>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopRow
        back="RECEIPTS"
        onBack={() => router.back()}
        right={<TopAction label={receiptRef(receipt.receiptId)} />}
      />

      <ScrollView contentContainerClassName="px-[20px] pb-[20px] gap-[11px]">
        {/* `collapsable={false}` keeps the view in the native hierarchy so
            the slip is one view rather than a stack of bands — without it Android
            flattens a plain wrapper away and the capture is empty. */}
        <View ref={slip} collapsable={false}>
          <Receipt
            title={RECEIPT_TITLE}
            stamp={receipt.stamp}
            quote={receipt.quote}
            rows={rows}
            barcodeSeed={receipt.receiptId}
            footer={receiptFooter(receipt.receiptId)}
            printing={printing ? { bands } : undefined}
          />
        </View>

        {receipt.recordingId ? (
          <Card
            className="flex-row justify-between items-center gap-[12px]"
            onPress={() => router.push(`/recording/${receipt.recordingId}`)}
            accessibilityLabel="open the conversation"
          >
            <View className="flex-1 gap-[3px]">
              <Label variant="tag">{RECEIPTS_COPY.from}</Label>
              <Txt variant="strong">
                {sourceLine(
                  source?.title ?? 'THE CONVERSATION',
                  source?.startedAt ?? receipt.createdAt,
                ) || 'THE CONVERSATION'}
              </Txt>
            </View>
            <Label variant="action" tone="stamp">→</Label>
          </Card>
        ) : null}
      </ScrollView>

      <View className="flex-row gap-[9px] px-[20px] pt-[6px] pb-[16px]">
        <Button
          className="flex-1"
          variant="secondary"
          title={RECEIPTS_COPY.share}
          icon={Icon.Share2}
          onPress={share}
        />
        <Touchable
          onPress={() => setMenu(true)}
          accessibilityRole="button"
          accessibilityLabel="more"
          className="border-[1.5px] border-tone-line2 py-[16px] px-[20px] items-center justify-center"
        >
          <Label variant="back" tone="fg">{RECEIPTS_COPY.more}</Label>
        </Touchable>
      </View>

      <Sheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={receiptRef(receipt.receiptId)}
        icon={Icon.Ellipsis}
        context={[RECEIPT_TITLE, clock(receipt.createdAt)]}
      >
        <View className="gap-[10px] py-[16px] px-[20px]">
          <Button
            full
            variant="secondary"
            title={RECEIPTS_COPY.copyAsText}
            onPress={() => { setMenu(false); void share(); }}
          />
          {receipt.recordingId ? (
            <Button
              full
              variant="ghost"
              title={RECEIPTS_COPY.openConversation}
              onPress={() => {
                setMenu(false);
                router.push(`/recording/${receipt.recordingId}`);
              }}
            />
          ) : null}
          {/* Why there is no third button here. */}
          <Txt variant="small" tone="faint">{RECEIPTS_COPY.noDelete}</Txt>
        </View>
      </Sheet>
    </Screen>
  );
}
