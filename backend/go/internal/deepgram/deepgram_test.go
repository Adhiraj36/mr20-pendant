package deepgram

import (
	"strings"
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestSpeakerCount(t *testing.T) {
	tr := &types.Transcript{Utterances: []types.Utterance{
		{Speaker: 0}, {Speaker: 1}, {Speaker: 0}, {Speaker: 2},
	}}
	if got := SpeakerCount(tr); got != 3 {
		t.Fatalf("SpeakerCount = %d, want 3", got)
	}
}

func TestAsDialogueShort(t *testing.T) {
	tr := &types.Transcript{Utterances: []types.Utterance{
		{Speaker: 0, Text: "hello"},
		{Speaker: 1, Text: "hi there"},
	}}
	want := "Speaker 0: hello\nSpeaker 1: hi there"
	if got := AsDialogue(tr, 0); got != want {
		t.Fatalf("AsDialogue = %q", got)
	}
}

func TestAsDialogueTrimsTheMiddle(t *testing.T) {
	long := strings.Repeat("word ", 100)
	utterances := make([]types.Utterance, 100)
	for i := range utterances {
		utterances[i] = types.Utterance{Speaker: i % 2, Text: long}
	}
	tr := &types.Transcript{Utterances: utterances}

	out := AsDialogue(tr, 10_000)
	if len(out) > 11_000 {
		t.Fatalf("not trimmed: %d chars", len(out))
	}
	if !strings.Contains(out, "middle of the conversation omitted") {
		t.Fatal("trim marker missing")
	}
	// The opening and the close both survive.
	if !strings.HasPrefix(out, "Speaker 0: word") {
		t.Fatal("opening lost")
	}
}
