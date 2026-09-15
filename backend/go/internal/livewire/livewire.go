// Package livewire is the live-transcript wire protocol — the contract between
// the app and the transcriber for watching a recording turn into text as it
// happens.
//
// Transport: a single WebSocket.
//
//	wss://<voice-host>/v1/transcribe?token=<clerk session token>
//
// The app sends one `start` naming the audio it is about to relay, then the
// pendant's bytes as binary frames for as long as the screen is open. Text
// comes back as it is recognised.
//
//	app:    {"type":"start","encoding":"mp3"}
//	app:    <binary audio frames, continuously>
//	server: {"type":"ready"}
//	server: {"type":"partial","text":"so what I was saying"}     (revised freely)
//	server: {"type":"final","text":"So what I was saying is."}   (settled)
//	server: {"type":"error","text":"..."}
//
// Partials are the point of this screen — they are what makes it feel live —
// but only a final is stable enough to keep. The app renders the running
// finals plus at most one trailing partial, and replaces that partial every
// time a new one arrives.
//
// This is deliberately not voicewire. That protocol carries turn-taking,
// interruption and synthesised speech because it is a conversation; this one
// carries text in one direction and nothing else, and collapsing the two would
// mean a transcript screen that has to understand what a turn is.
package livewire

// Version is sent in the ready frame; the app refuses a major it does not know.
const Version = "1.0"

// ClientFrame is the app's only control message.
type ClientFrame struct {
	Type string `json:"type"` // start
	// Encoding of the binary frames that follow. The pendant hands its audio
	// over as MP3, which Deepgram accepts directly — decoding it on the phone
	// first would cost battery to produce something larger.
	Encoding string `json:"encoding,omitempty"` // mp3 | linear16
	// Only meaningful for linear16.
	SampleRate int `json:"sampleRate,omitempty"`
}

// ServerFrame is everything coming back.
type ServerFrame struct {
	Type    string `json:"type"` // ready | partial | final | error
	Version string `json:"version,omitempty"`
	Text    string `json:"text,omitempty"`
}
