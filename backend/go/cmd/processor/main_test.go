package main

import (
	"context"
	"errors"
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

// A failed enqueue must never leave the row marked transcribed: alreadyProcessed
// would then swallow the very redelivery meant to retry the enqueue, and
// retryBlockedBy (internal/api/recordings.go) refuses a manual retry from
// StatusTranscribed — so a lost SendMessage would strand the recording forever,
// acknowledged off the queue with no way back.
func TestCommitTranscriptionOrdersEnqueueBeforeMark(t *testing.T) {
	sentinelEnqueueErr := errors.New("sqs: send message failed")
	sentinelMarkErr := errors.New("ddb: update failed")

	cases := []struct {
		name       string
		enqueueErr error
		markErr    error
		wantErr    error
		wantMarked bool
	}{
		{
			name:       "enqueue failure must surface and must not mark transcribed",
			enqueueErr: sentinelEnqueueErr,
			wantErr:    sentinelEnqueueErr,
			wantMarked: false,
		},
		{
			name:       "enqueue success marks transcribed",
			wantMarked: true,
		},
		{
			name:       "mark failure after a successful enqueue still surfaces",
			markErr:    sentinelMarkErr,
			wantErr:    sentinelMarkErr,
			wantMarked: true, // markTranscribed was attempted; it just failed
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			marked := false
			err := commitTranscription(
				func() error { return c.enqueueErr },
				func() error { marked = true; return c.markErr },
			)
			if !errors.Is(err, c.wantErr) {
				t.Errorf("err = %v, want %v", err, c.wantErr)
			}
			if marked != c.wantMarked {
				t.Errorf("markTranscribed invoked = %v, want %v", marked, c.wantMarked)
			}
		})
	}
}

// TestIngestOnceSkipsAResendWhenAlreadyIngestedOrFailed is I6: an SQS send
// sits between the GitLoom ingest and the final status write, in a window a
// redelivery can land in. Without this guard, a retry that reaches
// processObject again re-runs the whole pass — including a second
// whole-dialogue GitLoom ingest, which is a permanent duplicate (no delete,
// no supersede at the pinned SDK version). The guard is rec.MemoryStatus
// already carrying an outcome from an earlier attempt's interim write.
func TestIngestOnceSkipsAResendWhenAlreadyIngestedOrFailed(t *testing.T) {
	for _, status := range []types.MemoryStatus{types.MemoryIngested, types.MemoryFailed} {
		t.Run(string(status), func(t *testing.T) {
			rec := &types.Recording{RecordingID: "rec-1", UserID: "user-1", MemoryStatus: status}
			calls := 0
			ingest := func(ctx context.Context, userID, recordingID, startedAt string, tr *types.Transcript, speakers map[string]string) (string, error) {
				calls++
				return "dialogue text", nil
			}

			got, dialogue := ingestOnce(context.Background(), rec, &types.Transcript{}, ingest)

			if calls != 0 {
				t.Fatalf("ingest called %d times, want 0 — a %s recording must not be resent", calls, status)
			}
			if got != status {
				t.Fatalf("status = %q, want unchanged %q", got, status)
			}
			if dialogue != "" {
				t.Fatalf("dialogue = %q, want empty — nothing to upload when the ingest did not run", dialogue)
			}
		})
	}
}

// TestIngestOnceRunsWhenNoOutcomeIsRecordedYet covers the ordinary path: a
// fresh recording (empty MemoryStatus) must still actually ingest.
func TestIngestOnceRunsWhenNoOutcomeIsRecordedYet(t *testing.T) {
	rec := &types.Recording{RecordingID: "rec-1", UserID: "user-1"}
	calls := 0
	ingest := func(ctx context.Context, userID, recordingID, startedAt string, tr *types.Transcript, speakers map[string]string) (string, error) {
		calls++
		return "dialogue text", nil
	}

	status, dialogue := ingestOnce(context.Background(), rec, &types.Transcript{}, ingest)

	if calls != 1 {
		t.Fatalf("ingest called %d times, want 1", calls)
	}
	if status != types.MemoryIngested {
		t.Fatalf("status = %q, want ingested", status)
	}
	if dialogue != "dialogue text" {
		t.Fatalf("dialogue = %q, want it passed through", dialogue)
	}
}

// TestIngestOnceReportsFailedWithoutADialogueToUpload confirms a failed
// ingest still reports MemoryFailed (so an interim write can record it) and
// never hands back a dialogue string an error means was never produced.
func TestIngestOnceReportsFailedWithoutADialogueToUpload(t *testing.T) {
	rec := &types.Recording{RecordingID: "rec-1", UserID: "user-1"}
	sentinel := errors.New("gitloom: unavailable")
	ingest := func(ctx context.Context, userID, recordingID, startedAt string, tr *types.Transcript, speakers map[string]string) (string, error) {
		return "", sentinel
	}

	status, dialogue := ingestOnce(context.Background(), rec, &types.Transcript{}, ingest)

	if status != types.MemoryFailed {
		t.Fatalf("status = %q, want failed", status)
	}
	if dialogue != "" {
		t.Fatalf("dialogue = %q, want empty", dialogue)
	}
}
