/**
 * What the tasks and receipts screens decide, with no React around them.
 *
 * Which face a card wears, how the list is grouped, what a selection costs,
 * what a receipt's rows read as, how the roll is cut into days, and what — if
 * anything — the effort card may honestly claim. All of it is numbers and
 * strings, so `node --test` asks these directly and the screens only render.
 *
 * Two rules run through the file:
 *
 * 1. **Nothing is invented.** The backend's task row has no amount and no
 *    owner *name* — `owner` is a diarizer index. So an amount is read out of
 *    what was actually said (`taskAmount`), and where there is no name there
 *    is no fragment: `metaLine` drops it rather than printing a token.
 * 2. **`features.execution` decides the vocabulary, not the layout.** With
 *    execution off nothing can act, so every verb goes conditional ("WOULD
 *    SEND A MESSAGE") and the cards that describe acting are not rendered at
 *    all — see `[EXECUTION]` in the plan's slot table.
 */
import { money } from '@lyzn/design';
import {
  taskKindLabel, metaLine, countLabel, receiptClock,
  taskCardState as cardStateForStatus,
  type TaskCardState,
} from '../design/kit/models';
import type { ReceiptRowSpec } from '../design/receiptLogic';
import type { Task, TaskKind, TaskStatus } from '../api/tasks';
import type { Receipt } from '../api/receipts';

export type { TaskCardState };

/** The flags the screens read. Everything but `execution` is somebody else's. */
export interface Features {
  execution: boolean;
}

/** The narrowest thing these functions need — so a fixture is not a `Task`. */
export interface TaskShape {
  taskId: string;
  text: string;
  kind: TaskKind;
  status: TaskStatus;
  quote?: string;
  createdAt: string;
  doneAt?: string;
  receiptId?: string;
}

// -- the card --------------------------------------------------------------

/**
 * The face a task wears, given the tier.
 *
 * The kit answers this from a status; this takes the task itself, because
 * every call site here has one and passing `task.status` at nine of them is
 * nine chances to pass the wrong task's.
 */
export function taskCardState(
  task: Pick<TaskShape, 'status'>,
  features: Features,
): TaskCardState {
  return cardStateForStatus(task.status, { execution: features.execution });
}

/**
 * The one action a task card offers, from its face alone — `undefined` for the
 * faces that offer nothing to tap (running, done, failed).
 *
 * Kept beside taskCardState so a card's button is chosen from its state rather
 * than by hand at the call site: a `waiting` card approves, a `blocked` card
 * answers the question that parked it, a `capture` card is yours to mark done.
 * The button had once been wired to "select" for a waiting card, so APPROVE
 * selected the task and never approved it; this and its test keep that from
 * coming back.
 */
export type TaskCardAction = 'markDone' | 'approve' | 'answer';

export function taskCardAction(state: TaskCardState): TaskCardAction | undefined {
  switch (state) {
    case 'capture': return 'markDone';
    case 'waiting': return 'approve';
    case 'blocked': return 'answer';
    default: return undefined;
  }
}

/** Open business: still waiting on somebody. */
export function isOpen(task: Pick<TaskShape, 'status'>): boolean {
  return task.status === 'proposed' || task.status === 'approved' || task.status === 'blocked';
}

export interface TaskGroups {
  /** Waiting on you — the gate, and the reason the segment exists. */
  open: Task[];
  /** Tried and stopped. Only ever non-empty under execution (`[EXECUTION]`). */
  failed: Task[];
  /** Kept: done, with a receipt to prove it. */
  settled: Task[];
  /**
   * Dropped. Kept apart from `settled` because the kit's done card wears
   * `DONE ✓`, and a dismissed promise wearing that would be a lie; the
   * segment counts these rather than drawing them, and the detail screen —
   * which a deep link can still reach — says `DROPPED` in full.
   */
  dropped: Task[];
}

/**
 * The list, cut into the blocks the screen draws, newest first inside each.
 * Sorting here rather than trusting arrival order is what keeps a group
 * correct once a second page lands among rows the first page already had.
 */
export function groupTasks(tasks: Task[]): TaskGroups {
  const byNewest = (a: Task, b: Task) => b.createdAt.localeCompare(a.createdAt);
  return {
    open: tasks.filter(isOpen).sort(byNewest),
    failed: tasks.filter((t) => t.status === 'failed').sort(byNewest),
    settled: tasks.filter((t) => t.status === 'done').sort(byNewest),
    dropped: tasks.filter((t) => t.status === 'dismissed').sort(byNewest),
  };
}

/** How many are waiting on you — the number the segment label carries. */
export function waitingCount(tasks: Task[]): number {
  return tasks.filter((t) => isOpen(t) || t.status === 'failed').length;
}

// -- the honest eyebrow ----------------------------------------------------

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const sameDay = (iso: string, now: Date) => {
  const at = new Date(iso);
  return !Number.isNaN(at.getTime()) && startOfDay(at) === startOfDay(now);
};

/**
 * Canvas T0's red line: `3 THINGS YOU PROMISED TODAY · NONE OF THEM DONE`.
 *
 * Every fragment is counted, never assumed. `TODAY` is only said when every
 * promise counted was in fact made today; a list carrying older ones drops
 * the word rather than lying about the day. A dropped task is not a promise
 * kept and not a promise outstanding, so it leaves the count entirely.
 */
export function promiseEyebrow(
  tasks: Pick<TaskShape, 'status' | 'createdAt'>[],
  now: Date = new Date(),
): string | undefined {
  const counted = tasks.filter((t) => t.status !== 'dismissed');
  if (counted.length === 0) return undefined;
  const done = counted.filter((t) => t.status === 'done').length;
  const today = counted.every((t) => sameDay(t.createdAt, now));
  const noun = counted.length === 1 ? 'THING' : 'THINGS';
  const head = `${counted.length} ${noun} YOU PROMISED${today ? ' TODAY' : ''}`;
  const verdict = done === 0
    ? 'NONE OF THEM DONE'
    : done === counted.length
      ? (counted.length === 1 ? 'AND IT IS DONE' : 'ALL OF THEM DONE')
      : `${done} OF THEM DONE`;
  return metaLine([head, verdict]);
}

// -- money -----------------------------------------------------------------

/**
 * The amount a promise names, read out of the promise.
 *
 * The task row carries no amount — the canvas' `SPENDS ₹540` has to come from
 * somewhere, and the only honest source is the words themselves. So this
 * looks in the task's own text and then in what was said, and returns what it
 * finds *verbatim*: `₹41.20` stays `₹41.20`. Finding nothing is the common
 * case and returns nothing, which drops the fragment from every line it
 * would have joined.
 */
const AMOUNT = /(?:₹|\bRS\.?|\bINR)\s?(\d[\d,]*(?:\.\d{1,2})?)/i;

export function taskAmount(
  task: Pick<TaskShape, 'text' | 'quote'>,
): { text: string; value: number } | undefined {
  for (const source of [task.text, task.quote]) {
    const hit = source ? AMOUNT.exec(source) : null;
    if (!hit) continue;
    const value = Number(hit[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    return { text: `₹${hit[1]}`, value };
  }
  return undefined;
}

/** The nouns a selection is counted in. */
const KIND_NOUN: Record<TaskKind, [string, string]> = {
  message: ['MESSAGE', 'MESSAGES'],
  spend: ['SPEND', 'SPENDS'],
  file: ['FILE', 'FILES'],
  reminder: ['REMINDER', 'REMINDERS'],
  other: ['THING', 'THINGS'],
};

const KIND_ORDER: TaskKind[] = ['message', 'spend', 'file', 'reminder', 'other'];

/**
 * Canvas T1: `2 SELECTED · ₹540 · 1 MESSAGE` — what this costs, stated
 * before the button that commits to it.
 *
 * A spend that names an amount is represented *by* that amount rather than
 * counted twice, which is why the canvas' two selected tasks read as one
 * total and one message. A spend that names no amount is counted like any
 * other kind, because saying nothing about it would be worse than saying
 * `1 SPEND`.
 */
export function selectionSummary(
  tasks: Pick<TaskShape, 'kind' | 'text' | 'quote'>[],
): string {
  if (tasks.length === 0) return '';
  const amounts = tasks
    .map((t) => (t.kind === 'spend' ? taskAmount(t) : undefined))
    .filter((a): a is { text: string; value: number } => !!a);
  const total = amounts.length === 0
    ? undefined
    : amounts.length === 1
      ? amounts[0].text
      : money(amounts.reduce((sum, a) => sum + a.value, 0));

  const counted = tasks.filter((t) => !(t.kind === 'spend' && taskAmount(t)));
  const counts = KIND_ORDER.map((kind) => {
    const [singular, plural] = KIND_NOUN[kind];
    return countLabel(counted.filter((t) => t.kind === kind).length, singular, plural);
  });

  return metaLine([`${tasks.length} SELECTED`, total, ...counts]);
}

/** A task card's eyebrow, with the amount the promise named. */
export function taskEyebrowFor(
  task: Pick<TaskShape, 'kind' | 'text' | 'quote'>,
  features: Features,
): string {
  const capture = !features.execution;
  const amount = task.kind === 'spend' ? taskAmount(task)?.text : undefined;
  const verb = taskKindLabel(task.kind, { capture });
  return amount ? `${verb} ${amount}` : verb;
}

/**
 * Canvas T2's eyebrow — `WAITING FOR YOU · SENDS A MESSAGE`, and what it has
 * to become when nothing can act: `WAITING FOR YOU · WOULD SEND A MESSAGE`.
 */
export function taskDetailEyebrow(
  task: Pick<TaskShape, 'kind' | 'status' | 'text' | 'quote'>,
  features: Features,
): string {
  const kind = taskEyebrowFor(task, features);
  switch (task.status) {
    case 'done': return metaLine(['DONE', kind]);
    case 'dismissed': return metaLine(['DROPPED', kind]);
    case 'failed': return metaLine(["DIDN'T GO THROUGH", kind]);
    case 'approved': return metaLine([features.execution ? 'RUNNING' : 'WAITING FOR YOU', kind]);
    default: return metaLine(['WAITING FOR YOU', kind]);
  }
}

// -- dates -----------------------------------------------------------------

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** `TUE 04 SEP` — the canvas' own day stamp, zero-padded so a column lines up. */
export function dayStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return `${WEEKDAYS[at.getDay()]} ${pad(at.getDate())} ${MONTHS[at.getMonth()]}`;
}

/** `04 SEP` — the same stamp without its weekday, for a "since" line. */
export function shortStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return `${pad(at.getDate())} ${MONTHS[at.getMonth()]}`;
}

/** The local calendar day of an instant, `YYYY-MM-DD`. */
export function dayKey(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `11:04` — a wall clock, 24 hour, because this is a log and not a locale. */
export function clock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * The instant a promise was made: the conversation's start plus the offset of
 * the line it was matched to. Without a matched line the conversation's own
 * start is the honest answer — it is when this was said, to the minute the
 * app can actually stand behind.
 */
export function utteranceAt(startedAt: string, offsetSeconds?: number): string {
  const at = new Date(startedAt);
  if (Number.isNaN(at.getTime())) return startedAt;
  if (!offsetSeconds || offsetSeconds < 0) return startedAt;
  return new Date(at.getTime() + Math.round(offsetSeconds) * 1000).toISOString();
}

/**
 * Canvas T2's link back into the conversation: `QUOTE REVIEW WITH RAVI ·
 * 11:08`. Either fragment may be missing — an untitled recording, a task the
 * matcher could not place — and a missing one is dropped, never a token.
 */
export function sourceLine(title?: string, at?: string): string {
  return metaLine([title?.trim().toUpperCase(), at && clock(at)]);
}

// -- receipts --------------------------------------------------------------

/** `#0412` — the tail of the id, which is how a receipt is referred to. */
export function receiptRef(receiptId: string): string {
  return `#${receiptId.slice(-4).toUpperCase()}`;
}

/** `TXN 1A2B3C4D` — under the barcode, the same shape the library's slip uses. */
export function receiptFooter(receiptId: string): string {
  return `TXN ${receiptId.slice(-8).toUpperCase()}`;
}

/** Keys whose value is a moment, and should print to the second as proof. */
const CLOCK_KEYS = /(DONE|DELIVERED|READ|APPROVED|DRAFTED|SENT|PRINTED)/;

const looksIso = (v: string) => /^\d{4}-\d{2}-\d{2}T/.test(v);

/**
 * A stored receipt's rows, as the slip prints them.
 *
 * The backend stores instants raw (`MARKED DONE · 2026-09-08T11:05:07Z`),
 * because a record keeps the instant and a screen decides how to read it.
 * This is that decision: a verdict line reads to the second, anything else
 * dated reads as a day and a time, and everything else is passed through
 * untouched. The receipt's own title leads as the first row — canvas R1's
 * `TASK · SEND QUOTE` — because the slip's title slot belongs to
 * `LYZN · PROOF OF WORK`.
 */
export function receiptRowsFor(receipt: Pick<Receipt, 'title' | 'rows' | 'kind'>): ReceiptRowSpec[] {
  const head: ReceiptRowSpec[] = receipt.title
    ? [{ k: receipt.kind === 'task' ? 'TASK' : 'PROOF', v: receipt.title, plain: true }]
    : [];
  const rest = (receipt.rows ?? [])
    .filter((row) => row.k && row.v)
    .map((row) => ({
      k: row.k,
      v: looksIso(row.v)
        ? (CLOCK_KEYS.test(row.k) ? receiptClock(row.v) : metaLine([shortStamp(row.v), clock(row.v)]))
        : row.v,
      ...(row.ok ? { ok: true } : {}),
    }));
  return [...head, ...rest].slice(0, 12);
}

/** The two or three lines a roll item shows, chosen from the full set. */
export function receiptCardRows(receipt: Pick<Receipt, 'title' | 'rows' | 'kind'>): ReceiptRowSpec[] {
  const rows = receiptRowsFor(receipt);
  const verdict = rows.filter((r) => r.ok);
  const rest = rows.filter((r) => !r.ok && r.k !== 'TASK' && r.k !== 'PROOF');
  return [...rest.slice(0, 2 - Math.min(verdict.length, 1)), ...verdict.slice(0, 1)];
}

/**
 * The slip as plain text, for the `···` menu's one action.
 *
 * A receipt is proof, and proof that can only be looked at is half of one —
 * this is what somebody pastes into a message to say "here, it happened".
 * Same title, same quote, same rows, in the same order, so the text and the
 * picture agree.
 */
export function receiptAsText(receipt: Receipt, title = 'LYZN · PROOF OF WORK'): string {
  const lines = [title, ''];
  if (receipt.quote) lines.push(`“${receipt.quote}”`, '');
  for (const row of receiptRowsFor(receipt)) {
    lines.push(`${row.k}: ${row.v ?? ''}${row.ok ? ' ✓' : ''}`);
  }
  lines.push('', receiptFooter(receipt.receiptId));
  return lines.join('\n');
}

export interface ReceiptDay {
  key: string;
  /** `TODAY · TUE 04 SEP · 4 KEPT`. */
  heading: string;
  receipts: Receipt[];
}

/**
 * Canvas R2: the roll, cut into days, newest day first and newest slip first
 * inside a day.
 */
export function rollByDay(receipts: Receipt[], now: Date = new Date()): ReceiptDay[] {
  const days = new Map<string, Receipt[]>();
  for (const receipt of receipts) {
    const key = dayKey(receipt.createdAt);
    const bucket = days.get(key);
    if (bucket) bucket.push(receipt);
    else days.set(key, [receipt]);
  }

  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(startOfDay(now) - 86_400_000).toISOString());

  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const relative = key === today ? 'TODAY' : key === yesterday ? 'YESTERDAY' : undefined;
      return {
        key,
        heading: metaLine([relative, dayStamp(sorted[0].createdAt), `${sorted.length} KEPT`]),
        receipts: sorted,
      };
    });
}

/**
 * `34 KEPT · SINCE 04 SEP` — what the roll says about itself when there is no
 * effort figure to show, which on the Capture tier is always.
 */
export function rollMeta(receipts: Receipt[]): string {
  if (receipts.length === 0) return '';
  const oldest = receipts.reduce(
    (min, r) => (r.createdAt < min ? r.createdAt : min),
    receipts[0].createdAt,
  );
  return metaLine([`${receipts.length} KEPT`, `SINCE ${shortStamp(oldest)}`]);
}

// -- the receipt a finished task prints ------------------------------------

/**
 * The slip `POST /tasks/:id/done` writes, mirrored.
 *
 * The real receipt always comes back from the server in that response — this
 * is never used against a live backend. It exists for the fixture path, so
 * that marking a seeded task done on a simulator prints exactly the receipt
 * the server would have, rather than a hand-drawn stand-in that could drift
 * from `ddb.ReceiptFromTask` without anybody noticing. It is kept next to
 * `receiptRowsFor`, which is the thing that reads it back.
 */
export function receiptForDoneTask(
  task: Task,
  options: { receiptId: string; at: string },
): Receipt {
  return {
    receiptId: options.receiptId,
    userId: task.userId,
    kind: 'task',
    taskId: task.taskId,
    recordingId: task.recordingId,
    title: task.text,
    quote: task.quote,
    stamp: 'DONE',
    createdAt: options.at,
    rows: [
      { k: 'KIND', v: task.kind.toUpperCase() },
      { k: 'PROMISED', v: task.createdAt },
      ...(task.dueAt ? [{ k: 'DUE', v: task.dueAt }] : []),
      { k: 'MARKED DONE', v: options.at },
      { k: 'STATUS', v: 'DONE', ok: true },
    ],
  };
}

// -- effort ----------------------------------------------------------------

/** `2h 40m`, `40 MIN`, `6 SECONDS` → minutes. Anything unreadable is zero. */
export function parseMinutes(value: string): number {
  const hours = /(\d+(?:\.\d+)?)\s*(?:H\b|HOURS?\b|HR\b|HRS\b)/i.exec(value);
  const minutes = /(\d+(?:\.\d+)?)\s*(?:M\b|MIN\b|MINS?\b|MINUTES?\b)/i.exec(value);
  const seconds = /(\d+(?:\.\d+)?)\s*(?:S\b|SEC\b|SECS?\b|SECONDS?\b)/i.exec(value);
  const total =
    (hours ? Number(hours[1]) * 60 : 0) +
    (minutes ? Number(minutes[1]) : 0) +
    (seconds ? Number(seconds[1]) / 60 : 0);
  return Number.isFinite(total) ? total : 0;
}

/** `2h 40m`, `40m`, `0m`. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

export interface EffortSaved {
  minutes: number;
  /** `2h 40m`. */
  label: string;
  /** Seven columns, oldest first, each 0..1 — the canvas' bar row. */
  bars: number[];
  /** `THIS WEEK`. */
  window: string;
}

/**
 * Canvas R2's `YOUR EFFORT SAVED · THIS WEEK`.
 *
 * `null` unless execution is unlocked, and that is the point rather than a
 * guard: on the Capture tier lyzn saves nobody any effort — the person did
 * every one of these themselves — so the card is not dimmed or zeroed, it is
 * absent, and the roll shows its count instead.
 *
 * The figure is summed from the receipts' own rows, never estimated: a
 * receipt that does not say what it saved contributes nothing.
 */
export function effortSaved(
  receipts: Receipt[],
  options: { execution: boolean; now?: Date },
): EffortSaved | null {
  if (!options.execution) return null;
  const now = options.now ?? new Date();
  const from = startOfDay(now) - 6 * 86_400_000;

  const week = receipts.filter((r) => {
    const at = new Date(r.createdAt).getTime();
    return Number.isFinite(at) && at >= from;
  });

  const minutes = week.reduce((sum, receipt) => {
    const row = (receipt.rows ?? []).find((r) => /SAVED/i.test(r.k));
    return sum + (row ? parseMinutes(row.v) : 0);
  }, 0);

  const counts = Array.from({ length: 7 }, (_, i) => {
    const key = dayKey(new Date(from + i * 86_400_000).toISOString());
    return week.filter((r) => dayKey(r.createdAt) === key).length;
  });
  const peak = Math.max(1, ...counts);

  return {
    minutes,
    label: formatMinutes(minutes),
    bars: counts.map((n) => n / peak),
    window: 'THIS WEEK',
  };
}

/** What the tasks segment's "write one" affordance does, if it is drawn. */
export type ComposeState = 'send' | 'unlock' | 'hidden';

/**
 * Whether a person may write a task for their laptop, and what a tap means.
 *
 * The same rule the segment's upsell strip is drawn from. With the deployment
 * flag down there is nothing to sell and nothing to send, so the affordance is
 * absent rather than disabled — a build with no laptop surface must not offer
 * one. With the flag up and no automation on the plan, the answer to a tap is
 * the chooser, and never a 402 for somebody to read.
 */
export function composeState(
  features: { execution: boolean },
  plan?: { automation?: boolean },
): ComposeState {
  if (!features.execution) return 'hidden';
  return plan?.automation ? 'send' : 'unlock';
}
