# Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot Bedrock pass that corrects a transcript and extracts tasks and memories with a Claude Code agent running in a container-image Lambda, while keeping the existing Bedrock pass alive as an automatic fallback.

**Architecture:** `ProcessorFn` stops the moment ASR finishes — it marks the recording `transcribed` and enqueues to a new `extractQueue`. `ExtractFn` (new, Python, container image) runs Claude Code over the transcript and writes four JSON files — `corrections.json`, `tasks.json`, `memories.json`, `summary.json` — validates them, uploads them to S3, and enqueues to a new `applyQueue`. `ApplyFn` (new, Go, zip) is the only thing that writes state: it reads those four files, applies them if they validate, and — on `extractQueue`'s own dead-letter queue, reached once `ExtractFn` has exhausted its retries — runs the existing `merge.go`/`enrich.go` Bedrock path directly instead, so a recording always reaches `ready` with a title either way. (`summary.json` was added by a 2026-09-14 spec amendment made during this plan's own review — see Self-Review.)

**Tech Stack:** Go 1.24 + CDK (TypeScript) on the backend; Python 3.13 + `claude-agent-sdk` in `ExtractFn`'s container image; both existing zip Lambdas stay `PROVIDED_AL2023` ARM64.

**Spec:** docs/superpowers/specs/2026-09-14-extraction-agent-and-follow-ups-design.md — §1 and §2 only. §3 (the follow-up channel, `blocked` tasks, questions, durable sessions) is a separate plan and is not touched here.

## Global Constraints

- Go 1.24, CDK only, no SAM. Every existing Lambda is `PROVIDED_AL2023` zip on ARM64; `ExtractFn` is the first container-image Lambda in this backend.
- `docker buildx build --platform` and the Lambda's `--architectures` (CDK: the `DockerImageCode.fromImageAsset` platform and the function's `architecture`) must stay in sync — arm64 throughout, matching every other Lambda here.
- `ExtractFn`'s base image is `public.ecr.aws/lambda/python:3.13` (glibc, not Alpine/musl) because `claude-agent-sdk`'s bundled CLI binary is glibc-linked.
- `ExtractFn`: 3008 MB memory, 900 s timeout, 4096 MB ephemeral storage, its own reserved concurrency, `HOME=/tmp`, `CLAUDE_CONFIG_DIR=/tmp/.claude`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
- `os.environ.pop("ANTHROPIC_API_KEY", None)` runs before anything else in `ExtractFn`'s handler, every invocation.
- `merge.go` and `enrich.go` are never deleted. They are the fallback `ApplyFn` runs when extraction fails.
- Commits never carry `Co-Authored-By`, `Claude-Session`, or any attribution trailer — these repos are public.
- Every reader that switches on `RecordingStatus` treats a value it does not recognise as valid-but-unhandled, never as an error.
- `corrections.json`'s shape never changes: a JSON array of `{"i": <utterance index>, "text": "<corrected text>"}`, exactly what `enrich.ApplyCorrections` has always accepted.
- `summary.json`'s field names, types and caps mirror `enrich.go`'s own `Coerce` exactly: `title` ≤200 chars and required non-empty, `tags` ≤5 entries each ≤40 chars, `summary` ≤4000 chars, `category` a name resolved to an id via the existing `ResolveCategory` (never a raw id).
- Task ids stay `<recordingId>-<index>`, deterministic, so SQS redelivery rewrites rather than duplicates.
- No GitLoom memory is ever deleted at the pinned `gitloom-go@v0.3.4`. `Recall`-before-write is best-effort dedup, not erasure or supersession.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/go/internal/types/types.go` | `StatusTranscribed`; the `ExtractionRequest` wire type shared by `extractQueue` and `applyQueue` |
| `mobile/src/api/client.ts` | `RecordingStatus` widened to include `'transcribed'` |
| `backend/go/internal/api/recordings.go` | `retryBlockedBy`: `retryRecording` refuses a `transcribed` recording the same way it refuses `processing` |
| `backend/lib/data-plane.ts` | `extractQueue`, `extractDlq`, `applyQueue`, `applyDlq` |
| `backend/go/cmd/processor/main.go` | Stops after ASR: marks `transcribed`, moves the raw-transcript GitLoom ingest in, enqueues to `extractQueue`; `merge.go`/`enrich.go` calls removed |
| `backend/extract/Dockerfile` | The container image: Python 3.13, glibc, `claude-agent-sdk` |
| `backend/extract/requirements.txt` | `claude-agent-sdk>=0.2.152` |
| `backend/extract/requirements-dev.txt` | `pytest` |
| `backend/extract/credentials.py` | Secrets Manager resolution, cached per container — the OAuth token and the GitLoom key |
| `backend/extract/schemas.py` | Strict validators for the four output files (`summary.json` added by the spec's 2026-09-14 amendment), and the S3-key idempotency check |
| `backend/extract/prompt.py` | The system prompt (all four files), the model alias, the tool allowlist, the categories the agent may offer in `summary.json` |
| `backend/extract/gitloom_recall.py` | The agent's own `recall` tool, an in-process MCP server |
| `backend/extract/handler.py` | The Lambda entry point: env scrub, time budget, the `query()` turn, validate/upload/enqueue |
| `backend/extract/tests/` | `pytest` over every pure piece above |
| `backend/go/internal/apply/validate.go` | `ValidateAll`/`ValidateCorrections`/`ValidateTasks`/`ValidateMemories`/`ValidateSummary` — the Go-side mirror of `schemas.py` |
| `backend/go/internal/apply/tasks.go` | `TasksFromActionItems`, moved from `cmd/processor/main.go` |
| `backend/go/internal/apply/apply.go` | `ExtractionPrefix` |
| `backend/go/internal/apply/patch.go` | `Result`, `Patch` |
| `backend/go/cmd/apply/main.go` | `ApplyFn`: reads `applyQueue`/`extractDlq`, applies (title/tags/summary/category included, via `enrich.ResolveCategory`) or falls back, flips `ready`, pushes |
| `backend/go/build.sh` | Builds the new `apply` binary alongside `processor`/`dlqreaper` |
| `backend/go/cmd/dlqreaper/main.go` | Learns `applyDlq`'s message shape alongside `ingestDlq`'s |
| `backend/lib/mr20-stack.ts` | `ExtractFn` (container image), `ApplyFn` (Go zip), the Claude OAuth secret (and its output), `ProcessorFn`'s new env, `DlqReaperFn`'s new event source |
| `backend/lib/preview-stack.ts` | The same two Lambdas and queues, mirrored — no reserved concurrency, no DLQ reaper, matching this stack's existing precedent |
| `backend/bin/app.ts` | Threads `claudeOAuthSecretArn` context through to the preview stack, beside `deepgramSecretArn`/`sarvamSecretArn` |
| `.github/workflows/preview.yml` | Reads `ClaudeOAuthSecretArn` from production's stack outputs, passes it to `cdk deploy` |

---

## Task 1: `transcribed` — the new status every reader must survive

Per the spec's 2026-09-14 amendment: `transcribed` is a genuine addition to a previously-closed enum on both sides. `mobile/src/recordings/slip.ts:30-37` already falls through to `default: return null` for a status it does not recognise — that is the shape every other reader needs, not a new one. The Go side has one reader that is *not* shaped that way: `retryRecording`'s explicit `if rec.Status == ...` checks, which would otherwise fall through to re-enqueuing ASR on a recording that is mid-extraction.

**Files:**
- Modify: `backend/go/internal/types/types.go:14-21` (the `RecordingStatus` const block)
- Modify: `backend/go/internal/api/recordings.go:556-566` (`retryRecording`'s status checks → `retryBlockedBy`)
- Create: `backend/go/internal/api/recordings_test.go`
- Modify: `mobile/src/api/client.ts:9`
- Modify: `mobile/tests/recordings/slip.test.ts`

**Interfaces:**
- Produces: `types.StatusTranscribed types.RecordingStatus = "transcribed"`; `retryBlockedBy(status types.RecordingStatus) string` (package `api`, empty string means retry may proceed).

- [ ] **Step 1: Write the failing Go test**

Create `backend/go/internal/api/recordings_test.go`:

```go
package api

import (
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestRetryBlockedByNamesWhyOrPermitsIt(t *testing.T) {
	cases := []struct {
		status types.RecordingStatus
		want   string
	}{
		{types.StatusUploaded, ""},
		{types.StatusProcessing, "this recording is already being processed"},
		{types.StatusTranscribed, "this recording is already extracting"},
		{types.StatusReady, "this recording already has a transcript"},
		{types.StatusFailed, ""},
	}
	for _, c := range cases {
		if got := retryBlockedBy(c.status); got != c.want {
			t.Errorf("retryBlockedBy(%q) = %q, want %q", c.status, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
cd backend/go && go test ./internal/api/ -run TestRetryBlockedBy -v
```

Expected: `FAIL — undefined: retryBlockedBy` (and `types.StatusTranscribed` undefined).

- [ ] **Step 3: Add the status**

In `backend/go/internal/types/types.go:14-21`:

```go
const (
	StatusPending     RecordingStatus = "pending"     // row exists, audio not uploaded yet
	StatusUploaded    RecordingStatus = "uploaded"    // audio in S3, queued for processing
	StatusProcessing  RecordingStatus = "processing"  // processor picked it up
	StatusTranscribed RecordingStatus = "transcribed" // raw transcript written; extraction and enrichment still pending
	StatusReady       RecordingStatus = "ready"       // transcript + enrichment written
	StatusArchived    RecordingStatus = "archived"    // no speech; audio parked under archived/ for 30 days
	StatusFailed      RecordingStatus = "failed"      // gave up; Error says why
)
```

- [ ] **Step 4: Add `retryBlockedBy` and use it**

In `backend/go/internal/api/recordings.go`, replace the two `if rec.Status == ...` blocks at lines 560-565 with one call:

```go
	if reason := retryBlockedBy(rec.Status); reason != "" {
		return fiber.NewError(fiber.StatusConflict, reason)
	}
```

And add, near `truncate` (line 520):

```go
// retryBlockedBy names why a recording's audio cannot be re-queued right
// now, or "" when retryRecording may proceed. A transcribed recording is
// mid-extraction, not idle — re-enqueuing to ingestQueue would re-run ASR
// on a transcript ExtractFn or its fallback may already be working from.
func retryBlockedBy(status types.RecordingStatus) string {
	switch status {
	case types.StatusProcessing:
		return "this recording is already being processed"
	case types.StatusTranscribed:
		return "this recording is already extracting"
	case types.StatusReady:
		return "this recording already has a transcript"
	default:
		return ""
	}
}
```

- [ ] **Step 5: Run it, confirm it passes**

```bash
cd backend/go && go test ./internal/api/ -run TestRetryBlockedBy -v
```

Expected: `PASS`, 1 test (5 subcases).

- [ ] **Step 6: Widen the mobile union**

In `mobile/src/api/client.ts:9`:

```ts
export type RecordingStatus = 'pending' | 'uploaded' | 'processing' | 'transcribed' | 'ready' | 'archived' | 'failed';
```

- [ ] **Step 7: Add the mobile regression test**

In `mobile/tests/recordings/slip.test.ts`, add the import and a test:

```ts
import type { RecordingStatus } from '../../src/api/client';
```

```ts
test('an unrecognised status closes quietly — the discipline `default: null` already had', () => {
  // 'transcribed' sits between processing and ready (spec's 2026-09-14
  // amendment). The slip does not have to say anything new about it yet —
  // it only must not throw, the same as any future status it has not been
  // taught about.
  assert.equal(openRowKey('transcribed' as RecordingStatus), null);
});
```

- [ ] **Step 8: Run it, confirm it passes**

```bash
cd mobile && npm test
```

Expected: `PASS`, including the new test.

- [ ] **Step 9: Verify the other mobile readers fail safe (no code change)**

`grep -rn "PIPELINE\[" mobile/app/recording/\[id\].tsx` shows `PIPELINE` is `Partial<Record<Recording['status'], ...>>`, indexed by bracket lookup, and its result is already rendered as `pipeline ? <Banner .../> : null` (line 500) — `'ready'` is *already* absent from that map today, so `'transcribed'` produces the identical `undefined → null` path a shipped status already exercises. `grouping.ts`'s `working`/`ready` counts (`===`/`!==` comparisons, not exhaustive switches) do not crash either; a `transcribed` recording is simply not counted in either bucket. This is a deliberate non-change — see Self-Review.

- [ ] **Step 10: Full backend and mobile suites, then commit**

```bash
cd backend/go && go build ./... && go test ./... && go vet ./... && gofmt -l internal/types internal/api
cd mobile && npm test && npx tsc --noEmit -p tsconfig.json
```

Expected: all green.

```bash
git add backend/go/internal/types/types.go backend/go/internal/api/recordings.go backend/go/internal/api/recordings_test.go mobile/src/api/client.ts mobile/tests/recordings/slip.test.ts
git commit -m "recordings: a transcribed status between processing and ready"
```

---

## Task 2: CDK — `extractQueue` and `applyQueue`, with their own dead letters

Follows `ingestQueue`'s precedent exactly (`backend/lib/data-plane.ts:108-122`): visibility timeout exceeding the consumer's own timeout, `maxReceiveCount: 4`, `batchSize: 1` (set on the Lambda's event source in Task 11, not here), a DLQ per queue.

**Files:**
- Modify: `backend/lib/data-plane.ts`

**Interfaces:**
- Produces: `DataPlane.extractQueue`, `DataPlane.extractDlq`, `DataPlane.applyQueue`, `DataPlane.applyDlq` (all `sqs.Queue`), consumed by Task 3 (`extractQueue.queueUrl`) and Task 11 (`ExtractFn`/`ApplyFn`'s event sources and IAM grants).

- [ ] **Step 1: Widen the `DataPlane` interface**

In `backend/lib/data-plane.ts`, after `readonly dlq: sqs.Queue;`:

```ts
  readonly extractQueue: sqs.Queue;
  readonly extractDlq: sqs.Queue;
  readonly applyQueue: sqs.Queue;
  readonly applyDlq: sqs.Queue;
```

- [ ] **Step 2: Add the four queues**

After the `ingestQueue` block and its `addEventNotification` call (line 128), before the function's closing `return`:

```ts
  // ExtractFn's own dead letter: reached only once the agent has exhausted
  // every retry. ApplyFn consumes it directly (see mr20-stack.ts) and runs
  // the Bedrock fallback there, so a recording still reaches `ready` even
  // when the agent never produces valid output.
  const extractDlq = new sqs.Queue(scope, 'ExtractDlq', {
    retentionPeriod: ephemeral ? Duration.days(4) : Duration.days(14),
    visibilityTimeout: Duration.minutes(16),
    enforceSSL: true,
  });

  const extractQueue = new sqs.Queue(scope, 'ExtractQueue', {
    // Exceeds ExtractFn's own 900s (15 min) timeout — the same margin
    // ingestQueue keeps over ProcessorFn's.
    visibilityTimeout: Duration.minutes(16),
    retentionPeriod: ephemeral ? Duration.days(1) : Duration.days(4),
    enforceSSL: true,
    deadLetterQueue: { queue: extractDlq, maxReceiveCount: 4 },
  });

  // ApplyFn's own dead letter: reached only once ApplyFn itself has
  // exhausted every retry on both paths (the extracted files and the
  // Bedrock fallback). DlqReaperFn drains it and marks the recording
  // failed, the same as it already does for ingestDlq.
  const applyDlq = new sqs.Queue(scope, 'ApplyDlq', {
    retentionPeriod: ephemeral ? Duration.days(4) : Duration.days(14),
    visibilityTimeout: Duration.minutes(3),
    enforceSSL: true,
  });

  const applyQueue = new sqs.Queue(scope, 'ApplyQueue', {
    // No agent call and no multi-second Bedrock retry loop on this path —
    // ApplyFn's own timeout is short (see mr20-stack.ts), so 3 minutes of
    // visibility is generous, not tight.
    visibilityTimeout: Duration.minutes(3),
    retentionPeriod: ephemeral ? Duration.days(1) : Duration.days(4),
    enforceSSL: true,
    deadLetterQueue: { queue: applyDlq, maxReceiveCount: 4 },
  });
```

- [ ] **Step 3: Return the new queues**

```ts
  return { table, audioBucket, ingestQueue, dlq, extractQueue, extractDlq, applyQueue, applyDlq };
```

- [ ] **Step 4: Confirm the stack still synthesizes**

```bash
cd backend && npx tsc -p . --noEmit
```

Expected: no type errors (nothing yet destructures the four new fields, so no downstream break).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/data-plane.ts
git commit -m "cdk: extractQueue and applyQueue, each with its own dead letter"
```

---

## Task 3: `ProcessorFn` stops after ASR

The two-engine merge and the Haiku enrichment pass leave `ProcessorFn`'s critical path entirely. What stays: audio cleanup, Deepgram, Sarvam (still run for the second reading, just no longer merged here), the raw-transcript GitLoom ingest (it needs nothing extraction produces), and the transcript write to S3. What goes: `enrich.MergeTranscripts`, `enrich.Enrich`, `tasksFromEnrichment` (moved to `internal/apply`, Task 9's first caller), and `notifyReady` (ApplyFn fires the push once the recording is actually `ready`).

**Files:**
- Modify: `backend/go/internal/types/types.go` (add `ExtractionRequest`)
- Modify: `backend/go/cmd/processor/main.go`
- Create: `backend/go/cmd/processor/main_test.go`

**Interfaces:**
- Consumes: `gitloomx.IngestWithRetry` (unchanged), `deepgram.SpeakerCount` (unchanged).
- Produces: `types.ExtractionRequest{UserID, RecordingID, StartedAt, TranscriptKey string; Speakers map[string]string; Categories []string}` — the message on `extractQueue`, consumed unchanged by `ApplyFn` (Task 9) whether it arrives via `applyQueue` or `extractDlq`; `alreadyProcessed(status types.RecordingStatus) bool` (package `main`, `cmd/processor`).

- [ ] **Step 1: Add the shared message type**

In `backend/go/internal/types/types.go`, after the `Transcript` struct:

```go
// ExtractionRequest is what ProcessorFn hands to extractQueue once a raw
// transcript exists, and what ExtractFn forwards (re-serialized, same
// fields) to applyQueue on success. ApplyFn reads the identical shape
// whether it arrives from applyQueue or from extractQueue's own DLQ — see
// internal/apply.ExtractionPrefix's comment for why no field here names
// where ExtractFn's output landed.
//
// Categories is the user's category *names* only — the agent has no
// DynamoDB access (spec's 2026-09-14 amendment on summary.json), so this is
// how it learns what it may choose for summary.json's category field
// without querying a table it cannot reach. ApplyFn resolves the agent's
// choice back to an id itself, via the existing enrich.ResolveCategory.
type ExtractionRequest struct {
	UserID        string            `json:"userId"`
	RecordingID   string            `json:"recordingId"`
	StartedAt     string            `json:"startedAt"`
	TranscriptKey string            `json:"transcriptKey"`
	Speakers      map[string]string `json:"speakers,omitempty"`
	Categories    []string          `json:"categories,omitempty"`
}
```

- [ ] **Step 2: Write the failing test for the idempotency guard**

Create `backend/go/cmd/processor/main_test.go`:

```go
package main

import (
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestAlreadyProcessedCoversEveryStatusPastASR(t *testing.T) {
	cases := []struct {
		status types.RecordingStatus
		want   bool
	}{
		{types.StatusUploaded, false},
		{types.StatusProcessing, false},
		{types.StatusTranscribed, true}, // redelivery must not repeat ASR
		{types.StatusReady, true},
		{types.StatusArchived, true},
		{types.StatusFailed, false}, // a permanent failure may still be retried by hand
	}
	for _, c := range cases {
		if got := alreadyProcessed(c.status); got != c.want {
			t.Errorf("alreadyProcessed(%q) = %v, want %v", c.status, got, c.want)
		}
	}
}
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
cd backend/go && go test ./cmd/processor/ -run TestAlreadyProcessed -v
```

Expected: `FAIL — undefined: alreadyProcessed`.

- [ ] **Step 4: Rewrite `processObject`'s tail**

In `backend/go/cmd/processor/main.go`, the early-return guard at line 158 becomes:

```go
	if alreadyProcessed(rec.Status) {
		log.Printf("already processed, skipping redelivery recordingId=%s status=%s", recordingID, rec.Status)
		return nil
	}
```

and, near `cleanKeyFor` (line 90), add:

```go
// alreadyProcessed reports whether ProcessorFn's own work is done for this
// recording, so a redelivered ingestQueue message never repeats ASR — not
// even onto a transcript an agent may already be extracting from.
func alreadyProcessed(status types.RecordingStatus) bool {
	switch status {
	case types.StatusTranscribed, types.StatusReady, types.StatusArchived:
		return true
	default:
		return false
	}
}
```

Replace the merge call at lines 256-265:

```go
	// The correction pass moved out of this Lambda entirely — ExtractFn runs
	// it now, or ApplyFn's Bedrock fallback does — but the second engine's
	// reading is decided here, while Sarvam's response is still in hand, and
	// travels with the transcript as data instead of costing a second round
	// trip later.
	if sarvamErr != nil {
		log.Printf("sarvam unavailable, extraction will see one engine only recordingId=%s err=%v",
			recordingID, sarvamErr)
	} else if strings.TrimSpace(transcript.Text) != "" {
		transcript.AltText = sarvamText
	}
```

Replace everything from `categories, err := ddb.GetCategories(ctx, userID)` (line 284) through the end of `notifyReady(ctx, userID, recordingID, enrichment.Title, tasks)` (line 409) with:

```go
	// The category list travels with the extraction request: ExtractFn has
	// no DynamoDB access, deliberately, so the names it can offer the agent
	// have to be read here, once, rather than queried from the agent's own
	// container. Only names — resolving a chosen name back to an id is
	// ApplyFn's job (enrich.ResolveCategory), same as it already was.
	categories, err := ddb.GetCategories(ctx, userID)
	if err != nil {
		log.Printf("categories read failed, extraction will offer none recordingId=%s err=%v", recordingID, err)
		categories = nil
	}
	categoryNames := make([]string, len(categories))
	for i, cat := range categories {
		categoryNames[i] = cat.Name
	}

	// GitLoom's own extraction reads the transcript alone and needs nothing
	// the agent produces next — best-effort by design, matching what this
	// call always was: a paid-for transcript must never turn into a retried
	// SQS message over a GitLoom outage.
	memoryStatus := types.MemoryIngested
	dialogue, err := gitloomx.IngestWithRetry(ctx, userID, recordingID, rec.StartedAt, transcript, rec.Speakers)
	if err != nil {
		log.Printf("gitloom ingest failed recordingId=%s err=%v", recordingID, err)
		memoryStatus = types.MemoryFailed
	}

	memoryVersion, memoryKey := 0, ""
	if dialogue != "" {
		memoryVersion = 1
		memoryKey = memoryDialogueKey(userID, recordingID, memoryVersion)
		if _, err := s3Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket: &bucket, Key: &memoryKey,
			Body:        strings.NewReader(dialogue),
			ContentType: aws.String("text/plain; charset=utf-8"),
		}); err != nil {
			log.Printf("memory dialogue store failed recordingId=%s err=%v", recordingID, err)
			memoryVersion, memoryKey = 0, ""
		}
	}

	patch := map[string]any{
		"status":        types.StatusTranscribed,
		"cleanKey":      cleanKey,
		"transcriptKey": transcriptKey,
		"speakerCount":  deepgram.SpeakerCount(transcript),
		"memoryStatus":  memoryStatus,
		"error":         "",
	}
	if memoryVersion > 0 {
		patch["memoryIngestVersion"] = memoryVersion
		patch["memoryDialogueKey"] = memoryKey
		patch["memorySpeakers"] = rec.Speakers
	}
	if transcript.DurationSeconds > 0 {
		patch["durationSeconds"] = transcript.DurationSeconds
	}
	if sizeBytes > 0 {
		patch["sizeBytes"] = sizeBytes
	}
	if err := ddb.UpdateRecording(ctx, userID, rec.StartedAt, recordingID, patch); err != nil {
		return err
	}

	log.Printf("transcribed recordingId=%s seconds=%d speakers=%d utterances=%d memory=%s",
		recordingID, int(transcript.DurationSeconds), deepgram.SpeakerCount(transcript),
		len(transcript.Utterances), memoryStatus)

	return enqueueExtraction(ctx, types.ExtractionRequest{
		UserID: userID, RecordingID: recordingID, StartedAt: rec.StartedAt,
		TranscriptKey: transcriptKey, Speakers: rec.Speakers, Categories: categoryNames,
	})
```

Delete `tasksFromEnrichment` (lines 421-463) entirely — it moves to `internal/apply/tasks.go` in Task 9, unchanged.

Add, near `queueURL` (there is none yet in this file — add beside `cleanKeyFor`):

```go
func extractQueueURL() string { return os.Getenv("EXTRACT_QUEUE_URL") }

// enqueueExtraction hands a transcribed recording to ExtractFn.
func enqueueExtraction(ctx context.Context, req types.ExtractionRequest) error {
	body, err := json.Marshal(req)
	if err != nil {
		return err
	}
	_, err = sqsClient.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl: aws.String(extractQueueURL()), MessageBody: aws.String(string(body)),
	})
	return err
}
```

- [ ] **Step 5: Wire the SQS client and drop the now-unused `enrich` import**

In `initAWS` (line 53), add a package var and its initialization:

```go
var (
	s3Client  *s3.Client
	presign   *s3.PresignClient
	sqsClient *sqs.Client
)

func initAWS(ctx context.Context) error {
	if s3Client != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	s3Client = s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	})
	presign = s3.NewPresignClient(s3Client)
	sqsClient = sqs.NewFromConfig(cfg)
	return ddb.Init(ctx)
}
```

Add `"github.com/aws/aws-sdk-go-v2/service/sqs"` to the import block; remove `"github.com/MelloB1989/mr20-pendant/backend/internal/enrich"` — nothing in this file calls it anymore. `sync` stays (the Sarvam/Deepgram concurrency block above is untouched).

- [ ] **Step 6: Run it, confirm it passes; build the whole module**

```bash
cd backend/go && go test ./cmd/processor/ -run TestAlreadyProcessed -v
go build ./... && go vet ./... && gofmt -l cmd/processor internal/types
```

Expected: `PASS`; clean build (a leftover `enrich` import or an unused `tasksFromEnrichment` reference would fail the build here, not at test time).

- [ ] **Step 7: Commit**

```bash
git add backend/go/internal/types/types.go backend/go/cmd/processor/main.go backend/go/cmd/processor/main_test.go
git commit -m "processor: stop after ASR, hand off to extractQueue"
```

---

## Task 4: `ExtractFn` — the container scaffold, hardened

Based on the user's proven scaffold (spec: `public.ecr.aws/lambda/python:3.13`, `pip install claude-agent-sdk>=0.2.152`, the stateless `query()` API, `HOME=/tmp`, an OAuth token cached in a module global, `/tmp` wiped every invocation, a `remaining_time - 20s` budget). This task adds what the scaffold was verified to be missing: the `ANTHROPIC_API_KEY` guard, and an idempotency check — both enforced, not merely documented.

**Files:**
- Create: `backend/extract/Dockerfile`
- Create: `backend/extract/requirements.txt`
- Create: `backend/extract/requirements-dev.txt`
- Create: `backend/extract/credentials.py`
- Create: `backend/extract/handler.py`
- Create: `backend/extract/tests/test_credentials.py`
- Create: `backend/extract/tests/test_handler.py`

**Interfaces:**
- Produces: `credentials.claude_oauth_token() -> str`, `credentials.gitloom_api_key() -> str`, `credentials.resolve(arn, fields, name) -> str`; `handler.scrub_environment() -> None`, `handler.extraction_prefix(user_id, recording_id) -> str`, `handler.already_extracted(existing_keys, prefix) -> bool`, `handler.enqueue_apply(queue_url, req) -> None`, `handler.handler(event, context) -> dict`. Task 5 edits `handler.turn()`'s body; Task 6 edits its `ClaudeAgentOptions` construction; Task 7 edits `run_one`'s tail to call `schemas.py`'s validators (not yet created).

- [ ] **Step 1: One-time dev setup**

```bash
cd backend/extract && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt 2>/dev/null || true
```

(`requirements-dev.txt` does not exist yet — this will no-op until Step 2. Left here as the command the rest of this task's `pytest` runs assume.)

- [ ] **Step 2: Write the requirements files**

`backend/extract/requirements.txt`:

```
claude-agent-sdk>=0.2.152
```

`backend/extract/requirements-dev.txt`:

```
pytest>=8.0
```

```bash
cd backend/extract && pip install -r requirements-dev.txt
```

- [ ] **Step 3: Write the failing tests**

Create `backend/extract/tests/test_credentials.py`:

```python
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import credentials


class FakeSecretsManager:
    def __init__(self, secrets):
        self.secrets = secrets
        self.calls = 0

    def get_secret_value(self, SecretId):
        self.calls += 1
        return {"SecretString": self.secrets[SecretId]}


def test_a_bare_string_secret_resolves_directly(monkeypatch):
    fake = FakeSecretsManager({"arn:1": "sk-abc"})
    monkeypatch.setattr(credentials, "_sm_client", lambda: fake)
    credentials._cache.clear()
    assert credentials.resolve("arn:1", [], "test") == "sk-abc"


def test_a_json_secret_tries_fields_in_order(monkeypatch):
    fake = FakeSecretsManager({"arn:2": json.dumps({"token": "t-123"})})
    monkeypatch.setattr(credentials, "_sm_client", lambda: fake)
    credentials._cache.clear()
    assert credentials.resolve("arn:2", ["missing", "token"], "test") == "t-123"


def test_a_second_call_is_cached_and_does_not_refetch(monkeypatch):
    fake = FakeSecretsManager({"arn:3": "sk-once"})
    monkeypatch.setattr(credentials, "_sm_client", lambda: fake)
    credentials._cache.clear()
    credentials.resolve("arn:3", [], "test")
    credentials.resolve("arn:3", [], "test")
    assert fake.calls == 1


def test_the_placeholder_is_refused(monkeypatch):
    fake = FakeSecretsManager({"arn:4": "REPLACE_ME"})
    monkeypatch.setattr(credentials, "_sm_client", lambda: fake)
    credentials._cache.clear()
    try:
        credentials.resolve("arn:4", [], "test")
        assert False, "must raise"
    except RuntimeError as exc:
        assert "placeholder" in str(exc)
```

Create `backend/extract/tests/test_handler.py`:

```python
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from handler import already_extracted, extraction_prefix, scrub_environment


def test_extraction_prefix_matches_the_go_side_scheme():
    # Must match apply.ExtractionPrefix (backend/go/internal/apply/apply.go)
    # exactly — both sides compute this independently.
    assert extraction_prefix("user_1", "rec_1") == "extract/user_1/rec_1/"


def test_already_extracted_requires_all_three_files():
    prefix = "extract/user_1/rec_1/"
    assert not already_extracted(set(), prefix)
    assert not already_extracted({prefix + "corrections.json", prefix + "tasks.json"}, prefix)
    assert already_extracted(
        {prefix + "corrections.json", prefix + "tasks.json", prefix + "memories.json"}, prefix,
    )


def test_scrub_environment_removes_a_leaked_console_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-leaked")
    scrub_environment()
    assert "ANTHROPIC_API_KEY" not in os.environ
```

- [ ] **Step 4: Run them, confirm they fail**

```bash
cd backend/extract && python3 -m pytest tests/ -v
```

Expected: `ModuleNotFoundError: No module named 'credentials'` / `'handler'`.

- [ ] **Step 5: Write `credentials.py`**

```python
"""Credentials from Secrets Manager, cached for the container's life.

Mirrors backend/go/internal/config.Resolve (internal/config/config.go): a
Lambda container is reused, so a secret fetched once should not be
re-fetched on every invocation, and a secret holding a JSON object tries a
list of field names in order. Named credentials.py rather than secrets.py —
Python's own stdlib `secrets` module would otherwise be shadowed for
anything else in this container that imports it.
"""
import json
import os

import boto3

_cache: dict[str, str] = {}
_client = None

PLACEHOLDER = "REPLACE_ME"


def _sm_client():
    global _client
    if _client is None:
        _client = boto3.client("secretsmanager")
    return _client


def resolve(arn: str, fields: list[str], name: str) -> str:
    if arn in _cache:
        return _cache[arn]
    raw = _sm_client().get_secret_value(SecretId=arn)["SecretString"]
    value = raw
    if raw.strip().startswith("{"):
        parsed = json.loads(raw)
        value = ""
        for field in fields:
            if parsed.get(field):
                value = parsed[field]
                break
        if not value:
            raise RuntimeError(f"{name}: secret holds none of {fields}")
    if value == PLACEHOLDER:
        raise RuntimeError(f"{name}: still holds the placeholder the stack created it with")
    _cache[arn] = value
    return value


def claude_oauth_token() -> str:
    return resolve(os.environ["CLAUDE_OAUTH_SECRET_ARN"], ["token"], "Claude Code OAuth token")


def gitloom_api_key() -> str:
    return resolve(os.environ["GITLOOM_SECRET_ARN"], ["apiKey", "GITLOOM_API_KEY", "key"], "GitLoom API key")
```

- [ ] **Step 6: Write `handler.py`'s skeleton**

```python
"""ExtractFn: runs Claude Code over one recording's transcript and writes the
extraction agent's three output files.

Consumes extractQueue at batchSize 1. Each message is a
types.ExtractionRequest (backend/go/internal/types/types.go) as JSON. On
success this handler re-serializes the same fields onto applyQueue; on
exhausted retries the message reaches extractQueue's own DLQ, which ApplyFn
consumes directly and treats identically (internal/apply.ExtractionPrefix).
"""
import asyncio
import json
import logging
import os
import shutil

import boto3

import credentials

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("extract")

WORKDIR = "/tmp/work"

_s3 = None
_sqs = None


def s3_client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def sqs_client():
    global _sqs
    if _sqs is None:
        _sqs = boto3.client("sqs")
    return _sqs


def scrub_environment() -> None:
    """Removes ANTHROPIC_API_KEY before the SDK ever sees it.

    options.env is merged on top of the inherited environment and the SDK
    never unsets this key itself — so a stray Console key in the function's
    own environment would silently bill that account instead of using the
    subscription OAuth token. Called first, before anything else touches
    os.environ.
    """
    os.environ.pop("ANTHROPIC_API_KEY", None)


def prepare_workdir() -> None:
    """/tmp survives a warm Lambda container across invocations; wipe it so
    a second recording never inherits the first one's files."""
    shutil.rmtree(WORKDIR, ignore_errors=True)
    os.makedirs(WORKDIR, exist_ok=True)


def extraction_prefix(user_id: str, recording_id: str) -> str:
    # Must match apply.ExtractionPrefix on the Go side (internal/apply) —
    # both compute this independently; see that function's comment.
    return f"extract/{user_id}/{recording_id}/"


def already_extracted(existing_keys: set, prefix: str) -> bool:
    """True once all three output files exist at prefix, so a Lambda retry
    that lost the race between S3 upload and returning success does not pay
    for a second agent run to produce output already sitting in S3."""
    required = {prefix + "corrections.json", prefix + "tasks.json", prefix + "memories.json"}
    return required.issubset(existing_keys)


def existing_keys_under(bucket: str, prefix: str) -> set:
    resp = s3_client().list_objects_v2(Bucket=bucket, Prefix=prefix)
    return {obj["Key"] for obj in resp.get("Contents", [])}


def download_transcript(bucket: str, key: str) -> dict:
    body = s3_client().get_object(Bucket=bucket, Key=key)["Body"].read()
    return json.loads(body)


def enqueue_apply(queue_url: str, req: dict) -> None:
    sqs_client().send_message(QueueUrl=queue_url, MessageBody=json.dumps(req))


async def run_one(req: dict, remaining_ms: int) -> None:
    """req is one parsed extractQueue message: userId, recordingId,
    startedAt, transcriptKey, speakers."""
    bucket = os.environ["AUDIO_BUCKET"]
    prefix = extraction_prefix(req["userId"], req["recordingId"])

    if already_extracted(existing_keys_under(bucket, prefix), prefix):
        log.info("already extracted recordingId=%s, re-forwarding to applyQueue", req["recordingId"])
        enqueue_apply(os.environ["APPLY_QUEUE_URL"], req)
        return

    prepare_workdir()
    transcript = download_transcript(bucket, req["transcriptKey"])
    with open(f"{WORKDIR}/transcript.json", "w") as f:
        json.dump(transcript, f)
    with open(f"{WORKDIR}/alt.txt", "w") as f:
        f.write(transcript.get("altText", ""))

    budget_seconds = max(remaining_ms / 1000 - 20, 10)
    token = credentials.claude_oauth_token()

    async def turn():
        # Task 6 fills in the system prompt, model and tool config here.
        # Task 5 adds logging and cost capture inside the loop below.
        from claude_agent_sdk import ClaudeAgentOptions, query

        options = ClaudeAgentOptions(
            cwd=WORKDIR,
            permission_mode="bypassPermissions",
            setting_sources=[],
            allowed_tools=["Read", "Write", "Grep"],
            env={"CLAUDE_CODE_OAUTH_TOKEN": token},
        )
        async for _message in query(prompt="placeholder — Task 6 replaces this", options=options):
            pass

    await asyncio.wait_for(turn(), timeout=budget_seconds)
    # Task 7 adds: validate_and_upload(...) then enqueue_apply(...) here.


def handler(event, context):
    scrub_environment()
    failures = []
    for record in event.get("Records", []):
        try:
            req = json.loads(record["body"])
        except (KeyError, json.JSONDecodeError) as exc:
            log.error("unparseable message id=%s err=%s", record.get("messageId"), exc)
            continue
        try:
            asyncio.run(run_one(req, context.get_remaining_time_in_millis()))
        except asyncio.TimeoutError:
            log.error("time budget exhausted recordingId=%s", req.get("recordingId"))
            failures.append({"itemIdentifier": record["messageId"]})
        except Exception:
            log.exception("extraction failed recordingId=%s", req.get("recordingId"))
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
```

- [ ] **Step 7: Run the tests, confirm they pass**

```bash
cd backend/extract && python3 -m pytest tests/ -v
```

Expected: `PASS`, 7 tests. (`handler.py`'s module-level code makes no AWS call on import — `s3_client()`/`sqs_client()` construct lazily — so these tests run with no AWS credentials configured.)

- [ ] **Step 8: Write the Dockerfile**

```dockerfile
# public.ecr.aws/lambda/python:3.13 — Amazon Linux 2023, glibc. The bundled
# claude_agent_sdk CLI binary (claude_agent_sdk/_bundled/claude, ~207 MB, a
# platform-specific ELF the pip wheel carries) is glibc-linked and fails to
# start on an Alpine/musl base with nothing more than "failed to start
# Claude Code" — there is no more specific error to debug from.
FROM public.ecr.aws/lambda/python:3.13

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY handler.py credentials.py ${LAMBDA_TASK_ROOT}/

# The CLI writes config, transcripts and lockfiles under $HOME on startup,
# and Lambda's own default HOME is read-only. CLAUDE_CODE_DISABLE_AUTO_MEMORY
# turns off a CLI feature this pipeline has its own memory path for
# (GitLoom) and does not want the CLI writing files for on every turn.
ENV HOME=/tmp \
    CLAUDE_CONFIG_DIR=/tmp/.claude \
    CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

CMD ["handler.handler"]
```

(`prompt.py`, `gitloom_recall.py` and `schemas.py` are added to this `COPY` line in Tasks 6 and 7, once they exist.)

- [ ] **Step 9: Commit**

```bash
git add backend/extract/Dockerfile backend/extract/requirements.txt backend/extract/requirements-dev.txt backend/extract/credentials.py backend/extract/handler.py backend/extract/tests/
git commit -m "extract: the container scaffold, with the API-key guard enforced"
```

---

## Task 5: `ExtractFn` — logging and cost capture

The scaffold has no `print`, no `logging` import, and drops `ResultMessage.total_cost_usd`, `usage` and `model_usage` on the floor — the numbers that show whether the subscription token is holding up. `logging` is already configured (Task 4, `handler.py`'s top); this task makes the turn itself log.

**Files:**
- Modify: `backend/extract/handler.py` (`run_one`'s nested `turn()`)
- Modify: `backend/extract/tests/test_handler.py`

**Interfaces:**
- Consumes: `log` (module logger, Task 4).
- Produces: nothing new callable — this task changes what one existing code path logs, so it is verified by reading the log line's shape, not by a new pure function. The one thing worth a test is that a result carrying `is_error=True` is logged at `ERROR`, not `INFO`, which is a branch, not a print statement.

- [ ] **Step 1: Write the failing test**

Add to `backend/extract/tests/test_handler.py`:

```python
import logging

from handler import log_result


class FakeResultMessage:
    def __init__(self, is_error=False):
        self.total_cost_usd = 0.0123
        self.usage = {"input_tokens": 1000, "output_tokens": 200}
        self.model_usage = {"claude-sonnet-4-5": {"input_tokens": 1000}}
        self.is_error = is_error
        self.session_id = "sess_1"


def test_a_clean_result_logs_at_info(caplog):
    with caplog.at_level(logging.INFO):
        log_result(FakeResultMessage(), "rec_1")
    assert any(r.levelno == logging.INFO and "rec_1" in r.message for r in caplog.records)


def test_an_error_result_logs_at_error(caplog):
    with caplog.at_level(logging.INFO):
        log_result(FakeResultMessage(is_error=True), "rec_1")
    assert any(r.levelno == logging.ERROR for r in caplog.records)
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
cd backend/extract && python3 -m pytest tests/test_handler.py -v -k log_result
```

Expected: `FAIL — cannot import name 'log_result'`.

- [ ] **Step 3: Add `log_result` and call it from `turn()`**

In `backend/extract/handler.py`, add a module-level function (near `enqueue_apply`):

```python
def log_result(message, recording_id: str) -> None:
    """Logs the one ResultMessage a turn ends with. total_cost_usd, usage
    and model_usage are what show whether the subscription OAuth token is
    holding up under load — dropped on the floor in the original scaffold,
    logged here per extraction rather than only discoverable by re-running
    one by hand."""
    fields = (
        "recordingId=%s sessionId=%s cost_usd=%s usage=%s model_usage=%s"
        % (recording_id, message.session_id, message.total_cost_usd, message.usage, message.model_usage)
    )
    if message.is_error:
        log.error("extraction turn ended in error %s", fields)
    else:
        log.info("extraction turn finished %s", fields)
```

Replace `turn()`'s loop body:

```python
        from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

        options = ClaudeAgentOptions(
            cwd=WORKDIR,
            permission_mode="bypassPermissions",
            setting_sources=[],
            allowed_tools=["Read", "Write", "Grep"],
            env={"CLAUDE_CODE_OAUTH_TOKEN": token},
        )
        async for message in query(prompt="placeholder — Task 6 replaces this", options=options):
            if isinstance(message, ResultMessage):
                log_result(message, req["recordingId"])
```

- [ ] **Step 4: Run it, confirm it passes**

```bash
cd backend/extract && python3 -m pytest tests/ -v
```

Expected: `PASS`, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/extract/handler.py backend/extract/tests/test_handler.py
git commit -m "extract: log cost and usage per extraction, not only on request"
```

---

## Task 6: `ExtractFn` — the system prompt, the model, and GitLoom `Recall` (§2)

The scaffold's `allowed_tools` (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`) includes tools extraction does not need. This task picks the real list, adds the one tool extraction is missing — `Recall`, so the agent does not restate what GitLoom already holds (spec §2) — and picks a model.

**Files:**
- Create: `backend/extract/prompt.py`
- Create: `backend/extract/gitloom_recall.py`
- Modify: `backend/extract/handler.py` (`turn()`'s `ClaudeAgentOptions`)
- Modify: `backend/extract/Dockerfile` (the `COPY` line)
- Create: `backend/extract/tests/test_gitloom_recall.py`

**Interfaces:**
- Consumes: `credentials.gitloom_api_key()` (Task 4).
- Produces: `prompt.SYSTEM_PROMPT: str`, `prompt.MODEL: str`, `prompt.ALLOWED_TOOLS: list[str]`, `prompt.build_prompt(transcript_path, alt_path, categories: list) -> str`; `gitloom_recall.namespace_for(user_id) -> str`, `gitloom_recall.recall(query_text, user_id, limit=5) -> list[dict]`, `gitloom_recall.build_recall_tool(user_id)` (an MCP server object) — consumed by Task 7's `turn()` wiring (already wired here, since it belongs beside the rest of `ClaudeAgentOptions`).

- [ ] **Step 1: Verify the SDK's tool-registration API before writing against it**

`claude-agent-sdk>=0.2.152` is not yet installed in a way this repo can introspect without a real environment. Before trusting the shape below, run, in any environment with the package installed:

```bash
pip install "claude-agent-sdk>=0.2.152" >/dev/null
python3 -c "from claude_agent_sdk import tool, create_sdk_mcp_server; help(tool); help(create_sdk_mcp_server)"
```

The code below assumes the documented shape — a `@tool(name, description, input_schema)` decorator over an `async def(args) -> dict` returning `{"content": [{"type": "text", "text": ...}]}`, and `create_sdk_mcp_server(name, version, tools=[...])` returning an object passed as one entry of `ClaudeAgentOptions(mcp_servers={...})`. If the installed version differs, adjust `gitloom_recall.py`'s decorator and return shape to match — the *behaviour* (search GitLoom, return text hits) does not change.

- [ ] **Step 2: Write the failing tests**

Create `backend/extract/tests/test_gitloom_recall.py`:

```python
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from gitloom_recall import namespace_for


def test_an_already_valid_namespace_passes_through():
    # Mirrors gitloomx.Namespace (backend/go/internal/gitloomx/namespace.go):
    # lowercase letters, digits and '-', up to 64 chars, already qualifies.
    assert namespace_for("already-valid-123") == "already-valid-123"


def test_a_clerk_subject_is_folded_with_a_digest_suffix():
    ns = namespace_for("user_3J3fsbqIQhi6mqtfNj0JknPdOtO")
    assert ns.startswith("user-3j3fsbqiqhi6mqtfnj0jknpdoto-") or ns.startswith("user-")
    assert len(ns) <= 64
    # Stable: the same input always lands in the same namespace.
    assert ns == namespace_for("user_3J3fsbqIQhi6mqtfNj0JknPdOtO")


def test_two_ids_differing_only_by_case_land_in_different_namespaces():
    a = namespace_for("User_ABC")
    b = namespace_for("user_abc")
    assert a != b
```

- [ ] **Step 3: Run them, confirm they fail**

```bash
cd backend/extract && python3 -m pytest tests/test_gitloom_recall.py -v
```

Expected: `FAIL — No module named 'gitloom_recall'`.

- [ ] **Step 4: Write `gitloom_recall.py`**

```python
"""The extraction agent's own Recall tool.

Real tool use during the extraction turn (spec §2): before the agent writes
memories.json, it can ask GitLoom what it already holds for this person, so
it does not restate a fact GitLoom already extracted from an earlier
conversation. This is best-effort dedup — Recall is similarity search, not
exact match, so it will occasionally miss a real duplicate or suppress
something that was not actually a repeat. It is also the only dedup this
pipeline has: nothing written to GitLoom can be deleted or superseded at the
pinned gitloom-go v0.3.4 (RememberOptions.SessionID is write-only, with no
matching filter on Recall).

A plain HTTPS call, not the Go SDK: GitLoom's own REST API is what the SDK
wraps (POST /v1/memories, GET /v1/retrieve, Bearer auth) — this container has
no reason to vendor Go for two REST calls.
"""
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request

from claude_agent_sdk import create_sdk_mcp_server, tool

import credentials

GITLOOM_BASE_URL = os.environ.get("GITLOOM_BASE_URL", "https://api.gitloom.cloud").rstrip("/")

_VALID_NAMESPACE = re.compile(r"^[a-z0-9-]{1,64}$")


def namespace_for(user_id: str) -> str:
    """Mirrors gitloomx.Namespace (backend/go/internal/gitloomx/namespace.go)
    exactly: an already-valid id passes through untouched; anything else is
    folded to lowercase with a short digest of the *original* appended, so
    folding two ids to the same text cannot merge two accounts' memories."""
    if _VALID_NAMESPACE.match(user_id):
        return user_id
    head = re.sub(r"[^a-z0-9-]", "-", user_id.lower())
    suffix = "-" + hashlib.sha256(user_id.encode()).hexdigest()[:8]
    if len(head) + len(suffix) > 64:
        head = head[: 64 - len(suffix)]
    return head + suffix


def recall(query_text: str, user_id: str, limit: int = 5) -> list:
    namespace = namespace_for(user_id)
    params = urllib.parse.urlencode({"q": query_text, "namespace": namespace, "limit": limit})
    req = urllib.request.Request(
        f"{GITLOOM_BASE_URL}/v1/retrieve?{params}",
        headers={"Authorization": f"Bearer {credentials.gitloom_api_key()}"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = json.loads(resp.read())
    return body.get("hits", [])


def build_recall_tool(user_id: str):
    """Binds the tool to one recording's user — the agent never chooses a
    namespace, so it can never reach another user's memories no matter what
    it asks."""

    @tool(
        "recall",
        "Search this person's existing memories before writing new ones, to avoid restating what is already known.",
        {"query": str},
    )
    async def recall_tool(args):
        try:
            hits = recall(args["query"], user_id)
        except Exception as exc:  # a Recall outage must not stop extraction
            return {"content": [{"type": "text", "text": f"recall unavailable: {exc}"}]}
        if not hits:
            return {"content": [{"type": "text", "text": "nothing found"}]}
        lines = [f"- {h.get('snippet', '')}" for h in hits[:5]]
        return {"content": [{"type": "text", "text": "\n".join(lines)}]}

    return create_sdk_mcp_server(name="gitloom", version="1.0.0", tools=[recall_tool])
```

- [ ] **Step 5: Run the tests, confirm they pass**

```bash
cd backend/extract && python3 -m pytest tests/test_gitloom_recall.py -v
```

Expected: `PASS`, 3 tests.

- [ ] **Step 6: Write `prompt.py`**

```python
"""The extraction agent's fixed instructions, model and tool allowlist."""

MODEL = "sonnet"
# An alias, not a pinned dated snapshot: the alias tracks whichever model the
# CLI currently calls "sonnet", so this file does not go stale the day a new
# snapshot ships. Task 5's cost/usage logging records which concrete model
# actually ran on every extraction, so drift is visible in the logs rather
# than silently assumed.

ALLOWED_TOOLS = ["Read", "Write", "Grep", "mcp__gitloom__recall"]
# The scaffold's own list was ["Read", "Write", "Edit", "Bash", "Glob",
# "Grep"]. Dropped here:
#   Edit  — every output is a full-file JSON rewrite (Write), never a
#           partial patch; a structural edit to JSON risks leaving invalid
#           JSON behind, which a full rewrite does not.
#   Bash  — extraction never compiles, runs, or shells out to anything.
#   Glob  — the prompt names the exact input files directly; there is
#           nothing in the working directory worth discovering.
# Kept:
#   Read  — how the agent gets the transcript and the alt reading into
#           context.
#   Write — how it produces its three output files.
#   Grep  — a long transcript is cheaper to search than to reread whole.
# Added:
#   mcp__gitloom__recall — spec §2: real tool use, so the agent can avoid
#           restating a fact GitLoom already holds before it writes
#           memories.json.

SYSTEM_PROMPT = """You are extracting structured information from one \
transcript of a real conversation captured by a wearable pendant.

Two files are already in your working directory:
  transcript.json  the diarized transcript: {"utterances": [{"speaker": int, \
"text": str, ...}, ...], ...}
  alt.txt           a second speech-to-text engine's plain-text reading of \
the same audio, for correcting the first where it garbled a word.

Before you write memories.json, call the recall tool with a short query \
describing what this conversation might add, so you do not restate a fact \
already on file for this person. Recall is similarity search, not exact \
match — use your judgement about what it returns; it will not always be a \
perfect duplicate check.

Write exactly four files to your working directory:

corrections.json — a JSON array of {"i": <utterance index>, "text": \
"<corrected text>"}. List only utterances alt.txt clearly corrects: garbled \
words, misheard phrases, wrong proper nouns. Never rephrase, never fix \
grammar, never invent words absent from both readings. Empty array if \
nothing needs correcting.

tasks.json — a JSON array of {"text": str, "owner": <speaker index or \
null>, "kind": "message"|"spend"|"file"|"reminder"|"other"}. Only \
commitments someone actually made. Empty array if nobody committed to \
anything — most conversations have none.

memories.json — a JSON array of {"text": str, "kind": \
"fact"|"preference"|"person"|"decision"}, at most 200 characters each. Only \
durable things this conversation establishes about the wearer's own life. \
Speaker labels are anonymous diarizer indices, not identities: do not \
record who someone is unless the transcript itself says so. Content from a \
television, a phone call on speaker, or anyone else's story is not a fact \
about the wearer. Empty array is the right answer for most conversations.

summary.json — a single JSON object, not an array: {"title": str, "tags": \
[str, ...], "summary": str, "category": str|null}. title is 3-8 words \
naming what this conversation was actually about — never "Conversation" or \
"Meeting Discussion" — and is the one field here that must not be empty. \
tags is 2-5 lowercase single-word or short hyphenated topic tags. summary \
is 2-4 sentences on what was discussed and decided, written for someone who \
was there and wants to remember. category is exactly one name from the \
list you are given below, chosen by this conversation's dominant subject, \
or null when none of them honestly fits — never invent one.

Re-read each file after writing it. If something is wrong — invalid JSON, \
an index out of range, a kind or category you invented — rewrite that file \
before finishing."""


def build_prompt(transcript_path: str, alt_path: str, categories: list) -> str:
    category_line = (
        f"Categories to choose from for summary.json: {', '.join(categories)}."
        if categories
        else "No categories are defined for this person yet — summary.json's category must be null."
    )
    return (
        f"transcript.json and alt.txt are in your working directory "
        f"({transcript_path}, {alt_path} on disk). Read them, then write "
        f"corrections.json, tasks.json, memories.json and summary.json as "
        f"instructed. {category_line}"
    )
```

- [ ] **Step 7: Wire both into `handler.py`'s `turn()`**

In `backend/extract/handler.py`, replace `turn()`'s body:

```python
        from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

        from gitloom_recall import build_recall_tool
        from prompt import ALLOWED_TOOLS, MODEL, SYSTEM_PROMPT, build_prompt

        options = ClaudeAgentOptions(
            cwd=WORKDIR,
            system_prompt=SYSTEM_PROMPT,
            model=MODEL,
            permission_mode="bypassPermissions",
            setting_sources=[],
            allowed_tools=ALLOWED_TOOLS,
            mcp_servers={"gitloom": build_recall_tool(req["userId"])},
            env={"CLAUDE_CODE_OAUTH_TOKEN": token},
        )
        prompt_text = build_prompt(
            f"{WORKDIR}/transcript.json", f"{WORKDIR}/alt.txt", req.get("categories") or [],
        )
        async for message in query(prompt=prompt_text, options=options):
            if isinstance(message, ResultMessage):
                log_result(message, req["recordingId"])
```

- [ ] **Step 8: Add the two new files to the Dockerfile's `COPY`**

```dockerfile
COPY handler.py credentials.py prompt.py gitloom_recall.py ${LAMBDA_TASK_ROOT}/
```

- [ ] **Step 9: Run the full pytest suite**

```bash
cd backend/extract && python3 -m pytest tests/ -v
```

Expected: `PASS`, 12 tests.

- [ ] **Step 10: Commit**

```bash
git add backend/extract/prompt.py backend/extract/gitloom_recall.py backend/extract/handler.py backend/extract/Dockerfile backend/extract/tests/test_gitloom_recall.py
git commit -m "extract: the system prompt, a real tool allowlist, and Recall before write"
```

---

## Task 7: `ExtractFn` — the four-file output contract

The agent's self-correction ("re-read each file... rewrite before finishing", Task 6) is most of what this upgrade buys over the single-shot Bedrock call — files are deterministic where a parsed reply is not. This task validates what the agent wrote, uploads only once all four pass, and hands off to `applyQueue`. It also probes `ResultMessage.structured_output`, per the spec's explicit ask, and records the finding.

**Files:**
- Create: `backend/extract/schemas.py`
- Modify: `backend/extract/handler.py` (`run_one`'s tail)
- Modify: `backend/extract/Dockerfile` (the `COPY` line)
- Create: `backend/extract/tests/test_schemas.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `schemas.ValidationError`, `schemas.validate_corrections(raw, utterance_count) -> list[dict]`, `schemas.validate_tasks(raw) -> list[dict]`, `schemas.validate_memories(raw) -> list[dict]`, `schemas.validate_summary(raw) -> dict`. These validate independently of — and must agree with — `internal/apply`'s Go-side validators (Task 8); the two are not shared code because they run in different languages, so both must be kept honest against the same four contracts by hand. `validate_summary` deliberately does not check `category` against any particular list of names — see Step 3's comment, and the spec's 2026-09-14 amendment on `summary.json`.

- [ ] **Step 1: Write the failing tests**

Create `backend/extract/tests/test_schemas.py`:

```python
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from schemas import (
    ValidationError, validate_corrections, validate_memories, validate_summary, validate_tasks,
)


def test_valid_corrections_round_trip():
    raw = b'[{"i": 0, "text": "fixed"}]'
    assert validate_corrections(raw, utterance_count=2) == [{"i": 0, "text": "fixed"}]


def test_corrections_rejects_an_out_of_range_index():
    with pytest.raises(ValidationError):
        validate_corrections(b'[{"i": 5, "text": "x"}]', utterance_count=2)


def test_corrections_rejects_malformed_json():
    with pytest.raises(ValidationError):
        validate_corrections(b"not json", utterance_count=2)


def test_empty_arrays_are_valid_for_every_file():
    assert validate_corrections(b"[]", utterance_count=2) == []
    assert validate_tasks(b"[]") == []
    assert validate_memories(b"[]") == []


def test_tasks_rejects_an_invented_kind():
    with pytest.raises(ValidationError):
        validate_tasks(b'[{"text": "call the vet", "kind": "urgent"}]')


def test_a_partially_written_memories_file_fails_wholesale():
    # One good entry, one with an invented kind — the whole file is untrusted.
    raw = b'[{"text": "a real fact", "kind": "fact"}, {"text": "bad", "kind": "opinion"}]'
    with pytest.raises(ValidationError):
        validate_memories(raw)


def test_memories_rejects_an_entry_with_no_text():
    with pytest.raises(ValidationError):
        validate_memories(b'[{"kind": "fact"}]')


def test_valid_summary_round_trips():
    raw = (
        b'{"title": "Standup with Ravi", "tags": ["work", "standup"], '
        b'"summary": "Discussed the release.", "category": "Work"}'
    )
    out = validate_summary(raw)
    assert out == {
        "title": "Standup with Ravi", "tags": ["work", "standup"],
        "summary": "Discussed the release.", "category": "Work",
    }


def test_summary_requires_a_non_empty_title():
    # A blank title was exactly the regression this file exists to fix.
    with pytest.raises(ValidationError):
        validate_summary(b'{"tags": [], "summary": "x"}')


def test_summary_allows_a_null_category():
    # enrich.go's own ResolveCategory treats "none of them honestly fits" as
    # a legitimate answer, not a failure — summary.json must be allowed the
    # same answer.
    out = validate_summary(b'{"title": "Something happened", "category": null}')
    assert out["category"] is None


def test_summary_is_an_object_not_an_array():
    with pytest.raises(ValidationError):
        validate_summary(b'[{"title": "x"}]')


def test_summary_tags_are_capped_at_five_and_lowercased():
    raw = json.dumps({"title": "x", "tags": ["A", "B", "C", "D", "E", "F"]}).encode()
    out = validate_summary(raw)
    assert out["tags"] == ["a", "b", "c", "d", "e"]


def test_summary_does_not_reject_a_category_it_has_never_seen():
    # Membership in the list the agent was offered is enrich.ResolveCategory's
    # job on the Go side (Task 9) — this validator only checks the type.
    out = validate_summary(b'{"title": "x", "category": "Something Invented"}')
    assert out["category"] == "Something Invented"
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
cd backend/extract && python3 -m pytest tests/test_schemas.py -v
```

Expected: `FAIL — No module named 'schemas'`.

- [ ] **Step 3: Write `schemas.py`**

```python
"""Validation for the four files the extraction agent writes.

Each function takes the raw bytes read from disk and returns the parsed,
type-checked value, or raises ValidationError. Nothing here touches AWS or
the filesystem. internal/apply on the Go side re-implements the same rules
independently — the two checks are not shared code, since they run in
different languages, but they must agree on the same four contracts.
"""
import json


class ValidationError(Exception):
    """A file does not match its contract. Never partially applied — see
    validate_and_upload, which uploads only once every file has passed."""


VALID_TASK_KINDS = {"message", "spend", "file", "reminder", "other"}
VALID_FACT_KINDS = {"fact", "preference", "person", "decision"}


def _load_array(raw: bytes) -> list:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"not valid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise ValidationError("expected a JSON array at the top level")
    return data


def validate_corrections(raw: bytes, utterance_count: int) -> list:
    """The same shape enrich.ApplyCorrections has always accepted
    (backend/go/internal/enrich/merge.go:68): {"i": <utterance index>,
    "text": "<corrected text>"}."""
    data = _load_array(raw)
    out = []
    for entry in data:
        if not isinstance(entry, dict):
            raise ValidationError("every entry must be an object")
        if "i" not in entry or "text" not in entry:
            raise ValidationError("entry missing i or text")
        i, text = entry["i"], entry["text"]
        if not isinstance(i, int) or isinstance(i, bool):
            raise ValidationError("i must be an integer")
        if not isinstance(text, str) or not text.strip():
            raise ValidationError("text must be a non-empty string")
        if i < 0 or i >= utterance_count:
            raise ValidationError(f"i={i} is out of range for {utterance_count} utterances")
        out.append({"i": i, "text": text.strip()})
    return out


def validate_tasks(raw: bytes) -> list:
    data = _load_array(raw)
    out = []
    for entry in data:
        if not isinstance(entry, dict):
            raise ValidationError("every entry must be an object")
        text = entry.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValidationError("text must be a non-empty string")
        owner = entry.get("owner")
        if owner is not None and (not isinstance(owner, int) or isinstance(owner, bool)):
            raise ValidationError("owner must be an integer or null")
        kind = entry.get("kind", "other")
        if kind not in VALID_TASK_KINDS:
            raise ValidationError(f"kind {kind!r} is not one of {sorted(VALID_TASK_KINDS)}")
        out.append({"text": text.strip()[:400], "owner": owner, "kind": kind})
    return out


def validate_memories(raw: bytes) -> list:
    data = _load_array(raw)
    out = []
    for entry in data:
        if not isinstance(entry, dict):
            raise ValidationError("every entry must be an object")
        text = entry.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValidationError("text must be a non-empty string")
        kind = entry.get("kind", "fact")
        if kind not in VALID_FACT_KINDS:
            raise ValidationError(f"kind {kind!r} is not one of {sorted(VALID_FACT_KINDS)}")
        out.append({"text": text.strip()[:200], "kind": kind})
    return out


def validate_summary(raw: bytes) -> dict:
    """summary.json: a single object, not an array — {"title": str, "tags":
    [str, ...], "summary": str, "category": str|None}. Field names, types
    and caps mirror enrich.go's Coerce exactly (enrich.go:229-261), so
    ApplyFn writes into the same Recording fields the app already reads.

    category is checked only for type here, not for membership in whatever
    list the agent was given (prompt.build_prompt, Task 6) — resolving a
    name to an id, and answering "" for anything unrecognised, is
    enrich.ResolveCategory's job on the Go side (Task 9), already the one
    place that decision is made. Duplicating a membership check here would
    just be a second, competing answer to the same question.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValidationError("expected a JSON object, not an array")

    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ValidationError("title must be a non-empty string")

    tags_raw = data.get("tags", [])
    if not isinstance(tags_raw, list):
        raise ValidationError("tags must be an array")
    tags = []
    for tag in tags_raw[:5]:
        if not isinstance(tag, str):
            raise ValidationError("every tag must be a string")
        cleaned = tag.strip().lower()[:40]
        if cleaned:
            tags.append(cleaned)

    summary = data.get("summary", "")
    if not isinstance(summary, str):
        raise ValidationError("summary must be a string")

    category = data.get("category")
    if category is not None and not isinstance(category, str):
        raise ValidationError("category must be a string or null")

    return {
        "title": title.strip()[:200],
        "tags": tags,
        "summary": summary.strip()[:4000],
        "category": category.strip() if isinstance(category, str) else None,
    }
```

- [ ] **Step 4: Run them, confirm they pass**

```bash
cd backend/extract && python3 -m pytest tests/ -v
```

Expected: `PASS`, 25 tests.

- [ ] **Step 5: Wire validation, upload and hand-off into `handler.py`**

Add, near `enqueue_apply`:

```python
def validate_and_upload(bucket: str, prefix: str, utterance_count: int) -> None:
    """Reads the four files the agent wrote to WORKDIR, validates each
    against its contract, and uploads only once all four pass — a partial
    upload would let ApplyFn see three good files and one it can never trust
    came from a matching run."""
    from schemas import (
        ValidationError, validate_corrections, validate_memories, validate_summary, validate_tasks,
    )

    validators = {
        "corrections.json": lambda raw: validate_corrections(raw, utterance_count),
        "tasks.json": validate_tasks,
        "memories.json": validate_memories,
        "summary.json": validate_summary,
    }
    bodies = {}
    for name, validate in validators.items():
        path = f"{WORKDIR}/{name}"
        if not os.path.exists(path):
            raise ValidationError(f"{name}: the agent did not write this file")
        with open(path, "rb") as f:
            raw = f.read()
        validate(raw)  # raises ValidationError if the content is bad
        bodies[name] = raw

    for name, raw in bodies.items():
        s3_client().put_object(Bucket=bucket, Key=prefix + name, Body=raw, ContentType="application/json")
```

Replace `run_one`'s final line (`# Task 7 adds: ...`):

```python
    await asyncio.wait_for(turn(), timeout=budget_seconds)
    validate_and_upload(bucket, prefix, len(transcript.get("utterances", [])))
    enqueue_apply(os.environ["APPLY_QUEUE_URL"], req)
```

A `ValidationError` here propagates out of `run_one`, is caught by `handler`'s existing `except Exception`, and becomes a batch item failure — same as any other extraction failure, eventually reaching `extractDlq` after `maxReceiveCount` retries, where `ApplyFn` runs the fallback (Task 10).

- [ ] **Step 6: Add `schemas.py` to the Dockerfile's `COPY`**

```dockerfile
COPY handler.py credentials.py prompt.py gitloom_recall.py schemas.py ${LAMBDA_TASK_ROOT}/
```

- [ ] **Step 7: Probe `ResultMessage.structured_output`**

With `claude-agent-sdk>=0.2.152` installed and a real OAuth token available, run:

```bash
python3 -c "
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

async def main():
    async for msg in query(prompt='Say hi and stop.', options=ClaudeAgentOptions(max_turns=1)):
        if isinstance(msg, ResultMessage):
            print('structured_output:', repr(getattr(msg, 'structured_output', '<no such attribute>')))

asyncio.run(main())
"
```

Record the finding as a comment at the top of `schemas.py`: whether `structured_output` exists on this SDK version, what shape it holds, and whether it could replace the file-write convention in a future revision. The file convention above ships regardless of the answer — files are what let the agent re-read and correct its own output before finishing (spec §1), which is the documented reason for choosing them, not a workaround for a missing SDK feature.

- [ ] **Step 8: Run the full test suite once more, then commit**

```bash
cd backend/extract && python3 -m pytest tests/ -v
```

Expected: `PASS`, 25 tests.

```bash
git add backend/extract/schemas.py backend/extract/handler.py backend/extract/Dockerfile backend/extract/tests/test_schemas.py
git commit -m "extract: validate, upload, hand off to applyQueue"
```

---

## Task 8: `internal/apply` — validating what the agent wrote, in Go

The Go-side mirror of `schemas.py` (Task 7), strict in the same way and for the same reason: any single bad file means the whole extraction is untrusted, not partially applied. This is the exact decision function the Testing section's four scenarios (malformed `corrections.json`, missing `tasks.json`, partially-written `memories.json`, an agent run that wrote nothing at all) are written against — now against four files, since the spec's 2026-09-14 amendment added `summary.json` to close the gap this plan's own Self-Review found: a successful extraction produced no title.

**Files:**
- Create: `backend/go/internal/apply/validate.go`
- Create: `backend/go/internal/apply/validate_test.go`

**Interfaces:**
- Consumes: `types.ActionItem`, `types.Fact`, `types.TaskKinds`, `types.FactKinds`, `types.TaskKindOther`, `types.FactKindFact` (all existing, `internal/types`).
- Produces: `apply.SummaryFile{Title, Summary, Category string; Tags []string}`; `apply.Outcome{Corrections []map[string]any; Tasks []types.ActionItem; Memories []types.Fact; Summary SummaryFile}`; `apply.ValidateAll(corrections, tasks, memories, summary []byte, utteranceCount int) (Outcome, error)`; `apply.ValidateCorrections(raw []byte, utteranceCount int) ([]map[string]any, error)`; `apply.ValidateTasks(raw []byte) ([]types.ActionItem, error)`; `apply.ValidateMemories(raw []byte) ([]types.Fact, error)`; `apply.ValidateSummary(raw []byte) (SummaryFile, error)` — all consumed by Task 9's `cmd/apply/main.go`. `SummaryFile.Category` is the agent's chosen *name*, unresolved — Task 9 resolves it to an id via the existing `enrich.ResolveCategory`, which this package deliberately does not call itself (it would need the caller's live category list, a DynamoDB read this package has no reason to make).

- [ ] **Step 1: Write the failing tests**

Create `backend/go/internal/apply/validate_test.go`:

```go
package apply

import (
	"strings"
	"testing"
)

func TestValidateAllAppliesOnlyWhenEveryFileIsGood(t *testing.T) {
	corrections := []byte(`[{"i": 0, "text": "fixed"}]`)
	tasks := []byte(`[{"text": "call the vet", "owner": 0, "kind": "message"}]`)
	memories := []byte(`[{"text": "wants a vet appointment", "kind": "fact"}]`)
	summary := []byte(`{"title": "Standup with Ravi", "tags": ["work"], "summary": "x", "category": "Work"}`)

	out, err := ValidateAll(corrections, tasks, memories, summary, 2)
	if err != nil {
		t.Fatalf("valid files must not fail: %v", err)
	}
	if len(out.Corrections) != 1 || len(out.Tasks) != 1 || len(out.Memories) != 1 {
		t.Fatalf("got %+v", out)
	}
	if out.Summary.Title != "Standup with Ravi" || out.Summary.Category != "Work" {
		t.Fatalf("got %+v", out.Summary)
	}
}

func TestMalformedCorrectionsFailsTheWholeFile(t *testing.T) {
	_, err := ValidateAll([]byte(`not json`), []byte(`[]`), []byte(`[]`), []byte(`{"title": "x"}`), 2)
	if err == nil || !strings.Contains(err.Error(), "corrections.json") {
		t.Fatalf("err = %v, want it to name corrections.json", err)
	}
}

func TestAMissingFileFailsCleanly(t *testing.T) {
	_, err := ValidateAll([]byte(`[]`), nil, []byte(`[]`), []byte(`{"title": "x"}`), 2)
	if err == nil || !strings.Contains(err.Error(), "tasks.json is missing") {
		t.Fatalf("err = %v, want tasks.json missing", err)
	}
}

func TestAPartiallyWrittenMemoriesFileFailsCleanly(t *testing.T) {
	memories := []byte(`[{"text": "a real fact", "kind": "fact"}, {"text": "bad", "kind": "opinion"}]`)
	_, err := ValidateAll([]byte(`[]`), []byte(`[]`), memories, []byte(`{"title": "x"}`), 2)
	if err == nil || !strings.Contains(err.Error(), "memories.json") {
		t.Fatalf("err = %v, want it to name memories.json", err)
	}
}

func TestAnAgentRunThatWroteNothingFailsOnTheFirstMissingFile(t *testing.T) {
	_, err := ValidateAll(nil, nil, nil, nil, 2)
	if err == nil || !strings.Contains(err.Error(), "corrections.json is missing") {
		t.Fatalf("err = %v", err)
	}
}

func TestAMissingSummaryFailsCleanly(t *testing.T) {
	_, err := ValidateAll([]byte(`[]`), []byte(`[]`), []byte(`[]`), nil, 2)
	if err == nil || !strings.Contains(err.Error(), "summary.json is missing") {
		t.Fatalf("err = %v, want summary.json missing", err)
	}
}

func TestCorrectionsRejectsAnOutOfRangeIndex(t *testing.T) {
	_, err := ValidateCorrections([]byte(`[{"i": 5, "text": "x"}]`), 2)
	if err == nil {
		t.Fatal("an index past the transcript's own length must fail")
	}
}

func TestEmptyArraysAreValid(t *testing.T) {
	out, err := ValidateAll([]byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{"title": "x"}`), 2)
	if err != nil {
		t.Fatalf("three empty arrays and a bare title must validate: %v", err)
	}
	if len(out.Tasks) != 0 || len(out.Memories) != 0 || len(out.Corrections) != 0 {
		t.Fatalf("want three empty results, got %+v", out)
	}
}

func TestTasksRejectsAnInventedKind(t *testing.T) {
	_, err := ValidateTasks([]byte(`[{"text": "call the vet", "kind": "urgent"}]`))
	if err == nil {
		t.Fatal("an unrecognised kind must fail validation, not default silently")
	}
}

func TestSummaryRequiresANonEmptyTitle(t *testing.T) {
	// A blank title was exactly the regression summary.json exists to fix.
	_, err := ValidateSummary([]byte(`{"tags": []}`))
	if err == nil {
		t.Fatal("a summary.json with no title must fail validation")
	}
}

func TestSummaryAllowsANullCategory(t *testing.T) {
	out, err := ValidateSummary([]byte(`{"title": "Something happened", "category": null}`))
	if err != nil {
		t.Fatalf("a null category must be allowed: %v", err)
	}
	if out.Category != "" {
		t.Fatalf("category = %q, want empty", out.Category)
	}
}

func TestSummaryDoesNotRejectACategoryItHasNeverSeen(t *testing.T) {
	// Membership in the list the agent was offered is enrich.ResolveCategory's
	// job on the Go side (Task 9) — ValidateSummary only checks the type.
	out, err := ValidateSummary([]byte(`{"title": "x", "category": "Something Invented"}`))
	if err != nil {
		t.Fatalf("an unrecognised category name must not fail validation here: %v", err)
	}
	if out.Category != "Something Invented" {
		t.Fatalf("got %q", out.Category)
	}
}

func TestSummaryIsAnObjectNotAnArray(t *testing.T) {
	_, err := ValidateSummary([]byte(`[{"title": "x"}]`))
	if err == nil {
		t.Fatal("summary.json is a single object; an array must fail")
	}
}

func TestSummaryTagsAreCappedAtFiveAndLowercased(t *testing.T) {
	out, err := ValidateSummary([]byte(`{"title": "x", "tags": ["A", "B", "C", "D", "E", "F"]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"a", "b", "c", "d", "e"}
	if len(out.Tags) != len(want) {
		t.Fatalf("tags = %v, want %v", out.Tags, want)
	}
	for i := range want {
		if out.Tags[i] != want[i] {
			t.Fatalf("tags = %v, want %v", out.Tags, want)
		}
	}
}
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
cd backend/go && go test ./internal/apply/ -v
```

Expected: `FAIL — no Go files in .../internal/apply` (the package does not exist yet).

- [ ] **Step 3: Write `validate.go`**

```go
// Package apply validates and applies what the extraction agent wrote, and
// holds the parts of the Bedrock fallback's output that need identical
// treatment — the same four-file shape, whichever path produced it.
package apply

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// SummaryFile is what summary.json decodes to. Category is the agent's
// chosen *name*, unresolved — an id needs the caller's live category list,
// which this package does not read; ApplyFn (Task 9) resolves it via the
// existing enrich.ResolveCategory, exactly as the Bedrock fallback already
// does. "" means no category, whether the agent said null or ApplyFn later
// fails to resolve the name — the same outcome ResolveCategory already
// gives an invented name.
type SummaryFile struct {
	Title    string
	Tags     []string
	Summary  string
	Category string
}

// Outcome is what a fully-valid set of extraction files decodes to.
type Outcome struct {
	Corrections []map[string]any
	Tasks       []types.ActionItem
	Memories    []types.Fact
	Summary     SummaryFile
}

// ValidateAll checks all four files together and fails on the first
// problem, naming which file and why. Deliberately all-or-nothing: applying
// three good files and skipping a fourth bad one would leave a recording in
// a state nothing produced on purpose, so ApplyFn treats any error here as
// "run the fallback instead," never "apply what validated."
//
// A nil slice means the file was not found in S3 — the agent never wrote
// it, or ExtractFn never got far enough to upload it.
func ValidateAll(corrections, tasks, memories, summary []byte, utteranceCount int) (Outcome, error) {
	if corrections == nil {
		return Outcome{}, fmt.Errorf("corrections.json is missing")
	}
	c, err := ValidateCorrections(corrections, utteranceCount)
	if err != nil {
		return Outcome{}, fmt.Errorf("corrections.json: %w", err)
	}
	if tasks == nil {
		return Outcome{}, fmt.Errorf("tasks.json is missing")
	}
	t, err := ValidateTasks(tasks)
	if err != nil {
		return Outcome{}, fmt.Errorf("tasks.json: %w", err)
	}
	if memories == nil {
		return Outcome{}, fmt.Errorf("memories.json is missing")
	}
	m, err := ValidateMemories(memories)
	if err != nil {
		return Outcome{}, fmt.Errorf("memories.json: %w", err)
	}
	if summary == nil {
		return Outcome{}, fmt.Errorf("summary.json is missing")
	}
	s, err := ValidateSummary(summary)
	if err != nil {
		return Outcome{}, fmt.Errorf("summary.json: %w", err)
	}
	return Outcome{Corrections: c, Tasks: t, Memories: m, Summary: s}, nil
}

// ValidateCorrections checks the same shape ApplyCorrections has always
// accepted (internal/enrich/merge.go:68). Strict, unlike ApplyCorrections
// itself — that function silently skips a bad entry because it is reading a
// Bedrock reply it cannot ask to try again; this is reading a file the
// agent was told to re-read and fix, so one bad entry means the whole file
// is not trustworthy.
func ValidateCorrections(raw []byte, utteranceCount int) ([]map[string]any, error) {
	var data []map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("not a JSON array of objects: %w", err)
	}
	for _, entry := range data {
		idxRaw, ok := entry["i"]
		if !ok {
			return nil, fmt.Errorf("entry missing i")
		}
		idx, ok := idxRaw.(float64)
		if !ok || idx != float64(int(idx)) {
			return nil, fmt.Errorf("i must be an integer")
		}
		text, ok := entry["text"].(string)
		if !ok || strings.TrimSpace(text) == "" {
			return nil, fmt.Errorf("entry missing non-empty text")
		}
		i := int(idx)
		if i < 0 || i >= utteranceCount {
			return nil, fmt.Errorf("i=%d is out of range for %d utterances", i, utteranceCount)
		}
	}
	return data, nil
}

// ValidateTasks checks tasks.json strictly: an unrecognised kind fails
// validation here, rather than defaulting the way enrich.CoerceTaskKind does
// for a Bedrock reply it cannot ask to correct.
func ValidateTasks(raw []byte) ([]types.ActionItem, error) {
	var data []struct {
		Text  string `json:"text"`
		Owner *int   `json:"owner"`
		Kind  string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("not a JSON array of objects: %w", err)
	}
	items := make([]types.ActionItem, 0, len(data))
	for _, entry := range data {
		text := strings.TrimSpace(entry.Text)
		if text == "" {
			return nil, fmt.Errorf("entry missing non-empty text")
		}
		kind := entry.Kind
		if kind == "" {
			kind = string(types.TaskKindOther)
		}
		if !validTaskKind(kind) {
			return nil, fmt.Errorf("kind %q is not one of %v", kind, types.TaskKinds)
		}
		items = append(items, types.ActionItem{
			Text: truncate(text, 400), Owner: entry.Owner, Kind: types.TaskKind(kind),
		})
	}
	return items, nil
}

func validTaskKind(k string) bool {
	for _, v := range types.TaskKinds {
		if string(v) == k {
			return true
		}
	}
	return false
}

// ValidateMemories checks memories.json strictly, the same way ValidateTasks does.
func ValidateMemories(raw []byte) ([]types.Fact, error) {
	var data []struct {
		Text string `json:"text"`
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("not a JSON array of objects: %w", err)
	}
	facts := make([]types.Fact, 0, len(data))
	for _, entry := range data {
		text := strings.TrimSpace(entry.Text)
		if text == "" {
			return nil, fmt.Errorf("entry missing non-empty text")
		}
		kind := entry.Kind
		if kind == "" {
			kind = string(types.FactKindFact)
		}
		if !validFactKind(kind) {
			return nil, fmt.Errorf("kind %q is not one of %v", kind, types.FactKinds)
		}
		facts = append(facts, types.Fact{Text: truncate(text, 200), Kind: types.FactKind(kind)})
	}
	return facts, nil
}

func validFactKind(k string) bool {
	for _, v := range types.FactKinds {
		if string(v) == k {
			return true
		}
	}
	return false
}

// ValidateSummary checks summary.json: a single object, not an array. Field
// names, types and caps are copied from enrich.go's own Coerce
// (internal/enrich/enrich.go:229-261) exactly, so ApplyFn writes into the
// same Recording fields the app already reads. title is the one field
// required non-empty — a blank title was exactly the regression this file
// exists to fix. category is checked only for type here, never for
// membership in any particular list: SummaryFile's own doc comment explains
// why that check belongs to enrich.ResolveCategory, not here.
func ValidateSummary(raw []byte) (SummaryFile, error) {
	var data struct {
		Title    string   `json:"title"`
		Tags     []string `json:"tags"`
		Summary  string   `json:"summary"`
		Category *string  `json:"category"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return SummaryFile{}, fmt.Errorf("not a JSON object: %w", err)
	}
	title := strings.TrimSpace(data.Title)
	if title == "" {
		return SummaryFile{}, fmt.Errorf("title must be a non-empty string")
	}
	tags := make([]string, 0, len(data.Tags))
	for _, tag := range data.Tags {
		if len(tags) >= 5 {
			break
		}
		if cleaned := truncate(strings.ToLower(strings.TrimSpace(tag)), 40); cleaned != "" {
			tags = append(tags, cleaned)
		}
	}
	category := ""
	if data.Category != nil {
		category = strings.TrimSpace(*data.Category)
	}
	return SummaryFile{
		Title:    truncate(title, 200),
		Tags:     tags,
		Summary:  truncate(strings.TrimSpace(data.Summary), 4000),
		Category: category,
	}, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
```

Note the shape difference from `json.Unmarshal(raw, &data)` above versus `ValidateCorrections`'s `[]map[string]any`: `summary.json` is a single object with known field names, so a typed struct decodes it directly — there is no per-entry loop, unlike the other three files, which are all arrays of extracted items.

- [ ] **Step 4: Run them, confirm they pass**

```bash
cd backend/go && go test ./internal/apply/ -v
```

Expected: `PASS`, 14 tests.

- [ ] **Step 5: `go vet`, `gofmt`, commit**

```bash
cd backend/go && go build ./... && go vet ./internal/apply/ && gofmt -l internal/apply
git add backend/go/internal/apply/validate.go backend/go/internal/apply/validate_test.go
git commit -m "apply: strict validation of the agent's four output files"
```

---

## Task 9: `ApplyFn` — the extracted path

`ApplyFn` is Go, zip, small, and is the only thing in this design that writes state. This task builds `internal/apply`'s remaining pure pieces — `TasksFromActionItems` (moved unchanged from `cmd/processor/main.go`, deleted there in Task 3) and `Patch` — then `cmd/apply/main.go` itself, wired to the success path only; Task 10 adds the fallback.

The extracted path now resolves `summary.json`'s title, tags, summary and category onto the recording row too — the spec's 2026-09-14 amendment closed the gap this plan's own Self-Review originally found (a successful extraction produced no title, only the fallback did). Resolving the agent's chosen category *name* to an id needs the caller's live category list — `internal/apply` does not read it (`SummaryFile.Category`'s own doc comment, Task 8), so this task fetches it here via the same `ddb.GetCategories` and `enrich.ResolveCategory` the fallback already uses.

**Files:**
- Create: `backend/go/internal/apply/tasks.go`
- Create: `backend/go/internal/apply/tasks_test.go`
- Create: `backend/go/internal/apply/apply.go`
- Create: `backend/go/internal/apply/apply_test.go`
- Create: `backend/go/internal/apply/patch.go`
- Create: `backend/go/internal/apply/patch_test.go`
- Create: `backend/go/cmd/apply/main.go`
- Modify: `backend/go/build.sh`

**Interfaces:**
- Consumes: `apply.ValidateAll`, `apply.Outcome`, `apply.SummaryFile` (Task 8); `enrich.ApplyCorrections`, `enrich.ResolveCategory` (existing); `ddb.PutTasks`, `ddb.GetRecordingByID`, `ddb.UpdateRecording`, `ddb.GetCategories`, `ddb.Init` (existing); `gitloomx.RememberFacts` (existing); `push.RecordingReady` (existing); `types.ExtractionRequest` (Task 3, carries `Categories []string` for the fallback's own use — the extracted path re-fetches the live list instead, so a stale name from a queued message is never what gets resolved).
- Produces: `apply.TasksFromActionItems(userID, recordingID, startedAt string, items []types.ActionItem, t *types.Transcript) []ddb.Task`; `apply.ExtractionPrefix(userID, recordingID string) string`; `apply.Result{Tasks []types.ActionItem; Memories []types.Fact; Title, Summary, CategoryID string; Tags []string}`; `apply.Patch(r Result) map[string]any` — `Result` is populated by both paths now: the extracted path resolves it from `outcome.Summary` in this task, the fallback (Task 10) from `enrich.Enrich`'s `Enrichment`.

- [ ] **Step 1: Write the failing tests for the two moved/new pure pieces**

Create `backend/go/internal/apply/tasks_test.go`:

```go
package apply

import (
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestTaskIdsAreDeterministicFromRecordingAndPosition(t *testing.T) {
	items := []types.ActionItem{{Text: "call the vet"}, {Text: "pay the rent"}}
	transcript := &types.Transcript{Utterances: []types.Utterance{{Text: "I'll call the vet tomorrow"}}}

	tasks := TasksFromActionItems("user_1", "rec_1", "2026-09-14T09:00:00Z", items, transcript)

	if len(tasks) != 2 {
		t.Fatalf("got %d tasks, want 2", len(tasks))
	}
	if tasks[0].TaskID != "rec_1-0" || tasks[1].TaskID != "rec_1-1" {
		t.Fatalf("ids = %q, %q", tasks[0].TaskID, tasks[1].TaskID)
	}
	again := TasksFromActionItems("user_1", "rec_1", "2026-09-14T09:00:00Z", items, transcript)
	if again[0].TaskID != tasks[0].TaskID {
		t.Fatal("the same call twice must mint the same ids — redelivery must rewrite, not duplicate")
	}
}

func TestNoActionItemsIsNoTasks(t *testing.T) {
	if got := TasksFromActionItems("u", "r", "t", nil, &types.Transcript{}); got != nil {
		t.Fatalf("got %v, want nil", got)
	}
}
```

Create `backend/go/internal/apply/apply_test.go`:

```go
package apply

import "testing"

func TestExtractionPrefixMatchesThePythonSideScheme(t *testing.T) {
	if got := ExtractionPrefix("user_1", "rec_1"); got != "extract/user_1/rec_1/" {
		t.Fatalf("got %q", got)
	}
}
```

Create `backend/go/internal/apply/patch_test.go`:

```go
package apply

import (
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestPatchOmitsFieldsTheSourceLeftEmpty(t *testing.T) {
	// Patch is agnostic about which path called it — it only ever includes
	// a field when Result actually carries one, so UpdateRecording leaves
	// whatever was already on the row untouched rather than clobbering it
	// with a zero value.
	patch := Patch(Result{Tasks: nil, Memories: nil})
	if _, ok := patch["title"]; ok {
		t.Fatal("an empty Result must not put title in the patch")
	}
	if patch["status"] != types.StatusReady {
		t.Fatalf("status = %v, want ready", patch["status"])
	}
}

func TestPatchCarriesWhicheverPathProducedTitleAndCategory(t *testing.T) {
	patch := Patch(Result{Title: "Standup with Ravi", CategoryID: "work"})
	if patch["title"] != "Standup with Ravi" || patch["categoryId"] != "work" {
		t.Fatalf("patch = %+v", patch)
	}
}
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
cd backend/go && go test ./internal/apply/ -v
```

Expected: `FAIL — undefined: TasksFromActionItems, ExtractionPrefix, Patch, Result`.

- [ ] **Step 3: Write `tasks.go`, `apply.go`, `patch.go`**

`backend/go/internal/apply/tasks.go`:

```go
package apply

import (
	"fmt"
	"time"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/enrich"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// TasksFromActionItems turns a conversation's action items into task rows.
// Moved here from cmd/processor/main.go unchanged: ApplyFn is now the only
// caller, on both the extracted path and the Bedrock fallback, so this
// belongs beside the rest of what a recording's finish line writes.
//
// The ids are deterministic — the recording id and the item's position —
// and so is createdAt, the recording's own startedAt. Both on purpose: SQS
// delivers at least once, and a redelivered applyQueue message must rewrite
// the same rows rather than leave the user with every promise listed twice.
func TasksFromActionItems(userID, recordingID, startedAt string, items []types.ActionItem, t *types.Transcript) []ddb.Task {
	if len(items) == 0 {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339)
	tasks := make([]ddb.Task, 0, len(items))
	for i, item := range items {
		kind := item.Kind
		if kind == "" {
			kind = types.TaskKindOther
		}
		task := ddb.Task{
			TaskID:      fmt.Sprintf("%s-%d", recordingID, i),
			UserID:      userID,
			RecordingID: recordingID,
			Text:        item.Text,
			Owner:       item.Owner,
			Kind:        kind,
			Status:      ddb.TaskProposed,
			Quote:       item.Text,
			CreatedAt:   startedAt,
			UpdatedAt:   now,
		}
		if idx := enrich.BestUtterance(item.Text, t.Utterances); idx >= 0 {
			at := idx
			task.UtteranceIndex = &at
			task.Quote = t.Utterances[idx].Text
		}
		tasks = append(tasks, task)
	}
	return tasks
}
```

`backend/go/internal/apply/apply.go`:

```go
package apply

// ExtractionPrefix is where ExtractFn puts corrections.json, tasks.json,
// memories.json and summary.json for one recording, and where ApplyFn looks
// for them. Computed independently on both sides — ExtractFn in Python
// (backend/extract/handler.py's extraction_prefix), ApplyFn here — rather
// than carried on the SQS message, so extractQueue's DLQ (which carries the
// *original* ProcessorFn message, with nothing ExtractFn would have added)
// and applyQueue (ExtractFn's forwarded copy of that same message) need
// exactly one message shape between them.
func ExtractionPrefix(userID, recordingID string) string {
	return "extract/" + userID + "/" + recordingID + "/"
}
```

`backend/go/internal/apply/patch.go`:

```go
package apply

import "github.com/MelloB1989/mr20-pendant/backend/internal/types"

// Result is what either path — the agent's validated files, or the Bedrock
// fallback — produces, in the one shape the write step needs regardless of
// where it came from. Both paths populate every field now: the extracted
// path resolves Title/Tags/Summary/CategoryID from summary.json (via
// ResolveCategory for the id), the fallback from enrich.Enrich's own
// Enrichment — see cmd/apply/main.go's processMessage and runFallback
// (Task 10).
type Result struct {
	Tasks      []types.ActionItem
	Memories   []types.Fact
	Title      string
	Tags       []string
	Summary    string
	CategoryID string
}

// Patch builds the DynamoDB update for a recording that just finished
// applying. Fields the source left empty are left out of the map entirely,
// so UpdateRecording leaves whatever was already on the row untouched
// rather than clobbering it with a zero value — enrich.go's own fallback()
// can still leave Summary empty when it has nothing honest to say, and a
// null category is a legitimate answer on either path, so Patch stays
// agnostic about why a field is empty, only about whether it is.
func Patch(r Result) map[string]any {
	patch := map[string]any{
		"status":      types.StatusReady,
		"actionItems": r.Tasks,
		"facts":       r.Memories,
		"error":       "",
	}
	if r.Title != "" {
		patch["title"] = r.Title
	}
	if len(r.Tags) > 0 {
		patch["tags"] = r.Tags
	}
	if r.Summary != "" {
		patch["summary"] = r.Summary
	}
	if r.CategoryID != "" {
		patch["categoryId"] = r.CategoryID
	}
	return patch
}
```

- [ ] **Step 4: Delete `tasksFromEnrichment` from `cmd/processor/main.go` if Task 3 left it**

Task 3 already deleted it; if it is still present (plan executed out of order), delete it now — `internal/apply.TasksFromActionItems` above is its only remaining copy.

- [ ] **Step 5: Run the package tests, confirm they pass**

```bash
cd backend/go && go test ./internal/apply/ -v
```

Expected: `PASS`, 19 tests.

- [ ] **Step 6: Write `cmd/apply/main.go` — success path only**

```go
// ApplyFn: the only Lambda in this pipeline that writes state.
//
// Consumes two queues carrying the identical message shape
// (types.ExtractionRequest): applyQueue, ExtractFn's own success signal, and
// extractQueue's dead-letter queue, reached only once ExtractFn has
// exhausted every retry (Task 10 wires the second queue and its fallback
// branch). Both trigger the same handler, because which path to take is
// decided from what is actually sitting in S3, not from which queue
// delivered the message.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/MelloB1989/mr20-pendant/backend/internal/apply"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/enrich"
	"github.com/MelloB1989/mr20-pendant/backend/internal/gitloomx"
	"github.com/MelloB1989/mr20-pendant/backend/internal/push"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

var s3Client *s3.Client

func initAWS(ctx context.Context) error {
	if s3Client != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	s3Client = s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	})
	return ddb.Init(ctx)
}

func bucket() string { return os.Getenv("AUDIO_BUCKET") }

// fetchOptional returns (nil, nil) when the key does not exist — "the agent
// never got this far" is not an error worth retrying, it is the signal to
// fall back (Task 10). Any other failure is returned so the caller can let
// SQS retry.
func fetchOptional(ctx context.Context, key string) ([]byte, error) {
	out, err := s3Client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket()), Key: aws.String(key)})
	if err != nil {
		var nsk *s3types.NoSuchKey
		if errors.As(err, &nsk) {
			return nil, nil
		}
		return nil, err
	}
	defer out.Body.Close()
	return io.ReadAll(out.Body)
}

func processMessage(ctx context.Context, req types.ExtractionRequest) error {
	rec, err := ddb.GetRecordingByID(ctx, req.RecordingID)
	if err != nil {
		return err
	}
	if rec == nil {
		log.Printf("no recording row recordingId=%s", req.RecordingID)
		return nil
	}
	// Idempotency: a redelivered applyQueue or extractDlq message after
	// this recording already reached ready must not re-apply or re-remember.
	if rec.Status == types.StatusReady || rec.Status == types.StatusArchived {
		log.Printf("already applied, skipping redelivery recordingId=%s status=%s", req.RecordingID, rec.Status)
		return nil
	}

	transcriptRaw, err := fetchOptional(ctx, req.TranscriptKey)
	if err != nil {
		return err
	}
	if transcriptRaw == nil {
		return fmt.Errorf("transcript missing at %s", req.TranscriptKey)
	}
	var transcript types.Transcript
	if err := json.Unmarshal(transcriptRaw, &transcript); err != nil {
		return fmt.Errorf("transcript unreadable: %w", err)
	}

	prefix := apply.ExtractionPrefix(req.UserID, req.RecordingID)
	correctionsRaw, err := fetchOptional(ctx, prefix+"corrections.json")
	if err != nil {
		return err
	}
	tasksRaw, err := fetchOptional(ctx, prefix+"tasks.json")
	if err != nil {
		return err
	}
	memoriesRaw, err := fetchOptional(ctx, prefix+"memories.json")
	if err != nil {
		return err
	}
	summaryRaw, err := fetchOptional(ctx, prefix+"summary.json")
	if err != nil {
		return err
	}

	outcome, valErr := apply.ValidateAll(correctionsRaw, tasksRaw, memoriesRaw, summaryRaw, len(transcript.Utterances))
	if valErr != nil {
		// Task 10 replaces this with the Bedrock fallback.
		return fmt.Errorf("extraction output invalid, no fallback wired yet: %w", valErr)
	}

	applied := enrich.ApplyCorrections(&transcript, outcome.Corrections)
	log.Printf("applied extraction recordingId=%s corrections=%d tasks=%d memories=%d",
		req.RecordingID, applied, len(outcome.Tasks), len(outcome.Memories))

	// The agent chose a category *name* (or none) without ever touching
	// DynamoDB (SummaryFile.Category's own doc comment, internal/apply).
	// Resolving it to an id needs the live list, fetched here rather than
	// trusted from req.Categories — the extraction request may have sat in
	// a queue for a while, and the user's own edit is the one that should
	// win, not a name captured earlier by ProcessorFn.
	categories, err := ddb.GetCategories(ctx, req.UserID)
	if err != nil {
		log.Printf("categories read failed, leaving category unset recordingId=%s err=%v", req.RecordingID, err)
		categories = nil
	}
	result := apply.Result{
		Tasks: outcome.Tasks, Memories: outcome.Memories,
		Title: outcome.Summary.Title, Tags: outcome.Summary.Tags, Summary: outcome.Summary.Summary,
		CategoryID: enrich.ResolveCategory(outcome.Summary.Category, categories),
	}

	return finishApply(ctx, req, &transcript, result)
}

// finishApply is the tail both paths share: re-PUT the transcript if it
// changed, mint tasks, ship memories, flip ready, push. Task 10 calls this
// from the fallback branch too.
func finishApply(ctx context.Context, req types.ExtractionRequest, transcript *types.Transcript, result apply.Result) error {
	if transcript.MergedCorrections > 0 {
		body, err := json.Marshal(transcript)
		if err != nil {
			return err
		}
		if _, err := s3Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket: aws.String(bucket()), Key: aws.String(req.TranscriptKey),
			Body: strings.NewReader(string(body)), ContentType: aws.String("application/json"),
		}); err != nil {
			return err
		}
	}

	tasks := apply.TasksFromActionItems(req.UserID, req.RecordingID, req.StartedAt, result.Tasks, transcript)
	if len(tasks) > 0 {
		if err := ddb.PutTasks(ctx, tasks); err != nil {
			log.Printf("task rows failed recordingId=%s count=%d err=%v", req.RecordingID, len(tasks), err)
			tasks = nil
		}
	}

	if len(result.Memories) > 0 {
		if err := gitloomx.RememberFacts(ctx, req.UserID, req.RecordingID, req.StartedAt, result.Memories); err != nil {
			log.Printf("gitloom facts ingest failed recordingId=%s err=%v", req.RecordingID, err)
		}
	}

	patch := apply.Patch(result)
	if err := ddb.UpdateRecording(ctx, req.UserID, req.StartedAt, req.RecordingID, patch); err != nil {
		return err
	}

	log.Printf("ready recordingId=%s tasks=%d memories=%d", req.RecordingID, len(tasks), len(result.Memories))
	notifyReady(ctx, req.UserID, req.RecordingID, result.Title, tasks)
	return nil
}

func pushTokens(ctx context.Context, userID string) []string {
	rows, err := ddb.ListPushTokens(ctx, userID)
	if err != nil {
		log.Printf("push: could not read tokens userId=%s err=%v", userID, err)
		return nil
	}
	tokens := make([]string, 0, len(rows))
	for _, row := range rows {
		tokens = append(tokens, row.Token)
	}
	return tokens
}

func deliver(ctx context.Context, userID string, messages []push.Message) {
	if len(messages) == 0 {
		return
	}
	dead, err := push.Send(ctx, messages)
	if err != nil {
		log.Printf("push: send failed userId=%s err=%v", userID, err)
	}
	for _, token := range dead {
		if err := ddb.DeletePushToken(ctx, userID, token); err != nil {
			log.Printf("push: could not forget stale token err=%v", err)
		}
	}
}

func notifyReady(ctx context.Context, userID, recordingID, title string, tasks []ddb.Task) {
	tokens := pushTokens(ctx, userID)
	if len(tokens) == 0 {
		return
	}
	messages := push.RecordingReady(tokens, recordingID, title)
	if len(tasks) > 0 {
		messages = append(messages, push.TasksProposed(tokens, len(tasks), recordingID, tasks[0].Text)...)
	}
	deliver(ctx, userID, messages)
}

func handle(ctx context.Context, event events.SQSEvent) (events.SQSEventResponse, error) {
	if err := initAWS(ctx); err != nil {
		return events.SQSEventResponse{}, err
	}
	var failures []events.SQSBatchItemFailure
	for _, record := range event.Records {
		var req types.ExtractionRequest
		if err := json.Unmarshal([]byte(record.Body), &req); err != nil {
			log.Printf("unparseable message id=%s err=%v", record.MessageId, err)
			continue
		}
		if err := processMessage(ctx, req); err != nil {
			log.Printf("apply failed recordingId=%s err=%v", req.RecordingID, err)
			failures = append(failures, events.SQSBatchItemFailure{ItemIdentifier: record.MessageId})
		}
	}
	return events.SQSEventResponse{BatchItemFailures: failures}, nil
}

func main() { lambda.Start(handle) }
```

- [ ] **Step 7: Add `apply` to `build.sh`**

In `backend/go/build.sh`, change:

```bash
for name in processor dlqreaper; do
```

to:

```bash
for name in processor dlqreaper apply; do
```

- [ ] **Step 8: Build everything, run the whole Go suite**

```bash
cd backend/go && ./build.sh && go build ./... && go test ./... && go vet ./... && gofmt -l cmd/apply internal/apply
```

Expected: `dist/apply/bootstrap` exists; all tests pass; clean build.

- [ ] **Step 9: Commit**

```bash
git add backend/go/internal/apply/tasks.go backend/go/internal/apply/tasks_test.go backend/go/internal/apply/apply.go backend/go/internal/apply/apply_test.go backend/go/internal/apply/patch.go backend/go/internal/apply/patch_test.go backend/go/cmd/apply/main.go backend/go/build.sh
git commit -m "apply: the extracted path — transcript, tasks, title and memories, flip ready"
```

---

## Task 10: `ApplyFn` — the Bedrock fallback

If `ExtractFn` exhausts its retries, `ApplyFn` runs the existing `merge.go`/`enrich.go` path directly, so a recording still becomes useful even when the agent never produces valid output. This is zero new code in the fallback itself — `runFallback` below only calls what already exists — and it is exercised by the exact same `finishApply` tail Task 9 wrote, so both paths converge before they ever touch DynamoDB.

**Files:**
- Modify: `backend/go/cmd/apply/main.go`
- Create: `backend/go/cmd/apply/main_test.go` (the one thing in this package that is testable without AWS — see Step 1)

**Interfaces:**
- Consumes: `enrich.MergeTranscripts`, `enrich.Enrich`, `enrich.ResolveCategory`, `ddb.GetCategories` (all existing); `apply.Result`, `apply.Outcome`, `finishApply` (Task 9).
- Produces: `runFallback(ctx, req types.ExtractionRequest, transcript *types.Transcript) apply.Result` (no error — the existing `enrich.Enrich`/`enrich.MergeTranscripts` never return one; both are themselves best-effort and fall back internally, per their own doc comments).

`cmd/apply`'s orchestration (like `cmd/processor`'s) is not unit-tested at the AWS-calling layer — there is no dependency-injection seam for `s3Client`/`ddb` in this package, matching the existing convention (`cmd/processor` has none either). What *is* testable without AWS is the routing decision: given a validation error, does `processMessage` reach the fallback branch rather than returning the error outright. Step 1 below extracts that one decision into a pure function so it can be asserted directly.

- [ ] **Step 1: Write the failing test for the routing decision**

Create `backend/go/cmd/apply/main_test.go`:

```go
package main

import (
	"errors"
	"testing"
)

func TestANilValidationErrorUsesTheExtractedPath(t *testing.T) {
	if usesFallback(nil) {
		t.Fatal("a validation error of nil means the files were good — no fallback")
	}
}

func TestAnyValidationErrorUsesTheFallback(t *testing.T) {
	if !usesFallback(errors.New("tasks.json is missing")) {
		t.Fatal("any validation failure — missing, malformed, partially written — must route to the fallback")
	}
}
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
cd backend/go && go test ./cmd/apply/ -run UsesFallback -v
```

Expected: `FAIL — undefined: usesFallback`.

- [ ] **Step 3: Add `usesFallback` and `runFallback`, and wire the branch**

In `backend/go/cmd/apply/main.go`, add:

```go
// usesFallback is the one branch point between the two paths: any
// validation failure at all — missing, malformed, or partially written —
// means the fallback runs. There is no partial credit for two good files
// and one bad one.
func usesFallback(valErr error) bool { return valErr != nil }

// runFallback re-runs the old Bedrock path directly against the stored
// transcript: the two-engine merge, then the Haiku enrichment call. Both are
// already best-effort — MergeTranscripts logs and returns 0 corrections on
// any failure, Enrich falls back to a title-only Enrichment — so this
// function itself has nothing left to fail on.
func runFallback(ctx context.Context, req types.ExtractionRequest, transcript *types.Transcript) apply.Result {
	if transcript.AltText != "" {
		corrections := enrich.MergeTranscripts(transcript, transcript.AltText)
		log.Printf("fallback merge recordingId=%s corrections=%d", req.RecordingID, corrections)
	}
	categories, err := ddb.GetCategories(ctx, req.UserID)
	if err != nil {
		log.Printf("categories read failed, enriching without: %v", err)
		categories = nil
	}
	enrichment := enrich.Enrich(transcript, categories)
	return apply.Result{
		Tasks: enrichment.ActionItems, Memories: enrichment.Facts,
		Title: enrichment.Title, Tags: enrichment.Tags, Summary: enrichment.Summary,
		CategoryID: enrichment.CategoryID,
	}
}
```

Replace `processMessage`'s placeholder branch:

```go
	outcome, valErr := apply.ValidateAll(correctionsRaw, tasksRaw, memoriesRaw, summaryRaw, len(transcript.Utterances))

	var result apply.Result
	if usesFallback(valErr) {
		log.Printf("extraction output invalid, falling back recordingId=%s reason=%v", req.RecordingID, valErr)
		result = runFallback(ctx, req, &transcript)
	} else {
		applied := enrich.ApplyCorrections(&transcript, outcome.Corrections)
		log.Printf("applied extraction recordingId=%s corrections=%d tasks=%d memories=%d",
			req.RecordingID, applied, len(outcome.Tasks), len(outcome.Memories))
		categories, err := ddb.GetCategories(ctx, req.UserID)
		if err != nil {
			log.Printf("categories read failed, leaving category unset recordingId=%s err=%v", req.RecordingID, err)
			categories = nil
		}
		result = apply.Result{
			Tasks: outcome.Tasks, Memories: outcome.Memories,
			Title: outcome.Summary.Title, Tags: outcome.Summary.Tags, Summary: outcome.Summary.Summary,
			CategoryID: enrich.ResolveCategory(outcome.Summary.Category, categories),
		}
	}

	return finishApply(ctx, req, &transcript, result)
```

(This is the same categories-and-`ResolveCategory` step Task 9 already wrote into the success-only branch; it now lives on both sides of the `if`, since Task 9's version of this function did not yet know about the fallback branch it was about to be spliced next to.)

- [ ] **Step 4: Run it, confirm it passes; build the whole module**

```bash
cd backend/go && go test ./cmd/apply/ -v && go build ./... && go vet ./... && gofmt -l cmd/apply
```

Expected: `PASS`, 2 tests; clean build.

- [ ] **Step 5: The fallback-fires test, end to end at the validation boundary**

This is the test the spec's Testing section asks for by name ("the fallback actually fires"). It cannot reach real S3 or Bedrock without an AWS account, so it is written at the boundary this plan's own seams make testable — that `apply.ValidateAll` failing (for *any* of the four files, `summary.json` included) is exactly the condition `usesFallback` (Step 1) and `runFallback` (Step 3) exist to handle. Since the spec's 2026-09-14 amendment, both paths are supposed to leave a recording with a title; this test documents that a `summary.json`-shaped failure specifically still routes to the path that guarantees one. Add:

```go
func TestASummaryValidationFailureStillRoutesToTheFallback(t *testing.T) {
	// A bad summary.json is what this test exists to catch: before the
	// spec's 2026-09-14 amendment, no file carried a title at all, so there
	// was nothing here to get wrong. Now that summary.json is one of the
	// four files ValidateAll checks, a failure on it must route here
	// exactly like a failure on any of the other three — usesFallback does
	// not distinguish which file was bad, only that ValidateAll returned an
	// error at all.
	valErr := errors.New("summary.json: title must be a non-empty string")
	if !usesFallback(valErr) {
		t.Fatal("a summary.json validation failure must route to the fallback")
	}
	// runFallback itself calls Bedrock and cannot run in this suite without
	// an AWS account. Its shape — that it always sets Title (enrich.Enrich's
	// own fallback() guarantees one even when Bedrock is unreachable) — is
	// asserted directly against enrich.Enrich's own contract
	// (internal/enrich/enrich_test.go's Coerce and fallback() tests) and
	// against apply.Patch's tests (Task 9), where "a populated Result
	// reaches the row" is actually pinned down.
}
```

- [ ] **Step 6: Full suite, commit**

```bash
cd backend/go && go build ./... && go test ./... && go vet ./... && gofmt -l cmd/apply internal/apply
git add backend/go/cmd/apply/main.go backend/go/cmd/apply/main_test.go
git commit -m "apply: the Bedrock fallback, so a recording always reaches ready"
```

---

## Task 11: CDK — `ExtractFn` and `ApplyFn`, wired in

`ExtractFn` is the first container-image Lambda in this backend: `lambda.DockerImageFunction` with `DockerImageCode.fromImageAsset`, platform pinned to arm64 so the image CDK builds matches the function's own `architecture` — the exact failure mode the spec names ("`docker buildx build --platform` and `--architectures` must stay in sync or the function fails with only 'failed to start Claude Code'") is what pinning both to `Platform.LINUX_ARM64` / `Architecture.ARM_64` prevents. `ApplyFn` is a Go zip Lambda, built the same way `ProcessorFn` and `DlqReaperFn` already are.

**Files:**
- Modify: `backend/lib/mr20-stack.ts`

**Interfaces:**
- Consumes: `createDataPlane`'s four new queues (Task 2); `dist/apply/bootstrap` (Task 9's `build.sh`); `backend/extract/` (Tasks 4–7).
- Produces: nothing new callable — this task is infrastructure only, verified by `cdk synth`, not `go test`/`pytest`.

- [ ] **Step 1: Destructure the new queues**

In `backend/lib/mr20-stack.ts`, the `createDataPlane` call (line 100) becomes:

```ts
const { table, audioBucket, ingestQueue, dlq, extractQueue, extractDlq, applyQueue, applyDlq } =
  createDataPlane(this, { ephemeral: false });
```

- [ ] **Step 2: Add the Claude OAuth secret**

After the `sarvamSecret` block (line 124), before `gitloomSecret`:

```ts
    const claudeOAuthSecret = new secretsmanager.Secret(this, 'ClaudeCodeOAuthToken', {
      description: 'Claude subscription OAuth token ExtractFn runs Claude Code with (claude setup-token)',
      generateSecretString: {
        // Placeholder only. Overwrite after deploy:
        //   aws secretsmanager put-secret-value --secret-id <arn> --secret-string '{"token":"<real token>"}'
        secretStringTemplate: JSON.stringify({ token: 'REPLACE_ME' }),
        generateStringKey: 'unused',
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });
```

- [ ] **Step 3: Import the ECR assets module**

At the top of the file, beside the other `aws-cdk-lib` imports:

```ts
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
```

- [ ] **Step 4: Give `ProcessorFn` the extract queue**

In the `processor` construct's `env` (line 291), add:

```ts
        EXTRACT_QUEUE_URL: extractQueue.queueUrl,
```

and after `processor.addEventSource(...)` (line 331), add:

```ts
    extractQueue.grantSendMessages(processor);
```

- [ ] **Step 5: Add `ExtractFn`**

After the `processor.addEventSource(...)` block:

```ts
    // -- extraction --------------------------------------------------------
    //
    // The first container-image Lambda in this backend: claude-agent-sdk's
    // bundled CLI is a ~207 MB platform-specific ELF, which rules out zip
    // packaging outright. Platform.LINUX_ARM64 here and Architecture.ARM_64
    // below must never drift apart — a mismatch fails at runtime with
    // nothing more specific than "failed to start Claude Code".
    const EXTRACT_CONCURRENCY = 4;

    const extractFn = new lambda.DockerImageFunction(this, 'ExtractFn', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..', 'extract'), {
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 3008,
      timeout: Duration.seconds(900),
      ephemeralStorageSize: Size.mebibytes(4096),
      reservedConcurrentExecutions: EXTRACT_CONCURRENCY,
      environment: {
        AUDIO_BUCKET: audioBucket.bucketName,
        APPLY_QUEUE_URL: applyQueue.queueUrl,
        CLAUDE_OAUTH_SECRET_ARN: claudeOAuthSecret.secretArn,
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
      },
      logGroup: new logs.LogGroup(this, 'ExtractFnLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      description: 'Runs Claude Code over a transcript: corrections, tasks, memories and a summary, as four files',
    });
    audioBucket.grantReadWrite(extractFn);
    applyQueue.grantSendMessages(extractFn);
    claudeOAuthSecret.grantRead(extractFn);
    gitloomSecret.grantRead(extractFn);
    extractFn.addEventSource(
      new lambdaEventSources.SqsEventSource(extractQueue, { batchSize: 1, reportBatchItemFailures: true }),
    );
```

- [ ] **Step 6: Add `ApplyFn`**

Immediately after:

```ts
    const applyFn = goFn('ApplyFn', 'apply', {
      env: {
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
        BEDROCK_MODEL_ID: props.bedrockModelId,
      },
      timeout: Duration.minutes(3),
      memory: 512,
      description: 'The only thing that writes state: applies extraction output, or the Bedrock fallback',
    });
    table.grantReadWriteData(applyFn);
    audioBucket.grantReadWrite(applyFn);
    gitloomSecret.grantRead(applyFn);
    applyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    applyFn.addEventSource(
      new lambdaEventSources.SqsEventSource(applyQueue, { batchSize: 1, reportBatchItemFailures: true }),
    );
    // extractQueue's own DLQ, reached once ExtractFn has exhausted every
    // retry — ApplyFn treats a message from here identically to one from
    // applyQueue (internal/apply.ExtractionPrefix's comment explains why
    // both carry the same shape).
    applyFn.addEventSource(
      new lambdaEventSources.SqsEventSource(extractDlq, { batchSize: 1, reportBatchItemFailures: true }),
    );
```

- [ ] **Step 7: Output the Claude secret's ARN**

Task 13 wires a preview stack to the same secret, read-only, the same way it already reads `DeepgramSecretArn`/`SarvamSecretArn` from this stack's own outputs rather than a fixed name (`claudeOAuthSecret`'s physical secret name is CloudFormation-generated, like Deepgram's and Sarvam's — not a fixed name like `mr20/gitloom`). Beside the existing `DeepgramSecretArn`/`SarvamSecretArn` outputs:

```ts
    new CfnOutput(this, 'ClaudeOAuthSecretArn', { value: claudeOAuthSecret.secretArn });
```

- [ ] **Step 8: Confirm the stack synthesizes**

This is the closest thing to a test CDK changes get in this repo (no `cdk-nag`/jest suite exists for `backend/lib`); it also builds the container image locally, which needs Docker running.

```bash
cd backend && ./go/build.sh && npx cdk synth Mr20Stack >/dev/null
```

Expected: synthesizes with no error. The first run pulls `public.ecr.aws/lambda/python:3.13` and installs `claude-agent-sdk` inside the image — expect this to take a few minutes; a warm Docker cache makes later runs fast.

- [ ] **Step 9: Commit**

```bash
git add backend/lib/mr20-stack.ts
git commit -m "cdk: ExtractFn (container image) and ApplyFn, wired to their queues"
```

---

## Task 12: `DlqReaperFn` learns a second shape

`ingestDlq`'s messages are S3-event-shaped; `applyDlq`'s are a flat `types.ExtractionRequest`. `DlqReaperFn` already drains one DLQ and marks a recording failed — this task teaches it to recognise which queue a message came from (by `EventSourceARN`, passed in as an explicit environment variable rather than matched against CDK's auto-generated queue name) and parse accordingly, so `ApplyFn`'s own exhausted retries end the same way `ProcessorFn`'s already do: a `failed` recording with a reason, not a silently stuck one.

**Files:**
- Modify: `backend/go/cmd/dlqreaper/main.go`
- Modify: `backend/lib/mr20-stack.ts` (the `reaper` construct)

**Interfaces:**
- Consumes: `types.ExtractionRequest` (Task 3); `ddb.GetRecordingByID`, `ddb.UpdateRecording` (existing).
- Produces: nothing new callable outside this package.

This package has no existing test file and no dependency-injection seam for `ddb` (matching `cmd/processor`'s own convention) — this task follows that precedent rather than introducing one for a single Lambda's DLQ routing, which is otherwise a two-line `if`.

- [ ] **Step 1: Rewrite `cmd/dlqreaper/main.go`**

```go
// Drains the dead-letter queues so a recording that exhausted its retries —
// in ProcessorFn or in ApplyFn — shows as failed in the app instead of
// sitting stuck forever.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

var keyShape = regexp.MustCompile(`^audio/[^/]+/([^/]+)\.mp3$`)

// fail marks one recording failed, sharing the message both DLQs end in.
func fail(ctx context.Context, recordingID, reason string) {
	rec, err := ddb.GetRecordingByID(ctx, recordingID)
	if err != nil || rec == nil || rec.Status == types.StatusReady {
		return
	}
	if err := ddb.UpdateRecording(ctx, rec.UserID, rec.StartedAt, rec.RecordingID, map[string]any{
		"status": types.StatusFailed, "error": reason,
	}); err != nil {
		log.Printf("could not mark failed recordingId=%s err=%v", rec.RecordingID, err)
		return
	}
	log.Printf("marked failed from DLQ recordingId=%s", rec.RecordingID)
}

func handleIngestDlq(ctx context.Context, body string) {
	var payload struct {
		Records []struct {
			S3 struct {
				Object struct {
					Key string `json:"key"`
				} `json:"object"`
			} `json:"s3"`
		} `json:"Records"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		log.Printf("could not reap ingest DLQ message err=%v", err)
		return
	}
	for _, s3Record := range payload.Records {
		decoded, err := url.QueryUnescape(strings.ReplaceAll(s3Record.S3.Object.Key, "+", " "))
		if err != nil {
			continue
		}
		m := keyShape.FindStringSubmatch(decoded)
		if m == nil {
			continue
		}
		fail(ctx, m[1], "transcription failed repeatedly; the audio is safe and can be retried")
	}
}

func handleApplyDlq(ctx context.Context, body string) {
	var req types.ExtractionRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil || req.RecordingID == "" {
		log.Printf("could not reap apply DLQ message err=%v", err)
		return
	}
	fail(ctx, req.RecordingID, "extraction and its fallback both failed repeatedly; the transcript is safe and can be retried")
}

func handle(ctx context.Context, event events.SQSEvent) error {
	if err := ddb.Init(ctx); err != nil {
		return err
	}
	applyDlqARN := os.Getenv("APPLY_DLQ_ARN")
	for _, record := range event.Records {
		if applyDlqARN != "" && record.EventSourceARN == applyDlqARN {
			handleApplyDlq(ctx, record.Body)
			continue
		}
		handleIngestDlq(ctx, record.Body)
	}
	return nil
}

func main() { lambda.Start(handle) }
```

- [ ] **Step 2: Wire `applyDlq` in CDK**

In `backend/lib/mr20-stack.ts`, the `reaper` construct (line 333) becomes:

```ts
    const reaper = goFn('DlqReaperFn', 'dlqreaper', {
      env: { APPLY_DLQ_ARN: applyDlq.queueArn },
      timeout: Duration.minutes(2),
      description: 'Marks recordings failed once their retries are exhausted, in either pipeline',
    });
    table.grantReadWriteData(reaper);
    reaper.addEventSource(new lambdaEventSources.SqsEventSource(dlq, { batchSize: 5 }));
    reaper.addEventSource(new lambdaEventSources.SqsEventSource(applyDlq, { batchSize: 5 }));
```

- [ ] **Step 3: Build and vet**

```bash
cd backend/go && go build ./... && go vet ./cmd/dlqreaper/ && gofmt -l cmd/dlqreaper
cd backend && npx tsc -p . --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/go/cmd/dlqreaper/main.go backend/lib/mr20-stack.ts
git commit -m "dlqreaper: applyDlq ends the same way ingestDlq already does"
```

---

## Task 13: CDK — mirror the wiring into the preview stack

`preview-stack.ts` shares `createDataPlane` with production, so once Task 3 ships, every preview's `ProcessorFn` marks recordings `transcribed` and sends to `EXTRACT_QUEUE_URL` — a queue that does not exist in preview until this task, and an env var that resolves to `undefined`. Without this task, a preview's recordings stall at `transcribed` forever: not a crash, but a broken PR preview environment, which is a real cost to whoever opens the next pull request. This task raises `ExtractFn` and `ApplyFn` in `preview-stack.ts` the same way Task 11 raised them in production, and deliberately keeps two things preview already does differently: no reserved concurrency (preview's own `goFn` has never set one, for any Lambda), and no DLQ reaper (preview raises `ingestQueue`'s own DLQ today and nothing consumes it — a preview's dead letters are cleaned up by the whole ephemeral stack being torn down when its pull request closes, not by a Lambda watching for them).

**Files:**
- Modify: `backend/lib/preview-stack.ts`
- Modify: `backend/bin/app.ts`
- Modify: `.github/workflows/preview.yml`

**Interfaces:**
- Consumes: `createDataPlane`'s four new queues (Task 2, already shared); `ClaudeOAuthSecretArn` (Task 11's new output); `dist/apply/bootstrap` (Task 9); `backend/extract/` (Tasks 4–7).
- Produces: nothing new callable — infrastructure only, verified by `cdk synth`.

- [ ] **Step 1: Destructure the new queues in `preview-stack.ts`**

```ts
const { table, audioBucket, ingestQueue, extractQueue, extractDlq, applyQueue } =
  createDataPlane(this, { ephemeral: true });
```

(`dlq` and `applyDlq` stay undestructured, exactly as `dlq` already is today — nothing in this stack consumes either.)

- [ ] **Step 2: Add `claudeOAuthSecretArn` to `PreviewStackProps`**

Beside `sarvamSecretArn`:

```ts
  readonly claudeOAuthSecretArn: string;
```

and, beside the `sarvamSecret` binding:

```ts
    const claudeOAuthSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this, 'ClaudeOAuthSecret', props.claudeOAuthSecretArn);
```

- [ ] **Step 3: Give `ProcessorFn` the extract queue**

In the `processor` construct's `env`:

```ts
        EXTRACT_QUEUE_URL: extractQueue.queueUrl,
```

and after `processor.addEventSource(...)`:

```ts
    extractQueue.grantSendMessages(processor);
```

- [ ] **Step 4: Import the ECR assets module**

```ts
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
```

- [ ] **Step 5: Add `ExtractFn` and `ApplyFn`, without reserved concurrency**

After the `processor.addEventSource(...)` block:

```ts
    // No reservedConcurrentExecutions on either function — this stack has
    // never set one for anything, on the reasoning a preview never carries
    // production's volume.
    const extractFn = new lambda.DockerImageFunction(this, 'ExtractFn', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..', 'extract'), {
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 3008,
      timeout: Duration.seconds(900),
      ephemeralStorageSize: Size.mebibytes(4096),
      environment: {
        AUDIO_BUCKET: audioBucket.bucketName,
        APPLY_QUEUE_URL: applyQueue.queueUrl,
        CLAUDE_OAUTH_SECRET_ARN: claudeOAuthSecret.secretArn,
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
      },
      logGroup: new logs.LogGroup(this, 'ExtractFnLogs', {
        retention: logs.RetentionDays.ONE_DAY,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    audioBucket.grantReadWrite(extractFn);
    applyQueue.grantSendMessages(extractFn);
    claudeOAuthSecret.grantRead(extractFn);
    gitloomSecret.grantRead(extractFn);
    extractFn.addEventSource(
      new lambdaEventSources.SqsEventSource(extractQueue, { batchSize: 1, reportBatchItemFailures: true }),
    );

    const applyFn = goFn('ApplyFn', 'apply', {
      env: { GITLOOM_SECRET_ARN: gitloomSecret.secretArn, BEDROCK_MODEL_ID: props.bedrockModelId },
      timeout: Duration.minutes(3),
      memory: 512,
    });
    table.grantReadWriteData(applyFn);
    audioBucket.grantReadWrite(applyFn);
    gitloomSecret.grantRead(applyFn);
    applyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    applyFn.addEventSource(
      new lambdaEventSources.SqsEventSource(applyQueue, { batchSize: 1, reportBatchItemFailures: true }),
    );
    applyFn.addEventSource(
      new lambdaEventSources.SqsEventSource(extractDlq, { batchSize: 1, reportBatchItemFailures: true }),
    );
```

Note what stayed out on purpose: no `logGroup` retention override beyond the one-day default this stack already uses everywhere else, no `reservedConcurrentExecutions`, and no `DlqReaperFn` construct — `applyDlq` exists as a resource (it comes back from `createDataPlane` whether or not this stack destructures it) and nothing drains it, exactly like `dlq` today.

- [ ] **Step 6: Thread the secret through `bin/app.ts`**

Beside `sarvamSecretArn: app.node.tryGetContext('sarvamSecretArn'),`:

```ts
    claudeOAuthSecretArn: app.node.tryGetContext('claudeOAuthSecretArn'),
```

Update the usage comment above it:

```ts
//   cdk deploy -c previewPr=42 -c deepgramSecretArn=... -c sarvamSecretArn=... -c claudeOAuthSecretArn=...
```

- [ ] **Step 7: Thread the secret through the preview workflow**

In `.github/workflows/preview.yml`, beside the `deepgram`/`sarvam` extraction:

```bash
          claude=$(echo "$OUT" | jq -r '.[] | select(.OutputKey=="ClaudeOAuthSecretArn") | .OutputValue')
```

and beside the two existing `-c` flags on the `cdk deploy` line:

```bash
            -c claudeOAuthSecretArn="$claude"
```

- [ ] **Step 8: Confirm the preview stack synthesizes**

```bash
cd backend && ./go/build.sh && npx cdk synth Mr20PendantPreview-pr-0 -c previewPr=0 \
  -c deepgramSecretArn=arn:aws:secretsmanager:ap-south-1:000000000000:secret:fake \
  -c sarvamSecretArn=arn:aws:secretsmanager:ap-south-1:000000000000:secret:fake \
  -c claudeOAuthSecretArn=arn:aws:secretsmanager:ap-south-1:000000000000:secret:fake >/dev/null
```

Expected: synthesizes with no error against fake ARNs — `fromSecretCompleteArn` only needs a well-formed ARN string at synth time, not a reachable secret.

- [ ] **Step 9: Commit**

```bash
git add backend/lib/preview-stack.ts backend/bin/app.ts .github/workflows/preview.yml
git commit -m "cdk: a preview's recordings reach ready too, not just transcribed"
```

---

## Self-Review

**Spec coverage.**

| Spec item (§1, §2) | Task |
|---|---|
| New `transcribed` status; mobile union widened; unknown-status discipline | Task 1 |
| `ProcessorFn` stops after ASR, marks `transcribed`, enqueues to `extractQueue` | Task 3 |
| Two-engine merge leaves `ProcessorFn`'s critical path entirely | Task 3 |
| `extractQueue`/`applyQueue`, visibility exceeding the consumer's timeout, `maxReceiveCount: 4`, `batchSize: 1`, DLQ, following `ingestQueue`'s precedent | Task 2, Task 11 (batchSize is set on the event source) |
| `ExtractFn`: container image, arm64, 3008 MB, 900 s, its own reserved concurrency | Task 11 |
| Scaffold: `public.ecr.aws/lambda/python:3.13`, `claude-agent-sdk>=0.2.152`, stateless `query()`, `permission_mode="bypassPermissions"`, `setting_sources=[]`, OAuth token from Secrets Manager cached in a module global, `docker buildx --platform`/`--architectures` in sync, `/tmp` wiped every invocation, `remaining_time - 20s` budget in `asyncio.wait_for` | Task 4, Task 11 |
| `ANTHROPIC_API_KEY` popped before the SDK sees it, and tested | Task 4 (guard), test in Task 4's `test_handler.py` |
| Structured logging | Task 5 |
| Cost/usage capture (`total_cost_usd`, `usage`, `model_usage`) | Task 5 |
| System prompt, model selection, `allowed_tools` justified against the scaffold's list | Task 6 |
| Idempotency (agent side) | Task 4 (`already_extracted`) |
| Consuming SQS rather than a bare `{"prompt": ...}` event | Task 4 |
| Three JSON files, exact schemas, `corrections.json` matching `ApplyCorrections` | Task 6 (prompt), Task 7 (`schemas.py`), Task 8 (Go mirror) |
| Files rather than parsed replies, for self-correction | Task 6's system prompt ("re-read each file... rewrite before finishing") |
| Probe `ResultMessage.structured_output`, record the finding | Task 7, Step 7 |
| `ApplyFn` (Go): patches the transcript via `ApplyCorrections`, mints tasks via the deterministic id scheme, ships memories to GitLoom, flips to `ready`, fires the push | Task 9 |
| `merge.go`/`enrich.go` kept, unchanged, as the fallback | Task 10 (calls both, changes neither) |
| Fallback fires when `ExtractFn` exhausts retries | Task 11 (`extractDlq` → `ApplyFn`), Task 10 (`runFallback`) |
| A test that the fallback actually fires | Task 10, Step 5 (honestly scoped — see the gap below) |
| GitLoom `Recall`-before-write (§2) | Task 6 (`gitloom_recall.py`, wired into the system prompt and `allowed_tools`) |
| Dedup is best-effort; nothing in GitLoom can be deleted; `SessionID` is write-only | Task 6's module docstring; restated in this plan's Global Constraints |
| Idempotency at all three stages, tested | `ProcessorFn`: Task 3 (`alreadyProcessed`); `ExtractFn`: Task 4 (`already_extracted`); `ApplyFn`: Task 9 (`rec.Status == ready/archived` guard in `processMessage`) |
| Four JSON files, exact schemas, including `summary.json` (title/tags/summary/category), matching `enrich.go`'s own caps | Task 6 (prompt), Task 7 (`schemas.py`), Task 8 (Go mirror), Task 9 (writes them onto the row via `enrich.ResolveCategory`) — added by the spec's 2026-09-14 amendment; see below |
| Preview deployments raised the same way production is | Task 13 |

**Placeholder scan.** Searched this plan for "TBD", "handle edge cases", "add appropriate error handling", "similar to Task N", and any type or function used before the task that defines it. None found. The one place this plan is deliberately *not* concrete is named below, not hidden.

**Type consistency.** `types.ExtractionRequest` (Task 3) is the message both `extractQueue` and `applyQueue` carry, now including `Categories []string` for the agent's prompt. Task 4's Python `already_extracted`/`extraction_prefix` and Task 9's Go `apply.ExtractionPrefix` compute the identical S3 prefix string independently, each with a test asserting the literal (`extract/user_1/rec_1/`). `apply.Outcome` (Task 8), including its `Summary SummaryFile` field, feeds `apply.Result` (Task 9) on the extracted path — `SummaryFile.Category` (a name) resolved to `Result.CategoryID` (an id) via `enrich.ResolveCategory`, exactly the function the fallback path already called; `enrichment := enrich.Enrich(...)` feeds the same `apply.Result` shape on the fallback path (Task 10) — `Patch` (Task 9) is exercised by both without change, and both branches of `processMessage` now call the identical categories-fetch-and-resolve sequence. `apply.TasksFromActionItems`'s signature is identical to the `tasksFromEnrichment` it replaces, so both callers (extracted-path `outcome.Tasks`, fallback-path `enrichment.ActionItems`) pass the same `[]types.ActionItem` shape. `schemas.py`'s `validate_summary` and Go's `ValidateSummary` agree on the same four fields and the same leniency about `category` (type-checked only, membership left to `ResolveCategory`) — deliberately, so neither language's validator second-guesses the other's answer about a name it was never asked to judge.

**Named gaps — not resolved, not hidden.**

1. **A message stuck in `extractDlq` that `ApplyFn` itself cannot process (a genuine, persistent AWS-side failure — not a validation failure) has no further backstop.** `extractDlq` has no redrive policy of its own (matching `ingestDlq`'s precedent, which also has none), so a message `ApplyFn` cannot process for infrastructure reasons — not "the files are missing," which routes to the fallback correctly, but e.g. a sustained DynamoDB outage during `finishApply` — retries within `extractDlq`'s own visibility timeout indefinitely, bounded only by its retention period, after which SQS drops it silently. This is a narrow, rare edge case (the fallback path's own writes are the same kind of thing `ProcessorFn` already does without a further backstop), and building a third-tier queue for it is judged out of proportion to this plan's scope — named here rather than silently accepted.
2. **`Task 10`'s "fallback fires" coverage stops at the validation boundary.** `runFallback` itself calls Bedrock through `enrich.MergeTranscripts`/`enrich.Enrich`, both already covered by `internal/enrich`'s own tests (`merge_test.go`, `enrich_test.go`, `facts_test.go`) for their parsing/coercion halves, but never end-to-end with a real model call — matching the existing convention that `cmd/processor`'s orchestration is not itself unit-tested. This plan does not add a mocking seam for `enrich.Enrich`/`enrich.MergeTranscripts` (they are free functions, not injected like `internal/api`'s `ddbX` variables) because doing so would mean restructuring code this plan otherwise leaves untouched. A true end-to-end fallback test needs either a live AWS account or a seam this plan does not introduce.
3. **`grouping.ts`'s `working`/`ready` counts and `app/(tabs)/index.tsx`'s per-item "working" indicator do not have a bucket for `transcribed`.** Deliberately unchanged, mirroring the spec's own restraint about the slip ("today `processing` prints TRANSCRIBING... whether the slip should keep saying TRANSCRIBING through that window, say something else, or start showing the transcript itself is a product decision this document does not make"). A `transcribed` recording is simply not counted as "working" and not counted as "ready" until this plan's ApplyFn moves it to `ready` — a real but narrow undercount, not a crash, and not this plan's call to fix.

**Found during planning, fixed in the spec rather than left as a gap here.** The first draft of this plan found that the agent's three-file contract (`corrections.json`, `tasks.json`, `memories.json`) had no file for a recording's title, tags, summary or category — those only ever came from `enrich.go`, kept in this design as the *fallback*, so a successful extraction would reach `ready` with no title while a failed one that fell back to Haiku would get one. That was a design error in the spec, not a scoping question this plan gets to leave open, so it was corrected there directly: the spec's 2026-09-14 amendment on `summary.json` adds the fourth file, and Tasks 3, 6, 7, 8 and 9 above build it — the agent now produces a title, tags, a summary and a category on the success path, resolved through the same `enrich.ResolveCategory` the fallback already used. Nothing in this plan still treats that as an open question.

