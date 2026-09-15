package ddb

import (
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestReceiptFromTask(t *testing.T) {
	task := Task{
		TaskID:      "rec_1-0",
		UserID:      "user_1",
		RecordingID: "rec_1",
		Text:        "send Priya the deck",
		Quote:       "I'll send you the deck tonight",
		Kind:        types.TaskKindMessage,
		Status:      TaskProposed,
		DueAt:       "2026-09-09T18:00:00Z",
		CreatedAt:   "2026-09-08T10:00:00Z",
	}
	r := ReceiptFromTask(task, "r_1", "2026-09-08T12:00:00Z")

	if r.Kind != ReceiptTask || r.Stamp != StampDone {
		t.Fatalf("kind/stamp: %q %q", r.Kind, r.Stamp)
	}
	// The receipt has to lead back to both the task and the conversation, or
	// the roll is a list of claims with no source.
	if r.TaskID != "rec_1-0" || r.RecordingID != "rec_1" {
		t.Fatalf("links: %+v", r)
	}
	if r.Title != task.Text || r.Quote != task.Quote {
		t.Fatalf("title/quote: %q %q", r.Title, r.Quote)
	}

	rows := map[string]string{}
	for _, row := range r.Rows {
		rows[row.K] = row.V
	}
	if rows["KIND"] != "MESSAGE" {
		t.Fatalf("KIND = %q", rows["KIND"])
	}
	if rows["PROMISED"] != task.CreatedAt {
		t.Fatalf("PROMISED = %q", rows["PROMISED"])
	}
	if rows["MARKED DONE"] != "2026-09-08T12:00:00Z" {
		t.Fatalf("MARKED DONE = %q", rows["MARKED DONE"])
	}
	if rows["DUE"] != task.DueAt {
		t.Fatalf("DUE = %q", rows["DUE"])
	}

	var verdict *ReceiptRow
	for i := range r.Rows {
		if r.Rows[i].K == "STATUS" {
			verdict = &r.Rows[i]
		}
	}
	if verdict == nil || verdict.OK == nil || !*verdict.OK {
		t.Fatalf("the verdict line must carry ok=true: %+v", verdict)
	}
}

// A receipt with no due date must not print a blank DUE line — the design's
// rule is that empty fragments are dropped, not rendered empty.
func TestReceiptFromTaskDropsEmptyRows(t *testing.T) {
	r := ReceiptFromTask(Task{
		TaskID: "t", UserID: "u", Text: "buy milk",
		Kind: types.TaskKindOther, CreatedAt: "2026-09-08T10:00:00Z",
	}, "r_1", "2026-09-08T12:00:00Z")
	for _, row := range r.Rows {
		if row.K == "DUE" {
			t.Fatalf("a task with no due date printed a DUE row: %+v", row)
		}
		if row.V == "" {
			t.Fatalf("empty value on row %q", row.K)
		}
	}
}

func TestCleanRowsCapsAndTrims(t *testing.T) {
	rows := make([]ReceiptRow, 0, 20)
	for i := 0; i < 20; i++ {
		rows = append(rows, ReceiptRow{K: "  K  ", V: "  v  "})
	}
	rows = append(rows, ReceiptRow{K: "", V: "orphan"})

	got := CleanRows(rows)
	if len(got) != maxReceiptRows {
		t.Fatalf("rows = %d, want %d", len(got), maxReceiptRows)
	}
	if got[0].K != "K" || got[0].V != "v" {
		t.Fatalf("not trimmed: %+v", got[0])
	}
}

func TestReceiptSK(t *testing.T) {
	if got := receiptSK("2026-09-08T12:00:00Z", "r_1"); got != "RECEIPT#2026-09-08T12:00:00Z#r_1" {
		t.Fatalf("SK = %q", got)
	}
}
