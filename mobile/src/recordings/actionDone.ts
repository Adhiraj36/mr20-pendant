/**
 * `[ACTION_DONE_API]` — app spec §0.3, decision D4.
 *
 * `PATCH /recordings/{id}` accepts title, tags, speakers and categoryId; it
 * has no `actionItems[].done`. Until it does, a ticked action item lives on
 * this phone, keyed `${recordingId}:${index}` exactly as the spec writes it
 * (under the app's `pendant.` AsyncStorage namespace), and the detail screen
 * says so in a `label-sm` line beneath the list.
 *
 * Delete this file — and the line — the day the field exists.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const NAMESPACE = 'pendant.action.';

const storageKey = (recordingId: string, index: number) => `${NAMESPACE}${recordingId}:${index}`;

/**
 * The ticked state of a conversation's action items, in list order.
 *
 * One `multiGet` rather than a read per item: an unread key is simply not
 * done, so a storage failure degrades to "nothing ticked" rather than to an
 * error the screen would have to show.
 */
export async function loadActionDone(recordingId: string, count: number): Promise<boolean[]> {
  if (count <= 0) return [];
  const keys = Array.from({ length: count }, (_, i) => storageKey(recordingId, i));
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    const byKey = new Map(pairs);
    return keys.map((key) => byKey.get(key) === '1');
  } catch {
    return keys.map(() => false);
  }
}

/**
 * How many of each conversation's items are ticked, for a whole list.
 *
 * One `multiGet` across every recording on Home rather than one read per
 * row: the `n DONE ✓` chip is the only reason the list needs this, and a
 * chip is not worth a hundred round trips to storage. Anything that cannot
 * be read is simply not done.
 */
export async function loadDoneCounts(
  records: { recordingId: string; actionItems?: unknown[] }[],
): Promise<Record<string, number>> {
  const keys: string[] = [];
  const owner = new Map<string, string>();
  for (const record of records) {
    const count = record.actionItems?.length ?? 0;
    for (let i = 0; i < count; i++) {
      const key = storageKey(record.recordingId, i);
      keys.push(key);
      owner.set(key, record.recordingId);
    }
  }
  if (!keys.length) return {};

  const counts: Record<string, number> = {};
  try {
    for (const [key, value] of await AsyncStorage.multiGet(keys)) {
      if (value !== '1') continue;
      const id = owner.get(key);
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
  } catch {
    // No ticks readable is the same answer as no ticks.
  }
  return counts;
}

/** Writes one item's state. Untick removes the key rather than storing a `0`. */
export async function saveActionDone(
  recordingId: string,
  index: number,
  done: boolean,
): Promise<void> {
  const key = storageKey(recordingId, index);
  try {
    if (done) await AsyncStorage.setItem(key, '1');
    else await AsyncStorage.removeItem(key);
  } catch {
    // A checkbox that cannot be remembered is not worth an alert; the tick
    // still shows for this visit.
  }
}

/** Forgets a conversation's ticks — called when the conversation is deleted. */
export async function forgetActionDone(recordingId: string, count: number): Promise<void> {
  if (count <= 0) return;
  try {
    await AsyncStorage.multiRemove(
      Array.from({ length: count }, (_, i) => storageKey(recordingId, i)),
    );
  } catch {
    // Orphan keys are harmless: they are only ever read back by id.
  }
}
