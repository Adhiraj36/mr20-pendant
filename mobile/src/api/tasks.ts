/**
 * Tasks — the commitments a conversation left behind (plan §2.4, T3b's
 * endpoint table).
 *
 * A task is a promise somebody heard you make. The backend writes one row per
 * action item the enrichment pass found, `proposed`, and from there the app
 * is the only thing that moves it: `done`, `dismissed`, or — when execution
 * is unlocked — `approved`. There is no `GET /tasks/:id`: `createdAt` leads
 * the sort key and GSI1 is spent on status, so a single task is found by
 * paging the list the caller already has (see `ensureTask` in
 * `src/state/tasks.ts`).
 *
 * Types are the wire shape verbatim. `owner` is the diarizer's speaker index,
 * a number — not a name; nothing in this file invents one.
 */
import { ApiError, request } from './client';
import type { Receipt } from './receipts';

/** What the enrichment prompt classified the promise as. */
export type TaskKind = 'message' | 'spend' | 'file' | 'reminder' | 'other';

/**
 * Where the promise stands. `approved`, `blocked` and `failed` only ever
 * appear when `features.execution` is on — nothing writes them otherwise
 * (`[EXECUTION]`).
 */
export type TaskStatus = 'proposed' | 'approved' | 'blocked' | 'done' | 'dismissed' | 'failed';

/** A question the daemon asked mid-task — present only while blocked. */
export interface TaskQuestion {
  id: string;
  text: string;
  /** Present only when this is a choice rather than free text. */
  options?: string[];
  askedBy: string;
  askedAt: string;
  expiresAt: string;
  answer?: string;
  answeredAt?: string;
  answeredBy?: string;
}

export interface Task {
  taskId: string;
  userId: string;
  recordingId: string;
  /** Which line of the transcript the promise was matched to, when one was. */
  utteranceIndex?: number;
  text: string;
  /** The diarizer's speaker index, not a name. */
  owner?: number;
  kind: TaskKind;
  status: TaskStatus;
  /** The transcript's own words — what was actually said. */
  quote?: string;
  dueAt?: string;
  /** Set only while `status` is `blocked`. */
  question?: TaskQuestion;
  doneAt?: string;
  receiptId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPage {
  tasks: Task[];
  /** Opaque; follow it while it is present. */
  cursor?: string;
}

/** The six the backend accepts on `?status=`. Anything else is a 400. */
export const TASK_STATUSES: TaskStatus[] = [
  'proposed', 'approved', 'blocked', 'done', 'dismissed', 'failed',
];

/**
 * `402` from `/approve` is not an error to show: it is the price, and the app
 * answers it by opening the plan chooser (T3b: "402 and not 403 because the
 * second gate is a price").
 */
export function isPaymentRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 402;
}

/** A task that no longer exists, or never belonged to this account. */
export function isMissing(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/**
 * A transition the row refuses — done → dismissed, or the reverse. Idempotent
 * repeats are `200`; only a genuine contradiction is `409`.
 */
export function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

const query = (params: Record<string, string | number | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export const tasksApi = {
  /** One page, newest first. No `status` reads every one of them. */
  list: (options: { status?: TaskStatus; cursor?: string; limit?: number } = {}) =>
    request<TaskPage>('GET', `/tasks${query(options)}`),

  /** `text` is trimmed and truncated to 400 server-side; `dueAt` clears on `''`. */
  patch: (id: string, patch: { text?: string; dueAt?: string }) =>
    request<{ task: Task }>('PATCH', `/tasks/${encodeURIComponent(id)}`, patch),

  /**
   * Idempotent: a second call returns the same task and the receipt the first
   * one printed. `receipt` is null only for a task that somehow finished
   * without one, which the transaction is written to make impossible.
   */
  markDone: (id: string) =>
    request<{ task: Task; receipt: Receipt | null }>(
      'POST', `/tasks/${encodeURIComponent(id)}/done`,
    ),

  dismiss: (id: string) =>
    request<{ task: Task }>('POST', `/tasks/${encodeURIComponent(id)}/dismiss`),

  /**
   * Answer a blocked task's question. The daemon resumes on its own next
   * poll — this only ever writes the answer, never the task's status.
   */
  answer: (id: string, answer: string) =>
    request<{ task: Task }>('POST', `/tasks/${encodeURIComponent(id)}/answer`, { answer }),

  /**
   * A task nobody said out loud — the compose sheet's own route.
   *
   * `approved` queues it for the paired laptop and answers `402` unless the
   * plan carries automation; without it the task is a note to self.
   */
  create: (input: { text: string; kind?: TaskKind; dueAt?: string; approved?: boolean }) =>
    request<{ task: Task }>('POST', '/tasks', input),

  /** `402` until execution is enabled **and** the plan carries automation. */
  approve: (id: string) =>
    request<{ task: Task }>('POST', `/tasks/${encodeURIComponent(id)}/approve`),
};

/** The maximum the backend will hand back in one page. */
export const TASK_PAGE_LIMIT = 100;
