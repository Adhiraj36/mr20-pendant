/**
 * On-device library of recordings pulled off the pendant.
 *
 * The audio is written to the app's document directory and a manifest in
 * AsyncStorage records what has already been fetched and uploaded, so a sync
 * pass never re-pulls a file it already has. This mirrors what mr20sync.py did
 * with a JSON file next to the audio.
 */
import { Directory, File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MANIFEST_KEY = 'pendant.manifest.v1';
const ROOT = 'recordings';

export interface LibraryEntry {
  deviceFolder: string;
  deviceFile: string;
  /** Path relative to the document directory. */
  path: string;
  sizeBytes: number;
  durationSeconds: number;
  fetchedAt: string;
  /** Set once the backend has issued an id for it. */
  recordingId?: string;
  uploadedAt?: string;
  /** Consecutive failed upload attempts; cleared on success. */
  attempts?: number;
  /** Epoch ms before which flushUploads must not try this entry again. */
  nextAttemptAt?: number;
}

export type Manifest = Record<string, LibraryEntry>;

export const entryKey = (folder: string, file: string) => `${folder}/${file}`;

let cache: Manifest | null = null;

export async function loadManifest(): Promise<Manifest> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(MANIFEST_KEY);
  try {
    cache = raw ? (JSON.parse(raw) as Manifest) : {};
  } catch {
    // A corrupt manifest only costs a re-sync; the audio on the device is intact.
    cache = {};
  }
  return cache;
}

async function persist(manifest: Manifest): Promise<void> {
  cache = manifest;
  await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
}

function fileFor(folder: string, name: string): File {
  return new File(Paths.document, ROOT, folder, `${name}.mp3`);
}

/** Local URI for a recording the app has pulled, or null if it is not held. */
export async function localUri(folder: string, name: string): Promise<string | null> {
  const manifest = await loadManifest();
  const entry = manifest[entryKey(folder, name)];
  if (!entry) return null;
  const file = fileFor(folder, name);
  return file.exists ? file.uri : null;
}

/**
 * Whether this device file needs no pull.
 *
 * Two ways to already have it: the audio is on disk at the size the device
 * reports, or it was uploaded — the backend's copy counts, and the local one
 * being pruned afterwards must not turn every future sync into a re-pull of
 * the whole pendant (which is exactly what it did: prune freed the space,
 * have() saw no file, and the same conversations transferred again at BLE
 * speed on every pass).
 *
 * The size check catches a transfer that was cut short by a disconnect,
 * which would otherwise look complete in the manifest.
 */
export async function have(folder: string, name: string, sizeBytes: number): Promise<boolean> {
  const manifest = await loadManifest();
  const entry = manifest[entryKey(folder, name)];
  if (!entry || entry.sizeBytes !== sizeBytes) return false;

  if (entry.uploadedAt) return true;

  const file = fileFor(folder, name);
  return file.exists && file.size === sizeBytes;
}

export async function save(
  folder: string,
  name: string,
  data: Uint8Array,
  durationSeconds: number,
): Promise<LibraryEntry> {
  new Directory(Paths.document, ROOT, folder).create({ intermediates: true, idempotent: true });

  const file = fileFor(folder, name);
  if (file.exists) file.delete();
  file.create();
  file.write(data);

  const entry: LibraryEntry = {
    deviceFolder: folder,
    deviceFile: name,
    path: `${ROOT}/${folder}/${name}.mp3`,
    sizeBytes: data.length,
    durationSeconds,
    fetchedAt: new Date().toISOString(),
  };

  const manifest = await loadManifest();
  manifest[entryKey(folder, name)] = entry;
  await persist(manifest);
  return entry;
}

/**
 * Take a file the phone recorded and file it as a library entry, in place.
 *
 * `save` writes bytes, which is right for a pendant transfer that arrives as
 * bytes over Bluetooth. A phone recording is already a file on disk and can
 * be an hour long, so reading it into memory to write it out again would be
 * a lot of megabytes for nothing. This moves it instead, and then the entry
 * looks like any other: the same manifest, the same upload retry, the same
 * pruning once the account has it.
 */
export async function adopt(
  folder: string,
  name: string,
  uri: string,
  durationSeconds: number,
): Promise<LibraryEntry> {
  new Directory(Paths.document, ROOT, folder).create({ intermediates: true, idempotent: true });

  const source = new File(uri);
  const destination = fileFor(folder, name);
  if (destination.exists) destination.delete();
  source.move(destination);

  const entry: LibraryEntry = {
    deviceFolder: folder,
    deviceFile: name,
    path: `${ROOT}/${folder}/${name}.mp3`,
    sizeBytes: destination.size ?? 0,
    durationSeconds,
    fetchedAt: new Date().toISOString(),
  };

  const manifest = await loadManifest();
  manifest[entryKey(folder, name)] = entry;
  await persist(manifest);
  return entry;
}

export async function markUploaded(
  folder: string,
  name: string,
  recordingId: string,
): Promise<void> {
  const manifest = await loadManifest();
  const entry = manifest[entryKey(folder, name)];
  if (!entry) return;
  entry.recordingId = recordingId;
  entry.uploadedAt = new Date().toISOString();
  delete entry.attempts;
  delete entry.nextAttemptAt;
  await persist(manifest);
}

/** Cap the backoff: half an hour between tries, however broken the file is. */
const MAX_BACKOFF_MS = 30 * 60_000;

/**
 * Record a failed upload attempt: the entry backs off exponentially
 * (2, 4, 8... minutes) so one broken file cannot hammer the network on every
 * flush while the rest of the queue still moves.
 */
export async function recordUploadFailure(folder: string, name: string): Promise<void> {
  const manifest = await loadManifest();
  const entry = manifest[entryKey(folder, name)];
  if (!entry) return;
  const attempts = (entry.attempts ?? 0) + 1;
  entry.attempts = attempts;
  entry.nextAttemptAt = Date.now() + Math.min(2 ** attempts * 60_000, MAX_BACKOFF_MS);
  await persist(manifest);
}

/**
 * Entries that are on disk, not yet uploaded, and due for a try. `all` skips
 * the backoff gate — a user-initiated sync means "try everything now".
 */
export async function pendingUploads(options: { all?: boolean } = {}): Promise<LibraryEntry[]> {
  const manifest = await loadManifest();
  const now = Date.now();
  return Object.values(manifest).filter(
    (e) => !e.uploadedAt && (options.all || !e.nextAttemptAt || e.nextAttemptAt <= now),
  );
}

export async function fileUri(entry: LibraryEntry): Promise<string | null> {
  const file = fileFor(entry.deviceFolder, entry.deviceFile);
  return file.exists ? file.uri : null;
}

/**
 * Free space taken by audio the backend already has.
 *
 * The pendant keeps its own copy and the backend keeps another, so once a
 * recording is uploaded and transcribed the phone's copy is only a playback
 * cache. Called with the ids the backend confirms are `ready`.
 */
export async function pruneUploaded(readyIds: Set<string>): Promise<number> {
  const manifest = await loadManifest();
  let freed = 0;

  for (const entry of Object.values(manifest)) {
    if (!entry.recordingId || !readyIds.has(entry.recordingId)) continue;
    const file = fileFor(entry.deviceFolder, entry.deviceFile);
    if (!file.exists) continue;
    freed += file.size ?? 0;
    file.delete();
  }
  // Entries are kept (their uploadedAt is what stops a re-pull), so nothing was
  // freed means nothing changed — skip the write. This is now run after every
  // recordings load, so the common no-op case must stay cheap.
  if (freed > 0) await persist(manifest);
  return freed;
}

export async function totalLocalBytes(): Promise<number> {
  const manifest = await loadManifest();
  let total = 0;
  for (const entry of Object.values(manifest)) {
    const file = fileFor(entry.deviceFolder, entry.deviceFile);
    if (file.exists) total += file.size ?? 0;
  }
  return total;
}

/** Wipe the local cache. The pendant and the backend both keep their copies. */
export async function clearLibrary(): Promise<void> {
  const dir = new Directory(Paths.document, ROOT);
  if (dir.exists) dir.delete();
  await AsyncStorage.removeItem(MANIFEST_KEY);
  cache = {};
}
