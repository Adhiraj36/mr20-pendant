package apply

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestValidateAllAppliesOnlyWhenEveryFileIsGood(t *testing.T) {
	corrections := []byte(`[{"i": 0, "text": "fixed"}]`)
	tasks := []byte(`[{"text": "call the vet", "owner": 0, "kind": "message"}]`)
	memories := []byte(`[{"text": "wants a vet appointment", "kind": "fact"}]`)
	summary := []byte(`{"title": "Standup with Ravi", "tags": ["work"], "summary": "x", "category": "Work"}`)
	speakers := []byte(`[{"speaker": 0, "label": "Ravi", "description": "Addressed as Ravi; runs the standup."}]`)

	out, err := ValidateAll(corrections, tasks, memories, summary, speakers, 2, twoSpeakers)
	if err != nil {
		t.Fatalf("valid files must not fail: %v", err)
	}
	if len(out.Corrections) != 1 || len(out.Tasks) != 1 || len(out.Memories) != 1 {
		t.Fatalf("got %+v", out)
	}
	if out.Summary.Title != "Standup with Ravi" || out.Summary.Category != "Work" {
		t.Fatalf("got %+v", out.Summary)
	}
	if got := out.Speakers["0"]; got.Label != "Ravi" || got.Description != "Addressed as Ravi; runs the standup." {
		t.Fatalf("speakers = %+v", out.Speakers)
	}
}

// twoSpeakers is the speaker set a two-voice transcript yields from
// SpeakerIndices — what every ValidateAll call here stands in for.
var twoSpeakers = map[int]bool{0: true, 1: true}

func TestSpeakerIndicesIsTheSetTheTranscriptUses(t *testing.T) {
	tr := &types.Transcript{Utterances: []types.Utterance{{Speaker: 0}, {Speaker: 2}, {Speaker: 0}}}
	got := SpeakerIndices(tr)
	if len(got) != 2 || !got[0] || !got[2] || got[1] {
		t.Fatalf("SpeakerIndices = %v, want {0, 2}: not a count, the diarizer's numbering need not be contiguous", got)
	}
}

func TestAMissingSpeakersFileFailsCleanly(t *testing.T) {
	_, err := ValidateAll([]byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{"title": "x"}`), nil, 2, twoSpeakers)
	if err == nil || !strings.Contains(err.Error(), "speakers.json is missing") {
		t.Fatalf("err = %v, want speakers.json missing", err)
	}
}

func TestSpeakersRejectsAnIndexTheTranscriptNeverHad(t *testing.T) {
	_, err := ValidateSpeakers([]byte(`[{"speaker": 3, "label": "Doctor"}]`), twoSpeakers)
	if err == nil || !strings.Contains(err.Error(), "speaker=3") {
		t.Fatalf("err = %v, want it to name the unknown index", err)
	}
}

func TestSpeakersRejectsADuplicateIndex(t *testing.T) {
	_, err := ValidateSpeakers([]byte(`[{"speaker": 0, "label": "Doctor"}, {"speaker": 0, "label": "Nurse"}]`), twoSpeakers)
	if err == nil || !strings.Contains(err.Error(), "listed twice") {
		t.Fatalf("err = %v, want a duplicate to fail the file", err)
	}
}

func TestSpeakersRejectsABlankLabelAndANonStringDescription(t *testing.T) {
	if _, err := ValidateSpeakers([]byte(`[{"speaker": 0, "label": "  "}]`), twoSpeakers); err == nil {
		t.Fatal("a blank label must fail — the app would show nothing in place of Speaker N")
	}
	if _, err := ValidateSpeakers([]byte(`[{"speaker": 0, "label": "Doctor", "description": 3}]`), twoSpeakers); err == nil {
		t.Fatal("a non-string description must fail, matching schemas.py")
	}
}

func TestSpeakersAllowsAnOmittedVoiceAndAnAbsentDescription(t *testing.T) {
	got, err := ValidateSpeakers([]byte(`[{"speaker": 1, "label": "Auto driver"}]`), twoSpeakers)
	if err != nil {
		t.Fatalf("leaving speaker 0 out is not an error, and description is optional: %v", err)
	}
	if len(got) != 1 || got["1"].Label != "Auto driver" || got["1"].Description != "" {
		t.Fatalf("got %+v", got)
	}
	if _, ok := got["0"]; ok {
		t.Fatal("an omitted voice must not be invented")
	}
}

func TestSpeakersCapsLabelAndDescription(t *testing.T) {
	long := strings.Repeat("x", 500)
	got, err := ValidateSpeakers([]byte(`[{"speaker": 0, "label": "`+long+`", "description": "`+long+`"}]`), twoSpeakers)
	if err != nil {
		t.Fatal(err)
	}
	if utf8.RuneCountInString(got["0"].Label) != maxSpeakerLabelChars || utf8.RuneCountInString(got["0"].Description) != maxSpeakerDescriptionChars {
		t.Fatalf("label=%d description=%d runes, want %d and %d",
			len(got["0"].Label), len(got["0"].Description), maxSpeakerLabelChars, maxSpeakerDescriptionChars)
	}
}

func TestPatchStoresProfilesBesideTheUsersOwnNames(t *testing.T) {
	profiles := map[string]types.SpeakerProfile{"0": {Label: "Doctor"}}
	patch := Patch(Result{Title: "x", Speakers: profiles})
	if _, ok := patch["speakers"]; ok {
		t.Fatal("Patch must never write speakers — that map is the user's own, and the only one memory is re-filed with")
	}
	if got, ok := patch["speakerProfiles"].(map[string]types.SpeakerProfile); !ok || got["0"].Label != "Doctor" {
		t.Fatalf("speakerProfiles = %#v", patch["speakerProfiles"])
	}
	if _, ok := Patch(Result{Title: "x"})["speakerProfiles"]; ok {
		t.Fatal("an empty profile set must be left out, so an earlier run's profiles survive a fallback that produced none")
	}
}

func TestMalformedCorrectionsFailsTheWholeFile(t *testing.T) {
	_, err := ValidateAll([]byte(`not json`), []byte(`[]`), []byte(`[]`), []byte(`{"title": "x"}`), []byte(`[]`), 2, twoSpeakers)
	if err == nil || !strings.Contains(err.Error(), "corrections.json") {
		t.Fatalf("err = %v, want it to name corrections.json", err)
	}
}

func TestAMissingFileFailsCleanly(t *testing.T) {
	_, err := ValidateAll([]byte(`[]`), nil, []byte(`[]`), []byte(`{"title": "x"}`), []byte(`[]`), 2, twoSpeakers)
	if err == nil || !strings.Contains(err.Error(), "tasks.json is missing") {
		t.Fatalf("err = %v, want tasks.json missing", err)
	}
}

func TestAPartiallyWrittenMemoriesFileFailsCleanly(t *testing.T) {
	memories := []byte(`[{"text": "a real fact", "kind": "fact"}, {"text": "bad", "kind": "opinion"}]`)
	_, err := ValidateAll([]byte(`[]`), []byte(`[]`), memories, []byte(`{"title": "x"}`), []byte(`[]`), 2, twoSpeakers)
	if err == nil || !strings.Contains(err.Error(), "memories.json") {
		t.Fatalf("err = %v, want it to name memories.json", err)
	}
}

func TestAnAgentRunThatWroteNothingFailsOnTheFirstMissingFile(t *testing.T) {
	_, err := ValidateAll(nil, nil, nil, nil, nil, 2, twoSpeakers)
	if err == nil || !strings.Contains(err.Error(), "corrections.json is missing") {
		t.Fatalf("err = %v", err)
	}
}

func TestAMissingSummaryFailsCleanly(t *testing.T) {
	_, err := ValidateAll([]byte(`[]`), []byte(`[]`), []byte(`[]`), nil, []byte(`[]`), 2, twoSpeakers)
	if err == nil || !strings.Contains(err.Error(), "summary.json is missing") {
		t.Fatalf("err = %v, want summary.json missing", err)
	}
}

func TestCorrectionsRejectsAnOutOfRangeIndex(t *testing.T) {
	_, err := ValidateCorrections([]byte(`[{"i": 5, "text": "x"}]`), 2)
	if err == nil {
		t.Fatal("an index past the transcript's own length must fail")
	}
}

func TestEmptyArraysAreValid(t *testing.T) {
	out, err := ValidateAll([]byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{"title": "x"}`), []byte(`[]`), 2, twoSpeakers)
	if err != nil {
		t.Fatalf("three empty arrays and a bare title must validate: %v", err)
	}
	if len(out.Tasks) != 0 || len(out.Memories) != 0 || len(out.Corrections) != 0 {
		t.Fatalf("want three empty results, got %+v", out)
	}
}

func TestTasksRejectsAnInventedKind(t *testing.T) {
	_, err := ValidateTasks([]byte(`[{"text": "call the vet", "kind": "urgent"}]`))
	if err == nil {
		t.Fatal("an unrecognised kind must fail validation, not default silently")
	}
}

func TestSummaryRequiresANonEmptyTitle(t *testing.T) {
	// A blank title was exactly the regression summary.json exists to fix.
	_, err := ValidateSummary([]byte(`{"tags": []}`))
	if err == nil {
		t.Fatal("a summary.json with no title must fail validation")
	}
}

func TestSummaryAllowsANullCategory(t *testing.T) {
	out, err := ValidateSummary([]byte(`{"title": "Something happened", "category": null}`))
	if err != nil {
		t.Fatalf("a null category must be allowed: %v", err)
	}
	if out.Category != "" {
		t.Fatalf("category = %q, want empty", out.Category)
	}
}

func TestSummaryDoesNotRejectACategoryItHasNeverSeen(t *testing.T) {
	// Membership in the list the agent was offered is enrich.ResolveCategory's
	// job on the Go side (Task 9) — ValidateSummary only checks the type.
	out, err := ValidateSummary([]byte(`{"title": "x", "category": "Something Invented"}`))
	if err != nil {
		t.Fatalf("an unrecognised category name must not fail validation here: %v", err)
	}
	if out.Category != "Something Invented" {
		t.Fatalf("got %q", out.Category)
	}
}

func TestSummaryIsAnObjectNotAnArray(t *testing.T) {
	_, err := ValidateSummary([]byte(`[{"title": "x"}]`))
	if err == nil {
		t.Fatal("summary.json is a single object; an array must fail")
	}
}

func TestSummaryTagsAreCappedAtFiveAndLowercased(t *testing.T) {
	out, err := ValidateSummary([]byte(`{"title": "x", "tags": ["A", "B", "C", "D", "E", "F"]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"a", "b", "c", "d", "e"}
	if len(out.Tags) != len(want) {
		t.Fatalf("tags = %v, want %v", out.Tags, want)
	}
	for i := range want {
		if out.Tags[i] != want[i] {
			t.Fatalf("tags = %v, want %v", out.Tags, want)
		}
	}
}

// TestTruncateNeverSplitsARune is C2: a byte-based cap on non-ASCII text can
// cut in the middle of a multi-byte rune, producing invalid UTF-8 that
// still reaches DynamoDB (attributevalue.Marshal does not check) and then
// GitLoom, which has no delete or supersede to undo it. 200 runes of
// Devanagari is 600 bytes; truncate(s, 200) must keep all 200 runes, not
// stop 200 bytes in — the verified regression on the old byte-slice
// implementation was 68 runes / 200 bytes, and utf8.ValidString false on
// the result.
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
// partial one.
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

// TestTruncateStillCapsPlainASCIIByCharacterCount guards the case truncate
// already got right: byte and rune counts agree for ASCII, so this must
// keep behaving exactly as it did before.
func TestTruncateStillCapsPlainASCIIByCharacterCount(t *testing.T) {
	if got := truncate("hello world", 5); got != "hello" {
		t.Fatalf("truncate(%q, 5) = %q, want %q", "hello world", got, "hello")
	}
	if got := truncate("hi", 5); got != "hi" {
		t.Fatalf("truncate(%q, 5) = %q, want it unchanged", "hi", got)
	}
}

// TestValidatorsMatchPythonOnKnownDivergences is I1: a table of the exact
// cases internal/apply/validate.go and backend/extract/schemas.py used to
// disagree on. Each must now behave the way schemas.py already does.
func TestValidatorsMatchPythonOnKnownDivergences(t *testing.T) {
	cases := []struct {
		name    string
		wantErr bool
		run     func() error
	}{
		{
			name:    "a non-string 6th tag must not fail — python slices tags[:5] before type-checking",
			wantErr: false,
			run: func() error {
				_, err := ValidateSummary([]byte(`{"title": "x", "tags": ["a", "b", "c", "d", "e", 3]}`))
				return err
			},
		},
		{
			name:    "a non-string tag within the first five must fail",
			wantErr: true,
			run: func() error {
				_, err := ValidateSummary([]byte(`{"title": "x", "tags": ["a", 3]}`))
				return err
			},
		},
		{
			name:    "top-level null corrections.json must fail, not decode to zero rows",
			wantErr: true,
			run: func() error {
				_, err := ValidateCorrections([]byte(`null`), 5)
				return err
			},
		},
		{
			name:    "top-level null tasks.json must fail, not decode to zero rows",
			wantErr: true,
			run: func() error {
				_, err := ValidateTasks([]byte(`null`))
				return err
			},
		},
		{
			name:    "top-level null memories.json must fail, not decode to zero rows",
			wantErr: true,
			run: func() error {
				_, err := ValidateMemories([]byte(`null`))
				return err
			},
		},
		{
			name:    "top-level null speakers.json must fail, not decode to zero rows",
			wantErr: true,
			run: func() error {
				_, err := ValidateSpeakers([]byte(`null`), map[int]bool{0: true})
				return err
			},
		},
		{
			name:    "speaker index 1.0 must fail — python's isinstance(int) rejects a float literal",
			wantErr: true,
			run: func() error {
				_, err := ValidateSpeakers([]byte(`[{"speaker": 0.0, "label": "Doctor"}]`), map[int]bool{0: true})
				return err
			},
		},
		{
			name:    "a null entry inside a tasks array must fail",
			wantErr: true,
			run: func() error {
				_, err := ValidateTasks([]byte(`[null]`))
				return err
			},
		},
		{
			name:    `task kind: null must fail, not default to "other"`,
			wantErr: true,
			run: func() error {
				_, err := ValidateTasks([]byte(`[{"text": "call the vet", "kind": null}]`))
				return err
			},
		},
		{
			name:    `task kind: "" must fail, not default to "other"`,
			wantErr: true,
			run: func() error {
				_, err := ValidateTasks([]byte(`[{"text": "call the vet", "kind": ""}]`))
				return err
			},
		},
		{
			name:    `an absent task kind must still default to "other"`,
			wantErr: false,
			run: func() error {
				_, err := ValidateTasks([]byte(`[{"text": "call the vet"}]`))
				return err
			},
		},
		{
			name:    `memory kind: null must fail, not default to "fact"`,
			wantErr: true,
			run: func() error {
				_, err := ValidateMemories([]byte(`[{"text": "wants a vet appointment", "kind": null}]`))
				return err
			},
		},
		{
			name:    `memory kind: "" must fail, not default to "fact"`,
			wantErr: true,
			run: func() error {
				_, err := ValidateMemories([]byte(`[{"text": "wants a vet appointment", "kind": ""}]`))
				return err
			},
		},
		{
			name:    `an absent memory kind must still default to "fact"`,
			wantErr: false,
			run: func() error {
				_, err := ValidateMemories([]byte(`[{"text": "wants a vet appointment"}]`))
				return err
			},
		},
		{
			name:    "summary tags: null must fail, not become an empty list",
			wantErr: true,
			run: func() error {
				_, err := ValidateSummary([]byte(`{"title": "x", "tags": null}`))
				return err
			},
		},
		{
			name:    "summary tags: [null] must fail",
			wantErr: true,
			run: func() error {
				_, err := ValidateSummary([]byte(`{"title": "x", "tags": [null]}`))
				return err
			},
		},
		{
			name:    "summary.summary: null must fail, not become empty",
			wantErr: true,
			run: func() error {
				_, err := ValidateSummary([]byte(`{"title": "x", "summary": null}`))
				return err
			},
		},
		{
			name:    "an absent summary must still default to empty",
			wantErr: false,
			run: func() error {
				_, err := ValidateSummary([]byte(`{"title": "x"}`))
				return err
			},
		},
		{
			name:    "corrections i: 1e0 must fail — a float literal, not a JSON integer",
			wantErr: true,
			run: func() error {
				_, err := ValidateCorrections([]byte(`[{"i": 1e0, "text": "x"}]`), 5)
				return err
			},
		},
		{
			name:    "corrections i: 1.0 must fail for the same reason",
			wantErr: true,
			run: func() error {
				_, err := ValidateCorrections([]byte(`[{"i": 1.0, "text": "x"}]`), 5)
				return err
			},
		},
		{
			name:    "corrections i: 1 (a genuine JSON integer) must still pass",
			wantErr: false,
			run: func() error {
				_, err := ValidateCorrections([]byte(`[{"i": 1, "text": "x"}]`), 5)
				return err
			},
		},
		{
			name:    "task owner: 1e0 must fail for the same reason as corrections' i",
			wantErr: true,
			run: func() error {
				_, err := ValidateTasks([]byte(`[{"text": "x", "owner": 1e0}]`))
				return err
			},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.run()
			if c.wantErr && err == nil {
				t.Fatal("want an error, got nil")
			}
			if !c.wantErr && err != nil {
				t.Fatalf("want no error, got %v", err)
			}
		})
	}
}
