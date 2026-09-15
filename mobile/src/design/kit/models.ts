/**
 * The kit's decisions, with no React around them.
 *
 * Which face a task card wears, what a finished task prints, how a meta line
 * is joined, how a code splits into boxes, which ink was stored — five
 * questions the components ask and none of them answer, so `node --test` can
 * ask them directly (plan §1: "tests stay pure").
 *
 * Numbers and strings only: this file imports `@lyzn/design` and
 * `../tokens`, both of which are React-free for the same reason.
 */
import { inks, INK_STORAGE_KEY, type Ground } from '@lyzn/design';
import { joinLabel } from '../tokens';

export { INK_STORAGE_KEY };

// -- tasks -----------------------------------------------------------------

/** What the backend stores (plan §2.4, the `TASK` row). */
export type TaskStatus = 'proposed' | 'approved' | 'blocked' | 'done' | 'dismissed' | 'failed';

/** What the backend classifies a promise as. */
export type TaskKind = 'message' | 'spend' | 'file' | 'reminder' | 'other';

/**
 * What the card looks like — canvas T4, "one card, four lives", plus the
 * fifth the Capture tier adds (T0), plus a sixth for a task that has stopped
 * to ask a question.
 *
 * `capture` is not a status: it is what every unfinished task looks like
 * while `features.execution` is off, because nothing can act on it and the
 * card has to say so instead of offering an APPROVE that does nothing.
 *
 * `blocked` is not `waiting` wearing a different tag: the daemon has stopped
 * and is holding for an answer, so there is nothing here to approve and
 * nothing to edit — just the question, on the task's own detail screen.
 */
export type TaskCardState = 'waiting' | 'running' | 'done' | 'failed' | 'capture' | 'blocked';

export interface TaskLike {
  taskId: string;
  text: string;
  kind: TaskKind;
  status: TaskStatus;
  owner?: string;
  quote?: string;
  recordingId?: string;
  doneAt?: string;
  receiptId?: string;
}

/**
 * The state a task's card is in, given whether execution is unlocked.
 *
 * Total on purpose: a status the app has not met yet still gets a face
 * rather than an empty card.
 */
export function taskCardState(
  status: TaskStatus,
  options: { execution: boolean },
): TaskCardState {
  switch (status) {
    case 'failed': return 'failed';
    case 'blocked': return 'blocked';
    // Dismissed is settled business: paper, no actions, no offer to act. It
    // shares the `done` face and is told apart by its tag, below.
    case 'done': case 'dismissed': return 'done';
    case 'approved': return options.execution ? 'running' : 'capture';
    case 'proposed': default: return options.execution ? 'waiting' : 'capture';
  }
}

/** The word in the card's top-right corner, or none for the two that act. */
export function taskTag(status: TaskStatus): string | undefined {
  switch (status) {
    case 'done': return 'DONE ✓';
    case 'dismissed': return 'DROPPED';
    case 'approved': return 'RUNNING';
    case 'failed': return "DIDN'T GO THROUGH";
    case 'blocked': return 'NEEDS AN ANSWER';
    default: return undefined;
  }
}

/**
 * The kind, as the canvas says it — and as it says it in the Capture tier,
 * where lyzn would do the thing but cannot, so every verb goes conditional.
 */
const KIND_LABEL: Record<TaskKind, string> = {
  message: 'SENDS A MESSAGE',
  spend: 'SPENDS',
  file: 'SHARES A FILE',
  reminder: 'REMINDS YOU',
  other: 'DOES SOMETHING',
};

const KIND_LABEL_CAPTURE: Record<TaskKind, string> = {
  message: 'WOULD SEND A MESSAGE',
  spend: 'WOULD SPEND',
  file: 'WOULD SEND A FILE',
  reminder: 'WOULD REMIND YOU',
  other: 'YOU SAID YOU WOULD',
};

export function taskKindLabel(kind: TaskKind, options?: { capture?: boolean }): string {
  return (options?.capture ? KIND_LABEL_CAPTURE : KIND_LABEL)[kind];
}

/**
 * A task card's eyebrow: what it does, and to whom. `SPENDS ₹540 · KARACHI
 * BAKERY` — the amount rides with the verb, the target follows the dot.
 */
export function taskEyebrow(
  task: Pick<TaskLike, 'kind' | 'owner'>,
  options?: { capture?: boolean; amount?: string },
): string {
  const verb = taskKindLabel(task.kind, options);
  const head = options?.amount ? `${verb} ${options.amount}` : verb;
  return metaLine([head, task.owner?.toUpperCase()]);
}

// -- receipts --------------------------------------------------------------

/** One line of a receipt (plan §2.4, the `RECEIPT` row's `rows`). */
export interface ReceiptRowModel {
  k: string;
  /**
   * The value. Absent on a row that is a heading rather than a fact — the
   * receipt runs its leader to the edge and prints nothing after it, which
   * is what `ReceiptRowSpec` in @lyzn/design has always allowed.
   */
  v?: string;
  /** Settled green, with a ✓. Reserved for the line that says it happened. */
  ok?: boolean;
}

/** What the app would print, before the server gives it an id and a time. */
export interface DraftReceipt {
  kind: 'task';
  taskId: string;
  recordingId?: string;
  title: string;
  quote?: string;
  rows: ReceiptRowModel[];
  stamp: 'DONE';
}

/** "11:05:07" — a receipt states a time to the second, because it is proof. */
export function receiptClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * The receipt a finished task prints — canvas §04: "only printed where
 * something finished."
 *
 * `null` for anything not done, which is the rule stated as a return type
 * rather than as a comment: there is no such thing as a receipt for a task
 * still waiting, and a caller cannot accidentally draw one.
 */
export function receiptFromTask(
  task: TaskLike,
  options?: { at?: string; title?: string },
): DraftReceipt | null {
  if (task.status !== 'done') return null;
  const at = options?.at ?? task.doneAt;
  const rows: ReceiptRowModel[] = [
    { k: 'TASK', v: task.text },
    ...(task.owner ? [{ k: 'TO', v: task.owner.toUpperCase() }] : []),
    { k: 'KIND', v: taskKindLabel(task.kind) },
    ...(at ? [{ k: 'MARKED DONE', v: receiptClock(at), ok: true }] : []),
  ];
  return {
    kind: 'task',
    taskId: task.taskId,
    recordingId: task.recordingId,
    title: options?.title ?? 'LYZN · PROOF OF WORK',
    quote: task.quote,
    rows,
    stamp: 'DONE',
  };
}

// -- labels ----------------------------------------------------------------

/**
 * The mono label join, the site's slot rule: fragments separated by ` · `,
 * the empty ones dropped, never a token where a value is missing.
 */
export function metaLine(parts: (string | number | undefined | false | null)[]): string {
  return joinLabel(parts.map((p) => (typeof p === 'number' ? String(p) : p)));
}

/**
 * `2 COMMITMENTS`, `1 COMMITMENT`, and nothing at all for none — a count of
 * zero is not news, so it drops out of the line it was going to join.
 */
export function countLabel(
  n: number,
  singular: string,
  plural = `${singular}S`,
): string | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return `${n} ${n === 1 ? singular : plural}`.toUpperCase();
}

/**
 * A conversation row's chips: the languages heard, what was promised, what
 * has been settled. Empty counts drop; an empty language list drops.
 */
export function conversationChips(input: {
  languages?: string[];
  commitments?: number;
  done?: number;
}): { label: string; tone: 'faint' | 'stamp' | 'settled' }[] {
  const chips: { label: string; tone: 'faint' | 'stamp' | 'settled' }[] = [];
  const languages = (input.languages ?? []).filter(Boolean);
  if (languages.length) {
    chips.push({ label: languages.join(' + ').toUpperCase(), tone: 'faint' });
  }
  const open = countLabel(input.commitments ?? 0, 'COMMITMENT');
  if (open) chips.push({ label: open, tone: 'stamp' });
  const done = input.done ?? 0;
  if (done > 0) chips.push({ label: `${done} DONE ✓`, tone: 'settled' });
  return chips;
}

// -- code boxes ------------------------------------------------------------

export interface CodeBoxes {
  /** One entry per box; `''` where nothing has been typed yet. */
  chars: string[];
  /** Which box the caret is in, or `-1` when the code is complete. */
  caret: number;
  /** How many boxes carry a digit. */
  filled: number;
  complete: boolean;
}

/**
 * A verification code, split into its boxes — canvas O2: six boxes, the
 * typed ones ink-bordered, the caret's box in stamp violet, the rest faint.
 *
 * Anything past `length` is dropped rather than wrapped: the field itself
 * should not have accepted it, and a box that silently holds two digits is
 * worse than a keystroke that does nothing.
 */
export function codeBoxes(value: string, length = 6): CodeBoxes {
  const typed = [...(value ?? '')].slice(0, length);
  const chars = Array.from({ length }, (_, i) => typed[i] ?? '');
  const filled = typed.length;
  return {
    chars,
    filled,
    caret: filled >= length ? -1 : filled,
    complete: filled >= length,
  };
}

/**
 * `K7Q D2M` — a code split for reading aloud rather than for typing.
 *
 * The mirror of `codeBoxes`: that one is what a thumb fills in, this is what
 * a screen shows so it can be typed somewhere else. Anything that is not a
 * letter or a digit is dropped, because the spaces and hyphens people add to
 * make six characters readable are not part of the code and the server
 * normalises them away too.
 */
export function codeGroups(value: string, size = 3): string[] {
  const clean = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (size <= 0) return clean ? [clean] : [];
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out;
}

// -- ink -------------------------------------------------------------------

export type InkId = (typeof inks)[number]['id'];

/**
 * The default is the one the package marks as such, not a string written
 * here. `inks` is a readonly tuple of differently shaped literals, only one
 * of which carries `default`, so the predicate widens the element before it
 * asks.
 */
export const DEFAULT_INK: InkId =
  (inks.find((ink) => 'default' in ink && ink.default) ?? inks[0]).id;

export function isInk(value: unknown): value is InkId {
  return typeof value === 'string' && inks.some((ink) => ink.id === value);
}

/**
 * What was stored under `lyzn.ink`, coerced.
 *
 * AsyncStorage answers `null` when nothing was ever written and can answer
 * with an id an older build wrote and this one has dropped. Both are the
 * default ink, silently — a picker that refuses to render because storage
 * said `"teal"` is worse than one that quietly shows black.
 */
export function parseInk(raw: string | null | undefined): InkId {
  return isInk(raw) ? raw : DEFAULT_INK;
}

/** The swatch a picker paints for an id. */
export function inkHex(id: InkId): string {
  return (inks.find((ink) => ink.id === id) ?? inks[0]).hex;
}

/** The six, in the order the canvas draws them. */
export const INKS = inks;

// -- grounds ---------------------------------------------------------------

/**
 * A receipt is paper whichever theme is on (canvas D2: "receipts never go
 * dark"). Written down as a value so the kit's receipt components and the
 * tests agree on one word.
 */
export const RECEIPT_GROUND: Ground = 'paper';
