/**
 * The Library's day grouping and its mono labels — app spec §2.6.
 *
 * "Rows group by the local date of `startedAt`." §9's Lists note asks for a
 * pure function `recordings → { key, heading, meta, items }[]` so the same
 * grouping can back the Library's `SectionList` today and the Mira home's
 * Recent list later. Nothing here imports React or react-native, so the node
 * test runner exercises it directly (the discipline `receiptLogic.ts` set).
 *
 * Month and weekday names are spelled out here rather than taken from
 * `toLocaleDateString`: §2.6 gives the headings as literal copy (`Today`,
 * `Thursday`, `4 Sep`, `4 Sep 2025`) and §7 says screen copy is final, so a
 * device locale must not rewrite them.
 */
import { joinLabel } from '../design/tokens';
import type { Recording, RecordingStatus } from '../api/client';

/** Everything the grouping reads. Structural, so a test needs no API object. */
export interface DayRecord {
  recordingId: string;
  status: RecordingStatus;
  startedAt: string;
  durationSeconds: number;
}

export interface DayGroup<T extends DayRecord = Recording> {
  /** Local calendar day, `YYYY-MM-DD` — the section's stable key. */
  key: string;
  /** `Today` · `Yesterday` · `Thursday` · `4 Sep` · `4 Sep 2025`. */
  heading: string;
  /** `3 CONVERSATIONS · 48M`, the span dropped when nothing is transcribed. */
  meta: string;
  items: T[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local midnight, in milliseconds — the only day boundary the Library knows. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The local calendar day of an ISO instant, `YYYY-MM-DD`. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `09:41` — a local wall clock, 24 hour, for a row's meta and a slip's header. */
export function formatTimeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A duration as the Library prints it: `1H 04M`, `12M`, `48S`. Coarser than
 * `formatDuration` on purpose — §2.6's meta lines never show seconds beside
 * minutes, and a mono label is read at a glance, not counted.
 */
export function formatSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}H ${pad(m)}M`;
  if (m) return `${m}M`;
  return `${s}S`;
}

/** `Today` · `Yesterday` · a weekday within six days · `4 Sep` · `4 Sep 2025`. */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  // A day in the future (clock skew, a pendant whose clock never got set)
  // reads as its date rather than as a weekday nobody can place.
  if (days > 1 && days < 7) return WEEKDAYS[d.getDay()];
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? date : `${date} ${d.getFullYear()}`;
}

/**
 * Groups by local day, newest day first and newest row first inside a day.
 *
 * The list arrives newest-first and pages older, so re-sorting rather than
 * trusting arrival order is what keeps a group correct once a second page
 * lands in a day the first page had already opened.
 */
export function groupByDay<T extends DayRecord>(records: T[], now: Date = new Date()): DayGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = dayKey(record.startedAt);
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }

  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const seconds = sorted.reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
      return {
        key,
        heading: dayHeading(sorted[0].startedAt, now),
        meta: joinLabel([
          `${sorted.length} ${sorted.length === 1 ? 'conversation' : 'conversations'}`,
          seconds > 0 && formatSpan(seconds),
        ]).toUpperCase(),
        items: sorted,
      };
    });
}

export interface LibraryStats {
  /** Everything that is not archived. */
  count: number;
  /** Seconds transcribed — `ready` rows only; a queued one has no length yet. */
  seconds: number;
  /** Still in the pipeline: uploaded or processing. */
  working: number;
}

export function libraryStats(records: DayRecord[]): LibraryStats {
  const live = records.filter((r) => r.status !== 'archived');
  return {
    count: live.length,
    seconds: live
      .filter((r) => r.status === 'ready')
      .reduce((sum, r) => sum + (r.durationSeconds || 0), 0),
    working: live.filter((r) => r.status === 'processing' || r.status === 'uploaded').length,
  };
}

/**
 * `LIBRARY · 42 CONVERSATIONS · 1H 04M TRANSCRIBED · 3 TRANSCRIBING` — every
 * fragment dropped when it is zero, never rendered as an empty token
 * (spec §0.3, §2.6).
 */
export function libraryEyebrow(stats: LibraryStats): string {
  return joinLabel([
    'library',
    stats.count > 0 && `${stats.count} ${stats.count === 1 ? 'conversation' : 'conversations'}`,
    stats.seconds > 0 && `${formatSpan(stats.seconds)} transcribed`,
    stats.working > 0 && `${stats.working} transcribing`,
  ]).toUpperCase();
}

/** `Thu 4 Sep` — the detail header's date stamp, uppercased by its `Label`. */
export function formatDayStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The recording detail's meta line — `THU 4 SEP · 09:41 · 12M · 2 SPEAKERS`
 * (spec §2.7 step 1). The length comes from the player when it knows better
 * than the record does; a queued conversation has neither yet.
 */
export function detailMeta(
  recording: Pick<Recording, 'startedAt' | 'speakerCount'>,
  seconds: number,
): string {
  return joinLabel([
    formatDayStamp(recording.startedAt),
    formatTimeOfDay(recording.startedAt),
    seconds > 0 && formatSpan(seconds),
    !!recording.speakerCount && `${recording.speakerCount} ${recording.speakerCount === 1 ? 'speaker' : 'speakers'}`,
  ]).toUpperCase();
}

/**
 * A filed row's meta line — `09:41 · 12M · 2 SPEAKERS · WORK · 2 TASKS`
 * (spec §2.6, "Row — filed"). An archived conversation ends on why it is
 * there and how long it has; a failed one has `· FAILED` appended by the
 * screen instead, because that fragment is the only one in `danger`.
 */
export function filedRowMeta(
  recording: Pick<Recording, 'startedAt' | 'durationSeconds' | 'speakerCount' | 'status' | 'actionItems'>,
  categoryName?: string,
): string {
  const tasks = recording.actionItems?.length ?? 0;
  return joinLabel([
    formatTimeOfDay(recording.startedAt),
    recording.durationSeconds > 0 && formatSpan(recording.durationSeconds),
    !!recording.speakerCount && `${recording.speakerCount} ${recording.speakerCount === 1 ? 'speaker' : 'speakers'}`,
    categoryName,
    tasks > 0 && `${tasks} ${tasks === 1 ? 'task' : 'tasks'}`,
    recording.status === 'archived' && 'no speech',
    recording.status === 'archived' && 'gone in 30 days',
  ]).toUpperCase();
}
