package deepgram

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestAsDialogueWithSubstitutesNames(t *testing.T) {
	tr := &types.Transcript{Utterances: []types.Utterance{
		{Speaker: 0, Text: "I'll send the deck tonight"},
		{Speaker: 1, Text: "thanks"},
		{Speaker: 2, Text: "who is that"},
	}}
	// Speaker 2 has no name; a half-labelled conversation reads as
	// half-labelled rather than losing the labels it has.
	got := AsDialogueWith(tr, map[string]string{"0": "Priya", "1": "  "}, 0)
	want := "Priya: I'll send the deck tonight\nSpeaker 1: thanks\nSpeaker 2: who is that"
	if got != want {
		t.Fatalf("AsDialogueWith =\n%q\nwant\n%q", got, want)
	}
}

func TestAsDialogueKeepsAnonymousLabels(t *testing.T) {
	tr := &types.Transcript{Utterances: []types.Utterance{{Speaker: 0, Text: "hello"}}}
	if got := AsDialogue(tr, 0); got != "Speaker 0: hello" {
		t.Fatalf("AsDialogue = %q", got)
	}
}

func TestSpeakerLabel(t *testing.T) {
	names := map[string]string{"0": "Priya", "1": ""}
	if got := SpeakerLabel(0, names); got != "Priya" {
		t.Fatalf("named = %q", got)
	}
	if got := SpeakerLabel(1, names); got != "Speaker 1" {
		t.Fatalf("blank name = %q", got)
	}
	if got := SpeakerLabel(7, nil); got != "Speaker 7" {
		t.Fatalf("no map = %q", got)
	}
}

// The cap is bytes because bytes are what GitLoom measures. An hour of
// Devanagari is three bytes to the character, so a cap counted in characters
// is a cap that passes locally and 413s in Mumbai.
func TestAsDialogueCapIsBytesNotCharacters(t *testing.T) {
	line := strings.Repeat("नमस्ते ", 200) // multi-byte throughout
	utterances := make([]types.Utterance, 200)
	for i := range utterances {
		utterances[i] = types.Utterance{Speaker: i % 2, Text: line}
	}
	tr := &types.Transcript{Utterances: utterances}

	const budget = 20_000
	out := AsDialogueWith(tr, nil, budget)

	if len(out) > budget+200 { // + the omission marker
		t.Fatalf("dialogue is %d bytes, over the %d budget", len(out), budget)
	}
	if utf8.RuneCountInString(out) >= len(out) {
		t.Fatal("this fixture must be multi-byte for the test to mean anything")
	}
	if !strings.Contains(out, "middle of the conversation omitted") {
		t.Fatal("trim marker missing")
	}
}

// A byte-length cut lands mid-rune roughly two times in three on multi-byte
// text. Posting half a character is how a payload becomes invalid UTF-8.
func TestAsDialogueTrimsToRuneBoundaries(t *testing.T) {
	utterances := make([]types.Utterance, 100)
	for i := range utterances {
		utterances[i] = types.Utterance{Speaker: 0, Text: strings.Repeat("अआइईउ", 40)}
	}
	tr := &types.Transcript{Utterances: utterances}

	// Sweep budgets so the cut lands at every offset within a rune.
	for budget := 1_000; budget < 1_012; budget++ {
		out := AsDialogueWith(tr, nil, budget)
		if !utf8.ValidString(out) {
			t.Fatalf("budget %d produced invalid UTF-8", budget)
		}
	}
}

func TestAsDialogueShortIsUntouched(t *testing.T) {
	tr := &types.Transcript{Utterances: []types.Utterance{{Speaker: 0, Text: "नमस्ते"}}}
	if got := AsDialogueWith(tr, nil, 1_000); got != "Speaker 0: नमस्ते" {
		t.Fatalf("AsDialogueWith = %q", got)
	}
}
