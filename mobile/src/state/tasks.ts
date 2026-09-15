/**
 * Tasks and receipts, held outside the screens.
 *
 * Home's TASKS segment, the task detail, the edit screen and the receipt
 * detail are four views of one list, and a `MARK DONE` on any of them has to
 * be true on the other three before the network answers. So the list lives
 * here and the screens are thin over it.
 *
 * Three things this file is careful about:
 *
 * 1. **Optimism with a receipt.** `markDone` moves the task the moment it is
 *    tapped and puts the row back exactly as it was if the call fails. It is
 *    never optimistic about the *receipt*, though — a receipt is proof, and a
 *    proof the server has not written yet is not one. The screen navigates to
 *    the printed slip only once the response carries it.
 * 2. **There is no `GET /tasks/:id`.** `createdAt` leads the sort key and
 *    GSI1 is spent on status, so a deep link into a task the app has not
 *    listed yet pages the list until it finds it (`ensureTask`).
 * 3. **Fixtures are a mode, not a mock.** `seed()` puts the store in a state
 *    where the same reducers run and nothing reaches the network — which is
 *    what makes a simulator screenshot a picture of the real screen.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import {
  tasksApi, isPaymentRequired, type Task, type TaskStatus,
} from '../api/tasks';
import { receiptsApi, type Receipt } from '../api/receipts';
import {
  groupTasks, receiptForDoneTask, waitingCount as countWaiting,
  type Features, type TaskGroups,
} from '../tasks/models';
import { byNewest, mergeTasks } from '../tasks/merge';

/** How many pages `ensureTask` will walk before giving up on a deep link. */
const DEEP_LINK_PAGES = 5;

/**
 * Off until the config says otherwise — the plan's slot table, `[EXECUTION]`.
 *
 * The remote config client is T6's (`src/api/appConfig.ts`); when it lands it
 * calls `setFeatures` with what `/config` returned. Until then every screen
 * reads the honest default, which is the tier the product actually ships.
 */
const DEFAULT_FEATURES: Features = { execution: false };

interface TasksState {
  features: Features;
  setFeatures: (next: Partial<Features>) => void;

  /** True while the store is serving seeded data and touching no network. */
  fixtures: boolean;

  tasks: Task[];
  tasksCursor?: string;
  tasksLoading: boolean;
  tasksLoaded: boolean;
  tasksError?: string;

  receipts: Receipt[];
  receiptsCursor?: string;
  receiptsLoading: boolean;
  receiptsLoaded: boolean;
  receiptsError?: string;

  /** The batch-select set. Only ever non-empty under `features.execution`. */
  selected: string[];

  loadTasks: (options?: { reset?: boolean; status?: TaskStatus }) => Promise<void>;
  loadMoreTasks: () => Promise<void>;
  loadReceipts: (options?: { reset?: boolean }) => Promise<void>;
  loadMoreReceipts: () => Promise<void>;

  /** From memory when it is there, otherwise by paging the list. */
  ensureTask: (id: string) => Promise<Task | undefined>;
  ensureReceipt: (id: string) => Promise<Receipt | undefined>;

  markDone: (id: string) => Promise<Receipt | null>;
  dismiss: (id: string) => Promise<void>;
  editTask: (id: string, patch: { text?: string; dueAt?: string }) => Promise<void>;
  /** Resolves `{ paymentRequired: true }` on a 402 — the price, not a failure. */
  approve: (ids: string[]) => Promise<{ approved: number; paymentRequired: boolean }>;
  /**
   * Write a task and hand it straight to the laptop.
   *
   * Approved on arrival, which is what puts it in front of a daemon. The 402
   * is reported rather than thrown for the same reason `approve` reports it:
   * the answer to a price is the chooser, not an error.
   */
  sendToLaptop: (text: string) => Promise<{ ok: boolean; paymentRequired: boolean }>;
  /** Answer a blocked task's question. */
  answerQuestion: (id: string, answer: string) => Promise<{ ok: boolean }>;

  toggleSelect: (id: string) => void;
  clearSelection: () => void;

  /** Seed the store for the dev fixtures; nothing reaches the network after. */
  seed: (input: { tasks: Task[]; receipts: Receipt[]; features?: Partial<Features> }) => void;
  reset: () => void;
}

function mergeReceipts(existing: Receipt[], incoming: Receipt[]): Receipt[] {
  const byId = new Map(existing.map((r) => [r.receiptId, r]));
  for (const receipt of incoming) byId.set(receipt.receiptId, receipt);
  return [...byId.values()].sort(byNewest);
}

const replaceTask = (tasks: Task[], next: Task) =>
  tasks.map((t) => (t.taskId === next.taskId ? next : t));

const message = (err: unknown) =>
  err instanceof Error && err.message ? err.message : 'something went wrong';

export const useTasks = create<TasksState>((set, get) => ({
  features: DEFAULT_FEATURES,
  setFeatures: (next) => set((s) => ({ features: { ...s.features, ...next } })),

  fixtures: false,

  tasks: [],
  tasksLoading: false,
  tasksLoaded: false,

  receipts: [],
  receiptsLoading: false,
  receiptsLoaded: false,

  selected: [],

  async loadTasks(options = {}) {
    if (get().fixtures) return;
    if (get().tasksLoading) return;
    set({ tasksLoading: true, tasksError: undefined });
    try {
      const page = await tasksApi.list({ status: options.status });
      set((s) => ({
        tasks: options.reset ? page.tasks.slice().sort(byNewest) : mergeTasks(s.tasks, page.tasks),
        tasksCursor: page.cursor,
        tasksLoaded: true,
        tasksLoading: false,
      }));
    } catch (err) {
      set({ tasksLoading: false, tasksError: message(err) });
    }
  },

  async loadMoreTasks() {
    const { fixtures, tasksCursor, tasksLoading } = get();
    if (fixtures || !tasksCursor || tasksLoading) return;
    set({ tasksLoading: true });
    try {
      const page = await tasksApi.list({ cursor: tasksCursor });
      set((s) => ({
        tasks: mergeTasks(s.tasks, page.tasks),
        tasksCursor: page.cursor,
        tasksLoading: false,
      }));
    } catch (err) {
      set({ tasksLoading: false, tasksError: message(err) });
    }
  },

  async loadReceipts(options = {}) {
    if (get().fixtures) return;
    if (get().receiptsLoading) return;
    set({ receiptsLoading: true, receiptsError: undefined });
    try {
      const page = await receiptsApi.list();
      set((s) => ({
        receipts: options.reset
          ? page.receipts.slice().sort(byNewest)
          : mergeReceipts(s.receipts, page.receipts),
        receiptsCursor: page.cursor,
        receiptsLoaded: true,
        receiptsLoading: false,
      }));
    } catch (err) {
      set({ receiptsLoading: false, receiptsError: message(err) });
    }
  },

  async loadMoreReceipts() {
    const { fixtures, receiptsCursor, receiptsLoading } = get();
    if (fixtures || !receiptsCursor || receiptsLoading) return;
    set({ receiptsLoading: true });
    try {
      const page = await receiptsApi.list({ cursor: receiptsCursor });
      set((s) => ({
        receipts: mergeReceipts(s.receipts, page.receipts),
        receiptsCursor: page.cursor,
        receiptsLoading: false,
      }));
    } catch (err) {
      set({ receiptsLoading: false, receiptsError: message(err) });
    }
  },

  async ensureTask(id) {
    const held = get().tasks.find((t) => t.taskId === id);
    if (held || get().fixtures) return held;

    // No `GET /tasks/:id` exists (T3b deviation 1). Walk the list — it is
    // newest first and a deep link is nearly always about something recent,
    // so this is one request in practice and bounded in the worst case.
    let cursor: string | undefined;
    for (let page = 0; page < DEEP_LINK_PAGES; page++) {
      try {
        const next = await tasksApi.list({ cursor });
        set((s) => ({ tasks: mergeTasks(s.tasks, next.tasks), tasksLoaded: true }));
        const found = next.tasks.find((t) => t.taskId === id);
        if (found) return found;
        if (!next.cursor) return undefined;
        cursor = next.cursor;
      } catch (err) {
        set({ tasksError: message(err) });
        return undefined;
      }
    }
    return undefined;
  },

  async ensureReceipt(id) {
    const held = get().receipts.find((r) => r.receiptId === id);
    if (held || get().fixtures) return held;
    try {
      const { receipt } = await receiptsApi.get(id);
      set((s) => ({ receipts: mergeReceipts(s.receipts, [receipt]) }));
      return receipt;
    } catch (err) {
      set({ receiptsError: message(err) });
      return undefined;
    }
  },

  async markDone(id) {
    const before = get().tasks.find((t) => t.taskId === id);
    if (!before) return null;
    if (before.status === 'done' && before.receiptId) {
      return get().receipts.find((r) => r.receiptId === before.receiptId) ?? null;
    }

    const at = new Date().toISOString();

    if (get().fixtures) {
      const receipt = receiptForDoneTask(before, { receiptId: fixtureReceiptId(), at });
      const done: Task = {
        ...before, status: 'done', doneAt: at, updatedAt: at, receiptId: receipt.receiptId,
      };
      set((s) => ({
        tasks: replaceTask(s.tasks, done),
        receipts: mergeReceipts(s.receipts, [receipt]),
        selected: s.selected.filter((s2) => s2 !== id),
      }));
      return receipt;
    }

    // Optimistic on the task, never on the receipt: the row moves now, the
    // proof waits for the server that writes it.
    const optimistic: Task = { ...before, status: 'done', doneAt: at, updatedAt: at };
    set((s) => ({
      tasks: replaceTask(s.tasks, optimistic),
      selected: s.selected.filter((s2) => s2 !== id),
    }));

    try {
      const { task, receipt } = await tasksApi.markDone(id);
      set((s) => ({
        tasks: replaceTask(s.tasks, task),
        receipts: receipt ? mergeReceipts(s.receipts, [receipt]) : s.receipts,
      }));
      return receipt;
    } catch (err) {
      set((s) => ({ tasks: replaceTask(s.tasks, before), tasksError: message(err) }));
      throw err;
    }
  },

  async dismiss(id) {
    const before = get().tasks.find((t) => t.taskId === id);
    if (!before || before.status === 'dismissed') return;
    const at = new Date().toISOString();
    const optimistic: Task = { ...before, status: 'dismissed', updatedAt: at };
    set((s) => ({
      tasks: replaceTask(s.tasks, optimistic),
      selected: s.selected.filter((s2) => s2 !== id),
    }));
    if (get().fixtures) return;
    try {
      const { task } = await tasksApi.dismiss(id);
      set((s) => ({ tasks: replaceTask(s.tasks, task) }));
    } catch (err) {
      set((s) => ({ tasks: replaceTask(s.tasks, before), tasksError: message(err) }));
      throw err;
    }
  },

  async answerQuestion(id, answer) {
    const trimmed = answer.trim();
    if (!trimmed) return { ok: false };
    const before = get().tasks.find((t) => t.taskId === id);
    if (!before?.question) return { ok: false };

    if (get().fixtures) {
      const at = new Date().toISOString();
      const task: Task = {
        ...before,
        question: { ...before.question, answer: trimmed, answeredAt: at, answeredBy: 'app' },
        updatedAt: at,
      };
      set((s) => ({ tasks: replaceTask(s.tasks, task) }));
      return { ok: true };
    }

    try {
      const { task } = await tasksApi.answer(id, trimmed);
      set((s) => ({ tasks: replaceTask(s.tasks, task) }));
      return { ok: true };
    } catch (err) {
      set({ tasksError: message(err) });
      return { ok: false };
    }
  },

  async editTask(id, patch) {
    const before = get().tasks.find((t) => t.taskId === id);
    if (!before) return;
    const at = new Date().toISOString();
    const optimistic: Task = {
      ...before,
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
      updatedAt: at,
    };
    set((s) => ({ tasks: replaceTask(s.tasks, optimistic) }));
    if (get().fixtures) return;
    try {
      const { task } = await tasksApi.patch(id, patch);
      set((s) => ({ tasks: replaceTask(s.tasks, task) }));
    } catch (err) {
      set((s) => ({ tasks: replaceTask(s.tasks, before), tasksError: message(err) }));
      throw err;
    }
  },

  async approve(ids) {
    let approved = 0;
    for (const id of ids) {
      const before = get().tasks.find((t) => t.taskId === id);
      if (!before) continue;
      if (get().fixtures) {
        const at = new Date().toISOString();
        set((s) => ({
          tasks: replaceTask(s.tasks, { ...before, status: 'approved', updatedAt: at }),
        }));
        approved += 1;
        continue;
      }
      try {
        const { task } = await tasksApi.approve(id);
        set((s) => ({ tasks: replaceTask(s.tasks, task) }));
        approved += 1;
      } catch (err) {
        // A 402 stops the batch: the whole set is behind one price, and
        // approving three of five and then asking for money is worse than
        // asking first.
        if (isPaymentRequired(err)) return { approved, paymentRequired: true };
        set({ tasksError: message(err) });
        return { approved, paymentRequired: false };
      }
    }
    set({ selected: [] });
    return { approved, paymentRequired: false };
  },

  sendToLaptop: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, paymentRequired: false };

    if (get().fixtures) {
      const at = new Date().toISOString();
      const task: Task = {
        taskId: `own_${at}`, userId: '', recordingId: '', text: trimmed,
        kind: 'other', status: 'approved', createdAt: at, updatedAt: at,
      };
      set((s) => ({ tasks: mergeTasks(s.tasks, [task]) }));
      return { ok: true, paymentRequired: false };
    }

    try {
      const { task } = await tasksApi.create({ text: trimmed, approved: true });
      // The row the backend wrote, not the one that was typed: its id and its
      // status are the daemon's business, and guessing either would put a
      // task on screen that no machine will ever come for.
      set((s) => ({ tasks: mergeTasks(s.tasks, [task]) }));
      return { ok: true, paymentRequired: false };
    } catch (err) {
      if (isPaymentRequired(err)) return { ok: false, paymentRequired: true };
      set({ tasksError: message(err) });
      return { ok: false, paymentRequired: false };
    }
  },

  toggleSelect: (id) => set((s) => ({
    selected: s.selected.includes(id)
      ? s.selected.filter((x) => x !== id)
      : [...s.selected, id],
  })),

  clearSelection: () => set({ selected: [] }),

  seed: ({ tasks, receipts, features }) => set((s) => ({
    fixtures: true,
    tasks: tasks.slice().sort(byNewest),
    receipts: receipts.slice().sort(byNewest),
    tasksLoaded: true,
    receiptsLoaded: true,
    tasksCursor: undefined,
    receiptsCursor: undefined,
    tasksError: undefined,
    receiptsError: undefined,
    selected: [],
    features: { ...s.features, ...features },
  })),

  reset: () => set({
    fixtures: false,
    tasks: [], tasksCursor: undefined, tasksLoaded: false, tasksError: undefined,
    receipts: [], receiptsCursor: undefined, receiptsLoaded: false, receiptsError: undefined,
    selected: [], features: DEFAULT_FEATURES,
  }),
}));

/** Fixture receipt ids look like the real ones: four digits is what R2 shows. */
let fixtureReceiptSeq = 500;
const fixtureReceiptId = () => `rcp_${(fixtureReceiptSeq += 1)}`;

// -- selectors -------------------------------------------------------------

/** The number the TASKS segment carries: everything still on you. */
export const useWaitingCount = (): number =>
  useTasks((s) => countWaiting(s.tasks));

/**
 * The three blocks the segment draws.
 *
 * The grouping is memoised over the list rather than done inside the
 * selector: zustand v5 compares a selector's result by identity, and a
 * selector that builds a fresh object every call re-renders forever.
 */
export const useTaskGroups = (): TaskGroups => {
  const tasks = useTasks((s) => s.tasks);
  return useMemo(() => groupTasks(tasks), [tasks]);
};

export const useFeatures = (): Features => useTasks((s) => s.features);

/** Imperative reads, for the places that are not components. */
export const tasksState = () => useTasks.getState();
