// Package voiced runs the whole voice-chat pipeline server-side over one
// always-open WebSocket per app (protocol: internal/voicewire).
//
// The session is continuous. A single Deepgram live socket stays open for its
// whole life; every microphone frame the app sends is relayed straight to it.
// Deepgram's own voice-activity events drive the turn-taking:
//
//   - SpeechStarted while Mira is thinking or speaking is a barge-in: the
//     in-flight turn is cancelled, the app is told to stop playback, and the
//     new utterance becomes the next turn.
//   - UtteranceEnd (endpointed silence) closes an utterance: its transcript
//     becomes a Mira turn through the exact chat machinery the text UI uses
//     (same memory recall, storage, eager ingest).
//
// The reply is voiced as it is written: the model streams tokens, complete
// sentences are peeled off and synthesized (Sarvam, a female voice) the moment
// they finish, and each sentence's text + audio go down together — so the
// first words are heard about a second after the user stops, and the visible
// transcript only ever appears in step with the speech.
package voiced

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"

	gl "github.com/GitLoomHQ/gitloom-go/gitloom"
	"github.com/MelloB1989/karma/ai"
	"github.com/MelloB1989/karma/ai/voice"
	"github.com/MelloB1989/karma/models"
	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gorilla/websocket"

	"github.com/MelloB1989/mr20-pendant/backend/internal/api"
	"github.com/MelloB1989/mr20-pendant/backend/internal/voicewire"
)

// A female Sarvam bulbul:v3 voice (verified valid on the v3 model).
const ttsSpeaker = "priya"
const ttsLanguage = "en-IN"

var (
	ttsOnce  sync.Once
	ttsAgent *voice.Agent
	ttsErr   error
)

func tts() (*voice.Agent, error) {
	ttsOnce.Do(func() {
		kai := ai.NewKarmaAI(ai.BaseModel("unused"), ai.Bedrock)
		ttsAgent, ttsErr = voice.NewAgent(kai, voice.ProviderSarvam)
	})
	return ttsAgent, ttsErr
}

// Session is one connected app.
type Session struct {
	ws    *fiberws.Conn
	wsMu  sync.Mutex
	user  string
	dgKey string

	mu     sync.Mutex
	convID string
	dg     *websocket.Conn
	finals []string
	// turnCancel stops the turn in flight; turnSeq identifies it, so a turn
	// that finishes late cannot clear the cancel of the turn that replaced it.
	turnCancel context.CancelFunc
	turnSeq    uint64
	// speaking is true while Mira's audio is playing on the phone, and
	// spokenWords is what she is saying — the phone's microphone hears her
	// through its own speaker, so anything coming back that matches her own
	// words is echo, not the user.
	speaking    bool
	spokenWords map[string]int
	closed      bool

	// Counters, so a call that produced nothing can be told apart from a call
	// whose audio never reached us.
	audioBytes int64
	finalCount int
	turnCount  int
	dgClosed   bool
}

// echoOf reports whether a transcript is mostly Mira's own words coming back
// through the microphone. Hardware echo cancellation removes most of it; what
// survives is close enough to her wording to recognise this way.
func (s *Session) echoOf(text string) bool {
	if !s.speaking || len(s.spokenWords) == 0 {
		return false
	}
	words := strings.Fields(strings.ToLower(text))
	if len(words) == 0 {
		return true
	}
	hits := 0
	for _, w := range words {
		if s.spokenWords[strings.Trim(w, ".,!?;:'\"")] > 0 {
			hits++
		}
	}
	// A short utterance needs to be entirely hers to count as echo; a longer
	// one is echo when most of it is.
	if len(words) <= 3 {
		return hits == len(words)
	}
	return float64(hits)/float64(len(words)) >= 0.6
}

func (s *Session) noteSpoken(sentence string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.spokenWords == nil {
		s.spokenWords = map[string]int{}
	}
	for _, w := range strings.Fields(strings.ToLower(sentence)) {
		s.spokenWords[strings.Trim(w, ".,!?;:'\"")]++
	}
}

func (s *Session) setSpeaking(on bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.speaking = on
	if !on {
		s.spokenWords = nil
	}
}

// Handle runs the session until the socket closes.
func Handle(ws *fiberws.Conn, user, deepgramKey string) {
	s := &Session{ws: ws, user: user, dgKey: deepgramKey}
	s.send(voicewire.ServerFrame{Type: "hello", Version: voicewire.Version})
	log.Printf("voice session open user=%s", user)

	for {
		kind, payload, err := ws.ReadMessage()
		if err != nil {
			break
		}
		switch kind {
		case websocket.BinaryMessage:
			s.relayAudio(payload)
		case websocket.TextMessage:
			var f voicewire.ClientFrame
			if err := json.Unmarshal(payload, &f); err != nil {
				continue
			}
			switch f.Type {
			case "ping":
				s.send(voicewire.ServerFrame{Type: "pong"})
			case "start":
				s.start(f)
			}
		}
	}
	s.teardown()
	s.mu.Lock()
	audio, finals, turns := s.audioBytes, s.finalCount, s.turnCount
	s.mu.Unlock()
	log.Printf("voice session closed user=%s audioBytes=%d finals=%d turns=%d", user, audio, finals, turns)
}

// -- socket writes -----------------------------------------------------------

func (s *Session) send(f voicewire.ServerFrame) {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	if s.closed {
		return
	}
	if raw, err := json.Marshal(f); err == nil {
		_ = s.ws.WriteMessage(websocket.TextMessage, raw)
	}
}

func (s *Session) sendBinary(b []byte) {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	if s.closed {
		return
	}
	_ = s.ws.WriteMessage(websocket.BinaryMessage, b)
}

// -- session lifecycle -------------------------------------------------------

func (s *Session) start(f voicewire.ClientFrame) {
	convID := strings.TrimSpace(f.ConversationID)
	if convID == "" || len(convID) > 80 {
		s.send(voicewire.ServerFrame{Type: "error", Text: "start needs a conversationId"})
		return
	}
	rate := f.SampleRate
	if rate == 0 {
		rate = 16000
	}

	// One Deepgram live socket for the whole session. vad_events surfaces
	// SpeechStarted (barge-in + turn start); utterance_end_ms + endpointing
	// close a turn on natural silence; interim results are consumed but never
	// forwarded — the transcript only becomes visible with the reply.
	url := fmt.Sprintf(
		"wss://api.deepgram.com/v1/listen?model=nova-3&language=multi&encoding=linear16&channels=1&sample_rate=%d&interim_results=true&vad_events=true&endpointing=300&utterance_end_ms=1000&smart_format=true",
		rate)
	dg, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Authorization": []string{"Token " + s.dgKey}})
	if err != nil {
		log.Printf("deepgram dial failed: %v", err)
		s.send(voicewire.ServerFrame{Type: "error", Text: "the transcriber is unreachable — try again"})
		return
	}

	s.mu.Lock()
	if s.dg != nil {
		_ = s.dg.Close()
	}
	s.convID = convID
	s.dg = dg
	s.finals = nil
	s.mu.Unlock()

	s.send(voicewire.ServerFrame{Type: "state", Value: "listening"})
	go s.readDeepgram(dg)
}

func (s *Session) relayAudio(pcm []byte) {
	s.mu.Lock()
	dg := s.dg
	s.audioBytes += int64(len(pcm))
	s.mu.Unlock()
	if dg == nil {
		return
	}
	if err := dg.WriteMessage(websocket.BinaryMessage, pcm); err != nil {
		// The transcriber hung up mid-call; nothing said from here on would
		// ever be heard, and silence is the worst way to report that.
		s.mu.Lock()
		already := s.dgClosed
		s.dgClosed = true
		s.mu.Unlock()
		if !already {
			log.Printf("voice transcriber write failed user=%s err=%v", s.user, err)
			s.send(voicewire.ServerFrame{Type: "error", Text: "Lost the transcriber — reopen this screen."})
		}
	}
}

func (s *Session) teardown() {
	s.mu.Lock()
	s.closed = true
	if s.turnCancel != nil {
		s.turnCancel()
		s.turnCancel = nil
	}
	dg := s.dg
	s.dg = nil
	s.mu.Unlock()
	if dg != nil {
		_ = dg.Close()
	}
}

// -- Deepgram reader: the turn-taking brain ----------------------------------

func (s *Session) readDeepgram(dg *websocket.Conn) {
	for {
		_, payload, err := dg.ReadMessage()
		if err != nil {
			s.mu.Lock()
			live := s.dg == dg && !s.closed
			s.mu.Unlock()
			if live {
				log.Printf("voice transcriber stream ended user=%s err=%v", s.user, err)
			}
			return
		}
		// Read the discriminator ALONE first. Deepgram's shapes disagree
		// across event types — Results carries `channel` as an object, while
		// SpeechStarted and UtteranceEnd carry it as an array ([0,1]) — so a
		// single struct covering all three fails to unmarshal exactly the two
		// VAD frames that drive turn-taking, and they vanish silently.
		var head struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(payload, &head); err != nil {
			continue
		}
		switch head.Type {
		case "SpeechStarted":
			s.onSpeechStarted()
		case "UtteranceEnd":
			s.onUtteranceEnd()
		case "Results":
			var res struct {
				IsFinal bool `json:"is_final"`
				Channel struct {
					Alternatives []struct {
						Transcript string `json:"transcript"`
					} `json:"alternatives"`
				} `json:"channel"`
			}
			if err := json.Unmarshal(payload, &res); err != nil {
				continue
			}
			if res.IsFinal && len(res.Channel.Alternatives) > 0 {
				if t := strings.TrimSpace(res.Channel.Alternatives[0].Transcript); t != "" {
					s.mu.Lock()
					echo := s.echoOf(t)
					if !echo {
						s.finals = append(s.finals, t)
						s.finalCount++
					}
					s.mu.Unlock()
					if echo {
						log.Printf("voice ignoring echo user=%s text=%q", s.user, t)
					}
				}
			}
		}
	}
}

// onSpeechStarted: someone began talking. While Mira is speaking that someone
// is usually Mira herself, leaking from the speaker into the microphone, so a
// bare voice-activity event cannot be trusted to mean an interruption — acting
// on it made her cut herself off mid-sentence. During playback the barge-in
// decision waits for actual words (onUtteranceEnd, after echo is filtered);
// while she is only thinking, there is nothing to echo and this is genuine.
func (s *Session) onSpeechStarted() {
	s.mu.Lock()
	if s.speaking || s.turnCancel == nil {
		s.mu.Unlock()
		return
	}
	cancel := s.turnCancel
	s.turnCancel = nil
	s.mu.Unlock()

	cancel()
	s.send(voicewire.ServerFrame{Type: "interrupt"})
	s.send(voicewire.ServerFrame{Type: "state", Value: "listening"})
}

// onUtteranceEnd: the user stopped. If there is a transcript and no turn is
// already running, that transcript becomes a turn.
func (s *Session) onUtteranceEnd() {
	s.mu.Lock()
	if len(s.finals) == 0 {
		s.mu.Unlock()
		return
	}
	transcript := strings.TrimSpace(strings.Join(s.finals, " "))
	s.finals = nil
	if transcript == "" {
		s.mu.Unlock()
		return
	}
	// Words that survived echo filtering while Mira was talking ARE an
	// interruption: she stops, and what was said becomes the next turn.
	interrupted := false
	if s.turnCancel != nil {
		s.turnCancel()
		s.turnCancel = nil
		interrupted = true
	}
	s.turnSeq++
	seq := s.turnSeq
	ctx, cancel := context.WithCancel(context.Background())
	s.turnCancel = cancel
	s.mu.Unlock()

	if interrupted {
		s.setSpeaking(false)
		s.send(voicewire.ServerFrame{Type: "interrupt"})
	}
	s.mu.Lock()
	s.turnCount++
	s.mu.Unlock()
	go s.runTurn(ctx, seq, transcript)
}

// -- one turn ----------------------------------------------------------------

func (s *Session) runTurn(ctx context.Context, seq uint64, transcript string) {
	defer func() {
		s.setSpeaking(false)
		s.mu.Lock()
		// Only clear the cancel if this is still the current turn: a barge-in
		// has already installed a newer one, and clearing that would leave the
		// new turn uninterruptible.
		if s.turnSeq == seq {
			s.turnCancel = nil
		}
		s.mu.Unlock()
	}()

	s.send(voicewire.ServerFrame{Type: "state", Value: "thinking"})
	s.send(voicewire.ServerFrame{Type: "user", Text: transcript})

	wrapper, err := api.WrapperForVoice(ctx, s.user)
	if err != nil {
		log.Printf("voice wrapper init failed user=%s err=%v", s.user, err)
		s.send(voicewire.ServerFrame{Type: "error", Text: "Mira is unavailable right now."})
		s.send(voicewire.ServerFrame{Type: "state", Value: "listening"})
		return
	}

	restore := api.SetWrapEventSink(func(e gl.WrapEvent) {
		frame := voicewire.ServerFrame{Type: "tool", Name: "memory.recall", Status: "done", Hits: e.Hits}
		switch {
		case e.Kind == "memory.recall":
			frame.Status = "start"
		case e.Err != nil:
			frame.Status = "failed"
		}
		s.send(frame)
	})

	s.mu.Lock()
	convID := s.convID
	s.mu.Unlock()
	chatID := api.GlConvID(s.user, convID)
	history := models.AIChatHistory{
		ChatId: chatID,
		Messages: []models.AIMessage{{
			Role: models.User, Message: transcript, Timestamp: time.Now(),
		}},
	}

	spk := &speaker{s: s, ctx: ctx}
	spoke := false
	resp, err := wrapper.ChatCompletionStream(history, func(chunk models.StreamedResponse) error {
		if ctx.Err() != nil {
			return context.Canceled
		}
		if chunk.AIResponse == "" {
			return nil
		}
		if !spoke {
			spoke = true
			s.setSpeaking(true)
			s.send(voicewire.ServerFrame{Type: "state", Value: "speaking"})
		}
		spk.feed(chunk.AIResponse)
		return nil
	})
	restore()

	if ctx.Err() != nil {
		return
	}
	if err != nil {
		log.Printf("voice turn failed user=%s err=%v", s.user, err)
		s.send(voicewire.ServerFrame{Type: "error", Text: "Mira could not answer. Try again."})
		s.send(voicewire.ServerFrame{Type: "state", Value: "listening"})
		return
	}
	spk.flush()

	ingestCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	s.send(voicewire.ServerFrame{Type: "tool", Name: "memory.ingest", Status: "start"})
	ok := api.EagerIngest(ingestCtx, wrapper, chatID)
	cancel()
	status := "done"
	if !ok {
		status = "failed"
	}
	s.send(voicewire.ServerFrame{Type: "tool", Name: "memory.ingest", Status: status})

	if resp != nil {
		log.Printf("voice turn user=%s replyChars=%d", s.user, len(resp.AIResponse))
	}
	if ctx.Err() == nil {
		s.send(voicewire.ServerFrame{Type: "state", Value: "listening"})
	}
}

// -- streaming speaker: sentence in, text+audio out --------------------------

type speaker struct {
	s   *Session
	ctx context.Context
	buf strings.Builder
	// stream is Sarvam's streaming synthesis when it is available. With it,
	// text is pushed as the model writes and audio returns continuously; the
	// sentence buffer below is only used to decide what text to REVEAL, not
	// to gate synthesis. Without it we fall back to synthesising whole
	// sentences over REST.
	stream *ttsStream
	opened bool
	// ttsBuf holds words on their way to synthesis. Deltas cannot be forwarded
	// one at a time: a model emits plenty that are pure punctuation or space,
	// and Sarvam rejects a message with no letters in it — a single rejection
	// ends the stream and the whole reply arrives silent.
	ttsBuf strings.Builder
}

// Roughly a short phrase. Long enough that most sends carry real words,
// short enough that the first syllable is not kept waiting.
const ttsChunkChars = 24

// speakable reports whether text carries anything a voice could pronounce.
func speakable(text string) bool {
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

// pushTTS buffers text and sends it once it is worth sending. On flush it
// sends whatever is left, provided there is something to say.
func (sp *speaker) pushTTS(delta string, flush bool) {
	if sp.stream == nil {
		return
	}
	sp.ttsBuf.WriteString(delta)
	text := sp.ttsBuf.String()
	if !flush && len(text) < ttsChunkChars {
		return
	}
	if !speakable(text) {
		// Punctuation with no word attached yet: keep it for the next chunk
		// rather than have it refused on its own.
		if flush {
			sp.ttsBuf.Reset()
		}
		return
	}
	sp.ttsBuf.Reset()
	if err := sp.stream.Say(spoken(text)); err != nil {
		log.Printf("voice tts stream write failed: %v", err)
	}
}

// open lazily starts the streaming socket on the first token, so a turn that
// never produces text never dials.
func (sp *speaker) open() {
	if sp.opened {
		return
	}
	sp.opened = true
	stream, err := openTTSStream(sp.ctx)
	if err != nil {
		log.Printf("voice tts stream unavailable, falling back to per-sentence: %v", err)
		return
	}
	sp.stream = stream
	go func() {
		if err := stream.Read(sp.ctx, func(audio []byte) {
			if sp.ctx.Err() != nil {
				return
			}
			sp.s.send(voicewire.ServerFrame{
				Type: "audio", Status: "start",
				Mime: "audio/pcm", SampleRate: ttsSampleRate,
			})
			const chunk = 32 << 10
			for start := 0; start < len(audio); start += chunk {
				end := start + chunk
				if end > len(audio) {
					end = len(audio)
				}
				sp.s.sendBinary(audio[start:end])
			}
			sp.s.send(voicewire.ServerFrame{Type: "audio", Status: "end"})
		}); err != nil && sp.ctx.Err() == nil {
			log.Printf("voice tts stream ended early: %v", err)
		}
	}()
}

func (sp *speaker) feed(delta string) {
	sp.open()
	// With a stream open, words go to synthesis as they arrive rather than at
	// sentence boundaries — waiting for those is what left holes between them.
	sp.pushTTS(delta, false)

	sp.buf.WriteString(delta)
	for {
		text := sp.buf.String()
		cut := sentenceCut(text)
		if cut < 0 {
			return
		}
		sentence := strings.TrimSpace(text[:cut])
		rest := text[cut:]
		sp.buf.Reset()
		sp.buf.WriteString(rest)
		sp.say(sentence)
	}
}

func (sp *speaker) flush() {
	if s := strings.TrimSpace(sp.buf.String()); s != "" {
		sp.say(s)
	}
	sp.buf.Reset()
	if sp.stream != nil {
		sp.pushTTS("", true)
		// Tell Sarvam to synthesise the tail it is still holding, then let the
		// reader drain what comes back before the turn is declared over.
		if err := sp.stream.Flush(); err != nil {
			log.Printf("voice tts flush failed: %v", err)
		}
		select {
		case <-sp.stream.done:
		case <-sp.ctx.Done():
		case <-time.After(20 * time.Second):
		}
		sp.stream.Close()
	}
}

// say voices one sentence: the text is revealed with it, so the transcript
// only ever appears in step with the audio.
func (sp *speaker) say(sentence string) {
	sentence = spoken(sentence)
	if sentence == "" || sp.ctx.Err() != nil {
		return
	}
	sp.s.noteSpoken(sentence)
	sp.s.send(voicewire.ServerFrame{Type: "delta", Text: sentence})

	// Streaming synthesis already has these words; this sentence is only being
	// shown, not spoken again.
	if sp.stream != nil {
		return
	}

	agent, err := tts()
	if err != nil {
		log.Printf("tts agent unavailable: %v", err)
		return
	}
	synth, err := agent.Synthesize(sp.ctx, voice.SynthesizeRequest{
		Text: sentence, VoiceID: ttsSpeaker, Language: ttsLanguage,
	})
	if err != nil || sp.ctx.Err() != nil {
		if err != nil {
			log.Printf("tts failed: %v", err)
		}
		return
	}
	sp.s.send(voicewire.ServerFrame{Type: "audio", Status: "start", Mime: "audio/mpeg"})
	const chunk = 32 << 10
	for start := 0; start < len(synth.Audio); start += chunk {
		if sp.ctx.Err() != nil {
			return
		}
		end := start + chunk
		if end > len(synth.Audio) {
			end = len(synth.Audio)
		}
		sp.s.sendBinary(synth.Audio[start:end])
	}
	sp.s.send(voicewire.ServerFrame{Type: "audio", Status: "end"})
}

// A sentence shorter than this is not worth its own synthesis round trip —
// "Hi!" or "Sure." would each cost a Sarvam call and an audible seam, so a
// short opener rides along with the sentence that follows it.
const minSentenceChars = 12

// Terminators that end a sentence only when the next character is whitespace,
// which is what keeps "3.5" from splitting mid-number.
func isTerminator(b byte) bool {
	switch b {
	case '.', '!', '?', '\n', ':', ';':
		return true
	}
	return false
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\n' || b == '\t' || b == '\r'
}

// abbreviations that legitimately end in a period mid-sentence. Splitting on
// them makes the voice say "Doctor." and stop, which is exactly the seam this
// package exists to avoid.
var abbreviations = map[string]bool{
	"dr": true, "mr": true, "mrs": true, "ms": true, "prof": true, "sr": true,
	"jr": true, "st": true, "vs": true, "etc": true, "eg": true, "ie": true,
	"approx": true, "no": true, "fig": true, "inc": true, "ltd": true, "co": true,
}

// endsWithAbbreviation reports whether the period at text[i] closes an
// abbreviation or an initial ("J. R. R.") rather than a sentence.
func endsWithAbbreviation(text string, i int) bool {
	start := i
	for start > 0 && !isSpace(text[start-1]) {
		start--
	}
	word := strings.ToLower(strings.TrimRight(text[start:i], "."))
	// A single letter is an initial: "J. R. R. Tolkien".
	if len(word) == 1 && word[0] >= 'a' && word[0] <= 'z' {
		return true
	}
	// "e.g." / "U.S." arrive with their inner periods already stripped above.
	return abbreviations[word]
}

// sentenceCut returns the index just past the end of the first sentence worth
// speaking, or -1 if there is none yet. A terminator only counts when followed
// by whitespace (so "3.5" survives), when it does not close an abbreviation
// (so "Dr. Rao" survives), and when what precedes it is long enough to be
// worth its own breath.
func sentenceCut(text string) int {
	for i := 0; i < len(text); i++ {
		if !isTerminator(text[i]) {
			continue
		}
		if i+1 >= len(text) {
			// The buffer ends here; more tokens may extend this sentence.
			return -1
		}
		if !isSpace(text[i+1]) {
			continue
		}
		if text[i] == '.' && endsWithAbbreviation(text, i) {
			continue
		}
		if len(strings.TrimSpace(text[:i+1])) < minSentenceChars {
			continue // too short to voice alone; let it join what follows
		}
		return i + 1
	}
	return -1
}

// spoken flattens stray markdown so the voice never reads a symbol aloud.
// Emphasis markers go everywhere, but list bullets and heading hashes are
// only stripped where markdown puts them — at the start of a line — so
// "issue #12" and "a draw - nobody won" survive intact.
func spoken(text string) string {
	emphasis := strings.NewReplacer("**", "", "__", "", "*", "", "`", "")
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		l := strings.TrimSpace(line)
		for strings.HasPrefix(l, "#") {
			l = strings.TrimSpace(strings.TrimPrefix(l, "#"))
		}
		if after, ok := strings.CutPrefix(l, "- "); ok {
			l = after
		} else if after, ok := strings.CutPrefix(l, "• "); ok {
			l = after
		}
		lines[i] = emphasis.Replace(l)
	}
	return strings.TrimSpace(strings.Join(lines, " "))
}
