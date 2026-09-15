# A quality upgrade, a correction, and a new subsystem

Date: 2026-09-14. Status: approved in conversation; implementation follows
this document.

## Context

The ask was better transcript correction, task extraction and memory
extraction than the current single-shot Bedrock Haiku pass produces, using
the Claude Code container Lambda the user has already built and proven.
Separately, the user wants a way for the orchestrator to ask a question
mid-task.

**Three of the four things originally asked for already exist**, and that
reframes the whole project:

- Diff-based transcript correction already exists in
  `backend/go/internal/enrich/merge.go`. `MergeTranscripts` sends the
  Deepgram base and the Sarvam alternate reading to Bedrock Claude, which
  returns a JSON array of only the utterances it wants changed —
  `{"i": <index>, "text": "<corrected text>"}`. `ApplyCorrections`
  (`merge.go:68`) patches those onto the transcript's utterances, rebuilds
  the running text, and records the count as `transcript.MergedCorrections`
  (`merge.go:93`).
- Task and memory extraction already exists in
  `backend/go/internal/enrich/enrich.go`: one Bedrock Haiku 4.5 call
  (`DefaultModelID`, `enrich.go:69`, `"global.anthropic.claude-haiku-4-5-20251001-v1:0"`,
  overridable via `BEDROCK_MODEL_ID`, `enrich.go:72`) returns title, tags,
  summary, action items and facts — at most 12, 200 characters each
  (`enrich.go:189-190`) — plus a category. `tasksFromEnrichment`
  (`cmd/processor/main.go:429`, called at `main.go:358`) turns action items
  into task rows with deterministic ids `<recordingId>-<index>`
  (`main.go:441`), so SQS redelivery cannot mint the same task twice.
- The app-side task approval flow already exists end to end — proposed,
  approved, claimed by a daemon, done, receipted — as documented in
  `2026-09-11-daemon-tasks-design.md`.

So this document specifies a quality upgrade to two already-working passes,
a correction to an assumption about GitLoom, and one genuinely new
subsystem. It is not a greenfield build.

## Verified current state

**Pipeline.** Phone → presigned S3 PUT (`audio/<userSub>/<recordingId>.mp3`,
`internal/api/recordings.go:74`) → S3 `OBJECT_CREATED` on the `audio/`
prefix → SQS `ingestQueue` → `ProcessorFn`. `ProcessorFn` runs audio cleanup
(`internal/audioclean`, DeepFilterNet3 + ffmpeg, best-effort with fallback
to the raw file), then Deepgram (`nova-3`, `diarize=true`,
`utterances=true`, `internal/deepgram/deepgram.go:60-107`) and Sarvam
(`saaras:v3`, `internal/sarvam`) concurrently, then `merge.go`, then
`enrich.go`, then tasks and GitLoom.

**Storage.** DynamoDB holds metadata only: a `Recording` row at
`PK=USER#<sub>`, `SK=REC#<startedAt>#<recordingId>`,
`GSI1PK=REC#<recordingId>` (`internal/ddb/ddb.go:6-7,285-286`) — the GSI
exists so the processor can find the row from the S3 key alone. The
transcript body lives in S3 at `transcripts/<userSub>/<recordingId>.json`
(`cmd/processor/main.go:272`) because an hour of speech with word timings
would crowd a DynamoDB item. Audio lives under `audio/`, enhanced audio
under `clean/` (`cleanKeyFor`, `main.go:90-91`), archived audio under
`archived/`.

**Lambdas.** CDK only, no SAM. All three Lambdas today (`ApiFn`,
`ProcessorFn`, `DlqReaperFn`) are Go on `PROVIDED_AL2023`, ARM64, zip assets
via `lambda.Code.fromAsset` (`backend/lib/mr20-stack.ts:159-162`) — zero
Node.js Lambdas, zero container-image Lambdas. `ProcessorFn`: 15-minute
timeout, 3008 MB memory ("memory is the CPU dial on Lambda; the denoiser is
compute-bound", `mr20-stack.ts:290-311`), 2 GiB ephemeral storage, and a
reserved `PROCESSOR_CONCURRENCY = 4` (`mr20-stack.ts:83,309`).
`ingestQueue`'s visibility timeout is 16 minutes, `maxReceiveCount: 4`,
`batchSize: 1` — "one recording per invocation keeps retries precise"
(`backend/lib/data-plane.ts:108-122`).

**Precedent for bundled binaries.** `ProcessorFn` already ships `ffmpeg`
(51 MB) and `deep-filter` (39 MB) inside its zip under `bin/`
(`FFMPEG_PATH`/`DEEP_FILTER_PATH`, `mr20-stack.ts:296-298`), invoked via
`os/exec` with `cmd.Env = append(os.Environ(), "HOME=/tmp")`
(`internal/audioclean/audioclean.go:134`) because the tool wants a writable
home for its runtime scratch. It is the same lesson the Claude Code
scaffold's own `HOME=/tmp` teaches, learned once already in this codebase.

**Tasks (LYZN backend, DynamoDB).** `internal/ddb/tasks.go`: `PK=USER#<sub>`,
`SK=TASK#<createdAt>#<taskId>`, `GSI1PK=TASKSTATUS#<sub>#<status>`
(`tasks.go:4-5`). States today are `proposed → approved → executing →
done | dismissed | failed` (`tasks.go:40-52`), enforced by conditional
updates (`taskTransitionInput`, `tasks.go:284`) so two phones cannot corrupt
a transition; a refused transition is `ddb.ErrTaskTransition`
(`tasks.go:71`) → HTTP 409. `CompleteTask` (`tasks.go:415`) is a
transactional write that closes a task and prints its receipt atomically.
Fields include `recordingId, utteranceIndex, text, owner, kind, status,
quote, dueAt, doneAt, receiptId, daemonId, claimedAt, leaseUntil`
(`tasks.go:82-108`).

**Daemon protocol.** `GET /daemons/work` (approved, unclaimed),
`POST /daemons/work/:taskId/claim` (approved → executing, conditional),
`POST /daemons/work/:taskId/result` (executing → done | failed,
transactional with receipt, idempotent —
`postDaemonWorkResult`, `internal/api/daemons.go:946-972`).
`releaseAbandoned` (`daemons.go:795-802`) sweeps stale claims back to
`approved` using `LeaseUntil`. `GET /daemons/history` returns
`{waiting, running, finished, plan}` — the desktop's "tickets" are Task rows
joined with receipts; there is no ticket table. Approving is gated by
`automationGate`, which answers **402**, not 403, so the app can open a plan
chooser (`daemons.go:121-131,204-211`).

**Auth.** Humans authenticate via Clerk JWT verified in-process
(`internal/authjwt`); there is no API Gateway authorizer because the API is
a bare Fiber Function URL with `authType: NONE`
(`mr20-stack.ts:223-226`). Daemons authenticate with a separate bearer
token: 32 random bytes, base64url, 43 characters, stored only as its
SHA-256 hash (`NewDaemonToken`, `HashDaemonToken`,
`internal/ddb/daemons.go:105-124`), minted from a 6-character, 5-minute
pairing code (`PairCodeLength`, `PairCodeTTL`, `daemons.go:137,139`).
Unpairing deletes the row — "the row is the credential's only anchor... no
revocation list to keep in step" (`daemons.go:382-385`).

**Push.** Expo Push Service (`internal/push`), five fixed events:
`recording.ready`, `recording.failed`, `tasks.proposed`, `plan.activated`,
`receipt.printed` (`internal/push/events.go:12-16`). There is no generic
feed model and no notifications-list screen; Home's TASKS segment plus deep
links are the whole "waiting on you" surface.

**GitLoom.** `internal/gitloomx`. `IngestTranscript` (`gitloomx.go:112`)
sends the whole diarized transcript as **one** `gl.Turn` —
`ambientFraming + AsDialogueWith(...)`, `SessionID=recordingID`,
`Date=startedAt` — skipped under 240 characters (`minIngestChars`,
`gitloomx.go:233`). `ambientFraming` (`gitloomx.go:215`) exists because a TV
documentary once got filed as the wearer's own biography.
`RememberFacts` (`gitloomx.go:156`) sends the distilled facts as a second
single framed blob, same shape. `IngestWithRetry` (`gitloomx.go:239`) is 3
attempts with attempt² backoff (1s, 4s); a final failure sets
`memoryStatus=failed` and never fails the SQS message, because Deepgram was
already paid for.

**GitLoom's hard limits at the pinned v0.3.4 — load-bearing for §2.** The
installed `gitloom-go@v0.3.4` has no batch-write primitive and no
`Supersedes`. It has exactly one delete call, `DeleteConversation`
(`conversation.go:139`), and its own doc comment says what it does and does
not do: it "removes a stored conversation outright — its messages,
compactions and branches. Memories already extracted from it live in the
namespace's repository and survive; forgetting facts is the memories API's
territory, not a side effect of tidying a chat list." That is a different
feature — GitLoom's managed-conversation API (`NewConversation`, `Append`,
`Load`) — which `gitloomx` never calls; the pipeline only ever calls
`Remember` and `Recall`. So for the memories this pipeline writes, there is
no delete of any kind. `RememberOptions` carries `Namespace`, `SessionID`
and `Date` (`memory.go:76-81`); `RecallOptions` carries only `Namespace` and
`Limit` (`memory.go:105-108`) — `SessionID` is write-only, with no matching
filter on `Recall`, so a session's memories can never be read back as a
group. Deleting a recording writes a `Tombstone` row
(`internal/ddb/tombstones.go`) and `FilterTombstoned`
(`internal/gitloomx/recall.go:48`) suppresses hits client-side by
string-matching the recording id in the hit's path or snippet —
suppression at read time, not erasure. A `Write(ctx, []Memory, opts)` API
*with* `Path`, `Supersedes`, `Forget`, `Get`, `Tree`, `Topics` and `Graph`
exists (`write.go`) in an **untagged pseudo-version in the local module
cache**, `v0.3.1-0.20260807203502-1080a035640d`, but was never promoted to
a release, so it is not reachable via a normal `go get`.

**KARMAX comms and human-in-the-loop.** Discord, Telegram, Slack and
WhatsApp channels are all fully implemented, but nothing blocks on a human.
`comms.escalate` (`internal/agent/agent.go:485-529`) sends a fixed
permission-request string with no id and no correlation token, returns
`{"status":"permission_requested"}` immediately, and nothing waits. `propose`
writes a row and, on approval, starts a brand-new stateless turn from the
title and action alone — a code comment at `internal/recipes/run.go:163-164`
reads "The proposal id `ProposeTo` returns is not bound to anything — this
dialect never learned to bind it." `reply_to_id` is captured on every
inbound message and persisted (`internal/store/comms_store.go`,
`internal/store/migrations.go:117`) and read by nothing that correlates an
answer back to a question. Slack's interactive Approve/Reject
implementation (`internal/comms/slack/approvals.go`, `PostApproval`) and
the `EventApprovalDecision` it publishes (`internal/comms/manager.go:24`)
are unreachable dead code — nothing outside those two files calls
`PostApproval` or subscribes to the event. A genuine suspend/resume
primitive does exist — the `waiters` table plus the recipe `await:` verb
(`internal/store/waiter_store.go`, `internal/recipes/recipe.go:454`), which
could park on `comms.message` — but no shipped recipe uses it, and it is
reachable only from the recipe engine, not from the conversational agent.
KARMAX's own local task runner (`internal/runtime/taskrunner.go`) has a
`blocked` state whose comment reads "Blocked, done and failed all stop the
clock. Blocked comes back when the operator answers" (`taskrunner.go:152-153`),
resumed only by an explicit `task.update` call
(`internal/runtime/tasktools.go:154-167`) whose description says exactly
that: "Setting a blocked task back to working is what resumes it — the
runner leaves blocked tasks alone until somebody does that."

**The proven Claude Code Lambda scaffold.** The user built and ran this;
treat it as verified.

- `public.ecr.aws/lambda/python:3.13` — Amazon Linux 2023, glibc, not
  Alpine/musl, because the bundled CLI is glibc-linked.
- `pip install claude-agent-sdk>=0.2.152` pulls a platform-specific wheel
  containing a ~207 MB dynamically-linked ELF at
  `claude_agent_sdk/_bundled/claude`. This rules out zip packaging and means
  the image must be built for the architecture the function runs on;
  `docker buildx build --platform` and the function's `--architectures`
  must stay in sync, since a plain `docker build` on Apple Silicon bakes an
  aarch64 binary that fails on x86_64 with only "failed to start Claude
  Code."
- `ENV HOME=/tmp`, `CLAUDE_CONFIG_DIR=/tmp/.claude`,
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. The CLI writes config, transcripts
  and lockfiles under `$HOME` on startup, and Lambda's default `HOME` is
  read-only.
- The handler uses the stateless `query()` API with
  `permission_mode="bypassPermissions"`, `setting_sources=[]`,
  `allowed_tools=["Read","Write","Edit","Bash","Glob","Grep"]`, and passes
  the OAuth token through `options.env`.
- The token comes from Secrets Manager, cached in a module global so it is
  fetched once per cold start.
- `_prepare_tmp()` wipes `/tmp/work` every invocation, because `/tmp`
  survives warm reuse and a second task would otherwise inherit the first
  task's files.
- The time budget is `remaining_time - 20s`, wrapped in `asyncio.wait_for`,
  returning 504 rather than being hard-killed.
- Deploy: timeout 900s, memory 3008 MB (the vCPU dial — 3008 MB gives
  roughly 2 vCPU; at 512 MB the same task takes several times longer and
  costs more wall-clock), ephemeral storage 4096 MB. The image is roughly
  1 GB, so expect a few seconds of cold start and then warm reuse.

**Scaffold gaps to fix in this design, verified absent from it.** No use of
`ResultMessage.structured_output`. `total_cost_usd`, `usage` and
`model_usage` are all dropped on the floor. No `system_prompt`, no model
selection, no MCP. No logging at all — no `print`, no `logging` import.
No retry or idempotency guard, despite Lambda retrying async invocations by
default.

**A real footgun to fix.** The "never set `ANTHROPIC_API_KEY`" rule is
procedural only, not enforced. The SDK merges `options.env` on top of the
inherited environment, and the handler never unsets the key — so if it ever
lands in the function's environment, it flows straight to the CLI and
silently bills a Console account instead of using the subscription. A
one-line `os.environ.pop("ANTHROPIC_API_KEY", None)` at the top of the
handler makes the rule real instead of hoped-for.

**Bedrock is available but deliberately not used yet.** The bundled
binary's strings show first-class support — `CLAUDE_CODE_USE_BEDROCK`,
`CLAUDE_CODE_SKIP_BEDROCK_AUTH`, `ANTHROPIC_BEDROCK_BASE_URL`, a vendored
`BedrockRuntimeClient`, `ConverseCommand`/`ConverseStreamCommand`, and an
error string confirming fallback to the standard AWS credential chain. The
user has chosen to keep the subscription OAuth token for now, and that is a
deliberate, time-boxed decision, not an oversight. The risks are real and
worth naming once: per-account rate limits shared across every user's
recordings, a single point of failure, and consumer-subscription terms
sitting under a commercial multi-tenant backend. Migrating later is an
environment-variable change plus an IAM grant, not a rewrite.

| Decision | Choice |
|---|---|
| What ships | A quality upgrade to correction and extraction (§1), a correction to a GitLoom assumption (§2), and a new task-blocking subsystem (§3) |
| ProcessorFn's job | Stops after ASR. Marks the recording `transcribed`, writes the raw transcript, enqueues to a new `extractQueue` |
| ExtractFn | New: Python, container image, arm64, runs Claude Code, writes `corrections.json`/`tasks.json`/`memories.json` to `/tmp/work`, validates, uploads, enqueues to `applyQueue` |
| ApplyFn | New: Go, zip, small. Performs every DynamoDB/GitLoom/transcript write; the only thing that touches state |
| Fallback | `merge.go` + `enrich.go` stay as-is. When `ExtractFn` exhausts retries, `ApplyFn` runs the old Bedrock path directly |
| Memory batching | Already done (`RememberFacts`) — not a transport change. The upgrade is `Recall`-before-`Write`, for dedup |
| The untagged `Write([]Memory)` API | Not pinned. Recorded as an open question below |
| Task lifecycle | Gains one state: `blocked`, parked between two `executing`s |
| Question authority | The LYZN task row, not KARMAX's comms state — comms channels and the app are two delivery surfaces for the same row |
| Correlation | `reply_to_id`, finally read. Falls back to the single open question on a channel; asks which if more than one is open |
| Escape hatches | A question expiry that fails the task, and release of a pinned task when its daemon goes stale or unpairs |
| Bedrock migration | Deliberately deferred, not rejected — see above |
| `ANTHROPIC_API_KEY` | Explicitly popped from the environment at handler start |

## 1. The extraction pipeline

`ProcessorFn` stops after ASR. It marks the recording `transcribed` — a new
value; today's `RecordingStatus` enum runs `pending → uploaded → processing
→ ready | archived | failed` with no state between "processor picked it up"
and "transcript and enrichment written" — writes the raw transcript to S3 as
today, and enqueues to a new `extractQueue`. The two-engine merge leaves
`ProcessorFn`'s critical path entirely; it no longer runs there at all. The
app shows a usable transcript in seconds rather than waiting on Bedrock
correction and then an agent on top of it.

**Amendment, 2026-09-14 — `transcribed` is new, and that has a migration
cost.** Verified directly: `transcribed` does not exist anywhere today, and
this is a genuine addition to the enum, not a value already reserved for
it. The mobile client's own type is closed —
`RecordingStatus = 'pending' | 'uploaded' | 'processing' | 'ready' |
'archived' | 'failed'` (`mobile/src/api/client.ts:9`) — so it needs
widening before a client can even typecheck a `transcribed` row. At least
one reader already fails safe rather than crashing on a status it does not
recognise: `openRowKey`'s switch in `mobile/src/recordings/slip.ts:30-37`
falls through to `default: return null` for anything outside its four named
cases. That is the right shape to require everywhere status is read —
unknown-but-valid, not an error — but "does not crash" is not "shows the
right thing": today `processing` prints "TRANSCRIBING" on the slip, and by
this design's own premise a `transcribed` recording already has a readable
transcript sitting in S3. Whether the slip should keep saying
"TRANSCRIBING" through that window, say something else, or start showing
the transcript itself is a product decision this document does not make.
It only requires the discipline the accidental `default: null` already
demonstrates: nothing that switches on `status` may assume the enum it was
written against is still the whole enum.

`ExtractFn` is the container image: Python, arm64, 3008 MB, 15 minutes, its
own reserved concurrency, built on the proven scaffold above. It consumes
`extractQueue` at `batchSize: 1`, pulls the transcript and the Sarvam
alternate reading into `/tmp/work`, runs Claude Code with a system prompt,
and has the agent **write three JSON files**: `corrections.json` (the same
shape `ApplyCorrections` already accepts — an array of `{i, text}`
objects), `tasks.json`, and `memories.json`. It validates them, uploads them
to S3 under the recording's prefix, and enqueues to a new `applyQueue`.

**Amendment, 2026-09-14 — a fourth file: the agent's three-file contract left
no file for a recording's title.** Found in planning, not in the original
design: the three files above cover the extraction pass's *transactional*
output — a corrected transcript, tasks, memories — but never named where a
recording's title, tags, summary or category come from once `ExtractFn`
succeeds. `enrich.go`'s single Bedrock call produces all four today, and
that call is **kept as the fallback**, unchanged — so it still produces
them, but only on the fallback path. Without a fourth file, a recording
that goes through the successful, higher-quality extraction path would
reach `ready` with no title at all, while a recording whose extraction
*failed* and fell back to Haiku would get one. That is backwards: the
success path must not be visibly worse than the failure path, and the
agent is already reading the whole transcript, which is a better vantage
point for a title and a summary than a single Haiku pass over the same
text — that is the premise the upgrade rests on to begin with.

The agent now writes a **fourth file**, `summary.json` — named for what it
is rather than by analogy with the other three, which are all arrays of
extracted items; this one is a single object:

```
{
  "title":    "<string, 3-8 words, at most 200 characters>",
  "tags":     ["<lowercase tag, at most 40 characters>", ...],  // 0-5 tags
  "summary":  "<string, 2-4 sentences, at most 4000 characters>",
  "category": "<one name from the categories the agent was given, or null>"
}
```

Field names, types and caps are copied from `enrich.go`'s own contract
exactly, so `ApplyFn` writes into the same `Recording` fields the app
already reads (`title`, `tags`, `summary`, `categoryId`) rather than
inventing a parallel shape: `title` truncated to 200 characters
(`enrich.go:238`); `tags` capped at 5 entries, each truncated to 40
characters (`enrich.go:243-251`); `summary` truncated to 4000 characters
(`enrich.go:255`); `category` resolved from a name to the user's category
id via the existing `ResolveCategory` (`enrich.go:136`), which already
answers "" — no category — for anything it does not recognise, since "a
hallucinated category can never reach the table." `title` is the one field
this contract requires non-empty: a blank title was exactly the regression
being fixed, so a `summary.json` without one fails validation the same way
a `corrections.json` with a missing field does, and `ApplyFn` falls back to
`enrich.go` for the whole recording rather than accept a title-less row.
`summary` and `category` are not required non-empty — `enrich.go`'s own
`fallback()` already leaves `summary` empty rather than inventing one when
it cannot say anything honest, and a `category` of `null` (the agent found
no honest fit) is one of `enrich.go`'s own documented outcomes, not a
failure.

One thing does not carry over cleanly. `enrich.go` resolves a category by
name against the caller's live category list, fetched at the moment of the
call (`Enrich(t, categories)`, `enrich.go:266`). `ExtractFn` has no
DynamoDB access — deliberately: every DynamoDB, GitLoom and
transcript-patching path stays Go, on `ApplyFn`'s side, and giving the
extraction Lambda a second, narrower path to the same table would be the
"expensive tidiness for no benefit" this design already declined for the
rest of the split. So the category *names* travel with the extraction
request instead: `ProcessorFn` reads them once, alongside the transcript,
when it enqueues to `extractQueue`, and `ExtractFn` gives the agent that
list to choose from (or `null`) rather than a table it cannot query.
`ApplyFn` resolves the chosen name back to an id exactly as `enrich.go`
already does, on both paths now — the extracted path calls
`ResolveCategory` too, not only the fallback. A category renamed or
deleted in the window between `ProcessorFn` reading the list and `ApplyFn`
resolving the choice resolves to no category, the same outcome
`ResolveCategory` already gives an invented name — a live-edit race, not a
new failure mode.

Files rather than parsing the reply, deliberately: a file is deterministic —
no prose interleaving, no truncation — and the agent can re-read and fix
its own output before finishing. That self-check is most of what the
upgrade actually buys over a single-shot Bedrock call. `ResultMessage.
structured_output` should still be probed as a lighter-weight alternative
to the file convention, and the finding recorded once it is tried.

`ApplyFn` is Go, zip, small, and is the only thing in this design that
writes state: it patches the transcript via the existing `ApplyCorrections`,
mints tasks through `tasksFromEnrichment`'s deterministic id scheme, ships
memories to GitLoom, flips the recording to `ready`, and fires the push.

The split is deliberate. Every DynamoDB, GitLoom and transcript-patching
path is already Go and already correct, so reimplementing them in Python to
keep everything in one Lambda would be expensive tidiness for no benefit. It
also means a bad agent run retries without re-running ASR, and a GitLoom
outage retries without re-running the agent — three failure domains that
each retry independently instead of one Lambda retrying all of them
together.

`merge.go` and `enrich.go` are **kept as the fallback**, unchanged. If
`ExtractFn` exhausts its retries, `ApplyFn` runs the old Bedrock path
directly, so the recording still becomes useful even when the agent never
produces valid output. This is zero new code in the fallback itself — just
not deleting what already works.

## 2. Memory delivery, and a correction

The ask was to "send all memories at once so GitLoom's LLM step files them
properly." **That already happens.** `RememberFacts` concatenates every
fact for a recording into one framed blob and sends it in a single
`Remember` call — there was never a per-fact call to consolidate. State
this plainly rather than building a batching mechanism that already exists.

Given v0.3.4's limits above, the available upgrade is not the transport —
it is letting the agent **`Recall` before it writes**, so it does not
restate what GitLoom already holds for this person. That is real tool use
during the extraction turn, and it is the only dedup mechanism available
when nothing written can ever be deleted or superseded. The cost is a
`Recall` round trip per extraction, and the dedup it buys is best-effort:
recall is similarity-based, not exact-match, so it will miss some
duplicates and occasionally suppress something that was not actually a
repeat.

**Open question.** Whether to pin the untagged `Write([]Memory)` commit
(`v0.3.1-0.20260807203502-1080a035640d`) now, to get `Supersedes` and
`Forget` instead of write-once-and-suppress. Recommendation: don't, for
now — an untagged pseudo-version sitting only in the local module cache is
not a dependency a production pipeline should rest on, and there is no
guarantee its API matches whatever eventually ships as a tagged release.
It is the thing to watch for the next time gitloom-go cuts a version.

## 3. Tasks and the follow-up channel

The task lifecycle gains one state: `proposed → approved → executing →
blocked → executing → done | dismissed | failed`.

`blocked` stops the lease sweeper and pins the task to the daemon that
asked, so that daemon resumes with its own context rather than starting
cold. A `question` record hangs off the task: id, text, options when it is
a choice, who asked, when. **The LYZN task row is authoritative** — this
matters specifically because comms channels live in KARMAX while the app
lives in LYZN, so a question asked and answered entirely inside KARMAX's
own comms plumbing would otherwise never reach the app at all.

KARMAX posts a question up via a new `POST /daemons/work/:taskId/question`,
then may additionally deliver it over a configured comms channel. The app
gets it regardless, via a new `task.question` push event and an answer
affordance on the task detail screen. Either surface writes the answer to
the same row; the daemon picks it up from there and resumes.

Correlation uses `reply_to_id` — already captured on every inbound message
today and read by nothing. If the person did not use the reply affordance,
fall back to the single open question on that channel; if more than one is
open, ask which. This ambiguity is specific to comms channels: the app's
answer affordance lives on one task's detail screen, so it is never
ambiguous which question is being answered there.

Two escape hatches, because a pinned task is a leak: a question expires
after a configurable window and the task fails with a clear reason; and an
expired or unpaired daemon releases its pinned tasks rather than stranding
them — a different mechanism from the ordinary lease sweeper, since a
`blocked` task is deliberately parked rather than abandoned mid-execution,
and the ordinary sweeper must not reclaim it out from under a person who is
still expected to answer.

**Named gap, revised by the amendment below.** Slack's dead Approve/Reject
code is adjacent to this work and stays unrevived — see Out of scope.
`waiters`/`await:` is adjacent too, and this design **does** use it: a
claimed LYZN task runs inside a recipe (`desktop/resources/loops/
lyzn-tasks.yaml`), and `await:` is exactly the recipe engine's own
suspend/resume primitive, reachable because the caller already is a recipe.
The original version of this paragraph dismissed `waiters` as unreachable
from "the conversational agent that actually runs KARMAX's LYZN work" — an
assumption about who runs that work which the second amendment below found
to be wrong before the third confirmed what to do about it.

**Amendment, 2026-09-14 — checked against KARMAX directly; the claim as
written does not hold.** "Resumes with its own context rather than starting
cold" was verified rather than left as a hope, against four questions: how
a claimed LYZN task actually runs, whether a session key is genuinely used
to resume, what resuming actually requires, and what reaps a session in the
meantime.

The resumption primitive is real, and it works as hoped — for the sessions
that use it. `Supervisor.open()` (`internal/harness/supervisor.go:238-330`)
reuses a live process, and, its own comment says, "a dead one whose
transcript we know is resumed, which brings its context back; only a
genuinely new key starts cold." Concretely it needs two durable things: the
stored `HarnessSessionID` for that key, and the workdir the process was
started in — `--resume <id>` is passed to a process spawned with `cmd.Dir`
set to that same workdir (`internal/harness/session.go:96-97,128-129`), so
resumption is workdir-scoped, not id-alone. Reaping does not destroy
either: `teardown()` deletes a session's stored record only for kinds
marked `Ephemeral` (`supervisor.go:425-436`), and the `task` kind is not
one, in code (`internal/config/config.go:139`) or in the live profile
(`~/.karmax-desktop/karmax.yaml`, `idle: 5m`). KARMAX's own local task
runner already rides exactly this path across gaps of any length:
`rt.harness.SendWith(turnCtx, task.SessionKey, "task", ...)`
(`internal/runtime/taskrunner.go:123`) is called on a 90-second ticker
against whatever `task.SessionKey` names, however long it has sat idle.

But that is not how a claimed LYZN task runs. As actually shipped
(`desktop/resources/loops/lyzn-tasks.yaml`, this repo — the recipe the
paired daemon, "LYZN Daemon," polls on every two minutes), claiming a task
creates **no local KARMAX row at all**. The whole claim-work-report
sequence is one scheduled recipe tick, and the work itself is a single
`harness:` step: `loopKit.Harness` (`internal/runtime/loophost.go:621-634`),
which calls the coding tool with `"ephemeral": true` unconditionally —
commented "Loop work is one-off: no follow-up value in keeping the session
around." Ephemeral runs are a separate, simpler mechanism from the
Supervisor entirely (`internal/tools/builtin/claude_code.go`, its own
`StoredCodingSession` bookkeeping), whose own comment reads "Ephemeral
one-off tasks never reuse or become resumable sessions"
(`claude_code.go:254-255`), and which deletes the transcript the moment the
run ends (`removeClaudeSession`, `claude_code.go:338`). The backend side
already matches this: the recipe's harness prompt asks for
`STATUS: done|blocked|failed`, and `parseHarnessReply`
(`backend/go/internal/api/daemons.go:905-926`) does parse `blocked` as a
word — but only `STATUS: done` becomes `outcome: "success"`; everything
else, `blocked` included, becomes `"failure"` (`daemons.go:924-926`). A
harness that reports itself blocked closes the task as failed, today.
Nothing on either side waits for anything.

So the claim is false for exactly the reason suspected: the turn that asks
the question ends, its session is deleted on purpose, and there is nothing
left to resume into. Making it true needs two things that exist nowhere
today: something durable, keyed by the LYZN task id, naming which session
to return to — no such record exists, LYZN-side or local — and execution
routed through a mechanism that does not delete itself on completion. Two
already sit in this codebase, either workable: KARMAX's own `task` kind,
proven resumable above but built for its local, round-based tasks table
with its own prompt contract and 90-second scheduler that knows nothing
about a LYZN task today; or `ClaudeCodeTool` run non-ephemerally with an
explicit, deterministic `session_id` — the tool already accepts one,
`loopKit.Harness` simply never passes one. Choosing between them, and
building whichever is chosen, is implementation work this document
surfaces rather than resolves.

This also corrects the "Named gap" above: `waiters`/`await:` was dismissed
as reaching only "the conversational agent," but a claimed LYZN task runs
inside a *recipe*, which is precisely what the recipe engine's `await:`
verb is built for — so that primitive is not obviously unreachable here
after all, only unexamined. Whether it is a better fit than session
resumption is a question this pass did not investigate and does not
answer.

**Amendment, 2026-09-14 — the chosen design, and four more things checked
before writing it up.** Knowing the cost, the user chose to keep the
transcript: resume the real session, not a fresh one primed with a summary.
Two mechanisms, at two different layers, because a **recipe run** (the
poll-claim-work-report loop) and a **Claude Code session** (the transcript)
are different things and nothing requires one primitive to cover both. The
recipe parks with `await:` — the `waiters` table resumes the same execution
id, with prior steps replaying from their recorded results rather than
re-running, and sweeps its own timeouts. The harness step stops being
ephemeral — the Claude Code session is keyed durably by the LYZN task id,
so that when the answer arrives it resumes the real transcript through
`Supervisor.open()`'s dead-session path (previous amendment), not a
new one.

Four questions decided whether that is buildable as stated, and all four
were checked against the code rather than assumed:

- **What `ephemeral: true` destroys.** Only the transcript file —
  `removeClaudeSession` (`claude_code.go:362-368`) is one `os.Remove` on
  `~/.claude/projects/<slug of the workdir>/<sessionID>.jsonl`
  (`internal/chatlog/slug.go:21-27`, the CLI's own layout, confirmed by
  KARMAX's own doc comment there: "a conversation IS a harness session").
  The workdir itself is never touched. That matters less than it sounds,
  because the workdir was never task-specific to begin with:
  `hostpaths.WorkDir()` (`internal/hostpaths/hostpaths.go:152-165`) defaults
  to `$KARMAX_WORKDIR`, else the operator's home directory — one shared
  directory for every coding-tool call on the machine, today, regardless of
  ephemeral or not — and `loopKit.Harness` never overrides it
  (`loophost.go:621-634`). So resuming needs no workdir recreated or
  relaxed; it needs the same already-persistent default passed both times.
  What it does newly need, once a session is held for hours rather than
  seconds, is that default stopping being *safe to share*: a second LYZN
  task, or any other one-off harness call, writing into the same home
  directory while one task's work sits mid-way is a materially bigger risk
  held open for days than held open for the seconds an ephemeral call takes
  today. This document recommends a task-id-scoped `working_dir` (something
  like `$KARMAX_WORKDIR/lyzn-tasks/<taskID>`) rather than the shared
  default, once a session outlives one turn — but building that is,
  again, implementation work this document surfaces rather than resolves.

- **How the recipe step would run non-ephemerally.** There is no existing
  override. `loopKit.Harness(ctx, prompt string)` has a fixed signature
  that hardcodes `map[string]any{"prompt": prompt, "ephemeral": true}`
  (`loophost.go:626`) with no session identity in or out, and the recipe
  DSL gives it nothing to work with either: `case VerbHarness` in
  `internal/recipes/run.go:99-104` extracts a bare string via `text()` —
  unlike, say, the object-shaped `http:` step, `harness:` accepts no other
  field. `ClaudeCodeTool.run` (`claude_code.go:248-358`) already accepts an
  explicit `session_id` and a boolean `ephemeral` that decide `--resume` vs
  `--session-id` (`:300-304`) — the capability exists one layer down. What
  is missing is a path from a recipe step to those two fields: either a new
  verb, or `harness:` growing an optional structured form
  (`harness: { session_id: "lyzn:{{ .id }}", prompt: ... }`) alongside the
  plain-string form it keeps for everything else. Neither exists today.

- **Whether a non-ephemeral session survives hours or days.** The workdir:
  yes, trivially, per above — it was never going anywhere. The session
  record and the transcript file: also yes, but not because anything
  guarantees it — because **nothing today reaps them automatically**.
  `PruneHarnessSessions` (`internal/store/harness_store.go:209-219`) is one
  `DELETE FROM harness_sessions WHERE state IN ('closed','dead') AND
  last_activity_at < ?`, deleting the row only, never the `.jsonl` file —
  and it runs only when something calls it: the `harness.prune` tool
  (`internal/runtime/harnessinspect.go:187-216`, default cutoff 168 hours)
  or the `karmax session prune` CLI command
  (`cmd/karmax/session_cmd.go:257-269`, same default). Neither is on a
  ticker anywhere in the runtime — unlike, for comparison, the six-hourly
  sweep `looprun.go:300` runs for loop history and other bookkeeping.
  `ReapOrphans` (`supervisor.go:495-511`) only marks sessions dead after a
  restart; it deletes nothing. So today a session that nobody prunes lives
  forever, which is good news for "does resuming still work after three
  days" and bad news for the cost below.

- **Where `blocked` belongs on the backend.** The existing
  `POST /daemons/work/:taskId/result` stays exactly as it is: transactional,
  idempotent, and terminal — its whole contract
  (`postDaemonWorkResult`, `daemons.go:946-972`) is
  closing a task and printing a receipt, done or failed, once. Threading a
  non-terminal outcome through it would mean an endpoint whose name and
  contract both say "this is over" sometimes meaning "this isn't." The new
  `POST /daemons/work/:taskId/question` (§3, above) is the dedicated
  channel for `blocked`, and it is additive rather than a change to
  `/result`'s existing behaviour or its tests. The cost this moves
  elsewhere: the recipe itself currently has no branch on `STATUS:` at
  all — it posts whatever the harness said straight to `/result`
  unconditionally whenever the reply is non-empty (`lyzn-tasks.yaml`, the
  `- when: "{{ .reply }}"` step). Making `blocked` route to `/question`
  instead of `/result` is new logic in the recipe, not a config change.

**The disk cost, quantified rather than gestured at.** A blocked task holds
three things: a shared workdir (already persistent, effectively free), a
`harness_sessions` row (a few hundred bytes), and a growing `.jsonl`
transcript (as large as whatever the harness did before it asked). None of
these are large individually. The actual cost is that **nothing reclaims
any of it automatically today**, and per the point above, unanswered
questions are the expected case, not the tail. Left alone, this grows
without bound as blocked tasks accumulate — which is exactly why this
design cannot lean on the existing `harness.prune` tool as its answer:
that tool is correct and useful, but it is manual, and a manual safety net
is not a bound. The bound has to be the escape hatch §3 already specifies:
when a question expires, the same event that fails the task must also
close out its session — delete the `harness_sessions` row (what
`PruneHarnessSessions` already does, called directly rather than waiting
for someone to run `karmax session prune`) *and* remove the `.jsonl` file
by the same path `removeClaudeSession` computes (that function is
unexported today; a per-key deletion helper is new, small code). An
unpaired or long-stale daemon releasing its pinned tasks (the other escape
hatch) should do the same for whatever it was holding. Without this,
"resumes with its own context" is bought by disk that never comes back.

**The other cost: a path that works today would change, and it cannot
change only for the tasks that need it.** LYZN task execution, ephemeral
and one-shot, is not a prototype — it is the one mechanism in this whole
area that is actually shipped and running, and its ephemerality reads as a
deliberate choice (`loophost.go:625`, "no follow-up value in keeping the
session around") rather than an oversight. The tempting mitigation — keep
today's cheap path for the common case, and only pay for durability on the
tasks that turn out to block — does not survive the first verified fact
above: `ephemeral` is decided before the call and enforced unconditionally
inside it (`claude_code.go:335-338`), so by the time a reply says
`STATUS: blocked`, an ephemeral run has already deleted its own transcript.
A turn cannot be run cheap and upgraded to durable after the fact once it
turns out to need it, because whether it will need it is exactly what is
not known until it answers. So every LYZN task's first turn has to go
through the new, keyed, non-ephemeral path — there is no version of this
design that touches only the blocked minority.

What can still be kept small is the *difference*: the same tool call, with
`ephemeral: false` and a deterministic `session_id` in place of
`ephemeral: true`, changes nothing else about how the harness runs — and an
explicit cleanup step for the terminal case (`done` or `failed`) deletes
that session and transcript right after, so the net disk outcome for the
common case matches today's, reached one step later rather than inside the
tool call itself. If durable execution misbehaves in practice — a
`--resume` failure, a session that will not clean up, anything that makes
ordinary task execution less reliable than it is today — the honest
fallback is a revert, not a graceful degradation: `loopKit.Harness` goes
back to `ephemeral: true` unconditionally, and blocked LYZN tasks stop
resuming with real context until the problem is fixed. That is exactly
today's behaviour, and no worse than it — but it is not a partial mitigation
this design can fall back to piecemeal.

**Amendment, 2026-09-14 — per-task workdirs and real cleanup, now required,
checked against the code path that actually runs.** The user turned both
recommendations above into requirements.

**Decision 1: per-task workdirs.** LYZN task execution gets its own workdir,
keyed by the LYZN task id, in place of `hostpaths.WorkDir()`. Concretely:
`filepath.Join(hostpaths.WorkDir(), "lyzn-tasks", taskID)` — under the same
root `hostpaths.WorkDir()` already resolves, `$KARMAX_WORKDIR` else the
operator's home directory (`internal/hostpaths/hostpaths.go:152-165`), so
this is additive, not a second competing root. The name is the bare task id
and nothing else — no timestamp, no PID, no random suffix folded in —
because resuming a `blocked` task after however long a person takes to
answer means calling with the identical value used on the first turn, and a
value derived from anything transient would not reproduce days later. Paired
with it, the session id is likewise deterministic: `"lyzn:" + taskID`, the
same shape the prior amendment already sketched
(`harness: { session_id: "lyzn:{{ .id }}", ... }`). This also isolates
concurrent task executions from each other — two LYZN tasks running at once,
or a LYZN task running alongside any other one-off harness call, no longer
share a directory the way `hostpaths.WorkDir()` does today, which the third
amendment named as merely "effectively free" while sessions lived seconds and
did not say was safe to keep sharing once one can sit open for days.

**Verification, checked directly rather than assumed: does anything fight
this, and does `Supervisor.open()` actually govern it?** No to the first;
no to the second either, which corrects a piece of the prior amendment's own
phrasing.

- The path a claimed LYZN task's harness step actually takes is
  `loopKit.Harness(ctx, prompt)` (`internal/runtime/loophost.go:621-634`) →
  `builtin.ClaudeCodeTool.Execute` → `.run` (`claude_code.go:248`). That
  function never imports or calls `internal/harness` — no `Supervisor`, no
  `Supervisor.open()`. "Resumes the real transcript through
  `Supervisor.open()`'s dead-session path," from the prior amendment,
  borrowed Supervisor's language for the *pattern* — a dead session whose id
  and workdir are known gets its context back — without being literal about
  the mechanism. `ClaudeCodeTool.run` implements that same pattern itself,
  independently: `--resume <sessionID>` when `sessionID` is non-empty
  (`:300-301`, else `--session-id`, `:303`) with `cmd.Dir = workingDir`
  (`:325`) — structurally identical to Supervisor's own `--resume` +
  `cmd.Dir` pairing, but a separate code path with separate storage.
- That separate storage changes Decision 2's target. `ClaudeCodeTool.run`,
  non-ephemeral, writes to `coding_sessions`
  (`t.Store.SaveCodingSession`, `:340`; schema at
  `internal/store/migrations.go:124-137`) — not `harness_sessions`.
  `coding_sessions` has no `workdir` column, and, checked directly, no
  delete function exists for it anywhere in this codebase today. So
  `PruneHarnessSessions` and the `harness.prune`/`karmax session prune`
  tools the prior amendment leaned on do not reach a LYZN task's session at
  all — they prune a table this mechanism never writes to. Decision 2 below
  is written against `coding_sessions`, not `harness_sessions`.
- `ClaudeCodeTool.run` already accepts both fields Decision 1 needs, today,
  as plain `input` keys: `session_id` (`:251`, driving `resuming`, `:253`)
  and `working_dir` (`:270-272`, defaulting to `hostpaths.WorkDir()` only
  when empty). Nothing in `.run` needs to change for either to carry a
  per-task value — confirming the prior amendment's finding for `session_id`
  and extending it, since `working_dir` was already sitting there too, ready
  to be given a deterministic value instead of the shared default. The gap
  stays exactly where the prior amendment placed it: `loopKit.Harness`'s
  fixed `func(ctx, prompt string)` signature and the recipe's bare-string
  `harness:` verb (`internal/recipes/run.go:99-104`) carry neither field
  through. That is unchanged and is still the thing to build.
- One new gap, found while checking this. `ClaudeCodeTool.run` never creates
  `working_dir` — it only sets `cmd.Dir = workingDir` and execs (`:325,328`).
  `internal/harness` does create it, `os.MkdirAll(workdir, 0o755)`
  (`internal/harness/session.go:124`, `internal/harness/supervisor.go:588`),
  but that machinery is not in the path LYZN tasks take, per above. This has
  never mattered because the shared default, `hostpaths.WorkDir()`, always
  already exists. A fresh `lyzn-tasks/<taskID>` directory will not, the
  first time a given task runs, so whatever plumbs `working_dir` through —
  the new recipe path above — has to `mkdir -p` it before the call.
- Would `Supervisor.open()` have accepted a per-task path, had this actually
  gone through it? Yes, trivially — `opt.Workdir` is an unvalidated string
  (`supervisor.go:134-136`), used verbatim when set and otherwise defaulted
  to `filepath.Join(s.cfg.WorkdirRoot, sanitize(key))` (`:281-283`). Worth
  recording precisely anyway, because it reinforces why determinism is
  non-negotiable rather than a nicety: `open()` never reads the *stored*
  `rec.Workdir` back on resume, only ever `opt.Workdir` from the current
  call — resume correctness rests on the caller passing the same value
  twice, not on anything remembering it for them. `ClaudeCodeTool.run` has
  the identical property, no stored-workdir fallback either, so the same
  discipline applies regardless of which mechanism is used.

**Decision 2: cleanup is required, not assumed.** Specified per terminal
outcome, against `coding_sessions` and the on-disk transcript and workdir —
not `harness_sessions`, per the correction above:

- **`done` / `failed`.** Whatever closes the task — `postDaemonWorkResult`
  (`daemons.go:946-972`) on the LYZN side, triggering the corresponding
  KARMAX-side call — deletes, promptly, in the same request: the transcript
  file, the path `removeClaudeSession` already computes
  (`filepath.Join(chatlog.Dir(workdir), sessionID+".jsonl")`,
  `claude_code.go:362-368`; `chatlog.Dir` at
  `internal/chatlog/slug.go:25-27`) — that helper is unexported today, so an
  exported or wrapped equivalent is new, small code, as the prior amendment
  already flagged; the workdir itself, `os.RemoveAll` — new, nothing today
  touches it; and every `coding_sessions` row for that `session_id` — new: a
  delete keyed on the existing, already-indexed `session_id` column
  (`idx_coding_session`, `migrations.go:137`), not `id`. `id` is minted
  fresh on every call (`uuid.New().String()`, `:341`), so a session resumed
  across several turns accumulates one row per turn under the same
  `session_id`; deleting by `session_id` sweeps all of them in one
  statement.
- **Question expiry.** Fires the identical three-part cleanup at the same
  moment the expiry handler fails the task for its stated reason — the same
  code path as above, not a separate one.
- **Task dismissed, or its daemon unpairs.** `DismissTask` today transitions
  only from `proposed`/`approved` (`backend/go/internal/ddb/tasks.go:356-360`)
  — a task in either state has never had a harness turn, let alone a pinned
  session, so a plain dismiss has nothing on disk to release. The bullet's
  real weight is the other half, already named in §3: the pinned-task
  release path for a stale or unpaired daemon. That path releases the task
  row; it must also run the same three-part cleanup for whatever session it
  was holding — exactly what the prior amendment recommended and did not yet
  make concrete.
- **The backstop.** An extension of the six-hour ticker already running in
  `retryWorker` (`internal/runtime/looprun.go:300`, its `case <-prune.C` at
  `:308`), not a new ticker. That ticker already exists, already runs
  unconditionally in the daemon process, and already does exactly this kind
  of work — age-bound deletion across several tables in one pass
  (`PruneLoopRuns`, `PruneAgentTurns`, `PruneEventLog`, `PruneTimers`,
  `PruneLoopSteps`, `PruneMeter`, `:309-334`). A new ticker would be a
  second timer doing the same category of job for one more table, with its
  own separate chance to be forgotten or to die silently; extending the one
  that already fires costs one more `case` and inherits machinery already
  proven to run. Its job: find `coding_sessions` rows whose `session_id`
  carries the `lyzn:` prefix and whose `updated_at` is older than a cutoff —
  a week, matching `harness.prune`'s own default cutoff in spirit, since
  anything the backstop actually finds is by definition a task that fell
  through `done`, `failed`, expiry, and unpair — the tail, not the common
  case — then recompute the transcript path and workdir from the task id
  embedded in that same `session_id`, and run the identical three-part
  cleanup. No new lookup table: the deterministic naming from Decision 1 is
  exactly what makes a bound possible without tracking task-to-session-to-
  workdir anywhere new.

Neither decision comes out unbuildable. Decision 1 needs no change inside
`ClaudeCodeTool.run` at all — only the recipe-to-tool plumbing the prior
amendment already named, plus one new `mkdir -p`. Decision 2 needs new code
— a `coding_sessions` delete keyed on `session_id`, an exported
transcript-deletion helper, and one new `case` in an existing ticker — but
all of it is small, additive, and lands in files this design already
touches.

## Framing

This design is mostly not about Claude Code. Section 1 is plumbing around
it — files in, files out, a container image, a fallback. Section 2 is a
correction to an assumption, not a build. Section 3, the largest genuinely
new piece, has nothing to do with transcripts at all.

## Testing

- **The extraction contract.** `ApplyFn` against a malformed
  `corrections.json`, a missing `tasks.json`, a partially-written
  `memories.json`, and an agent run that writes nothing at all — each must
  fail cleanly into the fallback path rather than partially applying state.
- **The fallback firing.** `ExtractFn` retries exhausted, `ApplyFn` runs
  `merge.go` + `enrich.go` directly, and the recording still reaches `ready`.
- **Idempotency under SQS redelivery** at each of the three stages —
  `ExtractFn` re-run on the same message, `ApplyFn` re-run on the same
  `applyQueue` message, and a redelivered `ingestQueue` message after
  `ProcessorFn` already marked the recording `transcribed`.
- **The `blocked` transitions**, including both escape hatches: a question
  that times out fails the task with a stated reason, and a task pinned to
  a daemon that goes stale or unpairs is released rather than left stuck.
- **Correlation**, including the ambiguous multi-question case: a reply
  with no `reply_to_id` on a channel with two open questions must ask which,
  not guess.
- **The `ANTHROPIC_API_KEY` guard**: set it in the Lambda's environment
  deliberately in a test and assert the handler pops it before the SDK ever
  sees it.

## Out of scope

- **Bedrock migration.** Deferred, not rejected — see above.
- **Pinning the untagged gitloom-go commit.** Recorded as an open question
  in §2, not adopted here.
- **A generic app feed or notifications screen.** `task.question` is one
  more fixed push event, the sixth, not a step toward a general model.
- **Reviving Slack's dead approval buttons.** Named as a gap in §3, not
  built.
- **Any change to the ASR engines themselves.** Deepgram and Sarvam are
  untouched; this document only moves what happens after they return.
