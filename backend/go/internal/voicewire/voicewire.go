// Package voicewire is the voice-chat wire protocol — the ONE contract the
// app depends on. Everything behind it (VAD, which model thinks, which voice
// answers, where the server runs) is free to change so long as these frames
// keep their meaning.
//
// Transport: a single, always-open WebSocket.
//
//	wss://<voice-host>/v1/voice?token=<clerk session token>
//
// The session is CONTINUOUS. After one `start` the app streams microphone PCM
// forever (binary frames, 16-bit little-endian mono); the server runs the
// turn-taking itself from voice activity — no push-to-talk. The server tells
// the app what it is doing through `state`, reveals text only as speech is
// produced, streams the reply's audio sentence by sentence, and cuts itself
// off the moment the user talks over it.
//
//	app:    {"type":"start","conversationId":"...","sampleRate":16000}
//	app:    <binary PCM frames, continuously>
//	server: {"type":"state","value":"listening"}
//	server: {"type":"state","value":"thinking"}       (user stopped talking)
//	server: {"type":"user","text":"<what you said>"}
//	server: {"type":"tool","name":"memory.recall","status":"start"|"done","hits":n}
//	server: {"type":"state","value":"speaking"}
//	server: {"type":"delta","text":"<one sentence>"}  (revealed as it is voiced)
//	server: {"type":"audio","status":"start"} <binary mp3> {"type":"audio","status":"end"}
//	server: ... (repeats per sentence) ...
//	server: {"type":"state","value":"listening"}
//
// If the user starts speaking while the server is thinking or speaking, the
// server abandons that turn and sends {"type":"interrupt"} — the app stops
// playback at once and the new utterance becomes the next turn. The app may
// send {"type":"ping"} to keep the socket warm; the server answers
// {"type":"pong"}. Errors arrive as {"type":"error","text":"..."} and end the
// turn, not the socket.
package voicewire

// Version is sent by the server in its hello frame; the app refuses a major
// version it does not know.
const Version = "2.0"

// Client → server envelope.
type ClientFrame struct {
	Type string `json:"type"` // start | ping
	// start fields
	ConversationID string `json:"conversationId,omitempty"`
	SampleRate     int    `json:"sampleRate,omitempty"` // default 16000
}

// Server → client envelope.
type ServerFrame struct {
	Type string `json:"type"` // hello | state | user | delta | tool | audio | interrupt | error | pong

	// hello
	Version string `json:"version,omitempty"`
	// state
	Value string `json:"value,omitempty"` // listening | thinking | speaking
	// user / delta / error
	Text string `json:"text,omitempty"`
	// tool / audio
	Name   string `json:"name,omitempty"`
	Status string `json:"status,omitempty"` // start | end | done | failed
	Hits   int    `json:"hits,omitempty"`
	// audio: what the following binary frames contain. "audio/pcm" is raw
	// 16-bit little-endian mono at SampleRate — every chunk independently
	// playable, which is what makes streamed speech safe to cut anywhere.
	// "audio/mpeg" is a complete MP3 and must be decoded whole.
	Mime       string `json:"mime,omitempty"`
	SampleRate int    `json:"sampleRate,omitempty"`
}
