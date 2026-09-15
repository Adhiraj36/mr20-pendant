package main

import (
	"context"
	"errors"
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/apply"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
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

// TestBuildExtractedResultReadsCategoriesFresh guards the regression the plan
// warns about: a reviewer building the category list from req.Categories
// (the stale value carried on the queue message) instead of a fresh
// ddb.GetCategories read. req.Categories here names a category the fetcher
// does NOT return, and the fetcher returns one req.Categories does not name
// — so the two sources can never accidentally agree, and the test call
// count catches a version that stops calling the fetcher at all.
func TestBuildExtractedResultReadsCategoriesFresh(t *testing.T) {
	req := types.ExtractionRequest{
		UserID:      "user-1",
		RecordingID: "rec-1",
		Categories:  []string{"Stale"}, // the queue message's own view; must not be consulted
	}
	outcome := apply.Outcome{
		Summary: apply.SummaryFile{Category: "Fresh"},
	}
	live := []types.Category{{ID: "fresh-id", Name: "Fresh"}}
	calls := 0
	fetch := func(ctx context.Context, userID string) []types.Category {
		calls++
		if userID != req.UserID {
			t.Errorf("categories fetched for userId=%q, want %q", userID, req.UserID)
		}
		return live
	}

	result := buildExtractedResult(context.Background(), req, outcome, fetch)

	if calls != 1 {
		t.Fatalf("categories fetcher called %d times, want 1 — the category list must come from a fresh read, not req.Categories", calls)
	}
	if result.CategoryID != "fresh-id" {
		t.Fatalf("CategoryID = %q, want %q — must resolve against the fetcher's live list, not req.Categories %v",
			result.CategoryID, "fresh-id", req.Categories)
	}
}

// TestRunFallbackAlwaysProducesATitle guards the fallback's whole purpose: a
// recording that fails extraction must still reach ready with a title. An
// empty transcript takes enrich.Enrich's own no-Bedrock guard (RTM: no
// network, no AWS, no Bedrock calls from a test), so this exercises
// runFallback's wiring deterministically.
// TestWriteTasksReturnsAPutTasksFailure is C1: a PutTasks failure used to be
// logged and swallowed (tasks reset to nil), letting processMessage fall
// straight through to UpdateRecording(status: ready) — a recording with
// real commitments reaching `ready` with zero task rows behind it, forever,
// because the idempotency guard at the top of processMessage then refuses
// every redelivery once status reads ready. writeTasks must surface the
// error instead, so finishApply returns before it ever calls
// ddb.UpdateRecording.
func TestWriteTasksReturnsAPutTasksFailure(t *testing.T) {
	sentinel := errors.New("dynamodb: throttled")
	req := types.ExtractionRequest{UserID: "user-1", RecordingID: "rec-1", StartedAt: "2026-01-01T00:00:00Z"}
	transcript := &types.Transcript{RecordingID: "rec-1"}
	result := apply.Result{Tasks: []types.ActionItem{{Text: "call the vet"}}}

	putTasks := func(ctx context.Context, tasks []ddb.Task) error { return sentinel }

	tasks, err := writeTasks(context.Background(), req, transcript, result, putTasks)
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want %v — a PutTasks failure must surface, not be swallowed", err, sentinel)
	}
	if tasks != nil {
		t.Fatalf("tasks = %v, want nil on failure — the caller must not treat a failed write as zero tasks written", tasks)
	}
}

// TestWriteTasksSkipsPutTasksWhenThereAreNoTasks guards against a version
// that calls PutTasks unconditionally (an empty BatchWriteItem, or a
// spurious error from a stub that expects never to be called).
func TestWriteTasksSkipsPutTasksWhenThereAreNoTasks(t *testing.T) {
	req := types.ExtractionRequest{UserID: "user-1", RecordingID: "rec-1", StartedAt: "2026-01-01T00:00:00Z"}
	transcript := &types.Transcript{RecordingID: "rec-1"}
	result := apply.Result{}

	calls := 0
	putTasks := func(ctx context.Context, tasks []ddb.Task) error {
		calls++
		return nil
	}

	tasks, err := writeTasks(context.Background(), req, transcript, result, putTasks)
	if err != nil {
		t.Fatalf("no action items must never fail: %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("tasks = %v, want none", tasks)
	}
	if calls != 0 {
		t.Fatalf("PutTasks called %d times, want 0 when there is nothing to write", calls)
	}
}

// TestReconcileOrphanTasksDismissesTheExcessRows is I8: task ids are
// positional, so a re-run that returns fewer items than an earlier attempt
// did leaves the higher-numbered rows untouched — orphans carrying text
// from a discarded run, which GET /daemons/work would then offer for
// approval and execution. Attempt 1 wrote 3 rows (rec-0/1/2); attempt 2's
// own writeTasks call only produced 2 (rec-0/1) — rec-2 must be found and
// dismissed, and rec-0/rec-1 must not be touched by this pass (writeTasks
// already overwrote them).
func TestReconcileOrphanTasksDismissesTheExcessRows(t *testing.T) {
	existing := map[string]*ddb.Task{
		"rec-1-2": {TaskID: "rec-1-2", UserID: "user-1", RecordingID: "rec-1", Text: "stale promise", Status: ddb.TaskProposed},
	}
	var dismissed []ddb.Task
	getTask := func(ctx context.Context, userID, taskID string) (*ddb.Task, error) {
		if t, ok := existing[taskID]; ok {
			cp := *t
			return &cp, nil
		}
		return nil, nil
	}
	dismissTask := func(ctx context.Context, t ddb.Task) error {
		dismissed = append(dismissed, t)
		return nil
	}

	reconcileOrphanTasks(context.Background(), "user-1", "rec-1", 3, 2, getTask, dismissTask)

	if len(dismissed) != 1 {
		t.Fatalf("dismissed %d tasks, want exactly 1 (rec-2): %+v", len(dismissed), dismissed)
	}
	if dismissed[0].TaskID != "rec-1-2" {
		t.Fatalf("dismissed %q, want rec-1-2", dismissed[0].TaskID)
	}
	if dismissed[0].Status != ddb.TaskDismissed {
		t.Fatalf("status = %q, want dismissed", dismissed[0].Status)
	}
}

// TestReconcileOrphanTasksLeavesDoneAndDismissedAlone must not resurrect or
// touch a row the user (or a previous pass of this same reconciliation)
// already closed out — DismissTask's own doc comment explains why a
// finished task's receipt must survive.
func TestReconcileOrphanTasksLeavesDoneAndDismissedAlone(t *testing.T) {
	existing := map[string]*ddb.Task{
		"rec-1-2": {TaskID: "rec-1-2", UserID: "user-1", RecordingID: "rec-1", Status: ddb.TaskDone},
		"rec-1-3": {TaskID: "rec-1-3", UserID: "user-1", RecordingID: "rec-1", Status: ddb.TaskDismissed},
	}
	getTask := func(ctx context.Context, userID, taskID string) (*ddb.Task, error) {
		if t, ok := existing[taskID]; ok {
			cp := *t
			return &cp, nil
		}
		return nil, nil
	}
	calls := 0
	dismissTask := func(ctx context.Context, t ddb.Task) error { calls++; return nil }

	reconcileOrphanTasks(context.Background(), "user-1", "rec-1", 4, 2, getTask, dismissTask)

	if calls != 0 {
		t.Fatalf("dismissTask called %d times, want 0 — done and already-dismissed rows must be left alone", calls)
	}
}

// TestReconcileOrphanTasksSkipsRowsThatNeverExisted covers the common case:
// most of the time previousCount and newCount are equal or there simply is
// no earlier attempt, and a GetTask miss (nil, nil) must not be treated as
// something to dismiss.
func TestReconcileOrphanTasksSkipsRowsThatNeverExisted(t *testing.T) {
	getTask := func(ctx context.Context, userID, taskID string) (*ddb.Task, error) { return nil, nil }
	calls := 0
	dismissTask := func(ctx context.Context, t ddb.Task) error { calls++; return nil }

	reconcileOrphanTasks(context.Background(), "user-1", "rec-1", 2, 2, getTask, dismissTask)

	if calls != 0 {
		t.Fatalf("dismissTask called %d times, want 0 when newCount == previousCount", calls)
	}
}

func TestRunFallbackAlwaysProducesATitle(t *testing.T) {
	transcript := &types.Transcript{RecordingID: "rec-1"} // Text == "": enrich.Enrich's no-speech guard
	req := types.ExtractionRequest{UserID: "user-1", RecordingID: "rec-1", StartedAt: "2026-01-01T00:00:00Z"}
	noCategories := func(ctx context.Context, userID string) []types.Category { return nil }

	result := runFallback(context.Background(), req, transcript, noCategories)

	if result.Title == "" {
		t.Fatal("runFallback produced no title — the Bedrock fallback exists precisely so a recording always reaches ready with a title")
	}
}

// TestSendFactsLosingTheClaimNeverSends is the race this whole change
// exists to close: ApplyFn consumes two SQS queues that can both deliver
// the same recording concurrently, so two invocations can each read the
// same empty priorStatus and both reach sendFacts. Before
// ddb.SetFactsMemoryStatusIfUnset existed, both would call remember and
// permanently duplicate the facts GitLoom can neither delete nor
// supersede. Here setIfUnset reports a lost claim (ok=false, nil error —
// exactly SetFactsMemoryStatusIfUnset's own documented shape for a
// conditional check failure); remember must never be called.
func TestSendFactsLosingTheClaimNeverSends(t *testing.T) {
	sent := 0
	setIfUnset := func(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) (bool, error) {
		return false, nil
	}
	remember := func(ctx context.Context, userID, recordingID, startedAt string, facts []types.Fact) error {
		sent++
		return nil
	}
	updateRecording := func(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) error {
		t.Fatal("no correction write is expected when the claim is simply lost")
		return nil
	}

	status, writeStatus, err := sendFacts(context.Background(), "user-1", "rec-1", "2026-01-01T00:00:00Z",
		"", []types.Fact{{Text: "likes tea"}}, setIfUnset, remember, updateRecording)

	if err != nil {
		t.Fatalf("a lost claim is not an error: %v", err)
	}
	if sent != 0 {
		t.Fatalf("remember called %d times, want 0 — the loser of the claim must not resend", sent)
	}
	if writeStatus {
		t.Fatal("writeStatus = true, want false — the winner's claim already owns recording the outcome")
	}
	if status != types.MemoryIngested {
		t.Fatalf("status = %q, want %q — some other delivery already owns finishing this recording's facts", status, types.MemoryIngested)
	}
}

// TestSendFactsWinningTheClaimSendsOnce is the other side of the same race:
// the invocation whose conditional write lands is the one that must
// actually call remember, with this recording's own memories.
//
// I4: the claim itself must write MemorySending, not MemoryIngested — a
// process that dies between this write and remember returning must not
// leave the row claiming a success it cannot back up — and a second write,
// after remember actually succeeds, is what promotes the row to
// MemoryIngested. Before this fix the claim wrote MemoryIngested directly
// and no second write ever happened (the assertion below used to forbid
// updateRecording from being called at all on this path).
func TestSendFactsWinningTheClaimSendsOnce(t *testing.T) {
	facts := []types.Fact{{Text: "likes tea"}}
	var claimPatch map[string]any
	setIfUnset := func(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) (bool, error) {
		claimPatch = patch
		return true, nil
	}
	sent := 0
	remember := func(ctx context.Context, userID, recordingID, startedAt string, got []types.Fact) error {
		sent++
		if userID != "user-1" || recordingID != "rec-1" || startedAt != "2026-01-01T00:00:00Z" {
			t.Errorf("remember called with userId=%s recordingId=%s startedAt=%s", userID, recordingID, startedAt)
		}
		if len(got) != 1 || got[0].Text != "likes tea" {
			t.Errorf("remember got %+v, want the recording's own memories", got)
		}
		return nil
	}
	var successPatch map[string]any
	updateRecording := func(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) error {
		successPatch = patch
		return nil
	}

	status, writeStatus, err := sendFacts(context.Background(), "user-1", "rec-1", "2026-01-01T00:00:00Z",
		"", facts, setIfUnset, remember, updateRecording)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sent != 1 {
		t.Fatalf("remember called %d times, want exactly 1 — the winner of the claim must send", sent)
	}
	if claimPatch["factsMemoryStatus"] != types.MemorySending {
		t.Fatalf("claim patch = %v, want factsMemoryStatus=sending written before the send — "+
			"writing ingested here is I4: a crash before the send lands would leave the row "+
			"claiming success it never earned", claimPatch)
	}
	if successPatch["factsMemoryStatus"] != types.MemoryIngested {
		t.Fatalf("success patch = %v, want a follow-up write of factsMemoryStatus=ingested "+
			"once remember actually succeeds", successPatch)
	}
	if writeStatus {
		t.Fatal("writeStatus = true, want false — the follow-up write already recorded the outcome")
	}
	if status != types.MemoryIngested {
		t.Fatalf("status = %q, want %q", status, types.MemoryIngested)
	}
}

// TestSendFactsRedeliveryOfAnInterruptedSendDoesNotResendOrFalselySucceed is
// I4's own regression test. Before this fix, the claim wrote
// factsMemoryStatus=ingested *before* the send was attempted. If ApplyFn
// died right after that write, a redelivery of the same recording would read
// priorStatus=ingested and hit sendFacts' own "already remembered" shortcut
// — returning immediately, believing a send that never happened had already
// succeeded, permanently: retryRecording only ever re-fires a leg reading
// MemoryFailed, never MemoryIngested. This pins the fix's own escape hatch:
// a redelivery reading priorStatus=MemorySending (what the row is left at
// now, instead of the lying MemoryIngested) must not take that shortcut —
// it must still attempt to reconcile via setIfUnset, which is what confirms
// the row is not silently mistaken for already finished.
func TestSendFactsRedeliveryOfAnInterruptedSendDoesNotResendOrFalselySucceed(t *testing.T) {
	setIfUnsetCalled := false
	setIfUnset := func(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) (bool, error) {
		setIfUnsetCalled = true
		// The field is already set (to "sending", from the invocation that
		// died before it could correct it), so the conditional write loses —
		// exactly as it would against a genuine concurrent claim.
		return false, nil
	}
	remember := func(context.Context, string, string, string, []types.Fact) error {
		t.Fatal("remember must not be called for a row another delivery already claimed")
		return nil
	}
	updateRecording := func(context.Context, string, string, string, map[string]any) error {
		t.Fatal("no correction write is expected when the claim is already held")
		return nil
	}

	status, writeStatus, err := sendFacts(context.Background(), "user-1", "rec-1", "2026-01-01T00:00:00Z",
		types.MemorySending, []types.Fact{{Text: "likes tea"}}, setIfUnset, remember, updateRecording)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !setIfUnsetCalled {
		t.Fatal("a row reading \"sending\" must still attempt to reconcile via setIfUnset — the pre-fix bug " +
			"was priorStatus==ingested returning immediately, before ever checking whether the send had landed")
	}
	if writeStatus {
		t.Fatal("writeStatus = true, want false — this call does not own the row and must not tell the caller to write onto it")
	}
	if status != types.MemoryIngested {
		t.Fatalf("status = %q — this is the caller's own log line, not a row write; it must not report failure either", status)
	}
}

// TestSendFactsCorrectsTheMarkerWhenRememberFails covers the claim's own
// optimism: it stamps factsMemoryStatus=ingested before the send is even
// attempted (guarding the send itself, not just the write that follows it —
// see sendFacts's doc comment), so a send that then fails must be corrected
// back to failed in its own follow-up write.
func TestSendFactsCorrectsTheMarkerWhenRememberFails(t *testing.T) {
	setIfUnset := func(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) (bool, error) {
		return true, nil
	}
	remember := func(ctx context.Context, userID, recordingID, startedAt string, facts []types.Fact) error {
		return errors.New("gitloom: 503")
	}
	var corrected map[string]any
	updateRecording := func(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) error {
		corrected = patch
		return nil
	}

	status, writeStatus, err := sendFacts(context.Background(), "user-1", "rec-1", "2026-01-01T00:00:00Z",
		"", []types.Fact{{Text: "likes tea"}}, setIfUnset, remember, updateRecording)

	if err != nil {
		t.Fatalf("a GitLoom send failure is recorded, not returned as this call's own error: %v", err)
	}
	if corrected["factsMemoryStatus"] != types.MemoryFailed {
		t.Fatalf("correction write = %v, want factsMemoryStatus=failed", corrected)
	}
	if writeStatus {
		t.Fatal("writeStatus = true, want false — the correction write already recorded the outcome")
	}
	if status != types.MemoryFailed {
		t.Fatalf("status = %q, want %q", status, types.MemoryFailed)
	}
}

// TestSendFactsSkipsTheClaimWhenThereIsNothingToRemember guards the two
// paths that must never touch setIfUnset or remember at all: a first pass
// with no memories (reported as skipped so the row says something), and a
// recording whose facts were already ingested by an earlier attempt.
func TestSendFactsSkipsTheClaimWhenThereIsNothingToRemember(t *testing.T) {
	failIfCalled := func(name string) func(context.Context, string, string, string, map[string]any) (bool, error) {
		return func(context.Context, string, string, string, map[string]any) (bool, error) {
			panic(name + " must not be called")
		}
	}
	noRemember := func(context.Context, string, string, string, []types.Fact) error {
		panic("remember must not be called")
	}
	noCorrection := func(context.Context, string, string, string, map[string]any) error {
		panic("updateRecording must not be called")
	}

	status, writeStatus, err := sendFacts(context.Background(), "user-1", "rec-1", "2026-01-01T00:00:00Z",
		"", nil, failIfCalled("setIfUnset"), noRemember, noCorrection)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != types.MemorySkipped || !writeStatus {
		t.Fatalf("status=%q writeStatus=%v, want skipped/true for a first pass with nothing to remember", status, writeStatus)
	}

	status, writeStatus, err = sendFacts(context.Background(), "user-1", "rec-1", "2026-01-01T00:00:00Z",
		types.MemoryIngested, []types.Fact{{Text: "likes tea"}}, failIfCalled("setIfUnset"), noRemember, noCorrection)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != types.MemoryIngested || writeStatus {
		t.Fatalf("status=%q writeStatus=%v, want ingested/false when an earlier attempt already sent these facts", status, writeStatus)
	}
}
