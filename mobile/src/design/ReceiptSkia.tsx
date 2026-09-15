/**
 * The Skia layer of `Receipt` — the scalloped paper and the barcode's bars
 * (app spec §3.3, §9 "Receipt").
 *
 * Isolated in its own file, lazily `require`d from `Receipt.tsx` behind a
 * probe for the native module — `OrbVisual`'s pattern (`src/components/
 * OrbVisual.tsx`). Importing `@shopify/react-native-skia` eagerly, at the
 * top of a file that always loads, calls the module's own `getEnforcing` at
 * *import* time: on a dev client built before Skia was added that throws
 * through the global exception handler, which no try/catch here can contain.
 * Only requiring this file after the probe confirms the module is present
 * keeps the fallback path safe.
 */
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {
  Canvas, Path, Rect, Shadow, Skia, PathOp, type SkPath,
} from '@shopify/react-native-skia';
import { colors } from './tokens';

/**
 * A rect with semicircular bites of `radius` along the top and bottom
 * edges, centred *on* the edge, every `pitch` points — the site's mask
 * (`circle at 50% 0` and `50% 100%`, `web/src/index.css` `.receipt`),
 * built as a path op rather than painted notches so the ground behind the
 * slip shows through the bites instead of a guessed colour.
 *
 * `Skia.Path.MakeFromOp(one, two, op)` — confirmed against `PathFactory` in
 * `@shopify/react-native-skia`'s type defs — is the exact API; `PathOp.
 * Difference` subtracts the second path from the first.
 */
function scallopedPaper(width: number, height: number, radius = 8, pitch = 16): SkPath {
  const rect = Skia.Path.Make();
  rect.addRect({ x: 0, y: 0, width, height });
  if (width <= 0 || height <= 0) return rect;

  // Union every bite into one path first — one Difference at the end is
  // cheaper, and correct either way, but this halves the op count.
  let bites: SkPath | null = null;
  for (let x = pitch / 2; x < width; x += pitch) {
    const top = Skia.Path.Circle(x, 0, radius);
    bites = bites ? (Skia.Path.MakeFromOp(bites, top, PathOp.Union) ?? bites) : top;
    const bottom = Skia.Path.Circle(x, height, radius);
    bites = Skia.Path.MakeFromOp(bites, bottom, PathOp.Union) ?? bites;
  }
  if (!bites) return rect;
  return Skia.Path.MakeFromOp(rect, bites, PathOp.Difference) ?? rect;
}

/**
 * The paper, under the content. `<Shadow>` sits *inside* `<Path>` (spec
 * §3.3) — a `DropShadowImageFilter` on the path's own paint, so the shadow
 * is derived from the scalloped silhouette rather than the plain rect a
 * sibling shadow view would cast.
 */
export function SkiaPaper({ width, height }: { width: number; height: number }) {
  const path = useMemo(() => scallopedPaper(width, height), [width, height]);
  if (width <= 0 || height <= 0) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path path={path} color={colors.receiptPaper}>
        <Shadow dx={0} dy={10} blur={8} color="rgba(20,20,22,0.16)" />
      </Path>
    </Canvas>
  );
}

/**
 * 84 bars, alternating `receiptInk` with transparent (spec §3.3). Widths
 * come from `barcodeBars` (`@lyzn/design`) — never reimplemented here, so
 * the same seed draws the same code the website's `<Barcode>` draws.
 */
export function SkiaBarcode({
  bars, width, height,
}: {
  bars: number[];
  width: number;
  height: number;
}) {
  if (width <= 0 || height <= 0) return null;
  const total = bars.reduce((sum, w) => sum + w, 0) || 1;
  const unit = width / total;
  let x = 0;
  const rects = bars.map((w, i) => {
    const barWidth = w * unit;
    const node = i % 2 === 0
      ? <Rect key={i} x={x} y={0} width={barWidth} height={height} color={colors.receiptInk} />
      : null;
    x += barWidth;
    return node;
  });
  return <Canvas style={{ width, height }}>{rects}</Canvas>;
}
