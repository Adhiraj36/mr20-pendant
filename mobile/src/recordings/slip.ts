/**
 * A conversation, as a receipt — app spec §2.6, "Row — printing".
 *
 * This is where the plan's "each task and fact is a receipt row" becomes
 * literal: the facts the pipeline returns (`speakerCount`, `durationSeconds`,
 * `categoryId`) and the action items it extracted are turned into
 * `ReceiptRowSpec`s and nothing else. Pure — no React, no react-native — so
 * the node test runner exercises it directly.
 *
 * Only fields the `/recordings` API actually returns are read; a fragment
 * with nothing behind it is dropped rather than printed empty (spec §0.3).
 */
import type { ReceiptRowSpec } from '../design/receiptLogic';
import type { ActionItem, Recording, RecordingStatus } from '../api/client';
import { formatSpan, formatTimeOfDay } from './grouping';

/** The most task rows a slip prints before it starts counting (spec §2.6). */
export const MAX_TASK_ROWS = 4;

/** The slip's own header: `LYZN · 09:41`, the conversation's start. */
export function slipTitle(startedAt: string): string {
  const clock = formatTimeOfDay(startedAt);
  return clock ? `LYZN · ${clock}` : 'LYZN';
}

/**
 * The open row of a slip that is still printing: its key is the status and
 * it has no value, so the leader runs to the edge (spec §2.6, §3.3).
 */
export function openRowKey(status: RecordingStatus): string | null {
  switch (status) {
    case 'pending': return 'ON PHONE';
    case 'uploaded': return 'QUEUED';
    case 'processing': return 'TRANSCRIBING';
    default: return null;
  }
}

/** `SPEAKERS … 2` · `LENGTH … 12M` · `FILED UNDER … WORK`. */
export function slipFacts(
  recording: Pick<Recording, 'speakerCount' | 'durationSeconds'>,
  categoryName?: string,
): ReceiptRowSpec[] {
  const rows: ReceiptRowSpec[] = [];
  if (recording.speakerCount) rows.push({ k: 'SPEAKERS', v: String(recording.speakerCount) });
  if (recording.durationSeconds) rows.push({ k: 'LENGTH', v: formatSpan(recording.durationSeconds) });
  if (categoryName) rows.push({ k: 'FILED UNDER', v: categoryName.toUpperCase() });
  return rows;
}

/**
 * One `plain` row per action item — the item's own words, sentence case,
 * with the owner at the right (or `—` when diarization never attributed it).
 * Four at most, then `+ 2 MORE`: a slip in a list is proof, not the record.
 */
export function slipTasks(
  items: ActionItem[] | undefined,
  speakerName: (index: number) => string,
): ReceiptRowSpec[] {
  if (!items?.length) return [];
  const rows: ReceiptRowSpec[] = items.slice(0, MAX_TASK_ROWS).map((item) => ({
    k: item.text,
    v: item.owner !== null && item.owner !== undefined ? speakerName(item.owner) : '—',
    plain: true,
  }));
  const rest = items.length - rows.length;
  if (rest > 0) rows.push({ k: `+ ${rest} MORE` });
  return rows;
}

/** `TXN 3F9A2B1C` — the last eight characters of the id, uppercased. */
export function slipFooter(recordingId: string): string {
  return `TXN ${recordingId.slice(-8).toUpperCase()}`;
}
