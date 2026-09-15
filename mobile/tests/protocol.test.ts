/**
 * Protocol tests for the TypeScript port.
 *
 * Mirrors selftest.py: every case here is either a reply the real device
 * produced, or a hazard the Python client was changed to handle. No device or
 * native module required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, DANGEROUS, DIALECTS,
  decodeMessage, utf8ToBytes, encodeBase64, decodeBase64,
  field, verbOf, alignMp3,
  parseFileEntry, isSyncable, deviceFileToIso,
  WIFI_STATES, SVC_UUID, AUDIO_UUID, WRITE_UUID, CMD_UUID,
} from '../src/ble/protocol';

// -- dialect ---------------------------------------------------------------

test('the shipped-firmware dialect is tried first', () => {
  // Firmware V1.2 answers BLE&/DEV& and rejects the documented XS_ form, so
  // probing the documented one first would cost a round trip on every connect.
  assert.deepEqual(DIALECTS[0], ['BLE&', 'DEV&']);
  assert.deepEqual(DIALECTS[1], ['XS_BLE&', 'XS_DEV&']);
});

test('GATT UUIDs match the ones verified on hardware', () => {
  assert.equal(SVC_UUID, '001120a0-2233-4455-6677-88995a5b5c5d');
  assert.equal(AUDIO_UUID, '001120a1-2233-4455-6677-88995a5b5c5d');
  assert.equal(WRITE_UUID, '001120a2-2233-4455-6677-88995a5b5c5d');
  assert.equal(CMD_UUID, '001120a3-2233-4455-6677-88995a5b5c5d');
});

// -- the dangerous-command gate -------------------------------------------

test('commands that destroy data are refused', () => {
  // BLE&RESET formats the device and sits one character from BLE&OFF.
  assert.match(classify('BLE&RESET')!, /formats/);
  assert.match(classify('BLE&OFF')!, /pairing key/);
  assert.match(classify('D&2026-08-19&file')!, /deletes/);
  assert.match(classify('OTA&001234')!, /firmware-write/);
  assert.match(classify('OT&OVER')!, /commits a firmware write/);
  assert.match(classify('WIFI&OTA')!, /firmware-write/);
  assert.match(classify('WIFI&CH&ssid&pw')!, /WiFi credentials/);
});

test('BLE&STATUS is refused because it silently stops recording', () => {
  // Undocumented, answers DEV&STO, and halts an in-progress recording.
  assert.match(classify('STATUS')!, /stops an in-progress recording/);
});

test('everything the app actually needs is allowed', () => {
  for (const verb of [
    'FW', 'WF', 'MAC', 'BAT', 'SPACE', 'STE', 'GT', 'WIFIS', 'GET&USB',
    'REC&SECEN', 'STA', 'STO', 'SHAKE', 'LIST_DIRS', 'LIST&2026-08-19',
    'U&2026-08-19&2026-08-19 17-36-06', 'T&20260819182902', 'SK&0123456789abcdef',
  ]) {
    assert.equal(classify(verb), null, `${verb} should be allowed`);
  }
});

test('the gate matches on prefix, not equality', () => {
  // The verb carries arguments, so an exact-match gate would let D&x&y through.
  assert.notEqual(classify('D&anything'), null);
  assert.notEqual(classify('OTA&123456'), null);
});

test('every dangerous entry explains itself', () => {
  for (const [verb, reason] of Object.entries(DANGEROUS)) {
    assert.ok(reason.length > 10, `${verb} needs a usable reason`);
  }
});

// -- encoding --------------------------------------------------------------

test('commands round-trip through base64', () => {
  const command = 'BLE&U&2026-08-19&2026-08-19 17-36-06';
  assert.equal(decodeMessage(decodeBase64(encodeBase64(utf8ToBytes(command)))), command);
});

test('replies are NUL-padded and trimmed', () => {
  const padded = new Uint8Array([...utf8ToBytes('DEV&FW&V1.2'), 0, 0, 0]);
  assert.equal(decodeMessage(padded), 'DEV&FW&V1.2');
  assert.equal(decodeMessage(utf8ToBytes('  DEV&STO  ')), 'DEV&STO');
});

// -- reply parsing ---------------------------------------------------------

test('fields are extracted from real replies', () => {
  assert.equal(field('DEV&FW&V1.2', 2), 'V1.2');
  assert.equal(field('DEV&MAC&50c0f013d830', 2), '50c0f013d830');
  assert.equal(field('DEV&BAT&98', 2), '98');
  assert.equal(field('DEV&SPA&007655&007661', 2), '007655');
  assert.equal(field('DEV&SPA&007655&007661', 3), '007661');
  assert.equal(field('DEV&STE&1', 2), '1');
  assert.equal(field('DEV&CT&20260819182902', 2), '20260819182902');
  assert.equal(field('DEV&STA&2026-08-19 18-34-09', 2), '2026-08-19 18-34-09');
});

test('a short or missing reply yields undefined rather than throwing', () => {
  assert.equal(field('DEV&STO', 2), undefined);
  assert.equal(field(undefined, 2), undefined);
  assert.equal(field(null, 2), undefined);
  assert.equal(field('', 2), undefined);
});

test('the dialect prefix is stripped for event matching', () => {
  assert.equal(verbOf('DEV&STA&2026-08-19 18-34-09'), 'STA&2026-08-19 18-34-09');
  assert.equal(verbOf('XS_DEV&STO'), 'STO');
  assert.equal(verbOf('UNKNOWN'), 'UNKNOWN');
});

test('zero-padded storage figures parse as numbers', () => {
  assert.equal(Number(field('DEV&SPA&007655&007661', 2)), 7655);
  assert.equal(Number(field('DEV&SPA&000000&007661', 2)), 0);
});

test('wifi states cover the documented range', () => {
  for (let i = 0; i <= 7; i++) assert.ok(WIFI_STATES[String(i)], `state ${i} missing`);
});

// -- file listings ---------------------------------------------------------

test('file entries parse into folder, name, duration and size', () => {
  const entry = parseFileEntry('DEV&F&2026-08-19&2026-08-19 17-36-06&142&568320');
  assert.deepEqual(entry, {
    folder: '2026-08-19',
    name: '2026-08-19 17-36-06',
    durationSeconds: 142,
    sizeBytes: 568320,
  });
});

test('a truncated file entry is dropped rather than half-parsed', () => {
  assert.equal(parseFileEntry('DEV&F&2026-08-19&2026-08-19 17-36-06'), null);
  assert.equal(parseFileEntry('DEV&LIST&001'), null);
});

test('AppleDouble sidecars are skipped', () => {
  // macOS writes these when the pendant is mounted over USB. They exist on the
  // device's filesystem but it cannot open them, so every transfer request fails.
  const sidecar = parseFileEntry('DEV&F&2026-08-19&._2026-08-19 17-36-06&0&4096')!;
  assert.equal(isSyncable(sidecar), false);

  const real = parseFileEntry('DEV&F&2026-08-19&2026-08-19 17-36-06&142&568320')!;
  assert.equal(isSyncable(real), true);
});

test('zero-byte files are skipped', () => {
  const empty = parseFileEntry('DEV&F&2026-08-19&2026-08-19 17-36-06&0&0')!;
  assert.equal(isSyncable(empty), false);
});

test('device file names convert to timestamps', () => {
  const iso = deviceFileToIso('2026-08-19 17-36-06');
  assert.ok(iso);
  const date = new Date(iso!);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 7); // August
  assert.equal(date.getDate(), 19);
  assert.equal(date.getHours(), 17);
  assert.equal(date.getMinutes(), 36);
  assert.equal(date.getSeconds(), 6);
});

test('an unexpected file name yields no timestamp instead of a wrong one', () => {
  assert.equal(deviceFileToIso('REC001'), undefined);
  assert.equal(deviceFileToIso(''), undefined);
  assert.equal(deviceFileToIso('2026-13-45 99-99-99'), undefined);
});

// -- MP3 alignment ---------------------------------------------------------

test('a live capture is trimmed to the first frame sync', () => {
  // The device streams continuously, so a capture starts mid-frame and players
  // reject it until the leading fragment goes.
  const data = new Uint8Array([0x12, 0x34, 0x56, 0xff, 0xfb, 0x90, 0x00]);
  assert.deepEqual([...alignMp3(data)], [0xff, 0xfb, 0x90, 0x00]);
});

test('data already frame-aligned is returned untouched', () => {
  const data = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
  assert.equal(alignMp3(data), data);
});

test('a buffer with no frame sync is returned whole rather than emptied', () => {
  const data = new Uint8Array([0x00, 0x01, 0x02]);
  assert.deepEqual([...alignMp3(data)], [0x00, 0x01, 0x02]);
});

test('the sync check requires all eleven frame bits', () => {
  // 0xFF followed by a byte whose top three bits are not set is not a frame.
  const notASync = new Uint8Array([0xff, 0x0f, 0xff, 0xe0, 0x11]);
  assert.deepEqual([...alignMp3(notASync)], [0xff, 0xe0, 0x11]);
});
