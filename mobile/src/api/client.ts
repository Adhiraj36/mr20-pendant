/**
 * Typed client for the pendant backend.
 */
import { File, UploadType } from 'expo-file-system';
import { config } from './config';
import { currentIdToken, requestSignOut } from './auth';
import { fixtureResponse, fixtureChatTurn } from '../dev/fixtures';

export type RecordingStatus = 'pending' | 'uploaded' | 'processing' | 'transcribed' | 'ready' | 'archived' | 'failed';

/** Whether the conversation reached the memory store. */
export type MemoryStatus = 'ingested' | 'failed' | 'skipped';

/** A user-editable conversation category. The id is stable across renames. */
export interface Category {
  id: string;
  name: string;
}

export interface ActionItem {
  text: string;
  owner: number | null;
}

/**
 * One thing the conversation taught the memory layer.
 *
 * Ours, not GitLoom's: `Remember` returns nothing addressable, so the facts
 * a conversation produced come from our own enrichment pass and are stored
 * on the recording row (`[GL_FACT_IDS]`, T3b's report). The card that shows
 * them may therefore say exactly this many and no more.
 */
export interface Fact {
  text: string;
  kind: 'fact' | 'preference' | 'person' | 'decision';
}

export interface SpeakerProfile {
  label: string;
  description?: string;
}

export interface Recording {
  recordingId: string;
  status: RecordingStatus;
  deviceFolder: string;
  deviceFile: string;
  deviceMac: string;
  startedAt: string;
  durationSeconds: number;
  sizeBytes: number;
  /** Set when the pipeline produced an enhanced (denoised, silence-cut) version. */
  cleanKey?: string;
  title?: string;
  tags?: string[];
  summary?: string;
  actionItems?: ActionItem[];
  speakers?: Record<string, string>;
  /**
   * The pipeline's own reading of each voice, keyed like `speakers`: a label
   * (a name only when the conversation itself established it, otherwise the
   * role — "Doctor", "Auto driver") and a one-line description. Shown
   * wherever the wearer has not named that voice; `speakers` always wins.
   */
  speakerProfiles?: Record<string, SpeakerProfile>;
  speakerCount?: number;
  categoryId?: string | null;
  memoryStatus?: MemoryStatus;
  /** What this conversation taught the memory layer. Empty until enrichment ran. */
  facts?: Fact[];
  /**
   * How many times this conversation has been filed. 1 on the first ingest,
   * bumped by a speaker rename that re-files it with the names — which is
   * the whole of what `REMEMBERED · v2` claims (`[GL_SUPERSEDE]`).
   */
  memoryIngestVersion?: number;
  /** S3 key of the exact dialogue that was sent. Never shown; proof it exists. */
  memoryDialogueKey?: string;
  /** The speaker map as it was sent, so a rename can tell whether it changed. */
  memorySpeakers?: Record<string, string>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A row of `GET /chats`. T3b made this our own DynamoDB row rather than a
 * proxy of GitLoom's capped list, so it gained `kind`, `pinned`, `archived`
 * and `exchanges` — a superset of what the old shape carried, which is why
 * nothing that only reads `id`/`title`/`updatedAt` had to change.
 */
export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  kind?: 'text' | 'voice';
  pinned?: boolean;
  archived?: boolean;
  exchanges?: number;
  createdAt?: string;
}

export interface ChatAttachment {
  key: string;
  name: string;
  mime: string;
  /** Presigned GET, present on history responses; local file URI before upload. */
  url?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  attachments?: ChatAttachment[];
}

/** One managed step Mira runs around a reply, surfaced as a tool event. */
export interface ChatToolEvent {
  name: 'memory.recall' | 'memory.ingest' | 'task.sent' | string;
  status: 'start' | 'done' | 'failed';
  hits?: number;
}

export interface Utterance {
  speaker: number;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

export interface Transcript {
  recordingId: string;
  language: string;
  text: string;
  utterances: Utterance[];
  model: string;
  durationSeconds: number;
}

export interface PairedDevice {
  mac: string;
  peripheralId: string;
  name: string;
  firmware?: string;
  batteryPercent?: number;
  freeMb?: number;
  totalMb?: number;
  lastSeenAt?: string;
  pairedAt: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Signals the UI should bounce back to sign-in. */
export class UnauthenticatedError extends ApiError {
  constructor() {
    super(401, 'signed out');
  }
}

/** Nothing this API does should take longer than this. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Abort on timeout, and honour a caller's signal too.
 *
 * Without this a stalled connection hangs a sync pass indefinitely, which the
 * UI can only show as a spinner that never stops.
 */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request timed out')), ms);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort);
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * The one transport: a bearer token, a timeout, and a 401 that signs out.
 *
 * Exported so a surface that is large enough to own its own file — `plan.ts`
 * — can reach the backend without re-implementing any of that. Everything
 * small enough to be one line still lives in `api` below.
 */
export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  // Fixtures answer before the token is asked for, which is the point: a
  // simulator with no Clerk session still renders every screen. `__DEV__`
  // makes the whole branch dead code in a production build.
  if (__DEV__) {
    const canned = await fixtureResponse(method, path, body);
    if (canned !== undefined) return canned as T;
  }

  const token = await currentIdToken();
  if (!token) throw new UnauthenticatedError();

  const guard = withTimeout(init.signal, init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: guard.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(0, `${method} ${path} timed out`);
    }
    throw err;
  } finally {
    guard.done();
  }

  if (response.status === 401) {
    // The token was rejected outright; a refresh will not help.
    await requestSignOut();
    throw new UnauthenticatedError();
  }
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new ApiError(response.status, (payload as { error?: string }).error ?? response.statusText);
  }
  return payload as T;
}

export const api = {
  // -- devices -------------------------------------------------------------

  pairDevice: (input: {
    mac: string;
    peripheralId: string;
    name?: string;
    firmware?: string;
    wifiFirmware?: string;
    batteryPercent?: number;
    freeMb?: number;
    totalMb?: number;
  }) => request<{ mac: string } & PairedDevice>('POST', '/devices', input),

  listDevices: () => request<{ devices: PairedDevice[] }>('GET', '/devices'),

  updateTelemetry: (
    mac: string,
    telemetry: { batteryPercent?: number; freeMb?: number; totalMb?: number; firmware?: string },
  ) => request<void>('PATCH', `/devices/${mac}`, telemetry),

  unpairDevice: (mac: string) => request<void>('DELETE', `/devices/${mac}`),

  // -- push notifications --------------------------------------------------

  /** Re-sent on every launch: the OS may reissue a token at any time. */
  registerPushToken: (token: string, platform: 'ios' | 'android') =>
    request<void>('POST', '/push/tokens', { token, platform }),

  forgetPushToken: (token: string) =>
    request<void>('DELETE', `/push/tokens/${encodeURIComponent(token)}`),

  // -- recordings ----------------------------------------------------------

  /** Register a device file and get a presigned URL to PUT the audio to. */
  registerRecording: (input: {
    deviceFolder: string;
    deviceFile: string;
    deviceMac: string;
    startedAt?: string;
    durationSeconds?: number;
    sizeBytes?: number;
  }) =>
    request<{ recording: Recording; uploadUrl: string | null; alreadyHave: boolean }>(
      'POST', '/recordings', input,
    ),

  confirmUpload: (id: string) => request<Recording>('POST', `/recordings/${id}/uploaded`),

  listRecordings: (cursor?: string) =>
    request<{ recordings: Recording[]; cursor?: string }>(
      'GET', `/recordings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  getRecording: (id: string) =>
    request<{ recording: Recording; transcript: Transcript | null }>('GET', `/recordings/${id}`),

  /** Enhanced audio when it exists; `raw: true` asks for the untouched original. */
  getAudioUrl: (id: string, options: { raw?: boolean } = {}) =>
    request<{ url: string; expiresIn: number; variant: 'enhanced' | 'original' }>(
      'GET', `/recordings/${id}/audio${options.raw ? '?raw=1' : ''}`,
    ),

  patchRecording: (
    id: string,
    patch: { title?: string; speakers?: Record<string, string>; tags?: string[]; categoryId?: string | null },
  ) => request<Recording>('PATCH', `/recordings/${id}`, patch),

  retryRecording: (id: string) => request<Recording>('POST', `/recordings/${id}/retry`),

  deleteRecording: (id: string) => request<void>('DELETE', `/recordings/${id}`),

  // -- categories ----------------------------------------------------------

  getCategories: () => request<{ categories: Category[] }>('GET', '/categories'),

  putCategories: (categories: Category[]) =>
    request<{ categories: Category[] }>('PUT', '/categories', { categories }),

  // -- chat ----------------------------------------------------------------

  /**
   * One page of conversations.
   *
   * Voice and archived threads are filtered server-side **after** the page is
   * read, so a page can come back short or even empty with a cursor still
   * set: follow the cursor until it is absent rather than stopping on a short
   * page (T3b's report, `GET /chats`).
   */
  getChats: (cursor?: string) =>
    request<{ chats: ChatSummary[]; cursor?: string }>(
      'GET', `/chats${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  getChat: (id: string) =>
    request<{ id: string; title: string; messages: ChatMessage[] }>(
      'GET', `/chats/${encodeURIComponent(id)}`,
    ),

  deleteChat: (id: string) => request<void>('DELETE', `/chats/${encodeURIComponent(id)}`),

  getProfile: () => request<{ name?: string; avatarUrl?: string }>('GET', '/profile'),

  updateProfile: (input: { name?: string; avatarKey?: string }) =>
    request<{ name?: string; avatarUrl?: string }>('PUT', '/profile', input),

  presignAvatar: (input: { mime: string; sizeBytes: number }) =>
    request<{ key: string; uploadUrl: string }>('POST', '/profile/avatar', input),

  presignChatAttachment: (input: {
    conversationId: string; name: string; mime: string; sizeBytes: number;
  }) => request<{ key: string; uploadUrl: string }>('POST', '/chat/attachments', input),
};

/**
 * One chat turn, streamed.
 *
 * Uses expo/fetch rather than React Native's global fetch because only the
 * former exposes the response as a byte stream; RN's buffers the whole body,
 * which would turn streaming into a long blank wait. Events arrive as SSE
 * `data:` lines of {type: 'delta'|'done'|'error', text?}.
 */
export async function streamChatTurn(
  conversationId: string,
  message: string,
  handlers: {
    onDelta: (text: string) => void;
    onTool?: (event: ChatToolEvent) => void;
    attachments?: { key: string; name: string }[];
    /** `voice` picks the spoken system prompt server-side; the app only types. */
    kind?: 'text' | 'voice';
    signal?: AbortSignal;
  },
): Promise<void> {
  if (__DEV__ && await fixtureChatTurn(conversationId, message, handlers)) return;

  const token = await currentIdToken();
  if (!token) throw new UnauthenticatedError();

  const { fetch: streamingFetch } = await import('expo/fetch');
  const response = await streamingFetch(`${config.apiUrl}/chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify({
      conversationId,
      message,
      attachments: handlers.attachments,
      kind: handlers.kind ?? 'text',
    }),
    signal: handlers.signal ?? null,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail = response.statusText;
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? detail;
    } catch { /* not JSON */ }
    if (response.status === 401) {
      await requestSignOut();
      throw new UnauthenticatedError();
    }
    throw new ApiError(response.status, detail);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(0, 'the reply could not be streamed');

  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames end with a blank line; anything after the last one is a
    // partial frame that waits for the next chunk.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let event: { type: string; text?: string; name?: string; status?: string; hits?: number };
      try {
        event = JSON.parse(line.slice(6)) as typeof event;
      } catch {
        continue;
      }
      if (event.type === 'delta' && event.text) handlers.onDelta(event.text);
      else if (event.type === 'tool' && event.name) {
        handlers.onTool?.({
          name: event.name,
          status: (event.status as ChatToolEvent['status']) ?? 'done',
          hits: event.hits,
        });
      }
      else if (event.type === 'error') throw new ApiError(0, event.text || 'the assistant could not answer');
      else if (event.type === 'done') return;
    }
  }
}

/**
 * Upload audio straight to S3 with the presigned URL.
 *
 * expo-file-system streams the file from disk in native code, so a
 * multi-megabyte recording never passes through the JS heap.
 */
export async function uploadAudio(
  uploadUrl: string,
  fileUri: string,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const file = new File(fileUri);
  if (!file.exists) throw new ApiError(0, `local audio is missing: ${fileUri}`);

  let lastProgressAt = Date.now();

  const task = file.createUploadTask(uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    // Must match the ContentType the URL was signed with, or S3 rejects it.
    headers: { 'content-type': 'audio/mpeg' },
    mimeType: 'audio/mpeg',
    onProgress: ({ bytesSent, totalBytes }) => {
      lastProgressAt = Date.now();
      onProgress?.(bytesSent, totalBytes);
    },
  });

  // A 60 MB recording over a weak connection is slow but finite; a stalled
  // socket is not. Cancel rather than let a sync pass hang on it forever.
  const stallCheck = setInterval(() => {
    if (Date.now() - lastProgressAt > 90_000) task.cancel();
  }, 15_000);

  try {
    const result = await task.uploadAsync();
    if (result.status < 200 || result.status >= 300) {
      throw new ApiError(result.status, `upload rejected by S3: ${result.status}`);
    }
  } finally {
    clearInterval(stallCheck);
  }
}
