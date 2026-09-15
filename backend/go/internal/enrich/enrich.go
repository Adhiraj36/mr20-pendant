// Package enrich derives title, tags, summary, action items, the facts worth
// remembering and a category from a transcript, via Claude on Bedrock through
// karma's ai package.
//
// The facts are ours on purpose. GitLoom extracts its own memories from the
// same conversation, but returns nothing addressable — no ids, no list, no way
// to ask what it made of one recording. So the pass that was already being
// paid for produces the facts the app shows, and GitLoom receives them as a
// second, already-distilled ingestion rather than being the only place they
// exist ([GL_FACT_IDS]).
package enrich

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/MelloB1989/karma/ai"

	"github.com/MelloB1989/mr20-pendant/backend/internal/deepgram"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

const system = `You summarise transcripts of real conversations captured by a wearable pendant.

The transcript is diarized: each line is prefixed with "Speaker N", where N is an
anonymous index assigned by the diarizer. Speaker 0 is not necessarily the wearer.

Return a single JSON object and nothing else, with exactly these keys:

  "title"        A specific 3-8 word title naming what this conversation was about.
                 Not "Conversation" or "Meeting Discussion". If the topic is unclear,
                 name what was actually discussed, however mundane.
  "tags"         2-5 lowercase topic tags, single words or short hyphenated phrases.
  "summary"      2-4 sentences on what was discussed and what was decided. Write for
                 someone who was there and wants to remember, not for a stranger.
  "actionItems"  Commitments someone actually made. Each is {"text": string,
                 "owner": number|null, "kind": string} where owner is the speaker
                 index who took it on, or null if unclear, and kind is exactly one
                 of "message" (say something to someone), "spend" (pay, buy,
                 transfer money), "file" (send, sign or submit a document),
                 "reminder" (remember at a time) or "other". Use "other" rather
                 than guessing. Empty array if nobody committed to anything.
  "facts"        At most 12 durable things this conversation establishes about the
                 wearer's life, one sentence each, at most 200 characters. Each is
                 {"text": string, "kind": string} where kind is exactly one of
                 "fact" (something true about their world), "preference" (something
                 they like, avoid or always do), "person" (who someone is to them)
                 or "decision" (something settled here). Empty array is the right
                 answer for most conversations.
  "category"     Exactly one name from the CATEGORIES list in the user message,
                 chosen by the conversation's dominant subject — or null when none
                 of them honestly fits. Never invent a category.
  "speakers"     One entry per distinct "Speaker N" in the transcript:
                 {"speaker": N, "label": string, "description": string}. label is
                 1-3 words: the person's name only if the transcript itself
                 establishes it (they are addressed by name, or introduce
                 themselves), otherwise the role they play here — "Doctor",
                 "Auto driver", "Shop owner", "Friend", "Colleague". Never guess
                 a name. description is one sentence, at most 200 characters, on
                 who this voice appears to be and what they wanted or did in the
                 conversation; say "Likely the wearer" when the transcript makes
                 that clear (they are the one being asked, doing errands, talking
                 about their own home or work), and never otherwise.

Rules:
- Report only what is in the transcript. Do not infer facts that were not said.
- A fact must be durable and about the wearer's own life. Small talk, passing
  detail, and anything said by a television, podcast or film playing nearby are
  not facts. Speaker labels are not identities: do not record who someone is
  unless the transcript says so.
- Diarization is imperfect and may split or merge speakers. Do not remark on this.
- Transcription of a 16 kHz recording garbles some words. Work around obvious
  mis-hearings rather than quoting them.
- Do not invent action items to fill the list. Most conversations have none.`

// DefaultModelID is Haiku 4.5's Bedrock inference profile; overridable via env.
const DefaultModelID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"

func modelID() string {
	if v := os.Getenv("BEDROCK_MODEL_ID"); v != "" {
		return v
	}
	return DefaultModelID
}

func newAI() *ai.KarmaAI {
	// karma passes an unmapped BaseModel string through to Bedrock verbatim,
	// which is how the inference-profile id gets there.
	return ai.NewKarmaAI(
		ai.BaseModel(modelID()),
		ai.Bedrock,
		ai.WithSystemMessage(system),
		ai.WithTemperature(0.2),
		ai.WithMaxTokens(3000),
	)
}

// fallback keeps a recording from being left blank when the model is
// unavailable or answers garbage.
func fallback(t *types.Transcript) types.Enrichment {
	opening := strings.TrimSpace(truncate(t.Text, 80))
	title := "Untitled conversation"
	if opening != "" {
		title = opening
		if len(t.Text) > 80 {
			title += "…"
		}
	}
	return types.Enrichment{Title: title}
}

// truncate caps s at n runes — not n bytes — cutting only on a rune
// boundary, so the result is always valid UTF-8.
//
// A plain s[:n] byte slice can stop mid-codepoint on non-ASCII text (a
// 3-byte Devanagari rune, say), handing attributevalue.Marshal — and then,
// for the facts/title/tags this feeds, GitLoom itself — bytes utf8.Valid
// reports invalid, with no delete or supersede at the pinned SDK version to
// undo it. See internal/apply/validate.go's truncate, which had and fixed
// the identical bug on the extracted path; this is the Bedrock fallback's
// own copy of the same function (unexported, package-local, never shared
// code — the two were never one function to begin with), reachable by the
// exact same non-ASCII input whenever the fallback runs instead of the
// extracted path.
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

// parseJSON pulls the JSON object out of a reply that may be fenced or prefaced.
func parseJSON(text string) (map[string]any, error) {
	candidate := text
	if start := strings.Index(candidate, "```"); start != -1 {
		rest := candidate[start+3:]
		rest = strings.TrimPrefix(rest, "json")
		if end := strings.Index(rest, "```"); end != -1 {
			candidate = rest[:end]
		}
	}
	start := strings.Index(candidate, "{")
	end := strings.LastIndex(candidate, "}")
	if start == -1 || end <= start {
		return nil, fmt.Errorf("model returned no JSON object")
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(candidate[start:end+1]), &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

// ResolveCategory maps the model's category *name* to the stored *id*,
// case-insensitively. Anything unrecognised becomes "" — a hallucinated
// category can never reach the table.
func ResolveCategory(raw any, categories []types.Category) string {
	name, ok := raw.(string)
	if !ok {
		return ""
	}
	needle := strings.ToLower(strings.TrimSpace(name))
	if needle == "" {
		return ""
	}
	for _, cat := range categories {
		if strings.ToLower(cat.Name) == needle {
			return cat.ID
		}
	}
	return ""
}

func coerceActionItems(raw any) []types.ActionItem {
	list, ok := raw.([]any)
	if !ok {
		return nil
	}
	items := make([]types.ActionItem, 0, len(list))
	for _, entry := range list {
		if len(items) >= 25 {
			break
		}
		switch v := entry.(type) {
		case string:
			if text := strings.TrimSpace(v); text != "" {
				items = append(items, types.ActionItem{Text: truncate(text, 400)})
			}
		case map[string]any:
			text, _ := v["text"].(string)
			text = strings.TrimSpace(text)
			if text == "" {
				continue
			}
			item := types.ActionItem{Text: truncate(text, 400), Kind: types.CoerceTaskKind(v["kind"])}
			if owner, ok := v["owner"].(float64); ok && owner == float64(int(owner)) {
				o := int(owner)
				item.Owner = &o
			}
			items = append(items, item)
		}
	}
	return items
}

// Caps on what one conversation may add to memory. Twelve is already more
// than most days of talking produce; past that the model is padding, and
// padding is what fills a memory with things that were never true.
const (
	maxFacts     = 12
	maxFactChars = 200
)

// coerceFacts validates the facts array. A bare string is accepted as a plain
// fact — the model occasionally answers with one — and anything without text
// is dropped rather than stored empty.
func coerceFacts(raw any) []types.Fact {
	list, ok := raw.([]any)
	if !ok {
		return nil
	}
	facts := make([]types.Fact, 0, len(list))
	for _, entry := range list {
		if len(facts) >= maxFacts {
			break
		}
		switch v := entry.(type) {
		case string:
			if text := strings.TrimSpace(v); text != "" {
				facts = append(facts, types.Fact{
					Text: truncate(text, maxFactChars), Kind: types.FactKindFact,
				})
			}
		case map[string]any:
			text, _ := v["text"].(string)
			text = strings.TrimSpace(text)
			if text == "" {
				continue
			}
			facts = append(facts, types.Fact{
				Text: truncate(text, maxFactChars), Kind: types.CoerceFactKind(v["kind"]),
			})
		}
	}
	return facts
}

// Coerce validates a raw model reply into an Enrichment. Split from the model
// call so it is testable without Bedrock.
func Coerce(reply string, t *types.Transcript, categories []types.Category) types.Enrichment {
	parsed, err := parseJSON(reply)
	if err != nil {
		log.Printf("could not parse enrichment JSON: %v reply=%s", err, truncate(reply, 500))
		return fallback(t)
	}

	out := fallback(t)
	if title, ok := parsed["title"].(string); ok && strings.TrimSpace(title) != "" {
		out.Title = truncate(strings.TrimSpace(title), 200)
	}
	if rawTags, ok := parsed["tags"].([]any); ok {
		tags := make([]string, 0, len(rawTags))
		for _, rt := range rawTags {
			if len(tags) >= 5 {
				break
			}
			if tag, ok := rt.(string); ok {
				if tag = truncate(strings.ToLower(strings.TrimSpace(tag)), 40); tag != "" {
					tags = append(tags, tag)
				}
			}
		}
		out.Tags = tags
	}
	if summary, ok := parsed["summary"].(string); ok {
		out.Summary = truncate(strings.TrimSpace(summary), 4000)
	}
	out.ActionItems = coerceActionItems(parsed["actionItems"])
	out.Facts = coerceFacts(parsed["facts"])
	out.CategoryID = ResolveCategory(parsed["category"], categories)
	out.Speakers = coerceSpeakers(parsed["speakers"], t)
	return out
}

// Caps on one speaker profile; the same numbers internal/apply's
// ValidateSpeakers enforces on the agent's speakers.json, so both paths
// store the same shape.
const (
	maxSpeakerLabelChars       = 80
	maxSpeakerDescriptionChars = 200
)

// coerceSpeakers validates the speakers array against the voices the
// transcript actually has. An entry for an index the diarizer never
// produced, a duplicate, or one with no label is dropped rather than stored
// — a Bedrock reply cannot be asked to try again, so the good entries are
// kept and the bad ones are not, the same lenience coerceFacts shows.
func coerceSpeakers(raw any, t *types.Transcript) map[string]types.SpeakerProfile {
	list, ok := raw.([]any)
	if !ok {
		return nil
	}
	known := map[int]bool{}
	for _, u := range t.Utterances {
		known[u.Speaker] = true
	}
	profiles := map[string]types.SpeakerProfile{}
	for _, entry := range list {
		v, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		idx, ok := v["speaker"].(float64)
		if !ok || idx != float64(int(idx)) || !known[int(idx)] {
			continue
		}
		key := strconv.Itoa(int(idx))
		if _, dup := profiles[key]; dup {
			continue
		}
		label, _ := v["label"].(string)
		label = strings.TrimSpace(label)
		if label == "" {
			continue
		}
		description, _ := v["description"].(string)
		profiles[key] = types.SpeakerProfile{
			Label:       truncate(label, maxSpeakerLabelChars),
			Description: truncate(strings.TrimSpace(description), maxSpeakerDescriptionChars),
		}
	}
	if len(profiles) == 0 {
		return nil
	}
	return profiles
}

// Enrich runs the model over a transcript. The processor archives empty
// transcripts before ever calling this; the guard keeps the function safe to
// call directly.
func Enrich(t *types.Transcript, categories []types.Category) types.Enrichment {
	if strings.TrimSpace(t.Text) == "" {
		return types.Enrichment{Title: "No speech detected"}
	}

	names := make([]string, len(categories))
	for i, cat := range categories {
		names[i] = cat.Name
	}
	catList := "(none defined)"
	if len(names) > 0 {
		catList = strings.Join(names, ", ")
	}
	duration := ""
	if t.DurationSeconds > 0 {
		duration = fmt.Sprintf("over %d minutes", int(t.DurationSeconds/60+0.5))
	}
	prompt := fmt.Sprintf("CATEGORIES: %s\n\nConversation recorded %s:\n\n%s",
		catList, duration, deepgram.AsDialogue(t, 0))

	resp, err := newAI().GenerateFromSinglePrompt(prompt)
	if err != nil {
		// Access or model-id problems should not strand a good transcript.
		// Throttling is retried by the caller's SQS redelivery if it wants to;
		// a fallback enrichment is always usable.
		log.Printf("bedrock enrichment failed, falling back: %v", err)
		return fallback(t)
	}
	return Coerce(resp.AIResponse, t, categories)
}
