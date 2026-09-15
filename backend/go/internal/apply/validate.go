// Package apply validates and applies what the extraction agent wrote, and
// holds the parts of the Bedrock fallback's output that need identical
// treatment — the same four-file shape, whichever path produced it.
package apply

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// SummaryFile is what summary.json decodes to. Category is the agent's
// chosen *name*, unresolved — an id needs the caller's live category list,
// which this package does not read; ApplyFn (Task 9) resolves it via the
// existing enrich.ResolveCategory, exactly as the Bedrock fallback already
// does. "" means no category, whether the agent said null or ApplyFn later
// fails to resolve the name — the same outcome ResolveCategory already
// gives an invented name.
type SummaryFile struct {
	Title    string
	Tags     []string
	Summary  string
	Category string
}

// Outcome is what a fully-valid set of extraction files decodes to.
type Outcome struct {
	Corrections []map[string]any
	Tasks       []types.ActionItem
	Memories    []types.Fact
	Summary     SummaryFile
	// Speakers is keyed by diarizer index as a decimal string, the shape
	// Recording.SpeakerProfiles stores.
	Speakers map[string]types.SpeakerProfile
}

// SpeakerIndices is the set of diarizer indices a transcript actually
// uses — the only indices speakers.json may describe. Deepgram numbers
// speakers from 0, but nothing guarantees the set is contiguous, so this is
// a set rather than a count.
func SpeakerIndices(t *types.Transcript) map[int]bool {
	seen := map[int]bool{}
	for _, u := range t.Utterances {
		seen[u.Speaker] = true
	}
	return seen
}

// ValidateAll checks all five files together and fails on the first
// problem, naming which file and why. Deliberately all-or-nothing: applying
// four good files and skipping a fifth bad one would leave a recording in
// a state nothing produced on purpose, so ApplyFn treats any error here as
// "run the fallback instead," never "apply what validated."
//
// A nil slice means the file was not found in S3 — the agent never wrote
// it, or ExtractFn never got far enough to upload it.
func ValidateAll(corrections, tasks, memories, summary, speakers []byte, utteranceCount int, speakerIndices map[int]bool) (Outcome, error) {
	if corrections == nil {
		return Outcome{}, fmt.Errorf("corrections.json is missing")
	}
	c, err := ValidateCorrections(corrections, utteranceCount)
	if err != nil {
		return Outcome{}, fmt.Errorf("corrections.json: %w", err)
	}
	if tasks == nil {
		return Outcome{}, fmt.Errorf("tasks.json is missing")
	}
	t, err := ValidateTasks(tasks)
	if err != nil {
		return Outcome{}, fmt.Errorf("tasks.json: %w", err)
	}
	if memories == nil {
		return Outcome{}, fmt.Errorf("memories.json is missing")
	}
	m, err := ValidateMemories(memories)
	if err != nil {
		return Outcome{}, fmt.Errorf("memories.json: %w", err)
	}
	if summary == nil {
		return Outcome{}, fmt.Errorf("summary.json is missing")
	}
	s, err := ValidateSummary(summary)
	if err != nil {
		return Outcome{}, fmt.Errorf("summary.json: %w", err)
	}
	if speakers == nil {
		return Outcome{}, fmt.Errorf("speakers.json is missing")
	}
	sp, err := ValidateSpeakers(speakers, speakerIndices)
	if err != nil {
		return Outcome{}, fmt.Errorf("speakers.json: %w", err)
	}
	return Outcome{Corrections: c, Tasks: t, Memories: m, Summary: s, Speakers: sp}, nil
}

// decodeObjectArray unmarshals raw into a slice of JSON objects, rejecting
// anything that is not a JSON array of objects at the top level —
// including a literal `null`, which Go's usual `json.Unmarshal(raw,
// &[]T{})` would otherwise silently accept as a zero-length slice with no
// error ("The JSON null value unmarshals into ... a slice by setting it to
// nil" — encoding/json's own doc). schemas.py's validators go through
// `json.loads` and then `isinstance(data, list)`, which raises on a bare
// `null` the same as on any other non-array value; without this check a
// throttled or crashed extraction agent's `null` would read here as "zero
// rows, no error" instead of "malformed, fall back to Bedrock" — silently
// reaching `ready` with nothing to show for it. The same reasoning applies
// one level down: a `null` entry inside an otherwise-fine array (`[null]`)
// unmarshals into a nil map with no error too, where Python's own
// `isinstance(entry, dict)` check rejects it — so that is rejected here as
// well.
func decodeObjectArray(raw []byte) ([]map[string]json.RawMessage, error) {
	var probe any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, fmt.Errorf("not valid JSON: %w", err)
	}
	if _, ok := probe.([]any); !ok {
		return nil, fmt.Errorf("expected a JSON array at the top level")
	}
	var data []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("not a JSON array of objects: %w", err)
	}
	for _, entry := range data {
		if entry == nil {
			return nil, fmt.Errorf("every entry must be an object")
		}
	}
	return data, nil
}

// isJSONNull reports whether a field's raw JSON text is the literal `null`,
// as opposed to the field being entirely absent (raw == nil, from a map
// lookup that found nothing) or holding some other value. The distinction
// matters because Python's own dict.get(key, default) only ever supplies
// the default when the key is missing outright — a key present with an
// explicit null gets None back, not the default — and several of these
// validators (kind, tags, summary) need that same distinction to match.
func isJSONNull(raw json.RawMessage) bool {
	return raw != nil && strings.TrimSpace(string(raw)) == "null"
}

// isJSONInt reports whether raw is a JSON integer literal: no decimal
// point, no exponent. encoding/json throws this distinction away the
// moment a number reaches interface{} as float64 — 1, 1.0 and 1e0 all
// decode to the identical float64(1) — but Python's json module keeps it at
// parse time (a literal with a "." or "e"/"E" parses as float, otherwise as
// int), and schemas.py's `isinstance(i, int)` checks reject the float
// forms. Matching that here means reading the literal text, not the
// decoded value.
func isJSONInt(raw json.RawMessage) (int, bool) {
	s := strings.TrimSpace(string(raw))
	if s == "" || strings.ContainsAny(s, ".eE") {
		return 0, false
	}
	var n json.Number = json.Number(s)
	i64, err := n.Int64()
	if err != nil {
		return 0, false
	}
	return int(i64), true
}

// requiredNonEmptyString reads key from entry the way every text field here
// is required: present or not, null or a real string, the only thing that
// passes is a non-blank string once trimmed — matching
// `text.strip()` / `not text.strip()` on the Python side, where None (absent
// or explicit null), "", and "   " all fail identically.
func requiredNonEmptyString(entry map[string]json.RawMessage, key string) (string, error) {
	raw, present := entry[key]
	var s string
	if present && !isJSONNull(raw) {
		if err := json.Unmarshal(raw, &s); err != nil {
			return "", fmt.Errorf("entry missing non-empty %s", key)
		}
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("entry missing non-empty %s", key)
	}
	return s, nil
}

// stringWithDefault mirrors Python's `entry.get(key, default)` exactly: the
// default is used only when key is absent from entry altogether. A key
// present with an explicit null, an empty string, or some other JSON type
// all come back as a real (if invalid) value instead of silently becoming
// the default — the same as `entry.get("kind", "other")` answering None or
// "" rather than "other" when "kind" is present with those values. Without
// this, "kind": null and "kind": "" both defaulted here (a plain string
// field can't tell "absent" from "present but null", and an empty string
// unmarshals from either with no error), while schemas.py rejects both:
// its own default only ever fires when the key is missing.
func stringWithDefault(entry map[string]json.RawMessage, key, def string) (string, error) {
	raw, present := entry[key]
	if !present {
		return def, nil
	}
	var s string
	if !isJSONNull(raw) {
		if err := json.Unmarshal(raw, &s); err != nil {
			return "", fmt.Errorf("%s must be a string", key)
		}
	}
	return s, nil
}

// optionalInt reads an integer-or-null field the way Python's
// `owner = entry.get("owner")` does: absent and explicit null both mean
// "no owner", anything else must be a genuine JSON integer literal (never a
// float like 5.0, and never a bool — Python's own
// `not isinstance(owner, int) or isinstance(owner, bool)` guards against
// both).
func optionalInt(entry map[string]json.RawMessage, key string) (*int, error) {
	raw, present := entry[key]
	if !present || isJSONNull(raw) {
		return nil, nil
	}
	n, ok := isJSONInt(raw)
	if !ok {
		return nil, fmt.Errorf("%s must be an integer or null", key)
	}
	return &n, nil
}

// ValidateCorrections checks the same shape ApplyCorrections has always
// accepted (internal/enrich/merge.go:68). Strict, unlike ApplyCorrections
// itself — that function silently skips a bad entry because it is reading a
// Bedrock reply it cannot ask to try again; this is reading a file the
// agent was told to re-read and fix, so one bad entry means the whole file
// is not trustworthy.
func ValidateCorrections(raw []byte, utteranceCount int) ([]map[string]any, error) {
	entries, err := decodeObjectArray(raw)
	if err != nil {
		return nil, err
	}
	data := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		idxRaw, ok := entry["i"]
		if !ok {
			return nil, fmt.Errorf("entry missing i")
		}
		idx, ok := isJSONInt(idxRaw)
		if !ok {
			return nil, fmt.Errorf("i must be an integer")
		}
		text, err := requiredNonEmptyString(entry, "text")
		if err != nil {
			return nil, err
		}
		if idx < 0 || idx >= utteranceCount {
			return nil, fmt.Errorf("i=%d is out of range for %d utterances", idx, utteranceCount)
		}
		// Rebuilt minimal, not the raw decoded entry: ApplyCorrections
		// (internal/enrich/merge.go) only ever reads "i" (as float64 — the
		// shape every caller, including the Bedrock reply path, already
		// hands it) and "text", and schemas.py's own validate_corrections
		// builds the same minimal {"i", "text"} pair rather than passing
		// extra agent-supplied keys through.
		data = append(data, map[string]any{"i": float64(idx), "text": text})
	}
	return data, nil
}

// ValidateTasks checks tasks.json strictly: an unrecognised, missing, null
// or empty kind all fail validation here, rather than defaulting the way
// enrich.CoerceTaskKind does for a Bedrock reply it cannot ask to correct.
// The default of "other" applies only when the agent left "kind" out of the
// object entirely — present-but-null and present-but-empty are real (bad)
// values, not omissions, matching schemas.py's validate_tasks.
func ValidateTasks(raw []byte) ([]types.ActionItem, error) {
	entries, err := decodeObjectArray(raw)
	if err != nil {
		return nil, err
	}
	items := make([]types.ActionItem, 0, len(entries))
	for _, entry := range entries {
		text, err := requiredNonEmptyString(entry, "text")
		if err != nil {
			return nil, err
		}
		owner, err := optionalInt(entry, "owner")
		if err != nil {
			return nil, err
		}
		kind, err := stringWithDefault(entry, "kind", string(types.TaskKindOther))
		if err != nil {
			return nil, err
		}
		if !validTaskKind(kind) {
			return nil, fmt.Errorf("kind %q is not one of %v", kind, types.TaskKinds)
		}
		items = append(items, types.ActionItem{
			Text: truncate(text, 400), Owner: owner, Kind: types.TaskKind(kind),
		})
	}
	return items, nil
}

func validTaskKind(k string) bool {
	for _, v := range types.TaskKinds {
		if string(v) == k {
			return true
		}
	}
	return false
}

// ValidateMemories checks memories.json strictly, the same way ValidateTasks
// does — see its doc comment for why an absent kind defaults but a null or
// empty one does not.
func ValidateMemories(raw []byte) ([]types.Fact, error) {
	entries, err := decodeObjectArray(raw)
	if err != nil {
		return nil, err
	}
	facts := make([]types.Fact, 0, len(entries))
	for _, entry := range entries {
		text, err := requiredNonEmptyString(entry, "text")
		if err != nil {
			return nil, err
		}
		kind, err := stringWithDefault(entry, "kind", string(types.FactKindFact))
		if err != nil {
			return nil, err
		}
		if !validFactKind(kind) {
			return nil, fmt.Errorf("kind %q is not one of %v", kind, types.FactKinds)
		}
		facts = append(facts, types.Fact{Text: truncate(text, 200), Kind: types.FactKind(kind)})
	}
	return facts, nil
}

func validFactKind(k string) bool {
	for _, v := range types.FactKinds {
		if string(v) == k {
			return true
		}
	}
	return false
}

// Caps on one speaker profile. The label cap is the same 80 characters the
// API's own speaker rename (internal/api/recordings.go patchRecording)
// allows, since the app shows the two in the same place.
const (
	maxSpeakerLabelChars       = 80
	maxSpeakerDescriptionChars = 200
)

// ValidateSpeakers checks speakers.json: a JSON array of {"speaker": <index>,
// "label": str, "description": str}, one entry per diarizer index. Strict
// like the others: an index the transcript never used, a duplicate index, a
// blank label, or a non-string description fails the whole file. A speaker
// the agent left out is not an error — the app falls back to "Speaker N"
// for it, exactly as it does for an unnamed index today.
//
// The result is keyed by the index as a decimal string, ready to store as
// Recording.SpeakerProfiles.
func ValidateSpeakers(raw []byte, known map[int]bool) (map[string]types.SpeakerProfile, error) {
	entries, err := decodeObjectArray(raw)
	if err != nil {
		return nil, err
	}
	profiles := make(map[string]types.SpeakerProfile, len(entries))
	for _, entry := range entries {
		idxRaw, ok := entry["speaker"]
		if !ok {
			return nil, fmt.Errorf("entry missing speaker")
		}
		idx, ok := isJSONInt(idxRaw)
		if !ok {
			return nil, fmt.Errorf("speaker must be an integer")
		}
		if idx < 0 || !known[idx] {
			return nil, fmt.Errorf("speaker=%d is not a speaker in this transcript", idx)
		}
		key := strconv.Itoa(idx)
		if _, dup := profiles[key]; dup {
			return nil, fmt.Errorf("speaker=%d is listed twice", idx)
		}
		label, err := requiredNonEmptyString(entry, "label")
		if err != nil {
			return nil, err
		}
		description, err := stringWithDefault(entry, "description", "")
		if err != nil {
			return nil, err
		}
		profiles[key] = types.SpeakerProfile{
			Label:       truncate(label, maxSpeakerLabelChars),
			Description: truncate(strings.TrimSpace(description), maxSpeakerDescriptionChars),
		}
	}
	return profiles, nil
}

// ValidateSummary checks summary.json: a single object, not an array. Field
// names, types and caps are copied from enrich.go's own Coerce
// (internal/enrich/enrich.go:229-261) exactly, so ApplyFn writes into the
// same Recording fields the app already reads. title is the one field
// required non-empty — a blank title was exactly the regression this file
// exists to fix. category is checked only for type here, never for
// membership in any particular list: SummaryFile's own doc comment explains
// why that check belongs to enrich.ResolveCategory, not here.
//
// Every field is read through the same present/null-aware lookup schemas.py
// gets for free from `dict.get`: title, tags and summary all fail on an
// explicit null the way Python's isinstance checks do (data.get returns
// None either way, and None is never a valid str or list); category treats
// absent and null identically, because that is what data.get("category")
// already does on both sides — there is no default to diverge on.
func ValidateSummary(raw []byte) (SummaryFile, error) {
	var probe any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return SummaryFile{}, fmt.Errorf("not valid JSON: %w", err)
	}
	if _, ok := probe.(map[string]any); !ok {
		return SummaryFile{}, fmt.Errorf("expected a JSON object, not an array")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return SummaryFile{}, fmt.Errorf("not a JSON object: %w", err)
	}

	titleRaw, titlePresent := fields["title"]
	var title string
	if titlePresent && !isJSONNull(titleRaw) {
		_ = json.Unmarshal(titleRaw, &title) // non-string leaves title == "", failing the check below
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return SummaryFile{}, fmt.Errorf("title must be a non-empty string")
	}

	tagsRaw, tagsPresent := fields["tags"]
	var tagsIn []any
	if tagsPresent {
		if isJSONNull(tagsRaw) {
			return SummaryFile{}, fmt.Errorf("tags must be an array")
		}
		if err := json.Unmarshal(tagsRaw, &tagsIn); err != nil {
			return SummaryFile{}, fmt.Errorf("tags must be an array")
		}
	}
	// Python slices tags_raw[:5] *before* type-checking each element, so a
	// 6th element — of any type, valid or not — is never looked at. Slicing
	// first here too means a non-string 6th tag does not fail an otherwise
	// good summary.json, matching that exactly (rather than the stricter,
	// wrong-direction behaviour of a typed []string field, which fails the
	// whole unmarshal on any non-string element regardless of position).
	if len(tagsIn) > 5 {
		tagsIn = tagsIn[:5]
	}
	tags := make([]string, 0, len(tagsIn))
	for _, tag := range tagsIn {
		s, ok := tag.(string)
		if !ok {
			return SummaryFile{}, fmt.Errorf("every tag must be a string")
		}
		if cleaned := truncate(strings.ToLower(strings.TrimSpace(s)), 40); cleaned != "" {
			tags = append(tags, cleaned)
		}
	}

	summaryRaw, summaryPresent := fields["summary"]
	var summaryText string
	if summaryPresent {
		if isJSONNull(summaryRaw) {
			return SummaryFile{}, fmt.Errorf("summary must be a string")
		}
		if err := json.Unmarshal(summaryRaw, &summaryText); err != nil {
			return SummaryFile{}, fmt.Errorf("summary must be a string")
		}
	}

	categoryRaw, categoryPresent := fields["category"]
	var category string
	if categoryPresent && !isJSONNull(categoryRaw) {
		if err := json.Unmarshal(categoryRaw, &category); err != nil {
			return SummaryFile{}, fmt.Errorf("category must be a string or null")
		}
		category = strings.TrimSpace(category)
	}

	return SummaryFile{
		Title:    truncate(title, 200),
		Tags:     tags,
		Summary:  truncate(strings.TrimSpace(summaryText), 4000),
		Category: category,
	}, nil
}

// truncate caps s at n runes — not n bytes — cutting only on a rune
// boundary, so the result is always valid UTF-8.
//
// Every cap passed to this function is a character count straight from a
// written contract (backend/extract/prompt.py tells the agent "at most 200
// characters"; enrich.go's own Coerce, which this mirrors, works in the
// same unit), so counting bytes was always the wrong unit for it — the two
// happen to agree for ASCII, which is exactly why this went unnoticed, but
// a 3-byte Devanagari rune made a 200-"character" cap behave like a
// ~66-character one, and cutting mid-rune whenever the byte boundary landed
// inside a multi-byte sequence produced a string utf8.Valid reports false
// on. attributevalue.Marshal does not catch that on the way into DynamoDB,
// and gitloomx.RememberFacts sends the same mutilated bytes on to GitLoom,
// which has no delete or supersede at the pinned SDK version to undo it.
func truncate(s string, n int) string {
	if n <= 0 {
		return ""
	}
	count := 0
	for i := range s {
		if count == n {
			return s[:i]
		}
		count++
	}
	return s
}
