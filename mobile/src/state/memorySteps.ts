/**
 * What Mira's memory did, in the words the screens print — app spec §2.10
 * and §2.11.
 *
 * The chat stream emits `tool` events (`memory.recall`, `memory.ingest`) with
 * a status and, on a recall, a hit count. §2.10 turns those into `StatusBlock`
 * rows on the thread's rail; §2.11 turns them into a one-line note under the
 * call's hint. The mapping lives here rather than in either screen because it
 * is copy, it is the same copy on both, and copy is worth a test.
 *
 * `[MIRA_RECEIPTS]` (spec §0.3) stays a slot. The stream carries `delta`,
 * `tool`, `done` and `error` and nothing structured, so a run has nothing to
 * render a `Receipt` from. Nothing here invents one; when a
 * `{type:'receipt', …}` event exists, this is where its row model would be
 * folded and §2.10 would draw the slip inside the rail.
 */

/**
 * `ToolStep` from `chat.ts`, restated so this file imports nothing — it has
 * to stay loadable by the node test runner, which cannot see zustand.
 */
export interface MemoryStep {
  name: string;
  status: 'start' | 'done' | 'failed';
  hits?: number;
}

/**
 * Structurally a `StatusRow` from `design/stage/StatusBlock.tsx`. Values are
 * written uppercase: the block uppercases a row's label but prints its value
 * as given.
 */
export interface MemoryRow {
  label: string;
  value?: string;
  /** The step running right now — its value reads `fg` rather than `faint`. */
  live?: boolean;
}

/**
 * One step, as one row. `MEMORY · SEARCHING` and its endings become a key
 * and a value, which is what a status row is; `REMEMBERING` and its endings
 * have no second half and stay a bare label (spec §2.10, verbatim).
 */
export function memoryRow(step: MemoryStep): MemoryRow {
  if (step.name === 'memory.recall') {
    if (step.status === 'start') return { label: 'MEMORY', value: 'SEARCHING', live: true };
    if (step.status === 'failed') return { label: 'MEMORY', value: 'UNAVAILABLE' };
    return { label: 'MEMORY', value: step.hits ? `${step.hits} RECALLED` : 'NOTHING RELEVANT' };
  }
  if (step.name === 'memory.ingest') {
    if (step.status === 'start') return { label: 'REMEMBERING', live: true };
    if (step.status === 'failed') return { label: 'COULD NOT REMEMBER THIS' };
    return { label: 'REMEMBERED' };
  }
  if (step.name === 'task.sent') {
    // The one tool that acts rather than looks something up. It never reads
    // as finished: the laptop is what finishes a task, and it says so with a
    // receipt of its own.
    if (step.status === 'start') return { label: 'SENDING TO YOUR LAPTOP', live: true };
    if (step.status === 'failed') return { label: 'COULD NOT SEND TO YOUR LAPTOP' };
    return { label: 'SENT TO YOUR LAPTOP' };
  }
  // A tool this app has no copy for: its own name, which the block uppercases.
  return { label: step.name, live: step.status === 'start' };
}

/**
 * The rows for a run, one per tool, in the order the tools first ran.
 *
 * A turn can call the same tool twice — the store appends a second step once
 * the first has settled — and two rows would then carry the same label, which
 * is also `StatusBlock`'s row key. One row per tool, showing where that tool
 * got to, is both what the block can render and what the reader wants: the
 * state of memory, not a log of it.
 */
export function memoryRows(steps: MemoryStep[]): MemoryRow[] {
  const latest = new Map<string, MemoryStep>();
  for (const step of steps) latest.set(step.name, step);
  return [...latest.values()].map(memoryRow);
}

/**
 * The note that takes precedence under the call's hint while Mira is thinking
 * (spec §2.11). Shorter than the thread's rows because it replaces the hint
 * rather than sitting beside it.
 */
export function voiceToolNote(name: string): string {
  return name === 'memory.ingest' ? 'REMEMBERING' : 'SEARCHING MEMORY';
}
