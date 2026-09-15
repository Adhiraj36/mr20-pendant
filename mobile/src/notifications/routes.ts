/**
 * Where a notification goes when it is tapped — plan §2.4's five events.
 *
 * A table and one function over it, with no `expo-router` and no React in
 * sight, because the interesting part of notification routing is the part
 * that is wrong in production and impossible to reproduce: a payload whose
 * id is missing, a `type` from a build two releases newer, a tap that
 * launched the app cold. All of that is decidable from the `data` bag alone,
 * so it is decided here where `node --test` can ask.
 *
 * The rule for a payload that cannot be routed is to return `undefined` and
 * let the caller leave the app wherever it opened. Guessing — sending a
 * `recording.ready` with no id to the library, say — teaches people that
 * taps go somewhere arbitrary.
 */

/** The six events the backend sends (T3b, `internal/push/events.go`). */
export type PushType =
  | 'recording.ready'
  | 'recording.failed'
  | 'tasks.proposed'
  | 'plan.activated'
  | 'receipt.printed'
  | 'task.question';

/** The bag a notification carries. Everything in it is untrusted. */
export interface PushData {
  type?: unknown;
  recordingId?: unknown;
  taskId?: unknown;
  receiptId?: unknown;
  count?: unknown;
}

/** Home's three segments, as the deep link names them. */
export type HomeSegment = 'conversations' | 'tasks' | 'receipts';

function id(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * One entry per event. Each is total over its own payload: it either names a
 * route or says it cannot.
 *
 * `tasks.proposed` lands on Home with the TASKS segment selected rather than
 * on any single task — the notification is about a count ("3 things you
 * promised"), and opening one of three is picking for the person.
 */
export const PUSH_ROUTES: Record<PushType, (data: PushData) => string | undefined> = {
  'recording.ready': (data) => {
    const recordingId = id(data.recordingId);
    return recordingId ? `/recording/${recordingId}` : undefined;
  },
  // A failure opens the same screen: it is where the retry lives.
  'recording.failed': (data) => {
    const recordingId = id(data.recordingId);
    return recordingId ? `/recording/${recordingId}` : undefined;
  },
  'tasks.proposed': () => '/(tabs)?segment=tasks',
  'plan.activated': () => '/settings',
  'receipt.printed': (data) => {
    const receiptId = id(data.receiptId);
    return receiptId ? `/receipt/${receiptId}` : undefined;
  },
  'task.question': (data) => {
    const taskId = id(data.taskId);
    return taskId ? `/task/${taskId}` : undefined;
  },
};

export function isPushType(value: unknown): value is PushType {
  return typeof value === 'string' && value in PUSH_ROUTES;
}

/**
 * The route a payload asks for, or `undefined` when it does not ask for one
 * this build understands.
 */
export function routeFor(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const bag = data as PushData;
  if (!isPushType(bag.type)) return undefined;
  return PUSH_ROUTES[bag.type](bag);
}

/**
 * Which Home segment a route asks for, read back off the query string the
 * table above writes. Home is the only screen with segments, so this is the
 * one place that parses it.
 */
export function segmentOf(route: string | undefined): HomeSegment | undefined {
  if (!route) return undefined;
  const match = /[?&]segment=([a-z]+)/.exec(route);
  const value = match?.[1];
  if (value === 'conversations' || value === 'tasks' || value === 'receipts') return value;
  return undefined;
}
