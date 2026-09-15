package enrich

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestCoerceFacts(t *testing.T) {
	reply := `{"title":"t","facts":[
		{"text":"Priya is the wearer's sister","kind":"person"},
		{"text":"Prefers morning meetings","kind":"preference"},
		{"text":"They settled on the Mumbai office","kind":"decision"},
		{"text":"The lease ends in March","kind":"fact"}
	]}`
	e := Coerce(reply, transcript("x"), cats)

	if len(e.Facts) != 4 {
		t.Fatalf("facts = %d: %+v", len(e.Facts), e.Facts)
	}
	want := []types.FactKind{
		types.FactKindPerson, types.FactKindPreference,
		types.FactKindDecision, types.FactKindFact,
	}
	for i, kind := range want {
		if e.Facts[i].Kind != kind {
			t.Fatalf("fact %d kind = %q, want %q", i, e.Facts[i].Kind, kind)
		}
	}
}

// An unrecognised kind is a missing classification, not a new category — it
// must land on "fact" rather than reaching the table as itself.
func TestCoerceFactsUnknownKindBecomesFact(t *testing.T) {
	e := Coerce(`{"title":"t","facts":[{"text":"x","kind":"gossip"},{"text":"y"}]}`, transcript("x"), cats)
	if len(e.Facts) != 2 {
		t.Fatalf("facts = %+v", e.Facts)
	}
	for _, f := range e.Facts {
		if f.Kind != types.FactKindFact {
			t.Fatalf("kind = %q, want fact", f.Kind)
		}
	}
}

func TestCoerceFactsCapsCountAndLength(t *testing.T) {
	entries := make([]string, 0, 30)
	for i := 0; i < 30; i++ {
		entries = append(entries, fmt.Sprintf(`{"text":%q,"kind":"fact"}`, strings.Repeat("x", 500)))
	}
	reply := `{"title":"t","facts":[` + strings.Join(entries, ",") + `]}`
	e := Coerce(reply, transcript("x"), cats)

	if len(e.Facts) != maxFacts {
		t.Fatalf("facts = %d, want the cap of %d", len(e.Facts), maxFacts)
	}
	for _, f := range e.Facts {
		if len(f.Text) != maxFactChars {
			t.Fatalf("fact text = %d chars, want the cap of %d", len(f.Text), maxFactChars)
		}
	}
}

func TestCoerceFactsDropsEmptyAndNonObjects(t *testing.T) {
	e := Coerce(`{"title":"t","facts":[{"text":"  "},null,42,"a bare string fact"]}`, transcript("x"), cats)
	if len(e.Facts) != 1 || e.Facts[0].Text != "a bare string fact" {
		t.Fatalf("facts = %+v", e.Facts)
	}
	if e.Facts[0].Kind != types.FactKindFact {
		t.Fatalf("a bare string must file as a plain fact, got %q", e.Facts[0].Kind)
	}
}

func TestCoerceFactsAbsentIsEmpty(t *testing.T) {
	e := Coerce(`{"title":"t"}`, transcript("x"), cats)
	if len(e.Facts) != 0 {
		t.Fatalf("facts = %+v, want none", e.Facts)
	}
	// It must also survive the round trip a recording row makes.
	raw, err := json.Marshal(e.Facts)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "null" {
		t.Fatalf("empty facts marshalled as %s", raw)
	}
}

func TestCoerceActionItemKinds(t *testing.T) {
	reply := `{"title":"t","actionItems":[
		{"text":"text Priya","kind":"message","owner":0},
		{"text":"pay the deposit","kind":"spend"},
		{"text":"sign the lease","kind":"file"},
		{"text":"call at 6","kind":"reminder"},
		{"text":"look into it","kind":"handwave"},
		{"text":"unclassified"}
	]}`
	e := Coerce(reply, transcript("x"), cats)

	want := []types.TaskKind{
		types.TaskKindMessage, types.TaskKindSpend, types.TaskKindFile,
		types.TaskKindReminder, types.TaskKindOther, types.TaskKindOther,
	}
	if len(e.ActionItems) != len(want) {
		t.Fatalf("action items = %d", len(e.ActionItems))
	}
	for i, kind := range want {
		if e.ActionItems[i].Kind != kind {
			t.Fatalf("item %d kind = %q, want %q", i, e.ActionItems[i].Kind, kind)
		}
	}
	if e.ActionItems[0].Owner == nil || *e.ActionItems[0].Owner != 0 {
		t.Fatalf("owner lost alongside the kind: %+v", e.ActionItems[0])
	}
}

func TestBestUtteranceFindsTheLine(t *testing.T) {
	utterances := []types.Utterance{
		{Speaker: 0, Text: "so anyway the weather has been terrible"},
		{Speaker: 1, Text: "I will send you the quarterly deck tonight after dinner"},
		{Speaker: 0, Text: "great, thanks"},
	}
	if got := BestUtterance("send the quarterly deck tonight", utterances); got != 1 {
		t.Fatalf("BestUtterance = %d, want 1", got)
	}
}

// A wrong jump is worse than none: below the threshold the task simply carries
// no utterance.
func TestBestUtteranceRefusesAWeakMatch(t *testing.T) {
	utterances := []types.Utterance{
		{Speaker: 0, Text: "I will get back to you"},
		{Speaker: 1, Text: "sounds good"},
	}
	if got := BestUtterance("book the flights to Bangalore and confirm the hotel", utterances); got != -1 {
		t.Fatalf("BestUtterance = %d, want -1", got)
	}
}

// "I will send it to you" against "I will get back to you" otherwise scores
// well on the words that carry none of the meaning.
func TestBestUtteranceIgnoresStopWords(t *testing.T) {
	utterances := []types.Utterance{
		// Shares five words with the item, all of them stop words.
		{Speaker: 0, Text: "will you, and then it is that they were, to them"},
		{Speaker: 1, Text: "the deck, I'll send it over"},
	}
	if got := BestUtterance("will you send the deck to them", utterances); got != 1 {
		t.Fatalf("BestUtterance = %d, want 1 — stop words alone must not win", got)
	}
}

func TestBestUtteranceEmptyInputs(t *testing.T) {
	if got := BestUtterance("", []types.Utterance{{Text: "hello"}}); got != -1 {
		t.Fatalf("empty text = %d, want -1", got)
	}
	if got := BestUtterance("send the deck", nil); got != -1 {
		t.Fatalf("no utterances = %d, want -1", got)
	}
}
