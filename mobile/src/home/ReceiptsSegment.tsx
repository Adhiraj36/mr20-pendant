/**
 * Home's RECEIPTS segment — canvas R2 (the roll) and T0b (the Capture tier's
 * one greyed example).
 *
 * "Other AI hands you notes. We hand you receipts." The roll is the product's
 * memory of itself: one slip per thing that finished, cut into days, newest
 * first, and never edited or deleted.
 *
 * Two things it refuses to do:
 *
 * - **Claim effort it did not save.** `YOUR EFFORT SAVED` is drawn only when
 *   `features.execution` is on, because on the Capture tier the person did
 *   every one of these themselves. Where the card would be, the roll states
 *   its own count instead: `12 KEPT · SINCE 04 SEP`.
 * - **Sell where it should explain.** T0b's example is a greyed slip and a
 *   sentence, not a paywall splash; the button under it appears only when
 *   there is in fact something on the other side of it.
 */
import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Txt, Label, Banner, Card, Button, ReceiptCard, EmptyCard, Touchable,
} from '../design/kit';
import { RECEIPTS_COPY } from '../design/copy';
import { useApp } from '../state/store';
import { useTasks } from '../state/tasks';
import { effortSaved, receiptCardRows, rollByDay, rollMeta } from '../tasks/models';
import type { SegmentProps } from './TasksSegment';

export type { SegmentProps };

/** The slip T0b shows somebody who has never finished anything yet. */
const EXAMPLE = {
  quote: "I'll send you the revised quote before lunch.",
  rows: [
    { k: 'KIND', v: 'MESSAGE' },
    { k: 'MARKED DONE', v: '11:05:07' },
  ],
};

/** The canvas' seven columns, 38 points tall at their fullest. */
const BAR_HEIGHT = 38;

export function ReceiptsSegment({ onOpenReceipt }: SegmentProps) {
  const router = useRouter();
  const plan = useApp((s) => s.plan);
  const features = useTasks((s) => s.features);
  const receipts = useTasks((s) => s.receipts);
  const loaded = useTasks((s) => s.receiptsLoaded);
  const loading = useTasks((s) => s.receiptsLoading);
  const error = useTasks((s) => s.receiptsError);
  const cursor = useTasks((s) => s.receiptsCursor);
  const loadReceipts = useTasks((s) => s.loadReceipts);
  const loadMoreReceipts = useTasks((s) => s.loadMoreReceipts);

  useEffect(() => { loadReceipts(); }, [loadReceipts]);

  /** The roll could not be read. Not the same thing as nothing on the roll. */
  const banner = error ? (
    <Banner
      variant="void"
      label={[RECEIPTS_COPY.couldNotLoad, error]}
      action={RECEIPTS_COPY.retry}
      onAction={() => loadReceipts({ reset: true })}
      className="-mx-[18px] mb-[9px]"
    />
  ) : null;

  const days = useMemo(() => rollByDay(receipts), [receipts]);
  const effort = useMemo(
    () => effortSaved(receipts, { execution: features.execution }),
    [receipts, features.execution],
  );
  const meta = useMemo(() => rollMeta(receipts), [receipts]);

  // Nothing has printed yet. For an account that cannot act on its own
  // promises, that is canvas T0b: the example, greyed, and a sentence saying
  // what would put a real one here.
  if (!loaded && receipts.length === 0) {
    return (
      <View className="gap-[9px]">
        {banner}
        {loading ? <Label variant="eyebrow">{RECEIPTS_COPY.loading}</Label> : null}
      </View>
    );
  }

  if (loaded && receipts.length === 0) {
    if (!plan?.automation) {
      return (
        <View className="gap-[12px]">
          {banner}
          {/* 55% is the canvas' own value for the example slip: it is a
              picture of a receipt rather than one, and the greying is what
              says so without stamping VOID across it. */}
          <View className="opacity-[0.55]">
            <ReceiptCard
              stamp={RECEIPTS_COPY.exampleStamp}
              quote={EXAMPLE.quote}
              rows={EXAMPLE.rows}
            />
          </View>
          <Label variant="ghost" tone="muted" numberOfLines={2}>
            {RECEIPTS_COPY.exampleEyebrow}
          </Label>
          <Txt variant="bodyL" tone="muted">
            {RECEIPTS_COPY.exampleBody(features.execution)}
          </Txt>
          {/* The one button on this screen, and only when execution is
              something the app can actually sell (`[EXECUTION]`). */}
          {features.execution ? (
            <Button
              full
              title={RECEIPTS_COPY.exampleAction}
              onPress={() => router.push('/onboarding/plan')}
            />
          ) : null}
        </View>
      );
    }
    return (
      <View className="gap-[9px]">
        {banner}
        <EmptyCard
          eyebrow={RECEIPTS_COPY.emptyEyebrow}
          statement={RECEIPTS_COPY.emptyStatement}
          line={RECEIPTS_COPY.emptyLine(features.execution)}
        />
      </View>
    );
  }

  return (
    <View className="gap-[9px]">
      {banner}
      {effort ? (
        <Card className="flex-row items-end gap-[14px]">
          <View className="flex-1 gap-[4px]">
            <Label variant="tag">{[RECEIPTS_COPY.effort, effort.window]}</Label>
            <Txt variant="screen">{effort.label}</Txt>
          </View>
          <View className="flex-row items-end gap-[3px]" style={{ height: BAR_HEIGHT }}>
            {effort.bars.map((value, i) => (
              <View
                key={i}
                className={i === effort.bars.length - 1 ? 'w-[7px] bg-tone-fg' : 'w-[7px] bg-tone-line'}
                // A height is data, not design: a proportion cannot be a class.
                style={{ height: Math.max(2, Math.round(value * BAR_HEIGHT)) }}
              />
            ))}
          </View>
        </Card>
      ) : meta ? (
        <Label variant="eyebrow" className="mb-[2px]">{meta}</Label>
      ) : null}

      {days.map((day) => (
        <View key={day.key} className="gap-[9px]">
          <Label variant="eyebrow" className="mt-[7px]">{day.heading}</Label>
          {day.receipts.map((receipt) => (
            <ReceiptCard
              key={receipt.receiptId}
              stamp={receipt.stamp}
              quote={receipt.quote ?? receipt.title}
              rows={receiptCardRows(receipt)}
              onPress={() => onOpenReceipt(receipt.receiptId)}
            />
          ))}
        </View>
      ))}

      {/* The roll is longer than one page. Home asks for the next one at the
          bottom of the scroller; this is the same request, named, for a roll
          that ends above the fold. */}
      {cursor ? (
        <Touchable
          onPress={() => void loadMoreReceipts()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="load more receipts"
          className="py-[16px] items-center"
        >
          <Label variant="eyebrow">
            {loading ? RECEIPTS_COPY.loading : RECEIPTS_COPY.loadMore}
          </Label>
        </Touchable>
      ) : null}
    </View>
  );
}
