package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"

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

// I1: this is the third copy of the byte-truncation bug — internal/apply and
// internal/enrich each had and fixed the identical one on the extracted and
// Bedrock-fallback paths. This branch newly routes daemon question text
// (maxQuestionText, 500) and a person's answer to it (maxAnswerText, 400)
// through this same function, both of which can be Devanagari or any other
// multi-byte script: 500 bytes of Devanagari is 168 runes, and a plain
// s[:n] byte slice can stop mid-codepoint, hand back a string
// utf8.Valid reports false on, and print a mangled tail on the task screen,
// in the push body, and to whatever the daemon acts on next.
func TestTruncateNeverSplitsARune(t *testing.T) {
	rune3Byte := "अ" // U+0905, DEVANAGARI LETTER A — 3 bytes in UTF-8
	if len(rune3Byte) != 3 {
		t.Fatalf("test fixture assumption broken: %q is %d bytes, want 3", rune3Byte, len(rune3Byte))
	}
	s := strings.Repeat(rune3Byte, 200) // 200 runes, 600 bytes
	got := truncate(s, 200)

	if !utf8.ValidString(got) {
		t.Fatalf("truncate produced invalid UTF-8: %q", got)
	}
	if n := utf8.RuneCountInString(got); n != 200 {
		t.Fatalf("truncate(200 Devanagari runes, 200) kept %d runes, want 200", n)
	}
	if got != s {
		t.Fatalf("200 runes capped at 200 must be unchanged: got %d bytes, want %d", len(got), len(s))
	}
}

// TestTruncateCutsAtTheRuneBoundaryWhenOverLength shows the cut lands
// exactly on a rune boundary, not merely "somewhere valid": one Devanagari
// rune over the cap must drop exactly that one rune (3 bytes), never a
// partial one — the same case maxAnswerText=400 hits at roughly 134
// Devanagari characters, per the review's own measurement.
func TestTruncateCutsAtTheRuneBoundaryWhenOverLength(t *testing.T) {
	s := strings.Repeat("अ", 201) // 201 runes, 603 bytes
	got := truncate(s, 200)

	if !utf8.ValidString(got) {
		t.Fatalf("truncate produced invalid UTF-8: %q", got)
	}
	if n := utf8.RuneCountInString(got); n != 200 {
		t.Fatalf("got %d runes, want 200", n)
	}
	if len(got) != 600 {
		t.Fatalf("got %d bytes, want 600 (200 whole 3-byte runes)", len(got))
	}
}

// I3: the row must persist after EACH leg of a two-leg memory retry lands,
// not only once both succeed — otherwise a deterministic failure on the
// second leg (RememberFacts) throws away the first leg's own success
// (IngestTranscript): the handler returns 502 before memoryStatus=ingested
// ever reaches the table, so every subsequent tap re-ingests the whole
// conversation into GitLoom again, permanently — there is no delete or
// supersede at the pinned SDK version to undo a duplicate ingest.
func TestRetryRecordingPersistsEachMemoryLegAsItLands(t *testing.T) {
	rec := &types.Recording{
		RecordingID: "rec_1", UserID: testUser, Status: types.StatusReady,
		StartedAt: "2026-09-08T10:00:00Z", TranscriptKey: "transcripts/rec_1.json",
		MemoryStatus: types.MemoryFailed, FactsMemoryStatus: types.MemoryFailed,
		Facts: []types.Fact{{Text: "likes tea"}},
	}
	stub(t, &ddbGetRecording, func(context.Context, string, string) (*types.Recording, error) {
		return rec, nil
	})
	stub(t, &fetchTranscript, func(context.Context, string) (*types.Transcript, error) {
		return &types.Transcript{RecordingID: "rec_1"}, nil
	})
	stub(t, &gitloomxIngestTranscript, func(context.Context, string, string, string, *types.Transcript, map[string]string) (string, error) {
		return "dialogue text", nil
	})
	stub(t, &gitloomxRememberFacts, func(context.Context, string, string, string, []types.Fact) error {
		return errors.New("GitLoom said no — a deterministic 4xx, not a blip")
	})
	var patches []map[string]any
	stub(t, &ddbUpdateRecording, func(_ context.Context, _, _, _ string, patch map[string]any) error {
		patches = append(patches, patch)
		return nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Post("/recordings/:id/retry", retryRecording)
	})
	res := do(t, app, "POST", "/recordings/rec_1/retry", "")
	if res.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 — the facts leg still failed", res.StatusCode)
	}

	transcriptPersisted := false
	for _, p := range patches {
		if p["memoryStatus"] == types.MemoryIngested {
			transcriptPersisted = true
		}
		if p["factsMemoryStatus"] != nil {
			t.Fatalf("factsMemoryStatus must not be written — that leg failed: %+v", p)
		}
	}
	if !transcriptPersisted {
		t.Fatal("the transcript leg succeeded but was never persisted — a retry will re-ingest " +
			"the whole conversation into GitLoom again, permanently")
	}
}

// TestTruncateStillCapsPlainASCIIByCharacterCount guards the case truncate
// already got right: byte and rune counts agree for ASCII, so this must keep
// behaving exactly as it did before — every caller here (question text,
// hostnames, tags, titles) relies on that.
func TestTruncateStillCapsPlainASCIIByCharacterCount(t *testing.T) {
	if got := truncate("hello world", 5); got != "hello" {
		t.Fatalf("truncate(%q, 5) = %q, want %q", "hello world", got, "hello")
	}
	if got := truncate("hi", 5); got != "hi" {
		t.Fatalf("truncate(%q, 5) = %q, want it unchanged", "hi", got)
	}
}
