/**
 * Proof of work. The slip, and the compact one the roll is made of.
 *
 * A receipt is paper in both themes — canvas D2, "receipts never go dark" —
 * so both of these open a `paper` tone and everything inside them reads the
 * ordinary `--tone-*` classes from there. That is the whole trick: nothing
 * below knows the screen behind it might be the night, because as far as the
 * variables are concerned it is standing on a sheet.
 */
import React from 'react';
import { View } from 'react-native';
import { stampAngle } from '@lyzn/design';
import { ToneProvider } from '../tone';
import { Touchable } from '../Touchable';
import { Receipt as BaseReceipt, type ReceiptProps } from '../Receipt';
import { Txt, Label } from './text';
import { KeyValue } from './rows';
import { cx } from './type';
import { RECEIPT_GROUND, type ReceiptRowModel } from './models';

export type { ReceiptProps, ReceiptRowModel };

/**
 * The full slip — the existing Skia component, stood on paper.
 *
 * `Receipt.tsx` paints its own paper and ink and ignores the tone on
 * purpose; the provider here is for the RN chrome a caller wraps around it
 * (a `FROM` link, a share row) so that too stays paper on a night screen.
 */
export function Receipt({ className, ...props }: ReceiptProps & { className?: string }) {
  return (
    <ToneProvider ground={RECEIPT_GROUND} className={className}>
      <BaseReceipt {...props} />
    </ToneProvider>
  );
}

/**
 * A roll item — canvas R2: the title, the stamp, the quote, and the two or
 * three rows that say what happened. Smaller than the full slip and drawn in
 * plain views rather than Skia, because a scrolling list of paper edges is a
 * scrolling list of Skia canvases.
 */
export function ReceiptCard({
  title = 'LYZN · PROOF OF WORK',
  stamp,
  quote,
  rows = [],
  onPress,
  className,
}: {
  title?: string;
  /** `DONE`, `READY`, `UNLOCKED`, `FILED`, `EXAMPLE`. */
  stamp?: string;
  /** What was said, in quotation marks. */
  quote?: string;
  rows?: ReceiptRowModel[];
  onPress?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <Label variant="slipTitleSm" tone="fg" center>{title}</Label>
      {stamp ? (
        <View
          className="absolute right-[12px] top-[50px] border-2 border-tone-stamp rounded-[3px] py-[2px] px-[8px] opacity-[0.85]"
          style={{ transform: [{ rotate: `${stampAngle}deg` }] }}
          pointerEvents="none"
        >
          <Label variant="stamp" tone="stamp">{stamp}</Label>
        </View>
      ) : null}
      {quote ? (
        <Txt variant="slip" className={cx('mt-[10px] mb-[9px]', stamp && 'pr-[80px]')}>
          {`“${quote}”`}
        </Txt>
      ) : null}
      {rows.map((row) => <KeyValue key={row.k} k={row.k} v={row.v} ok={row.ok} />)}
    </>
  );

  // `bg-sheet` and not `bg-tone-panel`: the canvas' receipt is the sheet
  // itself (#FBFBF8), a shade above the paper tone's own panel, and it is the
  // one surface in the app whose colour is fixed rather than tonal.
  const surface = cx('relative bg-sheet pt-[15px] px-[16px] pb-[17px]', className);

  if (!onPress) {
    return <ToneProvider ground={RECEIPT_GROUND} className={surface}>{body}</ToneProvider>;
  }
  return (
    <Touchable onPress={onPress} accessibilityRole="button" accessibilityLabel={quote ?? title} className={surface}>
      <ToneProvider ground={RECEIPT_GROUND}>{body}</ToneProvider>
    </Touchable>
  );
}
