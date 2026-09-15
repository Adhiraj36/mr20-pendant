/**
 * Memory search — `GET /memory/search?q=`.
 *
 * GitLoom's `Recall` surfaced (plan §2.4). It is the one read the memory
 * layer offers: memories are written by the pipeline and are not addressable
 * afterwards, so this returns *hits* — a path, a score, a snippet and when
 * the thing was said — and never a memory object with an id.
 *
 * What the app does with a hit is match it back to a conversation it already
 * has, which is `citationChips` in `src/recordings/conversation.ts`. A hit
 * that names no conversation this phone knows gets no chip: a citation the
 * reader cannot open is a claim rather than a citation.
 *
 * Deleted conversations are filtered server-side against a tombstone list
 * (`[GL_ERASE]`, best effort — provenance names a commit, not a session).
 */
import { request } from './client';

export interface MemoryHit {
  /** GitLoom's own path for the memory. Often carries the recording id. */
  path: string;
  score: number;
  snippet: string;
  /** RFC 3339, when the memory was filed. */
  when: string;
}

/** The most that is worth asking for: the answer cites two or three. */
const DEFAULT_LIMIT = 8;

/**
 * Search the account's memory. `q` is capped at 500 characters server-side;
 * a longer question is trimmed here rather than being answered with a 400.
 */
export function searchMemory(
  q: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<{ hits: MemoryHit[] }> {
  const query = q.trim().slice(0, 500);
  const limit = options.limit ?? DEFAULT_LIMIT;
  return request<{ hits: MemoryHit[] }>(
    'GET',
    `/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    undefined,
    { signal: options.signal },
  );
}
