/**
 * Chat sessions with Mira, held outside the screens.
 *
 * A reply streams into this store, not into component state: leaving the
 * thread mid-answer must not kill the turn, and two conversations must be
 * able to stream at once. The screen is a thin view over its conversation's
 * slice; re-entering re-attaches to whatever is in flight.
 */
import { create } from 'zustand';
import {
  api, streamChatTurn, type ChatMessage, type ChatAttachment, type ChatToolEvent,
} from '../api/client';

/** One managed step shown under a reply: memory searched, memory written. */
export interface ToolStep {
  name: string;
  status: 'start' | 'done' | 'failed';
  hits?: number;
}

export interface Bubble extends ChatMessage {
  /** Still receiving deltas. */
  streaming?: boolean;
  /** The turn failed; retrying replays the question. */
  failed?: boolean;
  /** Steps Mira ran around this reply (assistant bubbles only). */
  steps?: ToolStep[];
}

/** A file staged in the composer, before or during upload. */
export interface PendingAttachment {
  uri: string;
  name: string;
  mime: string;
  sizeBytes: number;
}

interface Conversation {
  messages: Bubble[];
  busy: boolean;
  title?: string;
  /** History fetched at least once; a new chat has nothing to fetch. */
  loaded: boolean;
}

interface ChatState {
  conversations: Record<string, Conversation>;

  /** Fetch stored history once per conversation; cheap no-op afterwards. */
  load: (id: string) => Promise<void>;
  send: (id: string, message: string, attachments?: PendingAttachment[]) => Promise<void>;
  retry: (id: string) => void;
  /** Forget local state after a delete. */
  drop: (id: string) => void;
}

const empty = (): Conversation => ({ messages: [], busy: false, loaded: false });

/** Push each staged file to S3 through its presigned URL; returns the keys. */
async function uploadAttachments(
  conversationId: string,
  pending: PendingAttachment[],
): Promise<{ key: string; name: string }[]> {
  const out: { key: string; name: string }[] = [];
  for (const att of pending) {
    const { key, uploadUrl } = await api.presignChatAttachment({
      conversationId, name: att.name, mime: att.mime, sizeBytes: att.sizeBytes,
    });
    const { File } = await import('expo-file-system');
    const bytes = await new File(att.uri).bytes();
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': att.mime },
      body: bytes,
    });
    if (!put.ok) throw new Error(`upload failed (${put.status})`);
    out.push({ key, name: att.name });
  }
  return out;
}

export const useChat = create<ChatState>((set, get) => {
  const update = (id: string, patch: Partial<Conversation>) =>
    set((s) => ({
      conversations: {
        ...s.conversations,
        [id]: { ...(s.conversations[id] ?? empty()), ...patch },
      },
    }));

  const patchLast = (id: string, fn: (last: Bubble) => Bubble) =>
    set((s) => {
      const conv = s.conversations[id];
      if (!conv || !conv.messages.length) return s;
      const messages = [...conv.messages];
      messages[messages.length - 1] = fn(messages[messages.length - 1]);
      return { conversations: { ...s.conversations, [id]: { ...conv, messages } } };
    });

  /** Fold a tool event into the reply's step list: start appends, done/failed resolve. */
  const applyTool = (id: string, event: ChatToolEvent) =>
    patchLast(id, (last) => {
      const steps = [...(last.steps ?? [])];
      const i = steps.findIndex((s) => s.name === event.name && s.status === 'start');
      if (event.status === 'start') {
        if (i === -1) steps.push({ name: event.name, status: 'start' });
      } else if (i !== -1) {
        steps[i] = { name: event.name, status: event.status, hits: event.hits };
      } else {
        steps.push({ name: event.name, status: event.status, hits: event.hits });
      }
      return { ...last, steps };
    });

  return {
    conversations: {},

    load: async (id) => {
      const existing = get().conversations[id];
      // In-flight or already-loaded conversations keep their live state; a
      // refetch mid-stream would overwrite the reply being written.
      if (existing?.loaded || existing?.busy) return;
      try {
        const chat = await api.getChat(id);
        const current = get().conversations[id];
        if (current?.busy) return; // a send started while history was in flight
        update(id, { messages: chat.messages, title: chat.title || undefined, loaded: true });
      } catch {
        // New conversation: nothing stored yet.
        update(id, { loaded: true });
      }
    },

    send: async (id, raw, attachments = []) => {
      const message = raw.trim();
      const conv = get().conversations[id] ?? empty();
      if ((!message && !attachments.length) || conv.busy) return;

      // The user's turn appears at once, previewing local files while they
      // upload; the reply bubble follows and the stream writes into it.
      const shown: ChatAttachment[] = attachments.map((a) => ({
        key: '', name: a.name, mime: a.mime, url: a.uri,
      }));
      update(id, {
        busy: true,
        messages: [
          ...conv.messages.filter((b) => !b.failed),
          { role: 'user', text: message, attachments: shown.length ? shown : undefined },
          { role: 'assistant', text: '', streaming: true },
        ],
      });

      try {
        const uploaded = await uploadAttachments(id, attachments);
        await streamChatTurn(id, message, {
          attachments: uploaded.length ? uploaded : undefined,
          onDelta: (delta) =>
            patchLast(id, (last) => ({ ...last, text: last.text + delta })),
          onTool: (event) => applyTool(id, event),
        });
        patchLast(id, (last) => ({ ...last, streaming: false }));
      } catch {
        patchLast(id, () => ({
          role: 'assistant',
          text: 'That did not go through. Tap to try again.',
          failed: true,
        }));
      } finally {
        update(id, { busy: false });
      }
    },

    retry: (id) => {
      const conv = get().conversations[id];
      if (!conv || conv.busy) return;
      const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
      if (!lastUser) return;
      const cut = conv.messages.findLastIndex((b) => b.role === 'user');
      update(id, { messages: conv.messages.slice(0, cut) });
      // Local previews are gone after a reload; retry resends the words.
      void get().send(id, lastUser.text);
    },

    drop: (id) =>
      set((s) => {
        const { [id]: _, ...rest } = s.conversations;
        return { conversations: rest };
      }),
  };
});
