package enrich

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/MelloB1989/karma/ai"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// Two engines hear the same audio; the model referees, and then reads the
// result back as a listener would. It answers with a diff — only the
// utterances it would change — so output tokens scale with how much needs
// fixing, not with how long the conversation ran.
//
// The pendant records far-field, 16 kHz, 32 kbps, and the enhancement pass
// in front of the engines is imperfect, so a raw utterance is often close to
// what was said without being it: a garbled word, a name spelled by sound, a
// sentence that lost its last two words. The second engine catches some of
// that; the conversation's own context catches more. The model is allowed
// to use both — but the bar for a change is "a listener would have heard
// this", never "this reads better".
const mergeSystem = `Two independent speech-to-text engines transcribed the same audio: a real
conversation captured by a wearable pendant, far from the mouth, at low bitrate.

Transcript A is the base: numbered utterances with speakers and timing (not shown).
Transcript B is a second engine's plain-text reading of the identical audio.
B has no speaker labels and its sentence boundaries may differ; that is expected.

Your job is to make each utterance of A read as what the speaker actually said.
Use two sources of evidence, in this order:
  1. B, where it clearly heard a word or phrase better.
  2. The conversation itself — what was said before and after, the topic, names
     and places already established — where a word in A is plainly a mishearing
     of something the context makes obvious.

Fix: garbled or misheard words, wrong proper nouns, dropped or doubled words,
text rendered in the wrong language or script, and sentences broken by a
mistranscribed word. Keep the speaker's own grammar, register, dialect and
language mix — people talk in fragments and switch languages mid-sentence, and
that is not an error. Never paraphrase, never tidy, never merge or split
utterances, never add anything neither reading nor the context supports. When
both readings are plausible and the context does not decide it, keep A.

Answer with a JSON array and nothing else. Each element is
  {"i": <utterance number>, "text": "<the full corrected text of that utterance>"}
List only utterances you are changing. If A needs no corrections, answer [].`

func mergeAI() *ai.KarmaAI {
	return ai.NewKarmaAI(
		ai.BaseModel(modelID()),
		ai.Bedrock,
		ai.WithSystemMessage(mergeSystem),
		ai.WithTemperature(0),
		ai.WithMaxTokens(3000),
	)
}

// parseJSONArray pulls a JSON array out of a reply that may be fenced.
func parseJSONArray(text string) ([]map[string]any, error) {
	candidate := text
	if start := strings.Index(candidate, "```"); start != -1 {
		rest := candidate[start+3:]
		rest = strings.TrimPrefix(rest, "json")
		if end := strings.Index(rest, "```"); end != -1 {
			candidate = rest[:end]
		}
	}
	start := strings.Index(candidate, "[")
	end := strings.LastIndex(candidate, "]")
	if start == -1 || end <= start {
		return nil, fmt.Errorf("model returned no JSON array")
	}
	var parsed []map[string]any
	if err := json.Unmarshal([]byte(candidate[start:end+1]), &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

// ApplyCorrections writes a parsed diff onto the transcript's utterances and,
// when anything changed, rebuilds the running text from them. Split from the
// model call so it is testable without Bedrock.
func ApplyCorrections(t *types.Transcript, corrections []map[string]any) int {
	applied := 0
	for _, c := range corrections {
		idx, ok := c["i"].(float64)
		if !ok || idx != float64(int(idx)) {
			continue
		}
		i := int(idx)
		text, ok := c["text"].(string)
		text = strings.TrimSpace(text)
		if !ok || text == "" || i < 0 || i >= len(t.Utterances) {
			continue
		}
		if t.Utterances[i].Text == text {
			continue
		}
		t.Utterances[i].Text = text
		applied++
	}
	if applied > 0 {
		lines := make([]string, len(t.Utterances))
		for i, u := range t.Utterances {
			lines[i] = u.Text
		}
		t.Text = strings.Join(lines, " ")
		t.MergedCorrections = applied
	}
	return applied
}

// MergeTranscripts corrects the base transcript against a second engine's
// reading of the same audio. Best-effort by design: every failure is logged
// and leaves the base transcript untouched. Returns how many utterances
// changed.
func MergeTranscripts(t *types.Transcript, alt string) int {
	alt = strings.TrimSpace(alt)
	if alt == "" || len(t.Utterances) == 0 {
		return 0
	}

	var base strings.Builder
	for i, u := range t.Utterances {
		fmt.Fprintf(&base, "[%d] %s\n", i, u.Text)
	}
	prompt := fmt.Sprintf("Transcript A (base):\n%s\nTranscript B:\n%s", base.String(), alt)

	resp, err := mergeAI().GenerateFromSinglePrompt(prompt)
	if err != nil {
		log.Printf("transcript merge failed, keeping base: %v", err)
		return 0
	}
	corrections, err := parseJSONArray(resp.AIResponse)
	if err != nil {
		log.Printf("transcript merge unparseable, keeping base: %v reply=%s",
			err, truncate(resp.AIResponse, 300))
		return 0
	}
	return ApplyCorrections(t, corrections)
}
