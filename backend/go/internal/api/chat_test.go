package api

import (
	"strings"
	"testing"
)

// A thread with no name is every thread called the same thing.
func TestATitleIsTheQuestionThatStartedIt(t *testing.T) {
	if got := titleFromQuestion("What did I promise Ravi this week?"); got != "What did I promise Ravi this week" {
		t.Fatalf("title = %q", got)
	}
	// Long questions are cut at a word, not mid-word, and say they were cut.
	long := titleFromQuestion("What exactly did we decide about the LED placement on the enclosure last Tuesday")
	if len([]rune(long)) > 49 || !strings.HasSuffix(long, "…") {
		t.Fatalf("a long question was not trimmed to a row: %q (%d)", long, len([]rune(long)))
	}
	if strings.Contains(long, "  ") {
		t.Fatalf("trimming left ragged spacing: %q", long)
	}
	// Whitespace-only, and empty, have no name to take.
	for _, q := range []string{"", "   ", "\n\t"} {
		if got := titleFromQuestion(q); got != "" {
			t.Fatalf("titleFromQuestion(%q) = %q, want empty", q, got)
		}
	}
	// Newlines and runs of spaces collapse: a title is one line.
	if got := titleFromQuestion("what  did\nwe decide"); got != "what did we decide" {
		t.Fatalf("title = %q", got)
	}
}
