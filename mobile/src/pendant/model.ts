/**
 * What the Pendant tab says — canvas P1, P2, P3.
 *
 * Three numbers arrive off the device (`batteryPercent`, `freeMb`,
 * `totalMb`) and the canvas asks for six sentences about them, two of which
 * are estimates: `≈5H LEFT` beside the battery and `6.6 GB · ≈14 H` beside
 * the free space. **Neither is a constant in this file.** The device reports
 * no runtime and no bitrate, so both are derived from what the app has
 * actually watched happen — the battery from samples of its own percentage
 * over time, the hours-of-room from the bytes-per-second of recordings this
 * phone has already pulled. When there is not enough history to derive one,
 * the fragment is **omitted**, per the plan's slot rule: never ship a token.
 *
 * Pure — no React, no storage, no BLE. The screen hands it numbers and gets
 * strings back, and `node --test` reads it directly.
 */

// -- the battery -----------------------------------------------------------

/** One reading of the battery, and when it was taken. */
export interface BatterySample {
  /** Epoch milliseconds. */
  at: number;
  /** 0–100, as the device reports it. */
  percent: number;
}

/** How many readings are worth keeping. Enough for a day of connected use. */
export const MAX_BATTERY_SAMPLES = 24;

/**
 * How far apart the oldest and newest reading must be before a rate means
 * anything. Under half an hour the pendant's own reporting granularity (it
 * moves in whole percent) dominates, and the estimate swings by hours
 * between polls.
 */
export const MIN_BATTERY_SPAN_MS = 30 * 60_000;

/** Older than this and the pendant has been off the wrist; the trail is stale. */
export const MAX_BATTERY_AGE_MS = 12 * 60 * 60_000;

/**
 * Fold a reading into the trail.
 *
 * A charge — the percentage going up — throws the trail away rather than
 * being averaged into it: what is being estimated is how long this discharge
 * lasts, and a discharge that has been interrupted by a cable is a different
 * discharge. Readings that repeat the last percentage are kept, because the
 * time they cover is exactly what makes a slow discharge look slow.
 */
export function pushBatterySample(
  trail: BatterySample[],
  sample: BatterySample,
  now = sample.at,
): BatterySample[] {
  if (!Number.isFinite(sample.percent) || sample.percent < 0 || sample.percent > 100) return trail;

  const fresh = trail.filter((s) => now - s.at <= MAX_BATTERY_AGE_MS && s.at <= sample.at);
  const last = fresh[fresh.length - 1];
  if (last && sample.percent > last.percent) return [sample];
  // Two readings in the same instant are one reading; keep the newer.
  const kept = last && last.at === sample.at ? fresh.slice(0, -1) : fresh;
  return [...kept, sample].slice(-MAX_BATTERY_SAMPLES);
}

/**
 * Hours of use left at the rate this trail has been discharging, or
 * `undefined` when there is nothing honest to say: fewer than two readings,
 * too short a span, or a battery that has not moved at all (which would
 * divide by zero and claim infinity).
 */
export function batteryHoursLeft(trail: BatterySample[], nowPercent?: number): number | undefined {
  if (trail.length < 2) return undefined;
  const first = trail[0];
  const last = trail[trail.length - 1];
  const spanMs = last.at - first.at;
  if (spanMs < MIN_BATTERY_SPAN_MS) return undefined;

  const dropped = first.percent - last.percent;
  if (dropped <= 0) return undefined;

  const percentPerHour = dropped / (spanMs / 3_600_000);
  const percent = nowPercent ?? last.percent;
  const hours = percent / percentPerHour;
  if (!Number.isFinite(hours) || hours <= 0) return undefined;
  // Beyond a couple of days the estimate is arithmetic, not information.
  if (hours > 48) return undefined;
  return hours;
}

/**
 * `≈5H LEFT`, or nothing at all — canvas P1's second battery line. Rounded
 * to the hour below half a day, because "≈5.4H" is a false precision on a
 * number derived from whole-percent readings.
 */
export function batteryLeftLabel(trail: BatterySample[], nowPercent?: number): string | undefined {
  const hours = batteryHoursLeft(trail, nowPercent);
  if (hours === undefined) return undefined;
  if (hours < 1) return '≈UNDER 1H LEFT';
  return `≈${Math.round(hours)}H LEFT`;
}

// -- the storage -----------------------------------------------------------

const MB_PER_GB = 1024;

/** `1.4 / 8 GB` — canvas P1. Undefined until the device has reported both. */
export function storageLine(freeMb?: number, totalMb?: number): string | undefined {
  if (totalMb === undefined || freeMb === undefined || totalMb <= 0) return undefined;
  const used = Math.max(0, totalMb - freeMb);
  return `${gb(used)} / ${trimGb(totalMb)} GB`;
}

/** How full it is, 0–1. Zero when the device has not said. */
export function storageFraction(freeMb?: number, totalMb?: number): number {
  if (totalMb === undefined || freeMb === undefined || totalMb <= 0) return 0;
  return Math.max(0, Math.min(1, (totalMb - freeMb) / totalMb));
}

/** `6.6 GB` free, one decimal. */
export function freeLabel(freeMb?: number): string | undefined {
  if (freeMb === undefined) return undefined;
  return `${gb(Math.max(0, freeMb))} GB`;
}

/** `1.4`; a whole number keeps its decimal so the pair reads as a scale. */
function gb(mb: number): string {
  return (mb / MB_PER_GB).toFixed(1);
}

/** `8` rather than `8.0` for the total, which is the size of the part. */
function trimGb(mb: number): string {
  const value = mb / MB_PER_GB;
  return Number.isInteger(Math.round(value * 10) / 10) ? String(Math.round(value)) : value.toFixed(1);
}

/**
 * How many bytes a second of recorded audio takes on this pendant.
 *
 * Measured, not assumed: every file this phone has pulled carries both its
 * size and its duration, so the ratio is a fact about this device and this
 * firmware. Files shorter than a few seconds are ignored — a header is a
 * large fraction of one, and they would bias the rate upwards.
 */
export function bytesPerSecond(
  entries: { sizeBytes: number; durationSeconds: number }[],
): number | undefined {
  let bytes = 0;
  let seconds = 0;
  for (const entry of entries) {
    if (entry.durationSeconds < 5 || entry.sizeBytes <= 0) continue;
    bytes += entry.sizeBytes;
    seconds += entry.durationSeconds;
  }
  if (seconds < 60) return undefined;
  return bytes / seconds;
}

/** Hours of recording that would fit in `mb`, at a measured rate. */
export function hoursForMb(mb: number | undefined, rate: number | undefined): number | undefined {
  if (mb === undefined || rate === undefined || rate <= 0) return undefined;
  const hours = (mb * 1024 * 1024) / rate / 3600;
  return Number.isFinite(hours) ? hours : undefined;
}

/**
 * `6.6 GB · ≈14 H`, or just `6.6 GB` when no rate has been measured yet —
 * canvas P2's `ROOM LEFT` row.
 */
export function roomLeftLabel(freeMb?: number, rate?: number): string | undefined {
  const free = freeLabel(freeMb);
  if (!free) return undefined;
  const hours = hoursForMb(freeMb, rate);
  if (hours === undefined || hours < 1) return free;
  return `${free} · ≈${Math.round(hours)} H`;
}

// -- what is waiting -------------------------------------------------------

/** `48 MIN`, `11 H`, `2 H 20 MIN` — a duration in the canvas' mono. */
export function durationLabel(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'UNDER 1 MIN';
  if (minutes < 60) return `${minutes} MIN`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} H` : `${hours} H ${rest} MIN`;
}

/** The audio on this phone that has not reached the account yet. */
export function unsyncedSeconds(entries: { durationSeconds: number }[]): number {
  return entries.reduce((total, entry) => total + Math.max(0, entry.durationSeconds), 0);
}

// -- which of the three screens --------------------------------------------

/**
 * P1, P2 or P3 — and `none` when there is no pendant to describe at all.
 *
 * `full` outranks `away`: a pendant that has stopped recording is a worse
 * fact than a pendant that cannot reach the phone, and the way out of it is
 * different. It is judged on free space rather than on a fraction, because
 * "under a hundred megabytes" is when this device actually stops.
 */
export type PendantView = 'none' | 'connected' | 'away' | 'full';

/** Below this the pendant has no room for another file. */
export const FULL_MB = 100;

export function pendantView(input: {
  paired: boolean;
  connected: boolean;
  freeMb?: number;
  totalMb?: number;
}): PendantView {
  if (!input.paired) return 'none';
  const known = input.totalMb !== undefined && input.freeMb !== undefined;
  if (known && (input.freeMb as number) < FULL_MB) return 'full';
  return input.connected ? 'connected' : 'away';
}

/** `ALL SYNCED TO THIS PHONE · 09:38`, or the honest absence of one. */
export function syncedLine(lastSyncAt: string | undefined, pending: number): string | undefined {
  if (pending > 0) return `${pending} WAITING TO UPLOAD`;
  if (!lastSyncAt) return 'NOTHING SYNCED YET';
  const at = new Date(lastSyncAt);
  if (Number.isNaN(at.getTime())) return 'NOTHING SYNCED YET';
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `ALL SYNCED TO THIS PHONE · ${hh}:${mm}`;
}

/** `YLF20 · CONNECTED`, `YLF20 · LAST SEEN 10:52`, `YLF20 · 8 / 8 GB`. */
export function pendantMeta(
  view: PendantView,
  input: { name?: string; lastSeenAt?: string; freeMb?: number; totalMb?: number },
): (string | undefined)[] {
  const name = input.name?.toUpperCase();
  switch (view) {
    case 'connected':
      return [name, 'CONNECTED'];
    case 'away':
      return [name, lastSeen(input.lastSeenAt)];
    case 'full': {
      const total = input.totalMb !== undefined ? `${trimGb(input.totalMb)} / ${trimGb(input.totalMb)} GB` : undefined;
      return [name, total];
    }
    default:
      return [name];
  }
}

function lastSeen(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `LAST SEEN ${hh}:${mm}`;
}
