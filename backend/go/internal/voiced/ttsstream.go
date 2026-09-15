package voiced

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Sarvam's streaming synthesis, one socket per turn.
//
// Synthesising a sentence at a time over REST meant paying the full
// generation latency again for every sentence, and the queue on the phone ran
// dry between them — the reply came out in lumps with holes in it. Here the
// text is pushed as the model writes it and audio flows back continuously, so
// the gap only ever exists before the first syllable.
//
// Every failure falls back to the REST path: a call that sounds lumpy is far
// better than a call with no voice at all.

const (
	// Verified against the live API: the streaming endpoint is /text-to-speech/ws
	// (an inferred "/text-to-speech-streaming" is a bad handshake), and
	// send_completion_event is what produces the "final" event that tells us
	// the tail has been synthesised.
	ttsStreamURL = "wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true"
	// Sarvam hangs up on an idle socket after about a minute; a turn never
	// runs that long, but the deadline keeps a wedged read from lingering.
	ttsReadTimeout = 45 * time.Second
	// Raw PCM, so the phone never has to decode a fragment. MP3 was the
	// mistake here: only the first chunk of a stream carries a header, and the
	// continuations that follow decode to nothing on their own — which is why
	// streamed speech arrived silent.
	ttsCodec      = "linear16"
	ttsSampleRate = 22050
	// About a tenth of a second of audio: small enough to start quickly, large
	// enough not to flood the socket with tiny frames.
	ttsMinSegment = 4 << 10
)

type ttsStream struct {
	conn *websocket.Conn
	mu   sync.Mutex
	done chan struct{}
	err  error
}

// openTTSStream dials Sarvam and sends the voice configuration.
func openTTSStream(ctx context.Context) (*ttsStream, error) {
	key := os.Getenv("SARVAM_API_KEY")
	if key == "" {
		return nil, fmt.Errorf("SARVAM_API_KEY is not set")
	}

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, ttsStreamURL, http.Header{
		"api-subscription-key": []string{key},
	})
	if err != nil {
		return nil, err
	}

	config := map[string]any{
		"type": "config",
		"data": map[string]any{
			// Note: the streaming config names the language
			// target_language_code, unlike the REST body's language_code.
			"target_language_code": ttsLanguage,
			"speaker":              ttsSpeaker,
			"model":                "bulbul:v3",
			"output_audio_codec":   ttsCodec,
			"speech_sample_rate":   ttsSampleRate,
		},
	}
	if err := conn.WriteJSON(config); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return &ttsStream{conn: conn, done: make(chan struct{})}, nil
}

// Say queues text for synthesis. Safe to call as often as the model produces
// words; Sarvam buffers internally and decides where to breathe.
func (t *ttsStream) Say(text string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.conn.WriteJSON(map[string]any{
		"type": "text",
		"data": map[string]any{"text": text},
	})
}

// Flush tells Sarvam to synthesise whatever it is holding, which it otherwise
// waits to fill out.
func (t *ttsStream) Flush() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.conn.WriteJSON(map[string]any{"type": "flush"})
}

func (t *ttsStream) Close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	_ = t.conn.Close()
}

// Read pumps audio to onAudio until the socket ends or ctx is cancelled.
// Chunks are coalesced to a sane size first: the phone decodes each segment it
// is handed, and a fragment too small to hold whole MP3 frames decodes to
// nothing.
func (t *ttsStream) Read(ctx context.Context, onAudio func([]byte)) error {
	defer close(t.done)
	var pending []byte

	flushPending := func() {
		if len(pending) > 0 {
			onAudio(pending)
			pending = nil
		}
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		_ = t.conn.SetReadDeadline(time.Now().Add(ttsReadTimeout))
		_, payload, err := t.conn.ReadMessage()
		if err != nil {
			// A closed socket after the final event is the normal ending.
			flushPending()
			return nil
		}

		var msg struct {
			Type string `json:"type"`
			Data struct {
				Audio     string `json:"audio"`
				EventType string `json:"event_type"`
				Message   string `json:"message"`
			} `json:"data"`
		}
		if err := json.Unmarshal(payload, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "audio":
			if msg.Data.Audio == "" {
				continue
			}
			chunk, err := base64.StdEncoding.DecodeString(msg.Data.Audio)
			if err != nil {
				continue
			}
			pending = append(pending, chunk...)
			if len(pending) >= ttsMinSegment {
				flushPending()
			}
		case "error":
			flushPending()
			return fmt.Errorf("sarvam stream: %s", msg.Data.Message)
		case "event":
			if msg.Data.EventType == "final" {
				flushPending()
				return nil
			}
		}
	}
}
