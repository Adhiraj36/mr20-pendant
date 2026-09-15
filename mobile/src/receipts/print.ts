/**
 * Printing a proof the app itself witnessed — `POST /receipts`.
 *
 * Two of the four receipt kinds are the app's to print: **pairing**, when a
 * pendant is bound to the account (O7), and **plan**, when a tier is paid
 * for (U2). The other two are the backend's — a task's receipt comes out of
 * `POST /tasks/:id/done` in the same transaction that marks it done, and a
 * conversation's comes out of the pipeline.
 *
 * Printing server-side rather than drawing a slip locally is the point: the
 * receipts roll on Home is `GET /receipts`, so a pairing that only ever
 * existed as pixels on the O7 screen would be a proof you could not find
 * again. The stamp is chosen by the server from the kind (`pairing → READY`,
 * `plan → UNLOCKED`), never sent.
 *
 * Failure never blocks the screen that called it. A receipt that did not
 * print is a receipt missing from the roll, not a pairing that did not
 * happen — so every caller here fires and forgets.
 */
import { request } from '../api/client';

export type PrintableKind = 'pairing' | 'plan';

export interface ReceiptRow {
  k: string;
  v: string;
  ok?: boolean;
}

/** The wire shape, matching T3b's `Receipt` (`internal/api/receipts.go`). */
export interface Receipt {
  receiptId: string;
  userId: string;
  kind: 'task' | 'pairing' | 'plan' | 'conversation';
  taskId?: string;
  recordingId?: string;
  title: string;
  quote?: string;
  rows: ReceiptRow[];
  stamp: 'DONE' | 'READY' | 'UNLOCKED' | 'FILED';
  createdAt: string;
}

export interface PrintInput {
  kind: PrintableKind;
  title: string;
  quote?: string;
  rows?: ReceiptRow[];
}

/**
 * Print one. The backend caps the rows (12 kept, keys 40, values 160) and
 * refuses more than 24, so the caller sends what it has and does not count.
 */
export function printReceipt(input: PrintInput): Promise<{ receipt: Receipt }> {
  return request<{ receipt: Receipt }>('POST', '/receipts', input);
}

/**
 * Print one and swallow whatever goes wrong.
 *
 * The two callers are onboarding screens whose job is to move the person
 * forward; neither has anything useful to say about a 502, and neither
 * should stop for one. Returns the receipt when there is one, so a screen
 * that wants to link to it can.
 */
export async function printQuietly(input: PrintInput): Promise<Receipt | undefined> {
  try {
    const { receipt } = await printReceipt(input);
    return receipt;
  } catch (err) {
    console.warn('[receipts] not printed:', (err as Error)?.message ?? err);
    return undefined;
  }
}
