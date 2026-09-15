package enrich

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

var cats = []types.Category{
	{ID: "work", Name: "Work"},
	{ID: "health", Name: "Health"},
	{ID: "cat-x1y2", Name: "Side Projects"},
}

func transcript(text string) *types.Transcript {
	return &types.Transcript{Text: text, Utterances: []types.Utterance{{Speaker: 0, Text: text}}}
}

func TestCoerceFencedJSON(t *testing.T) {
	reply := "Here you go:\n```json\n{\"title\":\"Standup planning for the sprint\",\"tags\":[\"standup\",\"SPRINT\"],\"summary\":\"Planned it.\",\"actionItems\":[{\"text\":\"send notes\",\"owner\":1}],\"category\":\"work\"}\n```"
	e := Coerce(reply, transcript("we planned the sprint"), cats)

	if e.Title != "Standup planning for the sprint" {
		t.Fatalf("title = %q", e.Title)
	}
	if len(e.Tags) != 2 || e.Tags[1] != "sprint" {
		t.Fatalf("tags not lowercased/kept: %v", e.Tags)
	}
	if len(e.ActionItems) != 1 || e.ActionItems[0].Owner == nil || *e.ActionItems[0].Owner != 1 {
		t.Fatalf("action items wrong: %+v", e.ActionItems)
	}
	// Case-insensitive name -> id mapping.
	if e.CategoryID != "work" {
		t.Fatalf("categoryId = %q", e.CategoryID)
	}
}

func TestCoerceMultiWordCategoryName(t *testing.T) {
	e := Coerce(`{"title":"t","category":"side projects"}`, transcript("x"), cats)
	if e.CategoryID != "cat-x1y2" {
		t.Fatalf("categoryId = %q, want the minted id, not the name", e.CategoryID)
	}
}

func TestCoerceHallucinatedCategoryDropped(t *testing.T) {
	e := Coerce(`{"title":"t","category":"Finance"}`, transcript("x"), cats)
	if e.CategoryID != "" {
		t.Fatalf("hallucinated category must resolve to empty, got %q", e.CategoryID)
	}
}

func TestCoerceNullCategory(t *testing.T) {
	e := Coerce(`{"title":"t","category":null}`, transcript("x"), cats)
	if e.CategoryID != "" {
		t.Fatalf("null category must resolve to empty, got %q", e.CategoryID)
	}
}

func TestCoerceGarbageFallsBack(t *testing.T) {
	tr := transcript("the opening words of the conversation carry the topic")
	e := Coerce("I could not possibly summarise that.", tr, cats)
	if e.Title == "" || e.CategoryID != "" {
		t.Fatalf("fallback broken: %+v", e)
	}
}

func TestResolveCategoryNonString(t *testing.T) {
	if got := ResolveCategory(42, cats); got != "" {
		t.Fatalf("non-string category must resolve to empty, got %q", got)
	}
}

// TestTruncateNeverSplitsARune is C2's counterpart for the Bedrock fallback
// path: enrich.go's own truncate had the identical byte-slice bug as
// internal/apply's — a plain s[:n] can stop mid-codepoint on non-ASCII
// text. runFallback (cmd/apply) reaches this exact function via
// enrich.Enrich for title/tags/summary and enrich.CoerceFactKind's callers
// for facts text, so a Devanagari-heavy fallback run was exactly as capable
// of writing invalid UTF-8 to DynamoDB as the extracted path was.
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

func TestTruncateStillCapsPlainASCIIByCharacterCount(t *testing.T) {
	if got := truncate("hello world", 5); got != "hello" {
		t.Fatalf("truncate(%q, 5) = %q, want %q", "hello world", got, "hello")
	}
}

func TestCoerceSpeakersKeepsOnlyVoicesTheTranscriptHas(t *testing.T) {
	tr := &types.Transcript{Text: "hi", Utterances: []types.Utterance{{Speaker: 0, Text: "hi"}, {Speaker: 1, Text: "hello"}}}
	reply := `{"title": "Clinic visit", "speakers": [
		{"speaker": 0, "label": "Doctor", "description": "Asked about the cough."},
		{"speaker": 1, "label": "  Likely the wearer  "},
		{"speaker": 1, "label": "Duplicate"},
		{"speaker": 7, "label": "Ghost"},
		{"speaker": 0.5, "label": "Half"},
		{"speaker": 1, "label": "   "},
		"not an object"
	]}`
	out := Coerce(reply, tr, nil)
	if len(out.Speakers) != 2 {
		t.Fatalf("speakers = %+v, want exactly the two real voices", out.Speakers)
	}
	if out.Speakers["0"].Label != "Doctor" || out.Speakers["0"].Description != "Asked about the cough." {
		t.Fatalf("speaker 0 = %+v", out.Speakers["0"])
	}
	if out.Speakers["1"].Label != "Likely the wearer" || out.Speakers["1"].Description != "" {
		t.Fatalf("speaker 1 = %+v — first entry wins, trimmed, description optional", out.Speakers["1"])
	}
}

func TestCoerceSpeakersAbsentIsNil(t *testing.T) {
	tr := &types.Transcript{Text: "hi", Utterances: []types.Utterance{{Speaker: 0, Text: "hi"}}}
	if out := Coerce(`{"title": "x"}`, tr, nil); out.Speakers != nil {
		t.Fatalf("speakers = %+v, want nil so Patch leaves speakerProfiles alone", out.Speakers)
	}
}
