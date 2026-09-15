/**
 * Receipts — the roll (plan §2.4, T3b's endpoint table).
 *
 * A receipt is written once and never edited: it is the record of a moment,
 * and a record that can be changed afterwards proves nothing. There is no
 * PATCH and no DELETE on the wire, which is why the detail screen's `···`
 * menu offers copying and nothing else.
 *
 * The stamp is the server's word, never the client's — `POST /receipts`
 * accepts only `pairing` and `plan` and stamps them itself. A task's receipt
 * comes back from `POST /tasks/:id/done`; a conversation's from the pipeline.
 */
import { request } from './client';

/** What was proved. */
export type ReceiptKind = 'task' | 'pairing' | 'plan' | 'conversation';

/** The mark across the paper — server-chosen, per kind. */
export type ReceiptStamp = 'DONE' | 'READY' | 'UNLOCKED' | 'FILED';

/** One dotted-leader line. `ok` is the verdict line, and only that. */
export interface ReceiptRow {
  k: string;
  v: string;
  ok?: boolean;
}

export interface Receipt {
  receiptId: string;
  userId: string;
  kind: ReceiptKind;
  taskId?: string;
  recordingId?: string;
  /** For a task receipt, the task's own text. It becomes the slip's first row. */
  title: string;
  quote?: string;
  rows: ReceiptRow[];
  stamp: ReceiptStamp;
  createdAt: string;
}

export interface ReceiptPage {
  receipts: Receipt[];
  cursor?: string;
}

const query = (params: Record<string, string | number | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export const receiptsApi = {
  /** The roll, newest first — the order it comes off the printer. */
  list: (options: { cursor?: string; limit?: number } = {}) =>
    request<ReceiptPage>('GET', `/receipts${query(options)}`),

  get: (id: string) =>
    request<{ receipt: Receipt }>('GET', `/receipts/${encodeURIComponent(id)}`),

  /**
   * The two proofs the app prints itself. Onboarding owns both call sites
   * (T6); it is here because the roll that shows them is this task's.
   */
  print: (input: {
    kind: 'pairing' | 'plan';
    title: string;
    quote?: string;
    rows?: ReceiptRow[];
  }) => request<{ receipt: Receipt }>('POST', '/receipts', input),
};
