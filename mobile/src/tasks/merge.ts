/**
 * How a list of tasks is held: newest first, one row per id.
 *
 * Its own file, importing only a type, because the store it came out of
 * reaches the API client and therefore Expo — and this is the part with a
 * rule in it. A page arriving from the network and a task the person just
 * sent go through the same merge; sending one is only a page of one.
 */
import type { Task } from '../api/tasks';

export const byNewest = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);

/** Merge a page into what is held. A repeated id keeps the incoming copy. */
export function mergeTasks(existing: Task[], incoming: Task[]): Task[] {
  const byId = new Map(existing.map((t) => [t.taskId, t]));
  for (const task of incoming) byId.set(task.taskId, task);
  return [...byId.values()].sort(byNewest);
}
