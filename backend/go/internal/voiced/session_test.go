package voiced

import (
	"slices"
	"strings"
	"testing"
)

func TestSentenceCutFindsFirstCompleteSentence(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int
		// sentence is what text[:want] should hold; checked only when want >= 0.
		sentence string
	}{
		{"no terminator yet", "Hello there", -1, ""},
		{"empty buffer", "", -1, ""},
		{"terminator at the very end waits for more tokens", "Hello there.", -1, ""},
		{"terminator glued to the next word is not a break", "Hello there.How", -1, ""},
		{"period then space", "Hello there. How are you", 12, "Hello there."},
		{"question mark", "Are you there? Yes", 14, "Are you there?"},
		{"a short exclamation rides along", "Wow! That was fast.", -1, ""},
		// "Here goes:" is too short to be worth its own breath, so it rides along.
		{"a short clause does not get its own utterance", "Here goes: one two", -1, ""},
		{"short semicolon clause rides along", "First; second", -1, ""},
		{"tab is whitespace, but the clause is too short alone", "Done.\tNext", -1, ""},
		{"decimal point does not split", "It costs 3.5 dollars today. ", 27, "It costs 3.5 dollars today."},
		{"newline after a period", "Hello there.\nHow are you?", 12, "Hello there."},
		{"short section heading rides along", "Section one\n\nSection two", -1, ""},
		// A lone newline only ends a sentence when whitespace follows it, so a
		// hard-wrapped line running straight into the next one never splits.
		{"single newline mid-text is not a break", "Section one\nSection two ", -1, ""},
		// Three tiny sentences are voiced as one segment rather than three
		// separate synthesis round trips with seams between them.
		{"tiny sentences accumulate instead of splitting", "One. Two. Three.", -1, ""},
		// An abbreviation's period must not end the sentence, or the voice says
		// "Doctor." and stops before the name.
		{"abbreviation does not split", "Dr. Rao is here. ", 16, "Dr. Rao is here."},
		{"initials do not split", "J. R. R. Tolkien wrote it. ", 26, "J. R. R. Tolkien wrote it."},
		{"carriage return counts as whitespace", "Hello there.\r\nHow are you", 12, "Hello there."},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := sentenceCut(c.in)
			if got != c.want {
				t.Fatalf("sentenceCut(%q) = %d, want %d", c.in, got, c.want)
			}
			if got >= 0 && c.in[:got] != c.sentence {
				t.Errorf("text[:%d] = %q, want %q", got, c.in[:got], c.sentence)
			}
		})
	}
}

func TestSpokenFlattensMarkdownForTheVoice(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"bold asterisks", "This is **very** important", "This is very important"},
		{"bold underscores", "__strong__ words", "strong words"},
		{"italic asterisks", "*maybe* not", "maybe not"},
		{"inline code", "run `go test` now", "run go test now"},
		{"heading hashes", "## Weekly summary", "Weekly summary"},
		{"dash bullet", "- first item", "first item"},
		{"dot bullet", "• second item", "second item"},
		{"plain text untouched", "Just a normal sentence.", "Just a normal sentence."},
		{"surrounding whitespace trimmed", "  padded reply \n", "padded reply"},
		{"markers only", "**", ""},
		{"empty input", "", ""},
		{"everything at once", "## **Bold** heading with `code`", "Bold heading with code"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := spoken(c.in); got != c.want {
				t.Errorf("spoken(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// spoken's replacements are unanchored, so these markers disappear wherever
// they occur — not only where markdown would put them — and removing one from
// between two words leaves the surrounding spaces behind.
func TestSpokenStripsMarkersMidSentence(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		// Hashes and dashes inside prose are punctuation, not markdown, and
		// the voice should read them as written.
		{"see issue #12 for details", "see issue #12 for details"},
		{"call it a draw - nobody won", "call it a draw - nobody won"},
		// Emphasis markers are stripped wherever they appear, so a stray
		// asterisk still leaves the gap it occupied.
		{"the answer is 6 * 7", "the answer is 6  7"},
	}

	for _, c := range cases {
		if got := spoken(c.in); got != c.want {
			t.Errorf("spoken(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// sentenceStream mirrors speaker.feed/flush/say without the Session or the
// network: same buffer, same cut, same spoken() pass, but the "voiced"
// sentences are collected instead of synthesized.
type sentenceStream struct {
	buf  strings.Builder
	said []string
}

func (st *sentenceStream) feed(delta string) {
	st.buf.WriteString(delta)
	for {
		text := st.buf.String()
		cut := sentenceCut(text)
		if cut < 0 {
			return
		}
		sentence := strings.TrimSpace(text[:cut])
		rest := text[cut:]
		st.buf.Reset()
		st.buf.WriteString(rest)
		st.say(sentence)
	}
}

func (st *sentenceStream) flush() {
	if s := strings.TrimSpace(st.buf.String()); s != "" {
		st.say(s)
	}
	st.buf.Reset()
}

func (st *sentenceStream) say(sentence string) {
	if s := spoken(sentence); s != "" {
		st.said = append(st.said, s)
	}
}

func TestSentenceStreamHoldsATerminatorUntilTheNextToken(t *testing.T) {
	st := &sentenceStream{}

	st.feed("Hello")
	st.feed(" there.")
	if len(st.said) != 0 {
		t.Fatalf("a period at the buffer's end must wait for the next token, got %q", st.said)
	}

	st.feed(" How are")
	if want := []string{"Hello there."}; !slices.Equal(st.said, want) {
		t.Fatalf("after the token past the period: %q, want %q", st.said, want)
	}

	st.feed(" you?")
	if len(st.said) != 1 {
		t.Fatalf("a trailing question mark is not complete yet: %q", st.said)
	}

	st.flush()
	want := []string{"Hello there.", "How are you?"}
	if !slices.Equal(st.said, want) {
		t.Errorf("flush should release the tail: %q, want %q", st.said, want)
	}
}

func TestSentenceStreamSplitsOnlyOnRealSentenceEnds(t *testing.T) {
	cases := []struct {
		name        string
		deltas      []string
		beforeFlush []string
		afterFlush  []string
	}{
		{
			name:        "decimal split across two tokens stays one sentence",
			deltas:      []string{"It costs 3", ".5 dollars", " today. Thanks"},
			beforeFlush: []string{"It costs 3.5 dollars today."},
			afterFlush:  []string{"It costs 3.5 dollars today.", "Thanks"},
		},
		{
			// Each of these is far too short to be worth its own synthesis
			// round trip, so they are voiced together as one utterance.
			name:        "tiny sentences are voiced as one utterance",
			deltas:      []string{"One. Two. Three."},
			beforeFlush: nil,
			afterFlush:  []string{"One. Two. Three."},
		},
		{
			name:        "markdown is flattened before it is voiced",
			deltas:      []string{"## **Plan**", " for today.", " Step `one`."},
			beforeFlush: []string{"Plan for today."},
			afterFlush:  []string{"Plan for today.", "Step one."},
		},
		{
			name:        "a full-length sentence on a clean boundary leaves nothing to flush",
			deltas:      []string{"That is everything for now. "},
			beforeFlush: []string{"That is everything for now."},
			afterFlush:  []string{"That is everything for now."},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st := &sentenceStream{}
			for _, d := range c.deltas {
				st.feed(d)
			}
			if !slices.Equal(st.said, c.beforeFlush) {
				t.Errorf("streamed %q, want %q", st.said, c.beforeFlush)
			}
			st.flush()
			if !slices.Equal(st.said, c.afterFlush) {
				t.Errorf("after flush %q, want %q", st.said, c.afterFlush)
			}
		})
	}
}

// Mira's reply leaks from the phone's speaker back into its microphone. What
// survives hardware echo cancellation must not be mistaken for the user
// talking, or she cuts herself off and answers her own words.
func TestEchoOfRecognisesMiraOwnWords(t *testing.T) {
	newSession := func(spoken string) *Session {
		s := &Session{speaking: true, spokenWords: map[string]int{}}
		s.noteSpoken(spoken)
		return s
	}

	cases := []struct {
		name   string
		spoken string
		heard  string
		echo   bool
	}{
		{
			name:   "her sentence coming straight back",
			spoken: "I'm here to help you think things through.",
			heard:  "I'm here to help you think things through",
			echo:   true,
		},
		{
			name:   "a garbled fragment of her sentence",
			spoken: "I'm here to help you think things through.",
			heard:  "help you think through",
			echo:   true,
		},
		{
			name:   "the user actually interrupting",
			spoken: "I'm here to help you think things through.",
			heard:  "wait stop tell me about tomorrow instead",
			echo:   false,
		},
		{
			name:   "a short interjection that is not hers",
			spoken: "I'm here to help you think things through.",
			heard:  "no wait",
			echo:   false,
		},
		{
			name:   "a short echo of two of her words",
			spoken: "I'm here to help you think things through.",
			heard:  "think things",
			echo:   true,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := newSession(c.spoken)
			if got := s.echoOf(c.heard); got != c.echo {
				t.Errorf("echoOf(%q) = %v, want %v", c.heard, got, c.echo)
			}
		})
	}
}

// Nothing is echo when she is not speaking — otherwise the first thing the
// user says after a reply would be swallowed.
func TestEchoOfIsInertWhileListening(t *testing.T) {
	s := &Session{speaking: true, spokenWords: map[string]int{}}
	s.noteSpoken("I'm here to help you think things through.")
	if !s.echoOf("help you think things through") {
		t.Fatal("expected echo while speaking")
	}
	s.setSpeaking(false)
	if s.echoOf("help you think things through") {
		t.Error("a transcript after she stopped speaking must never be echo")
	}
}

// Sarvam refuses a text message with no letters in it, and one refusal ends
// the stream — so a reply that happens to emit a lone dash or space must
// never be forwarded on its own.
func TestSpeakableRejectsTextWithNothingToPronounce(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"hello", true},
		{"2026", true},
		{"नमस्ते", true},
		{"", false},
		{" ", false},
		{"—", false},
		{". ", false},
		{"…", false},
		{"**", false},
		{" - ", false},
		{"a", true},
	}
	for _, c := range cases {
		if got := speakable(c.in); got != c.want {
			t.Errorf("speakable(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
