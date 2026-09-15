/**
 * The onboarding screens' arithmetic and copy (app spec §2.3–§2.5): the
 * four-tick signal meter, the scan's status line, the rows the pairing
 * receipt prints, and the rule that keeps it printing only on arrival.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signalLevel, tickValue, pairingMeta, pairingRows, pairStatus,
  claimPairingPrint, resetPairingPrints,
  PAIRING_TITLE, PAIRING_STAMP, PAIRING_FOOTER, BATTERY_OK_PERCENT,
} from '../../src/onboarding/pairing';
import { receiptBands } from '../../src/design/receiptLogic';

test('the signal meter keeps the thresholds the bar glyph used', () => {
  assert.equal(signalLevel(-40), 4);
  assert.equal(signalLevel(-55), 3, '−55 itself is not "greater than −55"');
  assert.equal(signalLevel(-62), 3);
  assert.equal(signalLevel(-70), 2);
  assert.equal(signalLevel(-84), 2);
  assert.equal(signalLevel(-95), 1);
});

test('a device that answered the scan always lights at least one tick', () => {
  for (const rssi of [-100, -120, -200]) {
    assert.ok(signalLevel(rssi) >= 1, `rssi ${rssi} lit nothing`);
  }
});

/** `TickRow` lights tick `i` when `i / ticks <= value` — the meter's contract. */
const litTicks = (value: number, ticks: number) =>
  Array.from({ length: ticks }, (_, i) => i / ticks <= value).filter(Boolean).length;

test('tickValue lights exactly the level it is given', () => {
  for (const level of [1, 2, 3, 4]) {
    assert.equal(litTicks(tickValue(level, 4), 4), level, `level ${level}`);
  }
});

test('the meta line joins the name and the firmware, and drops what is missing', () => {
  assert.equal(
    pairingMeta({ name: 'YLF20_D830', firmware: 'V1.2' }),
    'YLF20_D830 · FW V1.2',
  );
  assert.equal(pairingMeta({ name: 'YLF20_D830' }), 'YLF20_D830');
  assert.equal(pairingMeta({ firmware: 'V1.2' }), 'FW V1.2');
  assert.equal(pairingMeta({}), '', 'no facts is no meta line, never a token');
});

test('the rows are the three the slip prints', () => {
  const rows = pairingRows({ batteryPercent: 98, freeMb: 7782, recording: true });
  assert.deepEqual(rows, [
    { k: 'BATTERY', v: '98%', ok: true },
    { k: 'FREE', v: '7.6 GB' },
    { k: 'RECORDING', v: 'Yes' },
  ]);
});

test('battery is an ok row at 20% and a plain one below it', () => {
  assert.equal(pairingRows({ batteryPercent: BATTERY_OK_PERCENT })[0].ok, true);
  assert.equal(pairingRows({ batteryPercent: BATTERY_OK_PERCENT - 1 })[0].ok, false);
});

test('a fact the pendant did not report has no row', () => {
  assert.deepEqual(pairingRows({}), []);
  // Undefined recording means "the device did not answer", not "not yet".
  assert.deepEqual(pairingRows({ recording: false }), [{ k: 'RECORDING', v: 'Not yet' }]);
});

test('the slip prints four bands, which is what Ready steps its timer through', () => {
  const bands = receiptBands({
    rows: pairingRows({ batteryPercent: 98, freeMb: 7782, recording: true }),
    barcodeSeed: 'aa:bb:cc:dd:ee:ff',
    footer: PAIRING_FOOTER,
  });
  // rows, barcode, footer — plus band 0, the title and meta.
  assert.deepEqual(bands, ['rows', 'barcode', 'footer']);
  assert.equal(bands.length + 1, 4);
});

test('the slip’s fixed copy is the spec’s, verbatim', () => {
  assert.equal(PAIRING_TITLE, 'LYZN · PAIRED');
  assert.equal(PAIRING_STAMP, 'LINKED');
  assert.equal(PAIRING_FOOTER, 'RECORDS ON ITS OWN · SYNCS WHEN IN RANGE');
});

test('the status line says what the radio is doing', () => {
  assert.equal(pairStatus('permissions', 0, true), 'ALLOW BLUETOOTH TO CONTINUE');
  assert.equal(pairStatus('permissions', 0, false), 'STARTING BLUETOOTH…');
  assert.equal(pairStatus('scanning', 0, false), 'SCANNING…');
  assert.equal(pairStatus('scanning', 2, false), 'SCANNING · 2 FOUND · TAP YOURS');
  assert.equal(pairStatus('connecting', 2, false), 'CONNECTING…');
  // The error takes the slot on a failure — a sentence, not a status.
  assert.equal(pairStatus('failed', 0, false), undefined);
});

test('a pairing prints its slip exactly once', () => {
  resetPairingPrints();
  assert.equal(claimPairingPrint('abc'), true, 'the arrival prints');
  assert.equal(claimPairingPrint('abc'), false, 'a re-entered Ready does not (R14)');
  assert.equal(claimPairingPrint('def'), true, 'a second pairing is its own arrival');
});

test('a Ready reached without a pairing behind it never prints', () => {
  resetPairingPrints();
  assert.equal(claimPairingPrint(undefined), false);
  assert.equal(claimPairingPrint(''), false);
  // …and having refused, it has not spent anything either.
  assert.equal(claimPairingPrint('ghi'), true);
});
