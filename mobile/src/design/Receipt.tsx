/**
 * Proof of work, drawn as a till slip — app spec §3.3, §9 "Receipt".
 *
 * "Other AI hands you notes. We hand you receipts." The slip carries its
 * own paper and ink (`receiptPaper`, `receiptInk`, `receiptFaint`) whatever
 * ground it sits on — it is the one component in the app that ignores
 * `useTone()` on purpose, the same way `web/src/components/Receipt.tsx`
 * never reads the site's tone variables.
 *
 * Two layers: a Skia `Canvas` under, with the scalloped edge and the one
 * shadow in the app (`ReceiptSkia.tsx`), and RN content over. Skia is a
 * native module, so a dev client built before it was added does not have
 * it — `hasSkia()` probes for `RNSkiaModule` (the same check `OrbVisual`
 * uses) and the flat fallback below stands in when it is absent: straight
 * edges, a hairline border, no shadow.
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  View, Text, StyleSheet, TurboModuleRegistry,
  type LayoutChangeEvent, type StyleProp, type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS } from 'react-native-reanimated';
import { colors, fontFamily, tabular } from './tokens';
import { stampAngle } from '@lyzn/design';
import { useTone } from './tone';
import { ease, dur, useReducedMotionFlag } from './motion';
import {
  barcodeBars, receiptBands, bandVisible, rowGroups,
  RECEIPT_TITLE, type ReceiptRowSpec, type ReceiptRows, type BandKey,
} from './receiptLogic';

export { barcodeBars, receiptBands, bandVisible, rowGroups, RECEIPT_TITLE };
export type { ReceiptRowSpec, ReceiptRows };

// -- the Skia probe ----------------------------------------------------
// See the file header: never import '@shopify/react-native-skia' at the
// top of a file that always loads. `require` it only once the probe says
// the native module is there.
type SkiaModule = typeof import('./ReceiptSkia');
let skia: SkiaModule | null | undefined;

function loadSkia(): SkiaModule | null {
  if (skia !== undefined) return skia;
  try {
    if (!TurboModuleRegistry.get('RNSkiaModule')) {
      skia = null;
      return skia;
    }
    /* eslint-disable @typescript-eslint/no-var-requires */
    skia = require('./ReceiptSkia') as SkiaModule;
    /* eslint-enable */
  } catch {
    skia = null;
  }
  return skia;
}

/** Reads the probe once per component instance, without re-probing on every render. */
function useSkia(): SkiaModule | null {
  return useMemo(loadSkia, []);
}

// -- pieces --------------------------------------------------------------

/** 1 px dashed rule, `receiptInk` at 26%, `margin 16 0 12` (spec §3.3). */
export function ReceiptCut({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          borderTopWidth: 1,
          borderStyle: 'dashed',
          borderColor: 'rgba(22,24,26,0.26)',
          marginTop: 16,
          marginBottom: 12,
        },
        style,
      ]}
    />
  );
}

/**
 * The rubber stamp — the canvas' own: a 2 px box in stamp violet, pressed at
 * `stampAngle` (−11°) at 85%, top-right of the slip.
 *
 * A stamp is pressed by hand, so it is never square to the paper; every one
 * on the canvas lands at the same eleven degrees, which is what makes them
 * read as one stamp rather than as decoration applied per screen. The angle
 * is the package's constant, not a number written here.
 */
export function ReceiptStamp({ children, top = 74 }: { children: ReactNode; top?: number }) {
  return (
    <View
      style={{
        position: 'absolute',
        right: 14,
        // Inside the slip, under the title — canvas O7/U2 press it at 74,
        // R1 at 88, a roll item at 50. It used to overhang the top edge,
        // which read as a sticker rather than as ink pressed onto paper.
        top,
        paddingVertical: 3,
        paddingHorizontal: 9,
        borderWidth: 2,
        borderColor: colors.stamp,
        borderRadius: 3,
        opacity: 0.85,
        transform: [{ rotate: `${stampAngle}deg` }],
      }}
    >
      <Text
        style={{
          fontFamily: fontFamily.mono[700],
          fontSize: 11,
          letterSpacing: 1.32,
          textTransform: 'uppercase',
          color: colors.stamp,
        }}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}

/**
 * A row: key, a dotted leader that takes the slack, value. `plain` keeps
 * sentence case for task text; a missing `v` leaves the leader running to
 * the edge — there is simply no value view to stop it (spec §3.3).
 */
export function ReceiptRow({ k, v, ok, plain }: ReceiptRowSpec) {
  return (
    <View style={styles.row}>
      <Text
        style={[
          styles.rowKey,
          plain && { textTransform: 'none' },
        ]}
        numberOfLines={1}
      >
        {k}
      </Text>
      <View style={styles.leader} />
      {v !== undefined ? (
        <Text style={[styles.rowValue, ok && styles.rowValueOk]} numberOfLines={1}>
          {v}{ok ? ' ✓' : ''}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * 84 bars from `barcodeBars` (never reimplemented — the same seed draws the
 * same code as the website's `<Barcode>`). Skia `Rect`s when the module is
 * present; flat proportional `View`s otherwise, so the barcode degrades the
 * same way the paper does.
 */
export function ReceiptBarcode({ seed, height = 44 }: { seed: string; height?: number }) {
  const [width, setWidth] = useState(0);
  const skiaModule = useSkia();
  const bars = useMemo(() => barcodeBars(seed), [seed]);

  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);

  if (skiaModule) {
    return (
      <View style={{ height }} onLayout={onLayout}>
        <skiaModule.SkiaBarcode bars={bars} width={width} height={height} />
      </View>
    );
  }

  return (
    <View style={[styles.barcodeFlat, { height }]}>
      {bars.map((w, i) => (
        <View
          key={i}
          style={{ flex: w, backgroundColor: i % 2 === 0 ? colors.receiptInk : 'transparent' }}
        />
      ))}
    </View>
  );
}

// -- the print animation ---------------------------------------------------

/**
 * One band, dispatching on whether the slip is printing at all (ruling
 * R14). `printing === undefined` means the slip is already printed — there
 * is nothing to reveal, so this renders `children` at their natural height
 * and nothing else: no `SharedValue`, no measuring twin, no `maxHeight`,
 * ever. `printing` set means the M2 choreography applies, handled by
 * `AnimatedPrintBand` below, unchanged from round 2.
 *
 * This dispatch is a plain condition, not a hook — `AnimatedPrintBand`'s
 * hooks stay inside that component, called only when it is the thing
 * mounted, so choosing between the two here never risks a hook-order
 * mismatch.
 *
 * Invariant this maintains, load-bearing for `Receipt`'s paper sizing
 * (`onSizeLayout`, further down): **a live-layout listener and an
 * animating band never coexist.** `Receipt`'s live content view's
 * `onLayout` is attached only when `!isPrinting` — exactly the branch
 * below that renders `children` once, at natural height, with nothing to
 * animate. When `isPrinting`, that `onLayout` is `undefined` and the
 * hidden sizing twin (which nothing here touches) owns the paper's size
 * instead. Neither branch below drives a live-layout listener while also
 * animating a height under it.
 */
function PrintBand({
  printing, visible, reduced, onDone, children,
}: {
  printing: boolean;
  visible: boolean;
  reduced: boolean;
  /** Fires once, the first time this band finishes revealing. Printing only. */
  onDone?: () => void;
  children: ReactNode;
}) {
  if (!printing) return <>{children}</>;
  return (
    <AnimatedPrintBand visible={visible} reduced={reduced} onDone={onDone}>
      {children}
    </AnimatedPrintBand>
  );
}

/**
 * The M2 choreography for one band. Measures its natural height once with
 * a hidden twin (absolute, opacity 0) and, once `visible`, drives
 * `maxHeight` from a `SharedValue` from 0 to that measurement — never
 * `height: 'auto'`, which Reanimated cannot animate. Reduce motion snaps
 * straight to the measured height instead of timing there.
 *
 * Only ever mounted by `PrintBand` while the slip is printing — see that
 * component's doc comment for the invariant this depends on.
 */
function AnimatedPrintBand({
  visible, reduced, onDone, children,
}: {
  visible: boolean;
  reduced: boolean;
  onDone?: () => void;
  children: ReactNode;
}) {
  const [measured, setMeasured] = useState<number | null>(null);
  const height = useSharedValue(0);
  const printed = useRef(false);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setMeasured((prev) => (prev === null ? e.nativeEvent.layout.height : prev));
  }, []);

  useEffect(() => {
    if (!visible || measured === null || printed.current) return;
    printed.current = true;
    if (reduced) {
      height.value = measured;
      onDone?.();
    } else {
      height.value = withTiming(measured, { duration: dur.slow, easing: ease.out }, (finished) => {
        if (finished && onDone) runOnJS(onDone)();
      });
    }
  }, [visible, measured, reduced, height, onDone]);

  const animatedStyle = useAnimatedStyle(() => ({ maxHeight: height.value }));

  return (
    <>
      {measured === null ? (
        <View
          style={styles.hiddenTwin}
          pointerEvents="none"
          onLayout={onLayout}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {children}
        </View>
      ) : null}
      {visible ? (
        <Animated.View style={[{ overflow: 'hidden' }, animatedStyle]}>
          {children}
        </Animated.View>
      ) : null}
    </>
  );
}

// -- Receipt ---------------------------------------------------------------

export interface ReceiptProps {
  title?: string;
  meta?: string;
  stamp?: string;
  quote?: string;
  /**
   * Curly quotes around `quote`. On by default — it is a quote slot. The
   * Library borrows the slot for a conversation's own title, which is not
   * something anybody said (spec §2.6: "the slip's quote slot, without
   * quotation marks").
   */
  quoted?: boolean;
  /** Flat, or cut into groups — see `ReceiptRows` in `receiptLogic.ts`. */
  rows?: ReceiptRows;
  total?: { k: string; v: string };
  barcodeSeed?: string;
  footer?: string;
  /** §2.6's "printing" row: header + one open row, max width 320. */
  compact?: boolean;
  /** M2: reveals band by band. Undefined prints the whole slip at once. */
  printing?: { bands: number };
  /**
   * M2's last beat: fades the Skia layer — the scalloped edges and the
   * shadow — to 0 over `dur.slow` while the content re-lays as the host
   * decides (the site's "filed" receipt becomes a plain row). Spec §3.3
   * names this prop explicitly under "Filing"; it is not in the props list
   * this task's brief gives verbatim, but 4.3–4.6 (the Library slip) has
   * nothing else to call for it, so it is included here rather than
   * invented per screen.
   */
  filed?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Receipt({
  title = RECEIPT_TITLE,
  meta,
  stamp,
  quote,
  quoted = true,
  rows,
  total,
  barcodeSeed,
  footer,
  compact = false,
  printing,
  filed = false,
  style,
}: ReceiptProps) {
  const skiaModule = useSkia();
  const tone = useTone();
  const reduced = useReducedMotionFlag();
  // Initialised at its target, not a hardcoded 1: a `Receipt` that mounts
  // already `filed` (a Library row built straight from a filed record) has
  // nothing to fade from — see the effect below, which only animates a
  // *change* to `filed` after mount, never the mount itself (R14).
  const edgeOpacity = useSharedValue(filed ? 0 : 1);
  const edgeMounted = useRef(false);

  // The Skia paper is sized from the slip's *final* dimensions. While
  // printing, that comes from a hidden, fully-printed twin rather than the
  // live, animating content — see the block comment further down for why.
  // A slip that isn't printing has no such twin (rendering one would cost
  // a second Skia `Canvas` — and a second `ReceiptBarcode` — permanently,
  // for every non-printing receipt a screen shows): its own visible
  // content already *is* the final layout, so it feeds `finalSize`
  // directly.
  const isPrinting = printing !== undefined;
  const [finalSize, setFinalSize] = useState({ width: 0, height: 0 });

  const onSizeLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setFinalSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  useEffect(() => {
    const target = filed ? 0 : 1;
    if (!edgeMounted.current) {
      // First run: snap, never animate. Not gated on `isPrinting` — a
      // printing receipt that later files must still fade (the real
      // transition this effect exists for); it is specifically the
      // *mount* that must never move, whatever `filed` and `printing` are.
      edgeMounted.current = true;
      edgeOpacity.value = target;
      return;
    }
    edgeOpacity.value = reduced ? target : withTiming(target, {
      duration: dur.slow,
      easing: ease.out,
    });
  }, [filed, reduced, edgeOpacity]);

  const edgeStyle = useAnimatedStyle(() => ({ opacity: edgeOpacity.value }));

  const bands = useMemo(
    () => receiptBands({ quote, rows, total, barcodeSeed, footer }),
    [quote, rows, total, barcodeSeed, footer],
  );
  const printedCount = printing?.bands;
  const headerVisible = printedCount === undefined || printedCount >= 1;

  // The stamp waits for every band up to (not including) the barcode; the
  // barcode itself waits for the stamp — spec §3.3: "the barcode after the
  // stamp." Bands with no stamp to wait for behave exactly like any other
  // band: revealed as soon as `printing.bands` reaches their slot.
  //
  // R14 extends to the stamp: it is one of M2's own beats (spec §1.5, the
  // stamp landing as the slip is made), so a receipt with `printing ===
  // undefined` renders it already landed — no opacity/scale entrance, no
  // `withTiming`, no waiting on `stampReady`. `stampDone` starts (and
  // stays) `true` outside the printing path, since there is no barcode
  // gate to hold: `PrintBand`'s static branch ignores `visible` entirely,
  // but `stampDone` is still the correct, non-misleading value for a slip
  // that isn't mid-print.
  const barcodeBandIndex = bands.indexOf('barcode');
  const bandsBeforeStamp = barcodeBandIndex === -1 ? bands.length : barcodeBandIndex;
  const stampReady = printedCount === undefined || printedCount >= bandsBeforeStamp + 1;
  const [stampDone, setStampDone] = useState(!isPrinting || !stamp);
  const stampOpacity = useSharedValue(isPrinting && stamp ? 0 : 1);
  const stampShown = useRef(false);

  useEffect(() => {
    if (!isPrinting || !stamp || !stampReady || stampShown.current) return;
    stampShown.current = true;
    if (reduced) {
      stampOpacity.value = 1;
      setStampDone(true);
    } else {
      stampOpacity.value = withTiming(1, { duration: 240, easing: ease.out }, (finished) => {
        if (finished) runOnJS(setStampDone)(true);
      });
    }
  }, [isPrinting, stamp, stampReady, reduced, stampOpacity]);

  const stampAnimatedStyle = useAnimatedStyle(() => ({
    opacity: stampOpacity.value,
    transform: [{ scale: 1.15 - stampOpacity.value * 0.15 }],
  }));

  const paddingTop = compact ? 18 : 26;
  const paddingHorizontal = compact ? 16 : 22;
  const paddingBottom = compact ? 14 : 20;

  const showBand = (key: BandKey) => {
    const index = bands.indexOf(key);
    if (index === -1) return false;
    if (key === 'barcode') return bandVisible(index, printedCount) && stampDone;
    return bandVisible(index, printedCount);
  };

  // The web component wraps everything below the header — stamp, quote,
  // rows, total, barcode, footer — in one `r-cut` div whenever any of it
  // exists, so the header-to-body cut appears any time the slip has a body
  // at all, not only when it opens with a quote or a row.
  const hasBody = bands.length > 0 || !!stamp;

  // Each band's content, built once and shared by the live (animated) body
  // below and the hidden "final" twin that sizes the Skia paper — see the
  // comment on `finalSize`.
  const quoteContent = bands.includes('quote') ? (
    <Text style={[styles.quote, stamp && { paddingRight: 96 }]}>
      {quoted ? `“${quote}”` : quote}
    </Text>
  ) : null;

  const groups = rowGroups(rows);
  const rowsContent = bands.includes('rows') ? (
    <View>
      {groups.map((group, groupIndex) => (
        <View key={groupIndex}>
          {/* A row band that follows a quote gets its own cut, exactly as
              the web component's `quote || children ? 'r-cut …'` does; a
              row band opening the slip does not. Every group after the
              first gets one too — that is what makes a group a group. */}
          {quote || groupIndex > 0 ? <ReceiptCut /> : null}
          {group.map((row) => <ReceiptRow key={row.k} {...row} />)}
        </View>
      ))}
    </View>
  ) : null;

  const totalContent = bands.includes('total') ? (
    <View>
      <ReceiptCut />
      <View style={styles.total}>
        <Text style={styles.rowKey} numberOfLines={1}>{total!.k}</Text>
        <Text style={[styles.totalValue, tabular]} numberOfLines={1}>{total!.v}</Text>
      </View>
    </View>
  ) : null;

  const barcodeContent = bands.includes('barcode') ? (
    <View style={{ marginTop: 20 }}>
      <ReceiptBarcode seed={barcodeSeed!} />
    </View>
  ) : null;

  const footerContent = bands.includes('footer') ? (
    <Text style={styles.footer}>{footer}</Text>
  ) : null;

  const headerContent = (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.header}>{title}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  );

  return (
    <View style={[{ position: 'relative' }, compact && { maxWidth: 320 }, style]}>
      {skiaModule ? (
        <Animated.View style={[StyleSheet.absoluteFill, edgeStyle]} pointerEvents="none">
          <skiaModule.SkiaPaper width={finalSize.width} height={finalSize.height} />
        </Animated.View>
      ) : (
        // The flat fallback (no Skia module, per `OrbVisual`'s probe):
        // straight edges, a hairline border in the ambient tone, no shadow.
        // Filing fades this the same way it fades the Skia paper. Cheap to
        // resize every frame (no path op), so it tracks the outer view's
        // live bounds directly rather than `finalSize`.
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: colors.receiptPaper,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: tone.line2,
            },
            edgeStyle,
          ]}
        />
      )}

      {isPrinting ? (
        /*
          A hidden, fully-printed twin — absolute, opacity 0, mounted only
          while `printing` is set — that measures the slip's *final* size
          once, so the Skia paper (`scallopedPaper`: a union of ~n circles
          then one Difference op) is computed from a stable target rather
          than from the live content view, whose height changes
          continuously while a band's `maxHeight` animates from 0 to
          measured over 700 ms (M2). Recomputing the path on every one of
          those layout frames would be a real cost for no visual gain — the
          paper is meant to read as already there, the way a thermal slip's
          paper exists before the print head reaches any given line, not as
          something that grows with the text. `onSizeLayout` only calls
          `setState` when the size actually changes, so once the slip's
          content is stable this fires once, not on every printed band.

          Gated on `isPrinting` rather than always mounted: a static,
          already-printed receipt has nothing to measure ahead of — its own
          visible content below already *is* the final layout — and
          rendering this unconditionally would mean every receipt with a
          barcode carries a second Skia `Canvas` and a second
          `ReceiptBarcode` permanently, for its whole life, which is a real
          cost across a screen that lists several.
        */
        <View
          pointerEvents="none"
          onLayout={onSizeLayout}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.finalTwin, { paddingTop, paddingHorizontal, paddingBottom }]}
        >
          {headerContent}
          {hasBody ? <ReceiptCut /> : null}
          {stamp ? <ReceiptStamp top={compact ? 50 : 74}>{stamp}</ReceiptStamp> : null}
          {quoteContent}
          {rowsContent}
          {totalContent}
          {barcodeContent}
          {footerContent}
        </View>
      ) : null}

      <View
        // Not printing: this view's own layout already is the slip's final
        // size, so it feeds `finalSize` directly rather than paying for a
        // second, hidden copy of the content. While printing, the twin
        // above owns `finalSize` instead — this stays unattached then, so
        // it never re-fires `setState` (and the Skia path with it) as
        // bands grow in (the bug fixed in the previous round).
        onLayout={isPrinting ? undefined : onSizeLayout}
        style={{ paddingTop, paddingHorizontal, paddingBottom }}
      >
        {headerVisible ? headerContent : null}

        {headerVisible && hasBody ? <ReceiptCut /> : null}

        {stamp ? (
          isPrinting ? (
            <Animated.View style={stampAnimatedStyle}>
              <ReceiptStamp top={compact ? 50 : 74}>{stamp}</ReceiptStamp>
            </Animated.View>
          ) : (
            // Not printing: the stamp is already landed (R14) — no
            // Animated.View, no entrance, same as the final twin's own
            // static ReceiptStamp above.
            <ReceiptStamp top={compact ? 50 : 74}>{stamp}</ReceiptStamp>
          )
        ) : null}

        {quoteContent ? (
          <PrintBand printing={isPrinting} visible={showBand('quote')} reduced={reduced}>
            {quoteContent}
          </PrintBand>
        ) : null}

        {rowsContent ? (
          <PrintBand printing={isPrinting} visible={showBand('rows')} reduced={reduced}>
            {rowsContent}
          </PrintBand>
        ) : null}

        {totalContent ? (
          <PrintBand printing={isPrinting} visible={showBand('total')} reduced={reduced}>
            {totalContent}
          </PrintBand>
        ) : null}

        {barcodeContent ? (
          <PrintBand printing={isPrinting} visible={showBand('barcode')} reduced={reduced}>
            {barcodeContent}
          </PrintBand>
        ) : null}

        {footerContent ? (
          <PrintBand printing={isPrinting} visible={showBand('footer')} reduced={reduced}>
            {footerContent}
          </PrintBand>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // `LYZN · PROOF OF WORK` — the canvas' own header: mono 9/700, tracked at
  // .22em, which is 1.98 points at that size.
  header: {
    fontFamily: fontFamily.mono[700],
    fontSize: 9,
    letterSpacing: 1.98,
    textTransform: 'uppercase',
    color: colors.receiptInk,
    textAlign: 'center',
  },
  meta: {
    marginTop: 4,
    fontFamily: fontFamily.mono[500],
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.receiptFaint,
    textAlign: 'center',
  },
  quote: {
    fontFamily: fontFamily.sans[500],
    fontSize: 15,
    letterSpacing: -0.15,
    lineHeight: 21,
    color: colors.receiptInk,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  rowKey: {
    // A `plain` key is task text, which can be longer than the slip is wide.
    // Shrinking rather than growing keeps the leader and the value on the
    // paper; `numberOfLines={1}` then truncates the key itself (spec §2.6:
    // "the item text in sentence case, one line, truncated").
    flexShrink: 1,
    fontFamily: fontFamily.mono[400],
    fontSize: 12,
    letterSpacing: 0.7,
    lineHeight: 23,
    textTransform: 'uppercase',
    color: 'rgba(22,24,26,0.72)',
  },
  leader: {
    flex: 1,
    borderBottomWidth: 1,
    borderStyle: 'dotted',
    borderColor: 'rgba(22,24,26,0.30)',
    borderRadius: 0.01, // Android needs a non-zero radius for a dotted border to draw.
    transform: [{ translateY: -3 }],
  },
  rowValue: {
    // Shares the slack with the key rather than pushing it off the slip: a
    // task's own text is a long value, and a key truncated to one letter is
    // worse than a value truncated to a line.
    flexShrink: 1,
    fontFamily: fontFamily.mono[500],
    fontSize: 12,
    letterSpacing: 0.7,
    lineHeight: 23,
    color: colors.receiptInk,
  },
  // Settled green, at 700 — the canvas gives a delivered time both, because
  // it is the line the whole slip exists to carry.
  rowValueOk: {
    color: colors.settled,
    fontFamily: fontFamily.mono[700],
  },
  total: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
  },
  totalValue: {
    fontFamily: fontFamily.mono[600],
    fontSize: 20,
    letterSpacing: 0.4,
    color: colors.receiptInk,
  },
  footer: {
    marginTop: 12,
    fontFamily: fontFamily.mono[500],
    fontSize: 10.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.receiptFaint,
    textAlign: 'center',
  },
  barcodeFlat: {
    flexDirection: 'row',
    overflow: 'hidden',
  },
  hiddenTwin: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0,
  },
  finalTwin: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
});
