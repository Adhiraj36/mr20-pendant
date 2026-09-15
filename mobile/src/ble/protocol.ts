/**
 * MR20 pendant protocol: constants and pure functions.
 *
 * Ported from the Python client in this repo, which was verified against real
 * hardware on firmware V1.2. Everything here is transport-free and unit
 * testable; the BLE plumbing lives in client.ts.
 *
 * Dialect note: the manufacturer's spec writes commands as "XS_BLE&FW" and
 * replies as "XS_DEV&FW&...", but firmware V1.2 drops the XS_ prefix entirely
 * and rejects the documented form with DEV&UNKNOWN. Commands are written here
 * as bare verbs and the prefix is detected on connect, so either build works.
 */
import * as base64 from 'base64-js';

export const SVC_UUID = '001120a0-2233-4455-6677-88995a5b5c5d';
/** Notify: live MP3 stream and bulk file data, sharing one channel. */
export const AUDIO_UUID = '001120a1-2233-4455-6677-88995a5b5c5d';
/** Write: app -> device. */
export const WRITE_UUID = '001120a2-2233-4455-6677-88995a5b5c5d';
/** Notify: device -> app replies and unsolicited events. */
export const CMD_UUID = '001120a3-2233-4455-6677-88995a5b5c5d';

/** The pendant advertises under this name and does not advertise its service. */
export const ADVERTISED_NAME_PREFIX = 'YLF20_';

/** (command prefix, reply prefix), most likely first. */
export const DIALECTS: ReadonlyArray<readonly [string, string]> = [
  ['BLE&', 'DEV&'],
  ['XS_BLE&', 'XS_DEV&'],
];

/**
 * Verbs the app must never send, with the reason.
 *
 * BLE&RESET formats the device, destroying every recording, and sits one
 * character away from BLE&OFF, which does not. The app has no legitimate use
 * for any of these, so unlike the Python CLI there is no override flag.
 */
export const DANGEROUS: Record<string, string> = {
  'BLE&RESET': "formats the device's storage, erasing all recordings",
  'BLE&OFF': 'drops the BLE link and resets the pairing key',
  OTA: 'puts the MCU into firmware-write mode',
  'WIFI&OTA': 'puts the WiFi coprocessor into firmware-write mode',
  'OT&OVER': 'commits a firmware write',
  'D&': 'deletes a recording from the device',
  'WIFI&CH': "changes the device's WiFi credentials",
  // Undocumented, and it answers DEV&STO: it stops an in-progress recording
  // rather than reporting anything. Found the hard way.
  STATUS: 'silently stops an in-progress recording',
};

/**
 * The WiFi transfer endpoint, from the vendor protocol sheet: the pendant
 * hosts an AP, and once joined the phone reads file bytes from a TCP socket
 * at this address. The stream's final five bytes are the end marker below —
 * they are not part of the file.
 *
 * AP behaviour (also from the sheet): it closes itself after 30 s with no
 * client, 5 s after a client leaves, and immediately if BLE disconnects — so
 * the BLE link must be held for the whole transfer.
 */
export const WIFI_SOCKET_HOST = '192.168.200.1';
export const WIFI_SOCKET_PORT = 8475;
export const WIFI_END_MARKER = Uint8Array.from([0xba, 0x5a, 0x02, 0x8f, 0x04]);

export const WIFI_STATES: Record<string, string> = {
  '0': 'off',
  '1': 'connected',
  '2': 'on, no client',
  '3': 'starting',
  '4': 'changing password',
  '5': 'OTA',
  '6': 'password changed, resetting',
  '7': 'auto-closed',
};

/** The reason a verb is dangerous, or null if it is safe to send. */
export function classify(verb: string): string | null {
  for (const [prefix, reason] of Object.entries(DANGEROUS)) {
    if (verb.startsWith(prefix)) return reason;
  }
  return null;
}

export class DangerousCommandError extends Error {
  constructor(verb: string, reason: string) {
    super(`refusing to send ${verb}: it ${reason}`);
    this.name = 'DangerousCommandError';
  }
}

// -- encoding --------------------------------------------------------------

/** react-native-ble-plx hands characteristic values over as base64. */
export function decodeBase64(value: string): Uint8Array {
  return base64.toByteArray(value);
}

export function encodeBase64(bytes: Uint8Array): string {
  return base64.fromByteArray(bytes);
}

export function utf8ToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** Decode a control message: ASCII, NUL-padded, sometimes with trailing space. */
export function decodeMessage(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    if (byte === 0) continue;
    out += String.fromCharCode(byte);
  }
  return out.trim();
}

// -- message parsing -------------------------------------------------------

/**
 * Pull one &-separated field. Index 0 is the DEV tag, 1 the verb, 2 onward the
 * payload. Returns undefined rather than throwing on a short message, because
 * the device does send truncated replies.
 */
export function field(msg: string | undefined | null, index: number): string | undefined {
  if (!msg) return undefined;
  const parts = msg.split('&');
  return parts.length > index ? parts[index] : undefined;
}

/** Drop the DEV&/XS_DEV& prefix so matching works on either dialect. */
export function verbOf(msg: string): string {
  const i = msg.indexOf('&');
  return i === -1 ? msg : msg.slice(i + 1);
}

/**
 * Trim to the first MP3 frame sync.
 *
 * The device streams continuously, so a live capture almost always starts
 * partway through a frame and players reject the result until the leading
 * fragment goes. File downloads start clean and are unaffected.
 */
export function alignMp3(data: Uint8Array): Uint8Array {
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0) {
      return i === 0 ? data : data.subarray(i);
    }
  }
  return data;
}

// -- typed replies ---------------------------------------------------------

export interface DeviceInfo {
  firmware?: string;
  wifiFirmware?: string;
  mac?: string;
  batteryPercent?: number;
  freeMb?: number;
  totalMb?: number;
  /**
   * Undefined means "the device did not answer", which is NOT the same as
   * "not recording". Treating a dropped reply as false is what made the
   * recording switch appear inverted: it silently forced the toggle off
   * whenever the STE reply was lost.
   */
  recording?: boolean;
  deviceTime?: string;
  wifiState?: string;
  usbFileMode?: string;
  recordMode?: string;
}

export interface DeviceFile {
  folder: string;
  name: string;
  durationSeconds: number;
  sizeBytes: number;
}

/** Parse DEV&F&<dir>&<file>&<secs>&<bytes>. */
export function parseFileEntry(msg: string): DeviceFile | null {
  const parts = msg.split('&');
  // DEV, F, dir, file, secs, bytes
  if (parts.length < 6) return null;
  const name = parts[3];
  if (!name) return null;
  return {
    folder: parts[2],
    name,
    durationSeconds: Number(parts[4]) || 0,
    sizeBytes: Number(parts[5]) || 0,
  };
}

/**
 * macOS writes AppleDouble sidecars when the pendant is mounted over USB.
 * They sit on the device's filesystem but it cannot open them, so a transfer
 * request for one always fails.
 */
export function isSyncable(file: DeviceFile): boolean {
  return !file.name.startsWith('._') && file.sizeBytes > 0;
}

/**
 * The device names files from its own clock as "YYYY-MM-DD HH-MM-SS".
 * Returns an ISO 8601 local timestamp, or undefined if the name is unexpected.
 */
export function deviceFileToIso(name: string): string | undefined {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];

  const date = new Date(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(date.getTime())) return undefined;

  // The Date constructor rolls out-of-range components over rather than
  // rejecting them, so month 13 would silently become next January. A garbled
  // name must produce no timestamp, not a plausible wrong one that then sorts
  // the library incorrectly.
  const roundTrips =
    date.getFullYear() === y &&
    date.getMonth() === mo - 1 &&
    date.getDate() === d &&
    date.getHours() === h &&
    date.getMinutes() === mi &&
    date.getSeconds() === s;

  return roundTrips ? date.toISOString() : undefined;
}
