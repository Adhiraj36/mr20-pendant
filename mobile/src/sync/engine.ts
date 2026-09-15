/**
 * Sync engine: pendant -> phone -> backend.
 *
 * A pass does what mr20sync.py did, in the same order and for the same reasons:
 *
 *   1. list every folder and file on the device
 *   2. skip anything the local manifest already holds at the right size
 *   3. stop any in-progress recording, because file transfers and the live
 *      audio stream share one notify characteristic and downloading while
 *      recording interleaves the two into a corrupt file
 *   4. pull each file, leaving a gap between transfers because the device
 *      drops requests that arrive back to back
 *   5. restart recording
 *   6. upload to S3, which triggers transcription server-side
 *
 * Steps 1-5 need the BLE link. Step 6 does not, and is retried separately so a
 * pass that got the audio off the device is never wasted by a flaky network.
 */
import { Mr20Client, delay } from '../ble/client';
import { deviceFileToIso, type DeviceFile } from '../ble/protocol';
import { api } from '../api/client';
import { uploadAudio } from '../api/client';
import * as library from './library';
import { WifiSession, WIFI_MIN_BYTES, wifiTransferAvailable } from './wifi';
import { analyzeSpeech } from './vad';

/** The device drops transfer requests issued back to back. */
const TRANSFER_GAP_MS = 2000;

export interface SyncProgress {
  phase: 'listing' | 'pausing' | 'wifi' | 'pulling' | 'uploading' | 'resuming' | 'idle' | 'done';
  /** Which file is in flight, if any. */
  file?: string;
  /** Position in the queue, 1-based. */
  index?: number;
  total?: number;
  /** Bytes of the current file. */
  received?: number;
  expected?: number;
  message?: string;
}

export interface SyncResult {
  pulled: number;
  uploaded: number;
  skipped: number;
  failed: number;
  /** Confidently-silent recordings discarded on the phone and the pendant. */
  discarded: number;
  bytes: number;
  errors: string[];
}

export type ProgressHandler = (progress: SyncProgress) => void;

export interface SyncOptions {
  onProgress?: ProgressHandler;
  signal?: AbortSignal;
  /** Never start a recording the user did not ask for. */
  passive?: boolean;
  /** Device MAC, recorded against each upload. */
  mac: string;
}

/**
 * Pull everything new off the pendant.
 *
 * Recording state is restored even if a transfer throws: leaving the pendant
 * stopped because a sync failed would silently cost the user every conversation
 * until they next opened the app.
 */
export async function pullFromDevice(
  client: Mr20Client,
  options: SyncOptions,
): Promise<{ fetched: library.LibraryEntry[]; result: SyncResult }> {
  const { onProgress, signal } = options;
  const result: SyncResult = { pulled: 0, uploaded: 0, skipped: 0, failed: 0, discarded: 0, bytes: 0, errors: [] };
  const fetched: library.LibraryEntry[] = [];

  onProgress?.({ phase: 'listing' });
  const files = await client.listAllFiles();

  const pending: DeviceFile[] = [];
  for (const file of files) {
    if (await library.have(file.folder, file.name, file.sizeBytes)) {
      result.skipped++;
    } else {
      pending.push(file);
    }
  }

  if (!pending.length) {
    onProgress?.({ phase: 'done', message: 'Already up to date' });
    return { fetched, result };
  }

  onProgress?.({ phase: 'pausing' });
  const wasRecording = await client.pauseRecording();

  // The AP session opens lazily, on the first file big enough to justify it,
  // and one session serves every large file in the pass. Any WiFi failure
  // downgrades the file (and the rest of the pass) to BLE — the pass never
  // fails because the fast path did.
  let wifi: WifiSession | null = null;
  let wifiDead = !wifiTransferAvailable();
  // Say so. The fast path being unavailable downgrades every file to BLE
  // silently and correctly, which is indistinguishable from it simply never
  // being worth taking — and that quiet is what hid a broken WiFi path for as
  // long as it did.
  if (wifiDead) console.log('sync: WiFi transfer unavailable — every file goes over BLE');

  // Both paths report the same shape, so the bar behaves identically whether
  // a file came over WiFi or BLE.
  const pullOne = async (file: DeviceFile, index: number): Promise<Uint8Array> => {
    const report = (received: number, expected: number) =>
      onProgress?.({
        phase: 'pulling',
        file: file.name,
        index: index + 1,
        total: pending.length,
        received,
        expected,
      });

    if (!wifiDead && file.sizeBytes >= WIFI_MIN_BYTES) {
      try {
        if (!wifi) {
          onProgress?.({ phase: 'wifi', file: file.name, message: 'Switching to the pendant WiFi' });
          wifi = await WifiSession.open(client);
        }
        return await wifi.pull(file.folder, file.name, { signal, onProgress: report });
      } catch (err) {
        // Once WiFi misbehaves, stop paying its setup cost this pass.
        wifiDead = true;
        if (wifi) { await wifi.close().catch(() => undefined); wifi = null; }
        const reason = (err as Error).message;
        console.log(`wifi pull failed, falling back to BLE: ${reason}`);
        // Say it on screen too. The fallback is silent and correct, which is
        // exactly what makes a broken fast path impossible to notice: every
        // sync still works, just slowly, and nobody can say why.
        onProgress?.({
          phase: 'wifi',
          file: file.name,
          message: `WiFi unavailable (${reason}) — continuing over Bluetooth`,
        });
      }
    }
    // Without a progress handler here the bar sat at zero for the whole of
    // every BLE transfer and then jumped to done — and BLE is the path taken
    // whenever WiFi is unavailable, which is to say most of the time.
    return client.pullFile(file.folder, file.name, { signal, onProgress: report });
  };

  // A low-latency link for the duration: the transfers are what this pass is
  // for, and the connection interval is what limits them.
  await client.setFastLink(true).catch(() => undefined);

  try {
    for (const [index, file] of pending.entries()) {
      if (signal?.aborted) break;

      onProgress?.({
        phase: 'pulling',
        file: file.name,
        index: index + 1,
        total: pending.length,
        received: 0,
        expected: file.sizeBytes,
      });

      try {
        const data = await pullOne(file, index);

        // Phone-side speech check: a confidently-silent recording is never
        // stored, never uploaded, and — since the link is ours right now —
        // deleted from the pendant on the spot. Ambiguity keeps the file;
        // Deepgram and the server-side archive remain the second opinion.
        const verdict = await analyzeSpeech(data);
        if (verdict.silent) {
          onProgress?.({ phase: 'pulling', file: file.name, message: 'No speech — discarding' });
          const gone = await client.deleteFile(file.folder, file.name).catch(() => false);
          if (!gone) {
            // It stays on the device and will be re-pulled and re-judged next
            // pass; noting the failure is enough.
            result.errors.push(`${file.name}: silent, but the pendant did not confirm the delete`);
          }
          result.discarded++;
          if (index < pending.length - 1) await delay(TRANSFER_GAP_MS);
          continue;
        }

        const entry = await library.save(file.folder, file.name, data, file.durationSeconds);
        fetched.push(entry);
        result.pulled++;
        result.bytes += data.length;
      } catch (err) {
        // One bad file must not abandon the rest of the queue; it will be
        // retried on the next pass.
        result.failed++;
        result.errors.push(`${file.name}: ${(err as Error).message}`);
      }

      if (index < pending.length - 1) await delay(TRANSFER_GAP_MS);
    }
  } finally {
    // Give the radio back its battery. Raised for the whole pass rather than
    // per file: renegotiating connection parameters briefly disturbs the link,
    // and doing that between every recording would cost more than it saves.
    await client.setFastLink(false).catch(() => undefined);
    // Leave the pendant's network before anything needs the real one — the
    // uploads that follow this pass are dead until the phone is back on it.
    if (wifi) await (wifi as WifiSession).close().catch(() => undefined);
    if (wasRecording && !options.passive) {
      onProgress?.({ phase: 'resuming' });
      // Best effort: if this throws the link is already gone, and the device
      // resumes on its own the next time it is woken.
      await client.startRecording().catch(() => undefined);
    }
  }

  return { fetched, result };
}

/**
 * Push anything on disk that the backend does not have yet.
 *
 * Safe to call with no BLE link, and safe to call repeatedly: the backend
 * dedupes on device folder + file name, so a reinstall that lost the manifest
 * re-registers rather than re-transcribing.
 */
export async function uploadPending(
  mac: string,
  onProgress?: ProgressHandler,
  options: { all?: boolean; signal?: AbortSignal } = {},
): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, uploaded: 0, skipped: 0, failed: 0, discarded: 0, bytes: 0, errors: [] };
  const pending = await library.pendingUploads(options);

  for (const [index, entry] of pending.entries()) {
    // Stop means stop: finish nothing further, keep what already landed.
    if (options.signal?.aborted) break;
    const uri = await library.fileUri(entry);
    if (!uri) {
      // On disk according to the manifest but gone from the filesystem.
      result.failed++;
      result.errors.push(`${entry.deviceFile}: local audio missing`);
      continue;
    }

    onProgress?.({
      phase: 'uploading',
      file: entry.deviceFile,
      index: index + 1,
      total: pending.length,
    });

    try {
      const { recording, uploadUrl, alreadyHave } = await api.registerRecording({
        deviceFolder: entry.deviceFolder,
        deviceFile: entry.deviceFile,
        deviceMac: mac,
        startedAt: deviceFileToIso(entry.deviceFile),
        durationSeconds: entry.durationSeconds,
        sizeBytes: entry.sizeBytes,
      });

      if (alreadyHave || !uploadUrl) {
        await library.markUploaded(entry.deviceFolder, entry.deviceFile, recording.recordingId);
        result.skipped++;
        continue;
      }

      await uploadAudio(uploadUrl, uri, (sent, total) =>
        onProgress?.({
          phase: 'uploading',
          file: entry.deviceFile,
          index: index + 1,
          total: pending.length,
          received: sent,
          expected: total,
        }),
      );

      await api.confirmUpload(recording.recordingId);
      await library.markUploaded(entry.deviceFolder, entry.deviceFile, recording.recordingId);
      result.uploaded++;
      result.bytes += entry.sizeBytes;
    } catch (err) {
      result.failed++;
      result.errors.push(`${entry.deviceFile}: ${(err as Error).message}`);
      // Back off this entry so the automatic flusher does not hammer it.
      await library.recordUploadFailure(entry.deviceFolder, entry.deviceFile);
    }
  }

  return result;
}

export interface CleanupResult {
  deleted: number;
  freedBytes: number;
  /** Files the backend has not confirmed, left untouched. */
  kept: number;
  errors: string[];
}

/**
 * Delete from the pendant every recording the backend has confirmed it holds.
 *
 * `confirmed` keys are `folder/name` of recordings whose status is ready or
 * archived — the two states that mean the audio (or its transcript) is safe
 * server-side. Anything else on the device is kept, unconditionally: this
 * function frees space, it never decides that a recording did not matter.
 *
 * Recording is paused for the same reason a sync pauses it — commands and the
 * live stream share the link — and restarted afterwards unless the user had
 * it off.
 */
export async function freeUpSpace(
  client: Mr20Client,
  confirmed: Set<string>,
  options: { onProgress?: (done: number, total: number, freedBytes: number) => void; passive?: boolean } = {},
): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, freedBytes: 0, kept: 0, errors: [] };

  const files = await client.listAllFiles();
  const deletable = files.filter((f) => confirmed.has(`${f.folder}/${f.name}`));
  result.kept = files.length - deletable.length;
  if (!deletable.length) return result;

  const wasRecording = await client.pauseRecording();
  try {
    for (const [index, file] of deletable.entries()) {
      const ok = await client.deleteFile(file.folder, file.name).catch(() => false);
      if (ok) {
        result.deleted++;
        result.freedBytes += file.sizeBytes;
      } else {
        result.errors.push(`${file.name}: the pendant did not confirm the delete`);
      }
      options.onProgress?.(index + 1, deletable.length, result.freedBytes);
      // The device drops requests issued back to back.
      if (index < deletable.length - 1) await delay(TRANSFER_GAP_MS);
    }
  } finally {
    if (wasRecording && !options.passive) {
      await client.startRecording().catch(() => undefined);
    }
  }
  return result;
}

/** A full pass: pull from the device, then push to the backend. */
export async function syncAll(client: Mr20Client, options: SyncOptions): Promise<SyncResult> {
  const { result } = await pullFromDevice(client, options);
  // The user (or the auto-sync) asked for a pass: try every pending file now.
  const uploads = await uploadPending(options.mac, options.onProgress, {
    all: true,
    signal: options.signal,
  });

  options.onProgress?.({ phase: 'done' });

  return {
    pulled: result.pulled,
    uploaded: uploads.uploaded,
    skipped: result.skipped + uploads.skipped,
    failed: result.failed + uploads.failed,
    discarded: result.discarded,
    bytes: result.bytes,
    errors: [...result.errors, ...uploads.errors],
  };
}
