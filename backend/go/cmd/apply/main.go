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
	"time"

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

// categoriesFn is how buildExtractedResult and runFallback get the user's
// live category list. Production wires it to fetchCategories below; both
// callers take it as a parameter — rather than calling fetchCategories
// directly — for two reasons: a test can substitute a stub without an AWS
// config (ddb.GetCategories reaches a package-level client that is nil
// outside a running Lambda, so fetchCategories itself cannot run in a unit
// test), and processMessage's own signature now says, in a type a reviewer
// has to look at, that the category list is a live read handed in rather
// than something either function is free to reconstruct from req.Categories.
type categoriesFn func(ctx context.Context, userID string) []types.Category

// putTasksFn abstracts ddb.PutTasks the same way categoriesFn abstracts
// ddb.GetCategories: ddb.PutTasks reaches a package-level DynamoDB client
// that is nil outside a running Lambda, so a test substitutes a stub here
// rather than calling it directly. See writeTasks.
type putTasksFn func(ctx context.Context, tasks []ddb.Task) error

// getTaskFn and dismissTaskFn abstract ddb.GetTask and ddb.PutTask for the
// same reason. See reconcileOrphanTasks.
type getTaskFn func(ctx context.Context, userID, taskID string) (*ddb.Task, error)
type dismissTaskFn func(ctx context.Context, t ddb.Task) error

// setFactsMemoryStatusIfUnsetFn, rememberFactsFn and updateRecordingFn
// abstract ddb.SetFactsMemoryStatusIfUnset, gitloomx.RememberFacts and
// ddb.UpdateRecording for the same reason categoriesFn and putTasksFn do:
// the real ddb calls reach a package-level client that is nil outside a
// running Lambda, so a test substitutes stubs here instead. See sendFacts.
type setFactsMemoryStatusIfUnsetFn func(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) (bool, error)
type rememberFactsFn func(ctx context.Context, userID, recordingID, startedAt string, facts []types.Fact) error
type updateRecordingFn func(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) error

// fetchCategories reads the user's live category list, falling back to nil
// (enrich.ResolveCategory and enrich.Enrich both treat a nil list as "no
// categories defined") rather than failing the whole apply over a read that
// only affects one optional field. Shared by both processMessage's extracted
// path and runFallback: the id needs the live list either way, fetched here
// rather than trusted from req.Categories, since the extraction request may
// have sat in a queue for a while and the user's own edit should win, not a
// name captured earlier by ProcessorFn.
func fetchCategories(ctx context.Context, userID string) []types.Category {
	categories, err := ddb.GetCategories(ctx, userID)
	if err != nil {
		log.Printf("categories read failed, continuing without: userId=%s err=%v", userID, err)
		return nil
	}
	return categories
}

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

func processMessage(ctx context.Context, req types.ExtractionRequest, categories categoriesFn) error {
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
	speakersRaw, err := fetchOptional(ctx, prefix+"speakers.json")
	if err != nil {
		return err
	}

	outcome, valErr := apply.ValidateAll(correctionsRaw, tasksRaw, memoriesRaw, summaryRaw, speakersRaw,
		len(transcript.Utterances), apply.SpeakerIndices(&transcript))

	var result apply.Result
	if usesFallback(valErr) {
		log.Printf("extraction output invalid, falling back recordingId=%s reason=%v", req.RecordingID, valErr)
		result = runFallback(ctx, req, &transcript, categories)
	} else {
		applied := enrich.ApplyCorrections(&transcript, outcome.Corrections)
		log.Printf("applied extraction recordingId=%s corrections=%d tasks=%d memories=%d speakers=%d",
			req.RecordingID, applied, len(outcome.Tasks), len(outcome.Memories), len(outcome.Speakers))
		result = buildExtractedResult(ctx, req, outcome, categories)
	}

	return finishApply(ctx, req, rec, &transcript, result)
}

// buildExtractedResult turns a validated Outcome into the Result the
// extracted path applies. The agent chose a category *name* (or none)
// without ever touching DynamoDB (SummaryFile.Category's own doc comment,
// internal/apply). Resolving it to an id needs the live list, fetched via
// categories rather than trusted from req.Categories — the extraction
// request may have sat in a queue for a while, and the user's own edit is
// the one that should win, not a name captured earlier by ProcessorFn. A
// reviewer building this list from req.Categories instead is the exact
// regression TestBuildExtractedResultReadsCategoriesFresh (main_test.go)
// exists to catch — split out to its own function so that test can call it
// directly.
func buildExtractedResult(ctx context.Context, req types.ExtractionRequest, outcome apply.Outcome, categories categoriesFn) apply.Result {
	cats := categories(ctx, req.UserID)
	return apply.Result{
		Tasks: outcome.Tasks, Memories: outcome.Memories,
		Title: outcome.Summary.Title, Tags: outcome.Summary.Tags, Summary: outcome.Summary.Summary,
		CategoryID: enrich.ResolveCategory(outcome.Summary.Category, cats),
		Speakers:   outcome.Speakers,
	}
}

// usesFallback is the one branch point between the two paths: any
// validation failure at all — missing, malformed, or partially written —
// means the fallback runs. There is no partial credit for two good files
// and one bad one.
func usesFallback(valErr error) bool { return valErr != nil }

// runFallback re-runs the old Bedrock path directly against the stored
// transcript: the two-engine merge, then the Haiku enrichment call. Both are
// already best-effort — MergeTranscripts logs and returns 0 corrections on
// any failure, Enrich falls back to a title-only Enrichment — so this
// function itself has nothing left to fail on. The whole reason this
// fallback exists is so a recording always reaches ready with a title;
// TestRunFallbackAlwaysProducesATitle (main_test.go) is what would catch a
// change that stops that from being true.
func runFallback(ctx context.Context, req types.ExtractionRequest, transcript *types.Transcript, categories categoriesFn) apply.Result {
	if transcript.AltText != "" {
		corrections := enrich.MergeTranscripts(transcript, transcript.AltText)
		log.Printf("fallback merge recordingId=%s corrections=%d", req.RecordingID, corrections)
	}
	cats := categories(ctx, req.UserID)
	enrichment := enrich.Enrich(transcript, cats)
	return apply.Result{
		Tasks: enrichment.ActionItems, Memories: enrichment.Facts,
		Title: enrichment.Title, Tags: enrichment.Tags, Summary: enrichment.Summary,
		CategoryID: enrichment.CategoryID,
		Speakers:   enrichment.Speakers,
	}
}

// writeTasks turns this attempt's action items into task rows and persists
// them, returning the error rather than swallowing it: a PutTasks failure
// used to be logged and then discarded (tasks reset to nil), and
// processMessage fell straight through to UpdateRecording(status: ready)
// anyway — a throttled BatchWriteItem on a recording with real commitments
// produced a `ready` row with a title, tags and summary but zero task rows
// behind it, forever, since processMessage's own idempotency guard then
// refuses every redelivery once status reads ready.
//
// Returning here instead is safe to retry: TasksFromActionItems
// (internal/apply/tasks.go) mints deterministic ids from the recording id
// and position, so SQS redelivering this message re-runs PutTasks against
// the same rows rather than duplicating them.
func writeTasks(ctx context.Context, req types.ExtractionRequest, transcript *types.Transcript, result apply.Result, putTasks putTasksFn) ([]ddb.Task, error) {
	tasks := apply.TasksFromActionItems(req.UserID, req.RecordingID, req.StartedAt, result.Tasks, transcript)
	if len(tasks) == 0 {
		return tasks, nil
	}
	if err := putTasks(ctx, tasks); err != nil {
		log.Printf("task rows failed recordingId=%s count=%d err=%v", req.RecordingID, len(tasks), err)
		return nil, err
	}
	return tasks, nil
}

// reconcileOrphanTasks dismisses rows a re-run's own action items no longer
// produced. Task ids are positional (recordingId-0, -1, -2, ...): attempt 1
// writing 3 rows and then failing before UpdateRecording, followed by a
// redelivery whose attempt 2 writes only 2, overwrites rec-0 and rec-1 but
// never touches rec-2 — it would otherwise sit in the table forever, still
// `proposed`, carrying text from a run this recording no longer has any
// memory of, and offered for approval by GET /daemons/work exactly as if it
// were real.
//
// previousCount is rec.TaskCount, read fresh at the top of processMessage
// and persisted by finishApply in its own write immediately after writeTasks
// succeeds (see the call site) — before anything later has a chance to fail
// and cause the very redelivery this function exists for. internal/ddb
// exposes no way to list or delete task rows by recordingId, so a direct
// GetTask/PutTask on each now-excess positional id is what is available; a
// row already dismissed or done is left alone (DismissTask's own doc
// comment explains why a finished task's receipt must survive, and the
// same care applies here).
func reconcileOrphanTasks(ctx context.Context, userID, recordingID string, previousCount, newCount int, getTask getTaskFn, dismissTask dismissTaskFn) {
	for i := newCount; i < previousCount; i++ {
		taskID := fmt.Sprintf("%s-%d", recordingID, i)
		existing, err := getTask(ctx, userID, taskID)
		if err != nil {
			log.Printf("orphan task lookup failed recordingId=%s taskId=%s err=%v", recordingID, taskID, err)
			continue
		}
		if existing == nil || existing.Status == ddb.TaskDismissed || existing.Status == ddb.TaskDone {
			continue
		}
		orphan := *existing
		orphan.Status = ddb.TaskDismissed
		orphan.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if err := dismissTask(ctx, orphan); err != nil {
			log.Printf("orphan task dismiss failed recordingId=%s taskId=%s err=%v", recordingID, taskID, err)
		}
	}
}

// finishApply is the tail both paths share: re-PUT the transcript if it
// changed, mint tasks, ship memories, flip ready, push. Task 10 calls this
// from the fallback branch too.
//
// The GitLoom send (gitloomx.RememberFacts, via sendFacts below) is guarded
// per-recording, not by serialising the whole Lambda: ApplyFn consumes two
// SQS queues that can both deliver the same recording concurrently, so two
// invocations can each read the same empty rec.FactsMemoryStatus and both
// reach here. sendFacts's own doc comment explains the conditional claim
// (ddb.SetFactsMemoryStatusIfUnset) that makes only one of them actually
// call RememberFacts — mr20-stack.ts no longer needs reservedConcurrency: 1
// on ApplyFn to keep that from happening.
//
// Because the claim writes its outcome durably before finishApply's own
// terminal ddb.UpdateRecording call below runs, that terminal write only
// ever carries factsMemoryStatus for the one case sendFacts says is still
// its to record (the first pass with nothing to remember) — every other
// outcome (ingested, failed, or lost to a concurrent claim) is already on
// the row by the time this function reaches its own UpdateRecording, so
// this write must not clobber it back to empty. What guarding the send
// does NOT buy: a genuine GitLoom error still permanently loses that
// recording's facts, because GitLoom has no delete and no supersede at the
// pinned gitloom-go@v0.3.4, and nothing today re-fires from
// factsMemoryStatus=failed — retryRecording (internal/api/recordings.go)
// only ever re-runs the whole-dialogue ingest, gated on rec.MemoryStatus.
func finishApply(ctx context.Context, req types.ExtractionRequest, rec *types.Recording, transcript *types.Transcript, result apply.Result) error {
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

	tasks, err := writeTasks(ctx, req, transcript, result, ddb.PutTasks)
	if err != nil {
		return err
	}
	if newCount := len(tasks); newCount != rec.TaskCount {
		if newCount < rec.TaskCount {
			reconcileOrphanTasks(ctx, req.UserID, req.RecordingID, rec.TaskCount, newCount, ddb.GetTask, ddb.PutTask)
		}
		// Bound the window (the same shape cmd/processor's memoryStatus
		// interim write uses): persist the new count now, before GitLoom or
		// the final UpdateRecording below get a chance to fail and cause a
		// redelivery. Without this, a retry after such a failure would still
		// read the stale rec.TaskCount and either rediscover the very same
		// orphans or, if this attempt's own count later drops further, miss
		// the ones this attempt just left behind.
		if err := ddb.UpdateRecording(ctx, req.UserID, req.StartedAt, req.RecordingID,
			map[string]any{"taskCount": newCount}); err != nil {
			log.Printf("taskCount interim write failed recordingId=%s err=%v", req.RecordingID, err)
		}
	}

	factsStatus, writeFactsStatus, err := sendFacts(ctx, req.UserID, req.RecordingID, req.StartedAt,
		rec.FactsMemoryStatus, result.Memories, ddb.SetFactsMemoryStatusIfUnset, gitloomx.RememberFacts, ddb.UpdateRecording)
	if err != nil {
		return err
	}

	patch := apply.Patch(result)
	if writeFactsStatus {
		patch["factsMemoryStatus"] = factsStatus
	}
	if err := ddb.UpdateRecording(ctx, req.UserID, req.StartedAt, req.RecordingID, patch); err != nil {
		return err
	}

	log.Printf("ready recordingId=%s tasks=%d memories=%d factsMemoryStatus=%s",
		req.RecordingID, len(tasks), len(result.Memories), factsStatus)
	notifyReady(ctx, req.UserID, req.RecordingID, result.Title, tasks)
	return nil
}

// sendFacts decides this attempt's factsMemoryStatus and, when there are new
// facts to send, guards the GitLoom send itself against ApplyFn's own
// concurrency: applyQueue and extractDlq's fallback can both deliver the
// same recording, so two invocations can each reach here having read the
// same empty priorStatus. setIfUnset (ddb.SetFactsMemoryStatusIfUnset) is a
// per-recording conditional write on factsMemoryStatus — attempted BEFORE
// remember runs, not after — so whichever invocation's claim lands is the
// only one that ever calls remember; the other sees ok=false and returns
// without sending. Guarding the write alone, after the send (the shape
// cmd/processor's own memoryStatus uses), would not be enough here: by the
// time a post-send write could detect the collision, both invocations would
// already have called GitLoom.
//
// The claim itself writes patch's optimistic types.MemorySending outcome
// before the send is attempted, since the send is what must never run
// twice — not after it succeeds. It is deliberately not MemoryIngested (I4):
// ApplyFn can die between this write and remember returning, and if the
// claim's own optimism were indistinguishable from a confirmed success, a
// redelivery reading the row afterward would hit the priorStatus ==
// MemoryIngested case above and believe, permanently and silently, that
// facts which were never sent already had been — with no way back, since
// retryRecording only ever re-fires a leg that reads MemoryFailed. Reaching
// MemoryIngested now takes an explicit second write, after remember actually
// returns; if that second write itself fails, the row is left at
// MemorySending rather than wrongly at MemoryIngested — sent, but not
// provably recorded as sent, which is the honest state to be stuck in,
// logged for a human to reconcile against GitLoom directly. If remember
// fails instead, updateRecording corrects the marker to failed in its own
// follow-up write; neither write needs a condition, because winning the
// claim already means no other invocation can be racing this row's
// factsMemoryStatus.
//
// The returned status is always the resolved outcome (for the caller's own
// logging); the bool says whether the caller's own terminal patch must
// still carry it. That is true only for the first-pass, nothing-to-remember
// case: every other outcome — ingested, failed, or lost to a concurrent
// claim — is already durable on the row by the time this function returns,
// and the caller's terminal write must not clobber it back to empty.
func sendFacts(
	ctx context.Context, userID, recordingID, startedAt string, priorStatus types.MemoryStatus, memories []types.Fact,
	setIfUnset setFactsMemoryStatusIfUnsetFn, remember rememberFactsFn, updateRecording updateRecordingFn,
) (types.MemoryStatus, bool, error) {
	if len(memories) == 0 {
		// Nothing to remember this time. Leave whatever the row already
		// says untouched unless this is the first pass, in which case
		// there is honestly nothing to report either.
		if priorStatus == "" {
			return types.MemorySkipped, true, nil
		}
		return priorStatus, false, nil
	}
	if priorStatus == types.MemoryIngested {
		// A previous attempt's claim already landed and its send already
		// reached GitLoom, or this row was already ready and reached here
		// some other way. Either way, resending would permanently
		// duplicate facts GitLoom can neither delete nor supersede.
		log.Printf("facts already remembered, not resending recordingId=%s", recordingID)
		return priorStatus, false, nil
	}

	won, err := setIfUnset(ctx, userID, startedAt, recordingID, map[string]any{"factsMemoryStatus": types.MemorySending})
	if err != nil {
		return "", false, err
	}
	if !won {
		// Some other delivery of this same recording — a genuine concurrent
		// one, or this same recording redelivered after an earlier attempt
		// died mid-send — already holds the claim (whatever value it wrote:
		// sending, ingested, or failed). Either way this invocation must not
		// send, and must not touch the row: it does not own the outcome.
		log.Printf("facts claimed by a concurrent delivery, not resending recordingId=%s", recordingID)
		return types.MemoryIngested, false, nil
	}

	if err := remember(ctx, userID, recordingID, startedAt, memories); err != nil {
		log.Printf("gitloom facts ingest failed recordingId=%s err=%v", recordingID, err)
		if fixErr := updateRecording(ctx, userID, startedAt, recordingID,
			map[string]any{"factsMemoryStatus": types.MemoryFailed}); fixErr != nil {
			log.Printf("factsMemoryStatus failure correction failed recordingId=%s err=%v", recordingID, fixErr)
		}
		return types.MemoryFailed, false, nil
	}
	if err := updateRecording(ctx, userID, startedAt, recordingID,
		map[string]any{"factsMemoryStatus": types.MemoryIngested}); err != nil {
		// The send itself succeeded — reporting failure here would be wrong,
		// and retrying would resend. The row stays at MemorySending, logged
		// for a human to reconcile against GitLoom directly.
		log.Printf("factsMemoryStatus success correction failed recordingId=%s err=%v", recordingID, err)
	}
	return types.MemoryIngested, false, nil
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
		if err := processMessage(ctx, req, fetchCategories); err != nil {
			log.Printf("apply failed recordingId=%s err=%v", req.RecordingID, err)
			failures = append(failures, events.SQSBatchItemFailure{ItemIdentifier: record.MessageId})
		}
	}
	return events.SQSEventResponse{BatchItemFailures: failures}, nil
}

func main() { lambda.Start(handle) }
