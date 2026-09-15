package enrich

import (
	"strings"
	"unicode"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// BestUtterance finds the line of the transcript a commitment most likely came
// from, so tapping the quote on a task can open the recording at the moment it
// was said.
//
// Deliberately cheap: a word-overlap score, no model call, no embedding. The
// action item is the model's *paraphrase* of what was said, so an exact match
// is not on offer and a clever matcher would only be confidently wrong more
// often. Below the threshold it returns -1 and the task simply has no
// utterance — a task that does not jump anywhere is fine; one that jumps to
// the wrong sentence makes the app look like it misheard.
//
// Stop words are excluded from the score. "I will send it to you tomorrow"
// against "I will get back to you" otherwise scores well on words that carry
// none of the meaning.
func BestUtterance(text string, utterances []types.Utterance) int {
	want := contentWords(text)
	if len(want) == 0 {
		return -1
	}

	best, bestScore := -1, 0.0
	for i, u := range utterances {
		have := contentWords(u.Text)
		if len(have) == 0 {
			continue
		}
		shared := 0
		for word := range want {
			if have[word] {
				shared++
			}
		}
		if shared == 0 {
			continue
		}
		// Scored against the item, not the line: a long utterance that
		// happens to contain the promise should not be penalised for
		// everything else it also says.
		score := float64(shared) / float64(len(want))
		if score > bestScore {
			best, bestScore = i, score
		}
	}
	if bestScore < matchThreshold {
		return -1
	}
	return best
}

// matchThreshold is how much of the commitment's own vocabulary a line must
// carry before the match is worth acting on. Half is strict enough that a
// shared verb alone never wins.
const matchThreshold = 0.5

var stopWords = map[string]bool{
	"a": true, "about": true, "after": true, "all": true, "an": true, "and": true,
	"any": true, "are": true, "as": true, "at": true, "be": true, "been": true,
	"but": true, "by": true, "can": true, "do": true, "does": true, "for": true,
	"from": true, "get": true, "go": true, "going": true, "had": true, "has": true,
	"have": true, "he": true, "her": true, "him": true, "his": true, "i": true,
	"if": true, "in": true, "is": true, "it": true, "its": true, "just": true,
	"like": true, "me": true, "my": true, "need": true, "of": true, "off": true,
	"on": true, "or": true, "our": true, "out": true, "she": true, "should": true,
	"so": true, "that": true, "the": true, "their": true, "them": true, "then": true,
	"there": true, "they": true, "this": true, "to": true, "up": true, "us": true,
	"was": true, "we": true, "were": true, "what": true, "when": true, "which": true,
	"will": true, "with": true, "would": true, "you": true, "your": true,
}

// contentWords is the set of words in a string that carry meaning: lowercased,
// stripped of punctuation, longer than two letters, and not a stop word.
func contentWords(text string) map[string]bool {
	fields := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	words := map[string]bool{}
	for _, f := range fields {
		if len(f) <= 2 || stopWords[f] {
			continue
		}
		words[f] = true
	}
	return words
}
