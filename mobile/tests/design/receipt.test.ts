/**
 * `Receipt`'s pure logic (app spec §3.3) — the row model, the barcode and
 * the band order the print animation (M2) reveals. `Receipt.tsx` itself
 * imports React Native and Skia and cannot load under `node --test` (see
 * `src/design/receiptLogic.ts`'s header), so this suite exercises the logic
 * module directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barcodeBars, receiptBands, bandVisible, RECEIPT_TITLE,
  type ReceiptRowSpec,
} from '../../src/design/receiptLogic';

test('the default title is the shipped one, verbatim', () => {
  assert.equal(RECEIPT_TITLE, 'LYZN · PROOF OF WORK');
});

test('the row model accepts a plain row (task text, sentence case)', () => {
  const plain: ReceiptRowSpec = { k: 'Call the dentist back', plain: true };
  const withValue: ReceiptRowSpec = { k: 'STATUS', v: 'FILED', ok: true, plain: false };
  const bare: ReceiptRowSpec = { k: 'NOTE' };

  assert.equal(plain.plain, true);
  assert.equal(plain.v, undefined);
  assert.equal(withValue.ok, true);
  assert.equal(bare.v, undefined);
});

test('barcodeBars draws 84 bars, each 1..3 wide', () => {
  const bars = barcodeBars('recording-42');
  assert.equal(bars.length, 84);
  for (const width of bars) {
    assert.ok(Number.isInteger(width));
    assert.ok(width >= 1 && width <= 3, `bar width ${width} out of range`);
  }
});

test('the same seed draws the same code — deterministic, on purpose', () => {
  const a = barcodeBars('order-9001');
  const b = barcodeBars('order-9001');
  assert.deepEqual(a, b);
});

test('a different seed draws a different code', () => {
  const a = barcodeBars('order-9001');
  const b = barcodeBars('order-9002');
  assert.notDeepEqual(a, b);
});

test('receiptBands lists only the bands the slip has, in print order', () => {
  assert.deepEqual(receiptBands({}), []);
  assert.deepEqual(receiptBands({ quote: 'hello' }), ['quote']);
  assert.deepEqual(
    receiptBands({
      quote: 'hello',
      rows: [{ k: 'a' }],
      total: { k: 'TOTAL', v: '$1' },
      barcodeSeed: 'x',
      footer: 'thanks',
    }),
    ['quote', 'rows', 'total', 'barcode', 'footer'],
  );
  // An empty rows array is not a rows band.
  assert.deepEqual(receiptBands({ rows: [] }), []);
});

test('bandVisible: undefined printedBands means the whole slip is up', () => {
  assert.equal(bandVisible(0, undefined), true);
  assert.equal(bandVisible(4, undefined), true);
});

test('bandVisible: band 0 (header) is not a content band — content starts at printed count 2', () => {
  // printedBands counts the header as band 1; content band 0 needs >= 2.
  assert.equal(bandVisible(0, 0), false);
  assert.equal(bandVisible(0, 1), false);
  assert.equal(bandVisible(0, 2), true);
  assert.equal(bandVisible(1, 2), false);
  assert.equal(bandVisible(1, 3), true);
});
