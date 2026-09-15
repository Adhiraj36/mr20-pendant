# GitLoom memory, archive, categories, and chat-with-AI

Date: 2026-08-21. Status: approved by Kartik in conversation; implementation follows this document.

## Context

The ingest pipeline (pendant → phone → S3 → SQS → Deepgram → Bedrock enrichment →
DynamoDB) already exists and works. This project adds a memory layer and a chat
surface on top of it, plus the pipeline and UX changes they imply.

Decisions were made explicitly with the user; none of the following is open:

| Decision | Choice |
|---|---|
| Fact extraction | GitLoom's own ingestion pipeline extracts from the raw diarized transcript. Our model does not pre-extract. |
| Chat model path | Claude Haiku 4.5 via Bedrock (`AnthropicBedrock` client), no Anthropic API key. |
| Categories | Ships with a curated set; user can add/rename/delete. Enrichment auto-assigns from the current set. |
| Chat shape | Multiple conversations, list screen, GitLoom auto-titles. |
| Search | Removed end to end: app tab, `/search` route, SearchFn, `searchBlob`. |
| Archived audio | Moved to an `archived/` S3 prefix with a 30-day lifecycle expiry. |
| Upload retry | Foreground-only: app foreground, periodic flush, exponential backoff. No OS background tasks. |
| Chat delivery | Streaming, via a Lambda Function URL with response streaming. |
| Enrichment model | Haiku 4.5 (was Sonnet 4.5). |
| Processor concurrency | Hard-coded constant, 4. |

GitLoom credentials: Secrets Manager secret `mr20/gitloom` (already created, key
`apiKey`), referenced by the stack with `fromSecretNameV2` — never a new secret
resource. The same key is in `backend/.env` (gitignored) for local runs.

## 1. Pipeline changes (backend)

### GitLoom ingestion

New module `backend/src/shared/gitloom.ts` wrapping the `@gitloomhq/sdk` client
(API key from the secret, cached per container like the Deepgram key).

In `processor.ts`, after the transcript is stored and enrichment succeeds:

1. Ensure the namespace exists: namespace = the recording's `userId` (Cognito
   sub). `createNamespace` is idempotent; call it before the first write and
   tolerate "already exists".
2. `remember` (`POST /v1/memories`) with:
   - `messages`: one `user` turn containing the diarized dialogue
     (`asDialogue(transcript)`), since the pendant conversation is overheard
     speech, not a chat.
   - `session_id`: the recordingId.
   - `date`: the recording's `startedAt` — GitLoom stamps memories with the
     conversation's real date, and a backfill must not claim everything
     happened today.
3. The call returns 202 and extraction is asynchronous server-side; there is
   nothing to poll.

Failure isolation: the ingest is retried in-process (3 attempts, 1s/4s/9s
backoff). On final failure the row records `memoryStatus: 'failed'` and the
recording still completes as `ready` — a GitLoom outage must not throw, because
an SQS redelivery would re-run Deepgram at real cost. `POST
/recordings/{id}/retry` is extended: for a row that is `ready` with
`memoryStatus 'failed'`, it re-fires only the ingest (reading the stored
transcript from S3) instead of re-queueing the whole pipeline.

`memoryStatus` field on the recording row: `'ingested' | 'failed' | 'skipped'`
(skipped = archived recordings, nothing to remember). Absent on rows that
predate this feature.

### No-speech → archived

In `processor.ts`, when the transcript comes back empty (`!transcript.text.trim()`,
the same test `enrich` uses today):

- Copy the S3 object from `audio/<sub>/<id>.mp3` to `archived/<sub>/<id>.mp3`,
  delete the original, and update `audioKey` on the row.
- Set status `archived` (new `RecordingStatus` member), `memoryStatus:
  'skipped'`. No enrichment call, no GitLoom call.
- The bucket gains a lifecycle rule: objects under `archived/` expire after 30
  days. The row survives as a record after the audio expires; the presigned
  audio endpoint keeps working until then because it reads `audioKey`.

### Enrichment

- Model: Haiku 4.5 on Bedrock. `bin/app.ts` default `bedrockModelId` changes to
  the Haiku 4.5 inference-profile id (exact id resolved from the model catalog
  at implementation time).
- Prompt gains a `category` output: the user's current category names are
  passed into the prompt, and the model must answer with exactly one of them or
  `null`. The processor validates the reply against the list; anything else
  becomes `null` (uncategorized). Stored as `categoryId` on the row.

### Concurrency and search removal

- `const PROCESSOR_CONCURRENCY = 4` in `lib/mr20-stack.ts`, applied as
  `reservedConcurrentExecutions` on ProcessorFn.
- Deleted: `src/api/search.ts`, SearchFn, the `/search` route, the `searchBlob`
  field write in `processor.ts`, and the app's Search tab (replaced by Chat).

## 2. Categories

### Model

A category is `{ id, name }` where `id` is a stable slug minted at creation and
`name` is the display label. Recordings store `categoryId`, so a rename never
orphans anything; deleting a category leaves its recordings uncategorized
(client renders "Uncategorized" for a `categoryId` no longer in the set).

Storage: one per-user prefs item in the existing DynamoDB table, following the
table's key scheme (`USER#<sub>` / `PREFS`). Seeded on first read with the
curated defaults: Work, Personal, Family, Health, Ideas, Errands.

### API

- `GET /categories` — the user's set (seeding it if absent).
- `PUT /categories` — replaces the full list (client sends the edited array;
  ids of existing categories are preserved by the client, new entries get ids
  minted server-side). Max 24 categories, names 1–32 chars.
- `PATCH /recordings/{id}` accepts `categoryId` (validated against the set, or
  null to clear).

### App UX

- **Library filter**: a horizontal chip row pinned above the list — `All ·
  <categories with ≥1 recording> · Archive`. Archive is a fixed last chip and
  the only place archived rows appear. Selecting a chip filters client-side.
- **Recording detail**: a category chip row — current one highlighted, one tap
  moves the recording. The last element is an edit affordance opening the
  manage screen.
- **Manage screen**: add / rename / delete, plain list UI in the app's design
  language. Deleting warns that its conversations become uncategorized.
- Rows in the library show the category as a small pill next to the status.

## 3. Upload retry and processing UX (app)

- The manifest entry gains `attempts` and `nextAttemptAt`. `flushUploads` skips
  entries whose `nextAttemptAt` is in the future; a failure sets
  `nextAttemptAt = now + min(2^attempts minutes, 30 min)`; success clears both.
- Triggers: on app foreground (AppState listener), every 2 minutes while the
  app is open, and the existing on-focus flush. All funnels through one
  in-flight guard so passes never overlap.
- Detail screen while `uploaded`/`processing`/`archived`: audio is playable —
  the local file when the phone still holds it, else the presigned URL — and
  the recorded time, duration, and status are shown. (The `ready` path and
  status pills already exist; this extends playback to pre-`ready` states.)

## 4. Chat with AI — backend

New Lambda `backend/src/api/chat.ts`, exposed two ways:

- **Streaming Function URL** (`awslambda.streamifyResponse`) for `POST /chat` —
  API Gateway HTTP APIs cannot stream. Auth: `Authorization: Bearer <idToken>`
  verified in-function with `aws-jwt-verify` against the user pool. CORS
  headers set manually.
- **`GET /chats`** on the existing authenticated HTTP API (same Lambda, non
  streaming handler path): the conversation list via the SDK's
  `conversations.list()`, returning id, title, updated-at.

The streaming request body: `{ conversationId, message }` — conversation ids
are client-minted UUIDs; the SDK creates the conversation on first use.

Per turn, the handler:

1. Verifies the JWT; namespace = token's `sub`.
2. `conversations.create(id, …).load()` (cached per container).
3. `withContext(message)` — GitLoom retrieval injected as background.
4. Streams from `AnthropicBedrock` Haiku 4.5 with the SDK's `anthropicTools`
   (`recall_memory`, `remember_memory`). Tool calls are executed against
   GitLoom (`recall` / `remember`) and the loop continues until a final answer.
5. Emits SSE events: `{type:'delta', text}`, `{type:'tool', name}`,
   `{type:'done'}`, `{type:'error', message}`.
6. Appends the user turn and final assistant turn with the provider's real
   usage. Compaction, chat-memory ingestion, and auto-titles run on the SDK's
   defaults.

The wrapper (`withMemory`) is not used here — it assumes non-streaming
responses — the Conversation primitives are the supported lower-level surface.

Stack: the chat Lambda gets the GitLoom secret, Bedrock invoke (streaming)
permission, a Function URL with `invokeMode: RESPONSE_STREAM`, and a
`ChatStreamUrl` CloudFormation output that `scripts-sync-config.sh` carries
into the mobile config.

## 5. Chat with AI — app

The Search tab becomes **Chat**:

- **Conversation list**: newest first, GitLoom titles (untitled shows "New
  conversation"), relative time, a compose button. Conversation delete only if
  the SDK exposes it (checked at implementation; otherwise omitted).
- **Thread screen**: message bubbles in the app's design language, streamed
  text rendered as tokens arrive (via `expo/fetch`, which supports response
  streaming in this SDK), a typing indicator before the first token, and a
  subtle inline marker when the assistant recalled or saved a memory
  (`{type:'tool'}` events).
- Tab icon: an icons8 chat icon supplied by the user; until it lands in
  `assets/`, a placeholder glyph is used.

## Error handling summary

| Failure | Behaviour |
|---|---|
| GitLoom down during ingest | 3 in-process retries → `memoryStatus 'failed'`, recording still `ready`; manual re-ingest via `/retry`. |
| GitLoom down during chat | Tool call / context fetch errors degrade to answering without memory; the turn is not lost. |
| Bedrock throttled in chat | SSE `error` event; client shows a retry affordance on the failed turn. |
| Upload failure | Backoff via `nextAttemptAt`; visible as the existing "On phone" status. |
| Chat JWT invalid | 401 before any model call. |

## Testing

- Backend (`node --test`): ingest retry/failure isolation (GitLoom client
  faked), archive branch (empty transcript → status/key move calls), category
  validation in enrichment parsing, categories handler (seed, PUT validation),
  chat auth rejection and SSE event framing (pure helpers extracted for
  testability).
- Mobile: `tsc` and existing protocol tests stay green; manifest backoff logic
  unit-tested (pure function).
- Manual: simulator run of chat streaming + library filters; a real recording
  end-to-end after deploy.

## Resolved at implementation time (lookups, not decisions)

- Exact Bedrock inference-profile id for Haiku 4.5.
- GitLoom API base URL (SDK default from its docs).
- Whether `conversations` supports delete.

## Addendum (same day): backend ports to Go

Decided after the sections above were approved; supersedes any TS-specific
implementation detail in them, changes no product behaviour.

- **The entire application backend is Go** — one module at `backend/go/`, one
  `cmd/<function>/` per Lambda (auth triggers, devices, recordings, categories,
  processor, DLQ reaper, chat), shared code under `internal/`.
- **CDK stays TypeScript.** Same stack, same logical IDs; `NodejsFunction`
  swaps to Go bundling (`provided.al2023`, arm64). Retained resources (user
  pool, table, bucket) are never replaced.
- **AI calls go through `github.com/MelloB1989/karma/ai`** (Bedrock provider):
  enrichment and the chat loop both.
- **GitLoom via `github.com/GitLoomHQ/gitloom-go`**, which wraps karma
  natively: chat uses `gitloom.WrapKarma(...)` + `ChatId` on karma's
  `AIChatHistory` — conversation window, memory injection, storage, compaction
  and titles are the wrapper's job. Transcript ingestion uses the client's
  memories API directly, as in the main spec.
- The TS Lambda sources under `backend/src/` are deleted once the Go port
  deploys and the auth + pipeline flows re-verify.

### Addendum 2: the HTTP API is one Fiber app

- All HTTP routes (devices, recordings, categories, chats list, chat stream)
  are a single Fiber v2 app (matching karma's Fiber major) in `cmd/api`,
  deployed as one Lambda with the AWS Lambda Web Adapter layer and a Function
  URL in RESPONSE_STREAM mode — native Fiber, SSE chat streaming, still
  scales to zero.
- API Gateway and its JWT authorizer are removed; Cognito id-token
  verification is Fiber middleware (JWKS cached in-process).
- The mobile config's `apiUrl` becomes the Function URL. Event-driven Lambdas
  (auth triggers, processor, DLQ reaper) are unchanged plain Go handlers.

## Addendum 3 (same day): chat delete, pendant cleanup, WiFi transfers

- **Conversation delete** is a real GitLoom feature now: `DELETE
  /v1/conversations/{id}` (server handler + gateway route on gitloom main,
  awaiting the user's cloud deploy), `DeleteConversation` in gitloom-go
  v0.3.2, `DELETE /chats/:id` in our backend, long-press delete in the app
  with local tombstones covering the deploy gap. Extracted memories survive
  by design. Conversation ids are now owner-prefixed (`<sub>.<clientId>`)
  in GitLoom, closing cross-user access to chats by guessed id.
- **Pendant cleanup**: `deleteFile` (the audited D& path) + `freeUpSpace` —
  deletes from the device only recordings whose backend status is ready or
  archived, 2 s between deletes, recording paused and restored. Surfaced as
  an "On the pendant" tile with reclaimable bytes and a confirm dialog.
- **WiFi transfers**: files ≥ 3 MB pull over the pendant's AP (TCP
  192.168.200.1:8475, five-byte end marker, per the vendor sheet) via
  react-native-wifi-reborn (auto-join; iOS HotspotConfiguration entitlement)
  and react-native-tcp-socket. One AP session per sync pass, opened lazily,
  closed before uploads need the real network; any WiFi failure downgrades
  the pass to BLE. Modules load lazily, so a dev client built before them
  still syncs over BLE. **A new dev-client build is required for WiFi.**
