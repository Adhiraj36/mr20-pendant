// Package livestt relays the pendant's audio to Deepgram and hands the text
// straight back, with nothing in between.
//
// It is a much smaller thing than the voice session next door: no turn-taking,
// no interruption, no model, no speech. Audio in, text out, until the app
// closes the socket. That is the whole feature — someone watching what their
// pendant is hearing become words.
package livestt

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gorilla/websocket"

	"github.com/MelloB1989/mr20-pendant/backend/internal/livewire"
)

// Deepgram closes an idle socket, and a pendant in a quiet room sends nothing
// for minutes at a time. A keepalive costs one small frame and saves a
// reconnect the user would see as the transcript stopping.
const keepAlive = 5 * time.Second

// Handle owns one app connection for its lifetime.
func Handle(ws *fiberws.Conn, userID, deepgramKey string) {
	session := &session{app: ws, key: deepgramKey, user: userID}
	defer session.close()
	session.run()
}

type session struct {
	app  *fiberws.Conn
	key  string
	user string

	mu sync.Mutex
	dg *websocket.Conn
	// Guards against writing to the app socket from the Deepgram reader and
	// the keepalive at the same time; gorilla permits one writer at a time.
	writing sync.Mutex
	done    bool
}

func (s *session) run() {
	for {
		kind, data, err := s.app.ReadMessage()
		if err != nil {
			return
		}
		switch kind {
		case fiberws.TextMessage:
			var frame livewire.ClientFrame
			if err := json.Unmarshal(data, &frame); err != nil {
				s.send(livewire.ServerFrame{Type: "error", Text: "unreadable frame"})
				continue
			}
			if frame.Type == "start" {
				s.start(frame)
			}
		case fiberws.BinaryMessage:
			s.relay(data)
		}
	}
}

func (s *session) start(frame livewire.ClientFrame) {
	url := deepgramURL(frame)
	dg, _, err := websocket.DefaultDialer.Dial(url, http.Header{
		"Authorization": []string{"Token " + s.key},
	})
	if err != nil {
		log.Printf("livestt: deepgram dial failed user=%s err=%v", s.user, err)
		s.send(livewire.ServerFrame{Type: "error", Text: "the transcriber is unreachable"})
		return
	}

	s.mu.Lock()
	if s.dg != nil {
		_ = s.dg.Close()
	}
	s.dg = dg
	s.mu.Unlock()

	s.send(livewire.ServerFrame{Type: "ready", Version: livewire.Version})
	go s.readDeepgram(dg)
	go s.keepAlive(dg)
}

func (s *session) relay(audio []byte) {
	s.mu.Lock()
	dg := s.dg
	s.mu.Unlock()
	if dg == nil {
		// Audio before start. Dropping it loses a fraction of a second at the
		// very beginning, which is better than buffering without a bound.
		return
	}
	if err := dg.WriteMessage(websocket.BinaryMessage, audio); err != nil {
		log.Printf("livestt: relay failed user=%s err=%v", s.user, err)
	}
}

// readDeepgram turns Deepgram's results into the two frames this protocol has.
func (s *session) readDeepgram(dg *websocket.Conn) {
	for {
		_, data, err := dg.ReadMessage()
		if err != nil {
			return
		}
		var result struct {
			Type    string `json:"type"`
			IsFinal bool   `json:"is_final"`
			Channel struct {
				Alternatives []struct {
					Transcript string `json:"transcript"`
				} `json:"alternatives"`
			} `json:"channel"`
		}
		if err := json.Unmarshal(data, &result); err != nil {
			continue
		}
		if result.Type != "Results" || len(result.Channel.Alternatives) == 0 {
			continue
		}
		text := result.Channel.Alternatives[0].Transcript
		if text == "" {
			// Silence produces empty finals constantly; forwarding them would
			// blank the trailing partial on screen for no reason.
			continue
		}
		if result.IsFinal {
			s.send(livewire.ServerFrame{Type: "final", Text: text})
		} else {
			s.send(livewire.ServerFrame{Type: "partial", Text: text})
		}
	}
}

func (s *session) keepAlive(dg *websocket.Conn) {
	ticker := time.NewTicker(keepAlive)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		current, done := s.dg, s.done
		s.mu.Unlock()
		if done || current != dg {
			return
		}
		if err := dg.WriteMessage(websocket.TextMessage, []byte(`{"type":"KeepAlive"}`)); err != nil {
			return
		}
	}
}

func (s *session) send(frame livewire.ServerFrame) {
	s.writing.Lock()
	defer s.writing.Unlock()
	if err := s.app.WriteJSON(frame); err != nil {
		log.Printf("livestt: app write failed user=%s err=%v", s.user, err)
	}
}

func (s *session) close() {
	s.mu.Lock()
	s.done = true
	dg := s.dg
	s.dg = nil
	s.mu.Unlock()
	if dg != nil {
		// Tells Deepgram to flush whatever it is holding before hanging up.
		_ = dg.WriteMessage(websocket.TextMessage, []byte(`{"type":"CloseStream"}`))
		_ = dg.Close()
	}
}

// deepgramURL builds the listen URL for whatever the app said it is sending.
//
// Interim results are the whole point here — they are what makes the screen
// read as live — so unlike the voice session, which consumes and discards
// them, this one forwards them. No VAD events and no endpointing: nothing
// downstream cares where a turn ends, only what was said.
func deepgramURL(frame livewire.ClientFrame) string {
	const base = "wss://api.deepgram.com/v1/listen" +
		"?model=nova-3&language=multi&channels=1&interim_results=true&smart_format=true"

	// MP3 is containerised, so Deepgram reads the rate out of the stream and
	// naming an encoding would only give it a chance to disagree.
	if frame.Encoding == "" || frame.Encoding == "mp3" {
		return base
	}
	rate := frame.SampleRate
	if rate == 0 {
		rate = 16000
	}
	return fmt.Sprintf("%s&encoding=linear16&sample_rate=%d", base, rate)
}
