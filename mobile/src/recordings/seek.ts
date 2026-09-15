/**
 * "Take me to 11:08" — the one thing the Ask sheet tells the conversation
 * behind it.
 *
 * The sheet is its own route pushed over the detail (canvas C4), so it
 * cannot reach into the detail's scroll view, and it must not replace it:
 * coming back to a remounted screen would lose the play position, the
 * follow-along and the transcript's place. Route params are no help either —
 * a pushed screen cannot rewrite the params of the screen underneath it.
 *
 * So: one slot, one subscriber, one read. The sheet writes a request and
 * dismisses; the detail wakes, takes the request (which clears it) and
 * scrolls. A request that nobody takes expires with the app, and a request
 * for a different conversation is ignored by construction, because the
 * reader passes the id it is showing.
 */

export interface SeekRequest {
  recordingId: string;
  seconds: number;
  /** Distinguishes two requests for the same second, so both are delivered. */
  at: number;
}

let pending: SeekRequest | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** Ask the conversation detail to scroll to a moment. */
export function requestSeek(recordingId: string, seconds: number): void {
  pending = { recordingId, seconds: Math.max(0, seconds), at: Date.now() };
  announce();
}

/**
 * Take the request, if there is one for this conversation.
 *
 * Taking clears it: a seek is an instruction, not a state, and one that
 * survived a re-render would scroll the page every time anything changed.
 */
export function takeSeek(recordingId: string): SeekRequest | null {
  if (!pending || pending.recordingId !== recordingId) return null;
  const request = pending;
  pending = null;
  return request;
}

/** `useSyncExternalStore`'s two halves, for the detail screen. */
export function subscribeSeek(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function seekSnapshot(): SeekRequest | null {
  return pending;
}
