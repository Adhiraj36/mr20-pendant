package ddb

import "testing"

func TestConversationSKLeadsWithUpdatedAt(t *testing.T) {
	c := Conversation{ID: "chat_1", UpdatedAt: "2026-09-08T10:00:00Z"}
	if got := c.SK(); got != "CONV#2026-09-08T10:00:00Z#chat_1" {
		t.Fatalf("SK = %q", got)
	}
}

func TestCoerceConversationKind(t *testing.T) {
	if got := CoerceConversationKind("voice"); got != ConversationVoice {
		t.Fatalf("voice = %q", got)
	}
	// Anything a stale or hostile client sends is a text thread. There is no
	// third kind to invent.
	for _, input := range []string{"", "text", "VOICE", "spoken", "../voice"} {
		if input == "voice" {
			continue
		}
		if got := CoerceConversationKind(input); got != ConversationText {
			t.Fatalf("%q = %q, want text", input, got)
		}
	}
}

// The counter exists because gitloom-go's own cadence is per-process and this
// runs on Lambda. Fifth exchange compacts, and only the fifth.
func TestDueForCompaction(t *testing.T) {
	for _, n := range []int{0, 1, 2, 3, 4, 6, 9} {
		if DueForCompaction(n) {
			t.Fatalf("%d exchanges must not compact", n)
		}
	}
	for _, n := range []int{5, 10, 15} {
		if !DueForCompaction(n) {
			t.Fatalf("%d exchanges must compact", n)
		}
	}
}
