/**
 * The canvas' own tasks and receipts, as the API would have sent them.
 *
 * These are the four promises and the roll drawn on the design canvas (T0,
 * T1, R2, D1), in the exact wire shape of `GET /tasks` and `GET /receipts` —
 * not a screen's props. A fixture that is shaped like the screen proves the
 * screen renders itself; one shaped like the wire proves the screen renders
 * what the backend actually sends, which is the only version worth a
 * screenshot.
 *
 * Times are built relative to now, so `TODAY · TUE 04 SEP` is true on the day
 * somebody runs this rather than true in September 2026.
 */
import type { Task } from '../../api/tasks';
import type { Receipt } from '../../api/receipts';

const USER = 'user_fixture';

/** A local instant, `days` ago at `h:m`, as the API would have serialised it. */
function at(days: number, h: number, m: number, s = 0): string {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, h, m, s);
  return day.toISOString();
}

/**
 * Canvas T0/T1's list: a message, a spend that names its own amount, a file,
 * and the reminder T1 draws as already running.
 *
 * The cake's amount is in the task's own words because that is the only place
 * the app can honestly read one from — the `TASK` row has no amount field
 * (see `taskAmount`).
 */
export const FIXTURE_TASKS: Task[] = [
  {
    taskId: 'rec_quote-0',
    userId: USER,
    recordingId: 'rec_quote',
    utteranceIndex: 7,
    text: 'Send the revised quote, 3 mm rate',
    kind: 'message',
    owner: 1,
    status: 'proposed',
    quote: "I'll send you the revised quote before lunch.",
    createdAt: at(0, 11, 8),
    updatedAt: at(0, 11, 8),
  },
  {
    taskId: 'rec_amma-0',
    userId: USER,
    recordingId: 'rec_amma',
    utteranceIndex: 2,
    text: "Order Amma's birthday cake — ₹540 at Karachi Bakery, Saturday pickup",
    kind: 'spend',
    owner: 0,
    status: 'proposed',
    quote: 'Amma birthday ki cake book cheyyali.',
    createdAt: at(0, 11, 19),
    updatedAt: at(0, 11, 19),
  },
  {
    taskId: 'rec_vendor-0',
    userId: USER,
    recordingId: 'rec_vendor',
    utteranceIndex: 11,
    text: 'Send pendant-v4.step',
    kind: 'file',
    owner: 0,
    status: 'proposed',
    quote: 'Send the STEP file today.',
    createdAt: at(0, 9, 44),
    updatedAt: at(0, 9, 44),
  },
  {
    taskId: 'rec_ca-0',
    userId: USER,
    recordingId: 'rec_ca',
    text: 'Remind: call the CA · Mon 09:00',
    kind: 'reminder',
    owner: 0,
    status: 'proposed',
    quote: 'CA ki Monday call cheyyali.',
    dueAt: at(-3, 9, 0),
    createdAt: at(0, 8, 12),
    updatedAt: at(0, 8, 12),
  },
  // Yesterday's, kept — this is what puts a `SETTLED` block under the list
  // and a slip at the top of the roll.
  {
    taskId: 'rec_insure-0',
    userId: USER,
    recordingId: 'rec_insure',
    text: 'Set a reminder for the insurance renewal',
    kind: 'reminder',
    owner: 0,
    status: 'done',
    quote: 'Insurance renewal ki reminder pettu.',
    doneAt: at(1, 13, 28, 11),
    receiptId: 'rcp_a41c0412',
    createdAt: at(1, 12, 2),
    updatedAt: at(1, 13, 28, 11),
  },
];

/** Canvas R2's roll — `#0412` at the top, and a day under it. */
export const FIXTURE_RECEIPTS: Receipt[] = [
  {
    receiptId: 'rcp_a41c0412',
    userId: USER,
    kind: 'task',
    taskId: 'rec_insure-0',
    recordingId: 'rec_insure',
    title: 'Set a reminder for the insurance renewal',
    quote: 'Insurance renewal ki reminder pettu.',
    stamp: 'DONE',
    createdAt: at(1, 13, 28, 11),
    rows: [
      { k: 'KIND', v: 'REMINDER' },
      { k: 'PROMISED', v: at(1, 12, 2) },
      { k: 'MARKED DONE', v: at(1, 13, 28, 11) },
      { k: 'STATUS', v: 'DONE', ok: true },
    ],
  },
  {
    receiptId: 'rcp_88f20388',
    userId: USER,
    kind: 'task',
    taskId: 'rec_step-0',
    recordingId: 'rec_vendor',
    title: 'Send the STEP file to the Shenzhen vendor',
    quote: 'Send the STEP file today.',
    stamp: 'DONE',
    createdAt: at(2, 13, 31, 4),
    rows: [
      { k: 'KIND', v: 'FILE' },
      { k: 'PROMISED', v: at(2, 9, 44) },
      { k: 'MARKED DONE', v: at(2, 13, 31, 4) },
      { k: 'STATUS', v: 'DONE', ok: true },
    ],
  },
  {
    receiptId: 'rcp_10ab0221',
    userId: USER,
    kind: 'pairing',
    title: 'Your pendant is linked',
    stamp: 'READY',
    createdAt: at(2, 9, 2, 40),
    rows: [
      { k: 'PENDANT', v: 'LYZN 01 · A4:C1:38' },
      { k: 'FIRMWARE', v: '1.4.2' },
      { k: 'LINKED', v: at(2, 9, 2, 40), ok: true },
    ],
  },
];

/** What the store is seeded with. Copies, so a screen cannot edit the fixture. */
export function taskFixtures(): { tasks: Task[]; receipts: Receipt[] } {
  return {
    tasks: FIXTURE_TASKS.map((t) => ({ ...t })),
    receipts: FIXTURE_RECEIPTS.map((r) => ({ ...r, rows: r.rows.map((row) => ({ ...row })) })),
  };
}
