"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DangerousCommandError = exports.WIFI_STATES = exports.DANGEROUS = exports.DIALECTS = exports.ADVERTISED_NAME_PREFIX = exports.CMD_UUID = exports.WRITE_UUID = exports.AUDIO_UUID = exports.SVC_UUID = void 0;
exports.classify = classify;
exports.decodeBase64 = decodeBase64;
exports.encodeBase64 = encodeBase64;
exports.utf8ToBytes = utf8ToBytes;
exports.decodeMessage = decodeMessage;
exports.field = field;
exports.verbOf = verbOf;
exports.alignMp3 = alignMp3;
exports.parseFileEntry = parseFileEntry;
exports.isSyncable = isSyncable;
exports.deviceFileToIso = deviceFileToIso;
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
const base64 = __importStar(require("base64-js"));
exports.SVC_UUID = '001120a0-2233-4455-6677-88995a5b5c5d';
/** Notify: live MP3 stream and bulk file data, sharing one channel. */
exports.AUDIO_UUID = '001120a1-2233-4455-6677-88995a5b5c5d';
/** Write: app -> device. */
exports.WRITE_UUID = '001120a2-2233-4455-6677-88995a5b5c5d';
/** Notify: device -> app replies and unsolicited events. */
exports.CMD_UUID = '001120a3-2233-4455-6677-88995a5b5c5d';
/** The pendant advertises under this name and does not advertise its service. */
exports.ADVERTISED_NAME_PREFIX = 'YLF20_';
/** (command prefix, reply prefix), most likely first. */
exports.DIALECTS = [
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
exports.DANGEROUS = {
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
exports.WIFI_STATES = {
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
function classify(verb) {
    for (const [prefix, reason] of Object.entries(exports.DANGEROUS)) {
        if (verb.startsWith(prefix))
            return reason;
    }
    return null;
}
class DangerousCommandError extends Error {
    constructor(verb, reason) {
        super(`refusing to send ${verb}: it ${reason}`);
        this.name = 'DangerousCommandError';
    }
}
exports.DangerousCommandError = DangerousCommandError;
// -- encoding --------------------------------------------------------------
/** react-native-ble-plx hands characteristic values over as base64. */
function decodeBase64(value) {
    return base64.toByteArray(value);
}
function encodeBase64(bytes) {
    return base64.fromByteArray(bytes);
}
function utf8ToBytes(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++)
        bytes[i] = text.charCodeAt(i) & 0xff;
    return bytes;
}
/** Decode a control message: ASCII, NUL-padded, sometimes with trailing space. */
function decodeMessage(bytes) {
    let out = '';
    for (const byte of bytes) {
        if (byte === 0)
            continue;
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
function field(msg, index) {
    if (!msg)
        return undefined;
    const parts = msg.split('&');
    return parts.length > index ? parts[index] : undefined;
}
/** Drop the DEV&/XS_DEV& prefix so matching works on either dialect. */
function verbOf(msg) {
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
function alignMp3(data) {
    for (let i = 0; i < data.length - 1; i++) {
        if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0) {
            return i === 0 ? data : data.subarray(i);
        }
    }
    return data;
}
/** Parse DEV&F&<dir>&<file>&<secs>&<bytes>. */
function parseFileEntry(msg) {
    const parts = msg.split('&');
    // DEV, F, dir, file, secs, bytes
    if (parts.length < 6)
        return null;
    const name = parts[3];
    if (!name)
        return null;
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
function isSyncable(file) {
    return !file.name.startsWith('._') && file.sizeBytes > 0;
}
/**
 * The device names files from its own clock as "YYYY-MM-DD HH-MM-SS".
 * Returns an ISO 8601 local timestamp, or undefined if the name is unexpected.
 */
function deviceFileToIso(name) {
    const m = name.match(/^(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/);
    if (!m)
        return undefined;
    const [, y, mo, d, h, mi, s] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
