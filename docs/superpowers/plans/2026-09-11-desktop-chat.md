# Desktop Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the LYZN desktop app a chat screen answered by the KARMAX engine running on the same machine, streaming both the reply and the work it does.

**Architecture:** KARMAX gains three things — a reader over Claude Code's own session files (so conversations need no storage), an optional event sink on the harness so the stream it already parses can be watched instead of discarded, and an NDJSON chat endpoint built on both. The monorepo gains a headless `@lyzn/chat-core` (types, a pure reducer, one hook, a transport interface) that the new desktop screen and the existing mobile screen both render their own primitives against.

**Tech Stack:** Go 1.26 (KARMAX), TypeScript, React 19 + Tailwind (desktop renderer), Electron 33 (main process), React Native / Expo (mobile), node's built-in test runner with `--experimental-strip-types` (shared package).

**Spec:** `docs/superpowers/specs/2026-09-11-desktop-chat-design.md`

## Global Constraints

- **KARMAX is a separate repository.** Tasks 1–3 are work in `$KARMAX_SRC` (the KARMAX checkout), not in this monorepo. Tasks 4–10 are in `mr20-pendant`.
- **The renderer never holds a credential.** The KARMAX API token can invoke `shell.exec`; it stays in the Electron main process. The renderer names intents over IPC and never a URL or a token.
- **The name KARMAX never appears on screen.** "The engine". The assistant is **Mira**.
- **No jargon in UI copy.** "The engine", not "the daemon". Errors say what to do next.
- **Comments are sparse** — one line where the reason is not obvious, explaining *why*, usually by naming the failure the code prevents. Never narrate what a line does.
- **Design tokens only.** Routes use `--fg-dim`, `--skin-2`, `--accent`; a hex literal in a route is a colour that will be wrong in the other theme.
- **`--mcp-config` and `--add-dir` are variadic** in the Claude CLI: any such flag must come *after* the positional prompt or it eats it.
- **Run `npm run test:core` after touching anything in `desktop/electron/`.** It starts a real daemon.
- **A nil `OnEvent` sink must leave existing harness behaviour bit-for-bit identical.** The task runner, loops and `harnessSendTool` all call the same path and are not part of this work.

## File Structure

**KARMAX (`$KARMAX_SRC`):**

| File | Responsibility |
|---|---|
| `internal/chatlog/chatlog.go` | Read Claude Code session jsonl: list, read, delete. The only place that knows that format. |
| `internal/chatlog/slug.go` | Working directory → project directory name. Moved from `claude_code.go`. |
| `internal/chatlog/chatlog_test.go` | Fixture-driven tests, including unknown record types. |
| `internal/harness/supervisor.go:133` | `Options` gains `OnEvent`. |
| `internal/harness/session.go:140` | `Session.Send` gains a sink parameter; the parse loop calls it. |
| `internal/api/chat.go` | New. The four chat routes. |
| `internal/api/chat_test.go` | New. Stream shape against recorded harness output. |

**Monorepo:**

| File | Responsibility |
|---|---|
| `packages/chat-core/src/types.ts` | `TurnEvent`, `Message`, `ToolStep`, `Card`, `ChatState`. |
| `packages/chat-core/src/reduce.ts` | `ask()` and `reduce()`. Pure. Where the logic lives. |
| `packages/chat-core/src/adapter.ts` | The transport interface both apps implement. |
| `packages/chat-core/src/useConversation.ts` | The one hook. |
| `packages/chat-core/test/reduce.test.ts` | Event-sequence tests. |
| `desktop/electron/chat.ts` | Main-process adapter: NDJSON from the engine, broadcast over IPC. |
| `desktop/src/routes/Mira.tsx` | The screen: conversation list + thread. |
| `desktop/src/routes/chat/Turn.tsx` | One turn: steps line, prose, cards. |
| `desktop/src/routes/chat/ReceiptCard.tsx` | The card, three kinds. |
| `mobile/src/state/chat.ts` | Becomes an adapter over the shared reducer. |

---

### Task 1: `internal/chatlog` — read Claude Code's session files

**Files:**
- Create: `$KARMAX_SRC/internal/chatlog/chatlog.go`
- Create: `$KARMAX_SRC/internal/chatlog/slug.go`
- Create: `$KARMAX_SRC/internal/chatlog/chatlog_test.go`
- Create: `$KARMAX_SRC/internal/chatlog/testdata/session-basic.jsonl`
- Modify: `$KARMAX_SRC/internal/tools/builtin/claude_code.go` (use `chatlog.Slug`)

**Interfaces:**
- Consumes: nothing.
- Produces: `chatlog.Dir(workdir string) string`, `chatlog.Slug(workdir string) string`, `chatlog.List(dir string) ([]Conversation, error)`, `chatlog.Read(dir, id string) ([]Message, error)`, `chatlog.Delete(dir, id string) error`, and the types `Conversation{ID, Title, Opening string; Updated time.Time}`, `Message{Role, Text string; At time.Time; Steps []Step}`, `Step{Tool, Phase, Detail string}`.

- [ ] **Step 1: Write the fixture**

Create `testdata/session-basic.jsonl`. Real shape, including record types the reader must ignore:

```jsonl
{"type":"system","subtype":"init","sessionId":"abc-123"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Archive the old screenshots"}]},"timestamp":"2026-09-11T10:00:00.000Z"}
{"type":"ai-title","aiTitle":"Archiving old screenshots","sessionId":"abc-123"}
{"type":"file-history-snapshot","messageId":"x","snapshot":{}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"ls ~/Downloads"}}]},"timestamp":"2026-09-11T10:00:02.000Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Found 14, all from July."}]},"timestamp":"2026-09-11T10:00:05.000Z"}
{"type":"some-future-record-nobody-has-seen","whatever":true}
{"type":"result","is_error":false,"result":"Found 14, all from July."}
```

- [ ] **Step 2: Write the failing test**

```go
package chatlog

import (
	"path/filepath"
	"testing"
)

// A session file is a conversation: its title, its turns, and the tools that
// ran inside them.
func TestReadsATranscript(t *testing.T) {
	msgs, err := Read("testdata", "session-basic")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 2 {
		t.Fatalf("got %d messages, want 2 (user, assistant)", len(msgs))
	}
	if msgs[0].Role != "user" || msgs[0].Text != "Archive the old screenshots" {
		t.Errorf("first message = %+v", msgs[0])
	}
	if msgs[1].Role != "assistant" || msgs[1].Text != "Found 14, all from July." {
		t.Errorf("second message = %+v", msgs[1])
	}
	if len(msgs[1].Steps) != 1 || msgs[1].Steps[0].Tool != "Bash" {
		t.Errorf("steps = %+v, want one Bash step", msgs[1].Steps)
	}
}

// A record type this build has never seen is skipped, not an error. The format
// belongs to another program and will grow types without asking.
func TestUnknownRecordTypesAreSkipped(t *testing.T) {
	if _, err := Read("testdata", "session-basic"); err != nil {
		t.Fatalf("an unknown record type broke the read: %v", err)
	}
}

// The list is what the conversation column renders.
func TestListsWithTitleAndOpening(t *testing.T) {
	convs, err := List("testdata")
	if err != nil {
		t.Fatal(err)
	}
	if len(convs) != 1 {
		t.Fatalf("got %d conversations, want 1", len(convs))
	}
	c := convs[0]
	if c.ID != "session-basic" {
		t.Errorf("id = %q", c.ID)
	}
	if c.Title != "Archiving old screenshots" {
		t.Errorf("title = %q, want the ai-title record", c.Title)
	}
	if c.Opening != "Archive the old screenshots" {
		t.Errorf("opening = %q, want the first user turn", c.Opening)
	}
	if c.Updated.IsZero() {
		t.Error("updated is zero; the list sorts on it")
	}
}

// The slug is how a working directory becomes a project directory name, and it
// has to match what the CLI itself does or every path is wrong.
func TestSlug(t *testing.T) {
	got := Slug("/Users/x/Developer/code/my_app.v2")
	want := "-Users-x-Developer-code-my-app-v2"
	if got != want {
		t.Fatalf("Slug() = %q, want %q", got, want)
	}
	if Dir("/Users/x") != filepath.Join(homeDir(), ".claude", "projects", "-Users-x") {
		t.Errorf("Dir() = %q", Dir("/Users/x"))
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd $KARMAX_SRC && go test ./internal/chatlog/ -v`
Expected: FAIL — the package does not compile, `undefined: Read`.

- [ ] **Step 4: Write `slug.go`**

```go
// Package chatlog reads the conversations Claude Code already keeps.
//
// KARMAX stores no chat history of its own. A conversation IS a harness
// session: the CLI writes the transcript, titles it, and compacts it, at
// ~/.claude/projects/<slug>/<session-id>.jsonl. This package is the only
// place that knows that, so the day the format moves there is one file to fix.
//
// Every reader here skips record types it does not recognise. The format
// belongs to another program and gains types without asking; a reader that
// errors on an unknown line would break on somebody else's release.
package chatlog

import (
	"os"
	"path/filepath"
	"strings"
)

var slugger = strings.NewReplacer("/", "-", ".", "-", "_", "-")

// Slug turns a working directory into the directory name the CLI uses for it.
func Slug(workdir string) string { return slugger.Replace(workdir) }

// Dir is where a working directory's sessions live.
func Dir(workdir string) string {
	return filepath.Join(homeDir(), ".claude", "projects", Slug(workdir))
}

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return home
}
```

- [ ] **Step 5: Write `chatlog.go`**

```go
package chatlog

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Conversation struct {
	ID      string    `json:"id"`
	Title   string    `json:"title"`
	Opening string    `json:"opening"`
	Updated time.Time `json:"updated"`
}

// Message is one turn as a client needs it. Steps are the tool_use blocks that
// were inside that assistant message, so a transcript read back from disk
// shows the same step line a live turn showed.
type Message struct {
	Role  string    `json:"role"`
	Text  string    `json:"text"`
	At    time.Time `json:"at"`
	Steps []Step    `json:"steps"`
}

type Step struct {
	Tool   string `json:"tool"`
	Phase  string `json:"phase"` // always "done": a transcript has no live steps
	Detail string `json:"detail"`
}

// record is the subset of the CLI's line format this package reads.
type record struct {
	Type      string `json:"type"`
	AITitle   string `json:"aiTitle"`
	Timestamp string `json:"timestamp"`
	Message   struct {
		Role    string `json:"role"`
		Content []struct {
			Type  string          `json:"type"`
			Text  string          `json:"text"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
	} `json:"message"`
}

// scan walks one session file, handing each decoded record to fn.
func scan(path string, fn func(record)) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	// A single line carries a whole message and can be large; the 64KB default
	// would truncate one and take the rest of the transcript with it.
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for sc.Scan() {
		var r record
		if json.Unmarshal(sc.Bytes(), &r) != nil {
			continue
		}
		fn(r)
	}
	return sc.Err()
}

func Read(dir, id string) ([]Message, error) {
	var out []Message
	err := scan(filepath.Join(dir, id+".jsonl"), func(r record) {
		if r.Type != "user" && r.Type != "assistant" {
			return
		}
		msg := Message{Role: r.Type, At: parseTime(r.Timestamp), Steps: []Step{}}
		for _, c := range r.Message.Content {
			switch c.Type {
			case "text":
				msg.Text += c.Text
			case "tool_use":
				msg.Steps = append(msg.Steps, Step{Tool: c.Name, Phase: "done"})
			}
		}
		if msg.Text == "" && len(msg.Steps) == 0 {
			return
		}
		// The CLI splits one assistant turn across several records — tools in
		// one, prose in the next. Merging them keeps a turn a turn.
		if n := len(out); n > 0 && out[n-1].Role == msg.Role {
			out[n-1].Text += msg.Text
			out[n-1].Steps = append(out[n-1].Steps, msg.Steps...)
			return
		}
		out = append(out, msg)
	})
	return out, err
}

func List(dir string) ([]Conversation, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []Conversation{}, nil // nobody has chatted here yet
	}
	if err != nil {
		return nil, err
	}
	out := []Conversation{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".jsonl")
		c := Conversation{ID: id}
		if info, err := e.Info(); err == nil {
			c.Updated = info.ModTime()
		}
		_ = scan(filepath.Join(dir, e.Name()), func(r record) {
			if r.Type == "ai-title" && c.Title == "" {
				c.Title = r.AITitle
			}
			if r.Type == "user" && c.Opening == "" {
				for _, part := range r.Message.Content {
					if part.Type == "text" {
						c.Opening = trim(part.Text, 140)
						break
					}
				}
			}
		})
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated.After(out[j].Updated) })
	return out, nil
}

func Delete(dir, id string) error {
	err := os.Remove(filepath.Join(dir, id+".jsonl"))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func parseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

func trim(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd $KARMAX_SRC && go test ./internal/chatlog/ -v`
Expected: PASS, four tests.

- [ ] **Step 7: Point `claude_code.go` at the shared slug**

In `internal/tools/builtin/claude_code.go`, `removeClaudeSession` builds the path with its own `strings.NewReplacer`. Replace its body's path construction with `filepath.Join(chatlog.Dir(workingDir), sessionID+".jsonl")` and delete the local replacer. Two places building one path is how they drift.

- [ ] **Step 8: Verify nothing else broke**

Run: `cd $KARMAX_SRC && go build ./... && go vet ./... && go test ./... 2>&1 | grep -v "^ok\|no test files"`
Expected: no output after the grep.

- [ ] **Step 9: Commit**

```bash
cd $KARMAX_SRC
git add internal/chatlog internal/tools/builtin/claude_code.go
git commit -m "Conversations are the ones Claude Code already keeps

KARMAX stored a single app thread per agent and called wiping it 'a new
conversation'. It never needed to store any: the CLI writes each session's
transcript, titles it with an ai-title record and compacts it, all on disk.

This reads that. Unknown record types are skipped rather than fatal — the
format belongs to another program and gains types without asking."
```

---

### Task 2: The harness stream can be watched

**Files:**
- Modify: `$KARMAX_SRC/internal/harness/supervisor.go:133` (Options), `:181` (the call)
- Modify: `$KARMAX_SRC/internal/harness/session.go:59` (args), `:140` (Send), `:176` (the parse loop)
- Create: `$KARMAX_SRC/internal/harness/sink_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `harness.Event{Kind, Text, Tool, Phase, JobID string}`, `harness.Options.OnEvent func(Event)`. Kinds are `"text"`, `"tool"`, `"error"`. Phases are `"start"`, `"done"`, `"failed"`.

- [ ] **Step 1: Write the failing test**

```go
package harness

import "testing"

// The sink sees the turn as it happens, in order.
//
// Without this the desktop chat is a three-minute spinner: the events are
// already parsed on the way to building a Turn and were simply discarded.
func TestSinkSeesTextAndTools(t *testing.T) {
	var got []Event
	sink := func(e Event) { got = append(got, e) }

	replay(sink, []event{
		{Type: "assistant", Message: message{Content: []content{{Type: "text", Text: "Look"}}}},
		{Type: "assistant", Message: message{Content: []content{{Type: "tool_use", Name: "Bash"}}}},
		{Type: "assistant", Message: message{Content: []content{{Type: "text", Text: "ing…"}}}},
	})

	want := []Event{
		{Kind: "text", Text: "Look"},
		{Kind: "tool", Tool: "Bash", Phase: "start"},
		{Kind: "text", Text: "ing…"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d events, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("event %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

// A nil sink must change nothing at all. Every existing caller — the task
// runner, loops, harnessSendTool — goes through this same path.
func TestNilSinkIsSafe(t *testing.T) {
	replay(nil, []event{
		{Type: "assistant", Message: message{Content: []content{{Type: "text", Text: "hi"}}}},
	})
}
```

Note: `replay` is a helper you add in Step 3 that runs the same `switch` the
live loop runs, so the test does not need a subprocess.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd $KARMAX_SRC && go test ./internal/harness/ -run TestSink -v`
Expected: FAIL — `undefined: Event`, `undefined: replay`.

- [ ] **Step 3: Add the type, the sink, and the replay helper**

In `session.go`, above `Send`:

```go
// Event is one thing worth telling a caller while a turn is still running.
//
// The harness can only report what it sees, so this set is narrower than the
// one on the wire: "conversation" and "done" are the endpoint's, added there
// because the harness has no business knowing about either.
type Event struct {
	Kind  string // "text" | "tool" | "error"
	Text  string
	Tool  string
	Phase string // for tool: "start" | "done" | "failed"
	JobID string
}

// emit hands one parsed CLI event to the sink, if there is one.
func emit(sink func(Event), ev event) {
	if sink == nil {
		return
	}
	switch ev.Type {
	case "assistant":
		for _, c := range ev.Message.Content {
			switch c.Type {
			case "text":
				sink(Event{Kind: "text", Text: c.Text})
			case "tool_use":
				sink(Event{Kind: "tool", Tool: c.Name, Phase: "start"})
			}
		}
	}
}

// replay drives emit over a fixed list, so the sink can be tested without a
// subprocess.
func replay(sink func(Event), evs []event) {
	for _, ev := range evs {
		emit(sink, ev)
	}
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd $KARMAX_SRC && go test ./internal/harness/ -run TestSink -v`
Expected: PASS, both tests.

- [ ] **Step 5: Thread the sink through the live path**

`session.go` — change the signature and call `emit` at the top of the `case ev, ok := <-s.events:` branch, before the existing `switch ev.Type`:

```go
func (s *Session) Send(ctx context.Context, text string, timeout time.Duration, sink func(Event)) (Turn, error) {
```

```go
		case ev, ok := <-s.events:
			if !ok {
				return turn, fmt.Errorf("harness exited mid-turn")
			}
			emit(sink, ev)
			switch ev.Type {
```

`supervisor.go:133` — add to `Options`:

```go
	// OnEvent watches the turn as it happens. Nil behaves exactly as before,
	// which is what keeps every existing caller out of this change.
	OnEvent func(Event)
```

`supervisor.go:181`:

```go
	turn, err := sess.Send(ctx, text, pol.TurnTimeout, opt.OnEvent)
```

- [ ] **Step 6: Ask the CLI for token-level deltas**

`session.go:59`, in `spawn`'s args — after `"--verbose"`:

```go
		// Without this, text arrives per completed block; with it, per token.
		// The chat is the only caller that shows text as it lands.
		"--include-partial-messages",
```

- [ ] **Step 7: Verify the whole engine still builds and passes**

Run: `cd $KARMAX_SRC && go build ./... && go vet ./... && go test ./... 2>&1 | grep -v "^ok\|no test files"`
Expected: no output. If `fallback_test.go` or `live_test.go` fail to compile, they call `sup.Send` (unchanged) not `sess.Send` — check you did not change the Supervisor signature.

- [ ] **Step 8: Commit**

```bash
cd $KARMAX_SRC
git add internal/harness
git commit -m "The turn can be watched while it happens

The harness already ran Claude Code with stream-json and already parsed
assistant, tool_use and result on the way to building a Turn — then threw the
live events away. A caller that wanted to show somebody what was happening
had nothing to show until the whole turn finished.

An optional sink, and --include-partial-messages so text arrives per token
rather than per block. A nil sink is the old behaviour exactly, which is what
keeps the task runner and the loops out of this."
```

---

### Task 3: The streaming chat endpoint

**Files:**
- Create: `$KARMAX_SRC/internal/api/chat.go`
- Create: `$KARMAX_SRC/internal/api/chat_test.go`
- Modify: `$KARMAX_SRC/internal/api/server.go` (register four routes)

**Interfaces:**
- Consumes: `chatlog.Dir/List/Read/Delete` (Task 1), `harness.Options.OnEvent` and `harness.Event` (Task 2).
- Produces: `POST /api/chat/stream`, `GET /api/chat/conversations`, `GET /api/chat/conversations/{id}`, `DELETE /api/chat/conversations/{id}`. Wire event kinds: `conversation` | `text` | `tool` | `ticket` | `done` | `error`.

- [ ] **Step 1: Write the failing test**

```go
package api

import (
	"encoding/json"
	"strings"
	"testing"
)

// The wire carries two events the harness never emits, and they bracket the
// ones it does.
func TestStreamBracketsHarnessEventsWithConversationAndDone(t *testing.T) {
	var lines []string
	w := &lineSink{onLine: func(s string) { lines = append(lines, s) }}

	streamTurn(w, "sess-1", true, func(sink func(harnessEvent)) (string, error) {
		sink(harnessEvent{Kind: "text", Text: "Found "})
		sink(harnessEvent{Kind: "tool", Tool: "Bash", Phase: "start"})
		sink(harnessEvent{Kind: "text", Text: "14."})
		return "Found 14.", nil
	})

	kinds := kindsOf(t, lines)
	want := []string{"conversation", "text", "tool", "text", "done"}
	if strings.Join(kinds, ",") != strings.Join(want, ",") {
		t.Fatalf("kinds = %v, want %v", kinds, want)
	}
}

// An existing conversation is not re-announced; the client already has the id.
func TestExistingConversationIsNotAnnounced(t *testing.T) {
	var lines []string
	w := &lineSink{onLine: func(s string) { lines = append(lines, s) }}
	streamTurn(w, "sess-1", false, func(sink func(harnessEvent)) (string, error) {
		sink(harnessEvent{Kind: "text", Text: "hi"})
		return "hi", nil
	})
	if got := kindsOf(t, lines); got[0] != "text" {
		t.Fatalf("first event = %q, want text", got[0])
	}
}

// A failure after partial output still ends the stream with something the
// client can act on. Headers left long ago; a status code is not available.
func TestFailureEndsTheStream(t *testing.T) {
	var lines []string
	w := &lineSink{onLine: func(s string) { lines = append(lines, s) }}
	streamTurn(w, "sess-1", false, func(sink func(harnessEvent)) (string, error) {
		sink(harnessEvent{Kind: "text", Text: "partial"})
		return "", errTest
	})
	kinds := kindsOf(t, lines)
	if kinds[len(kinds)-1] != "error" {
		t.Fatalf("last event = %q, want error", kinds[len(kinds)-1])
	}
}

func kindsOf(t *testing.T, lines []string) []string {
	t.Helper()
	var out []string
	for _, l := range lines {
		if strings.TrimSpace(l) == "" {
			continue
		}
		var e struct {
			Kind string `json:"kind"`
		}
		if err := json.Unmarshal([]byte(l), &e); err != nil {
			t.Fatalf("line is not JSON: %q", l)
		}
		out = append(out, e.Kind)
	}
	return out
}
```

You will add `lineSink`, `errTest`, `harnessEvent` and `streamTurn` in Step 3.
`harnessEvent` is a local alias for `harness.Event` so this file does not import
the harness package for a type it only forwards.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd $KARMAX_SRC && go test ./internal/api/ -run TestStream -v`
Expected: FAIL — `undefined: streamTurn`.

- [ ] **Step 3: Write `chat.go`**

```go
// The chat, streamed.
//
// The existing /api/chat stays: the phone-app route and the task runner use
// it and have no reason to move. This is the surface the desktop screen needs,
// which is the same turn with the middle shown rather than swallowed.
//
// Newline-delimited JSON rather than SSE: the client is a desktop app reading
// a stream it opened, not a browser wanting reconnection semantics, and one
// object per line is the least there is to get wrong on either side.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/MelloB1989/karmax/internal/chatlog"
	"github.com/MelloB1989/karmax/internal/harness"
	"github.com/MelloB1989/karmax/internal/hostpaths"
)

type harnessEvent = harness.Event

var errTest = errors.New("turn failed")

// lineSink is a writer that reports whole lines, so the stream's shape can be
// asserted without an HTTP server.
type lineSink struct {
	onLine func(string)
	buf    strings.Builder
}

func (l *lineSink) Write(p []byte) (int, error) {
	l.buf.Write(p)
	for {
		s := l.buf.String()
		i := strings.IndexByte(s, '\n')
		if i < 0 {
			break
		}
		l.onLine(s[:i])
		l.buf.Reset()
		l.buf.WriteString(s[i+1:])
	}
	return len(p), nil
}

func (l *lineSink) Flush() {}

// flusher is what a streaming response needs and a test does not.
type flusher interface{ Flush() }

// streamTurn writes one turn's events as NDJSON.
//
// `run` is the turn itself, given the sink to report through. Split out so the
// wire format is testable without a harness, a subprocess or a model.
func streamTurn(w io.Writer, conversationID string, isNew bool,
	run func(sink func(harnessEvent)) (string, error)) {

	enc := json.NewEncoder(w)
	send := func(v any) {
		_ = enc.Encode(v)
		if f, ok := w.(flusher); ok {
			f.Flush()
		}
	}

	if isNew {
		send(map[string]any{"kind": "conversation", "id": conversationID})
	}

	text, err := run(func(e harnessEvent) {
		// Each kind writes only its own fields. A blanket dump would put an
		// empty "tool" on every text delta, and the client's union would have
		// to treat every field as optional to read it.
		obj := map[string]any{"kind": e.Kind}
		switch e.Kind {
		case "text", "error":
			obj["text"] = e.Text
		case "tool":
			obj["tool"], obj["phase"] = e.Tool, e.Phase
		case "ticket":
			// A ticket's title rides in Text: harness.Event has no title field
			// and giving it one would put a chat's concern in the harness.
			obj["jobId"], obj["title"] = e.JobID, e.Text
		}
		send(obj)
	})

	if err != nil {
		// The error goes down the stream, not into a status code: the headers
		// left before the first token did.
		send(map[string]any{"kind": "error", "text": err.Error()})
		return
	}
	send(map[string]any{"kind": "done", "text": text})
}

// tickets reports the background jobs a finished turn started.
//
// Not a harness event, because the harness cannot know: a delegation's job id
// is in the tool's RESULT, and the session loop only reads assistant messages
// on its way to a Turn. Reading the completed turn's tool calls is both simpler
// and correct — a card for background work can only be useful after the turn
// ends, and the turn ends quickly precisely because the work went to the
// background.
func tickets(turn harness.Turn) []map[string]any {
	var out []map[string]any
	for _, tc := range turn.ToolCalls {
		if tc.Name != "claude_code.call" && tc.Name != "codex.call" {
			continue
		}
		var in struct {
			Background bool   `json:"background"`
			Prompt     string `json:"prompt"`
			JobID      string `json:"job_id"`
		}
		if json.Unmarshal(tc.Input, &in) != nil || !in.Background {
			continue
		}
		out = append(out, map[string]any{
			"kind": "ticket", "jobId": in.JobID, "title": trim(in.Prompt, 80),
		})
	}
	return out
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd $KARMAX_SRC && go test ./internal/api/ -run TestStream -v`
Expected: PASS, three tests.

- [ ] **Step 5: Add the handlers and routes**

```go
func (s *Server) chatDir() string { return chatlog.Dir(hostpaths.WorkDir()) }

func (s *Server) handleChatConversations(w http.ResponseWriter, r *http.Request) {
	convs, err := chatlog.List(s.chatDir())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	// The brain is named so the screen can explain an empty list rather than
	// just showing one: Codex keeps its sessions elsewhere and in another shape.
	writeJSON(w, http.StatusOK, map[string]any{
		"conversations": convs,
		"brain":         s.brainName(),
	})
}

func (s *Server) handleChatHistory(w http.ResponseWriter, r *http.Request) {
	msgs, err := chatlog.Read(s.chatDir(), r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "no such conversation"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

func (s *Server) handleChatDelete(w http.ResponseWriter, r *http.Request) {
	if err := chatlog.Delete(s.chatDir(), r.PathValue("id")); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s *Server) handleChatStream(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ConversationID string `json:"conversationId"`
		Message        string `json:"message"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(body.Message) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "message is required"})
		return
	}
	if s.harness == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "the brain is not running"})
		return
	}

	id, isNew := body.ConversationID, false
	if strings.TrimSpace(id) == "" {
		id, isNew = uuid.New().String(), true
	}

	// Nothing may buffer this. A progress stream that arrives at the end is
	// not a progress stream.
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	var finished harness.Turn
	streamTurn(w, id, isNew, func(sink func(harnessEvent)) (string, error) {
		turn, err := s.harness.SendWith(r.Context(), "chat:"+id, "chat", body.Message,
			harness.Options{OnEvent: sink})
		finished = turn
		// Background jobs are announced from the finished turn, before `done`,
		// because their ids only exist once the tool has returned.
		for _, t := range tickets(turn) {
			sink(harnessEvent{Kind: "ticket", JobID: t["jobId"].(string), Text: t["title"].(string)})
		}
		return turn.Text, err
	})
	_ = finished
}
```

- [ ] **Step 5b: Add the ticket test**

```go
// A background delegation becomes a ticket event, before done.
func TestBackgroundWorkBecomesATicket(t *testing.T) {
	var lines []string
	w := &lineSink{onLine: func(s string) { lines = append(lines, s) }}
	streamTurn(w, "s", false, func(sink func(harnessEvent)) (string, error) {
		sink(harnessEvent{Kind: "text", Text: "That will take a while."})
		sink(harnessEvent{Kind: "ticket", JobID: "job-1", Text: "Refactor the auth module"})
		return "That will take a while.", nil
	})
	kinds := kindsOf(t, lines)
	if strings.Join(kinds, ",") != "text,ticket,done" {
		t.Fatalf("kinds = %v", kinds)
	}
}
```

Run: `cd $KARMAX_SRC && go test ./internal/api/ -run TestStream -v` — PASS.

Register in `server.go`, beside the existing `/api/chat`:

```go
	mux.HandleFunc("POST /api/chat/stream", srv.auth(srv.handleChatStream))
	mux.HandleFunc("GET /api/chat/conversations", srv.auth(srv.handleChatConversations))
	mux.HandleFunc("GET /api/chat/conversations/{id}", srv.auth(srv.handleChatHistory))
	mux.HandleFunc("DELETE /api/chat/conversations/{id}", srv.auth(srv.handleChatDelete))
```

`s.brainName()` returns `"claude"` or `"codex"` from the config the harness was
built with; add it beside `resolveAgent` if it does not exist.

- [ ] **Step 6: Verify against a live engine**

Run: `cd $KARMAX_SRC && go build ./... && go vet ./... && go test ./... 2>&1 | grep -v "^ok\|no test files"`
Then start it and drive the real endpoint:

```bash
karmax start &
curl -N -H "Authorization: Bearer $KARMAX_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say the word PELICAN and nothing else."}' \
  http://127.0.0.1:9191/api/chat/stream
```

Expected: a `conversation` line immediately, one or more `text` lines arriving
*before* the command returns, then `done`. If everything appears at once, a
flush is missing.

- [ ] **Step 7: Commit**

```bash
cd $KARMAX_SRC
git add internal/api/chat.go internal/api/chat_test.go internal/api/server.go
git commit -m "A chat turn you can watch

/api/chat answers in one blob after up to three minutes, which is the right
shape for the phone route and the task runner and the wrong one for somebody
sitting in front of it.

This streams the same turn: the conversation id first when there is a new one,
then the text and tool events the harness now forwards, then the outcome. The
wire carries two kinds the harness never emits — conversation and done —
because the harness has no business knowing about either."
```

---

### Task 4: `@lyzn/chat-core` — types and the reducer

**Files:**
- Create: `packages/chat-core/package.json`, `tsconfig.json`
- Create: `packages/chat-core/src/types.ts`, `src/reduce.ts`, `src/index.ts`
- Create: `packages/chat-core/test/reduce.test.ts`

**Interfaces:**
- Consumes: the wire event kinds from Task 3.
- Produces: `TurnEvent`, `Message`, `ToolStep`, `Card`, `ChatState`, `empty()`, `ask(state, text)`, `reduce(state, event)`.

- [ ] **Step 1: Write `package.json` and `tsconfig.json`**

Mirror `packages/design` exactly — same `file:` linking story, same test runner.

```json
{
  "name": "@lyzn/chat-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "tsc -p tsconfig.json --noEmit && node --test --experimental-strip-types test/*.test.ts"
  },
  "devDependencies": { "typescript": "~5.8.3", "@types/node": "^22.14.0" }
}
```

Copy `packages/design/tsconfig.json` verbatim.

- [ ] **Step 2: Write the failing tests**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { empty, ask, reduce } from '../src/reduce.ts'

// Deltas accumulate into one reply rather than one bubble each.
test('text deltas accumulate', () => {
  let s = ask(empty(), 'hello')
  s = reduce(s, { kind: 'text', text: 'Found ' })
  s = reduce(s, { kind: 'text', text: '14.' })
  const last = s.messages.at(-1)!
  assert.equal(last.role, 'assistant')
  assert.equal(last.text, 'Found 14.')
  assert.equal(last.streaming, true)
})

// A tool resolves the step it started, in place. Two steps for one tool call
// is the bug this prevents.
test('a tool start then done updates one step', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'tool', tool: 'Bash', phase: 'start' })
  s = reduce(s, { kind: 'tool', tool: 'Bash', phase: 'done' })
  assert.deepEqual(s.messages.at(-1)!.steps, [{ tool: 'Bash', phase: 'done' }])
})

// Two calls to the same tool: done resolves the most recent unfinished one.
test('done resolves the latest unfinished step of that tool', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'tool', tool: 'Bash', phase: 'start' })
  s = reduce(s, { kind: 'tool', tool: 'Bash', phase: 'done' })
  s = reduce(s, { kind: 'tool', tool: 'Bash', phase: 'start' })
  const steps = s.messages.at(-1)!.steps
  assert.equal(steps.length, 2)
  assert.equal(steps[0].phase, 'done')
  assert.equal(steps[1].phase, 'start')
})

// A tool event before any text still has a reply to attach to.
test('a tool before any text creates the assistant turn', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'tool', tool: 'Read', phase: 'start' })
  assert.equal(s.messages.at(-1)!.role, 'assistant')
  assert.equal(s.messages.at(-1)!.steps.length, 1)
})

// A ticket becomes a card on the reply being written.
test('a ticket becomes a card', () => {
  let s = ask(empty(), 'refactor auth')
  s = reduce(s, { kind: 'ticket', jobId: 'job-1', title: 'Refactor the auth module' })
  const card = s.messages.at(-1)!.cards[0]
  assert.equal(card.kind, 'ticket')
  assert.equal(card.id, 'job-1')
  assert.equal(card.live, true)
})

// The final result is authoritative: partial deltas can be truncated or
// re-emitted, and the turn's own answer is the one to keep.
test('done replaces the text and settles the turn', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'text', text: 'Found 1' })
  s = reduce(s, { kind: 'done', text: 'Found 14, all from July.' })
  const last = s.messages.at(-1)!
  assert.equal(last.text, 'Found 14, all from July.')
  assert.equal(last.streaming, false)
  assert.equal(s.busy, false)
})

// A done with no text keeps what streamed rather than blanking the reply.
test('done without text keeps what arrived', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'text', text: 'partial answer' })
  s = reduce(s, { kind: 'done' })
  assert.equal(s.messages.at(-1)!.text, 'partial answer')
})

// An error after partial output keeps the output and marks the turn failed,
// so retry has something to show and the person can see how far it got.
test('an error keeps partial text and marks the turn failed', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'text', text: 'I started' })
  s = reduce(s, { kind: 'error', text: 'the engine stopped' })
  const last = s.messages.at(-1)!
  assert.equal(last.text, 'I started')
  assert.equal(last.failed, true)
  assert.equal(s.busy, false)
})

test('the conversation id is recorded', () => {
  const s = reduce(ask(empty(), 'hi'), { kind: 'conversation', id: 'sess-9' })
  assert.equal(s.conversationId, 'sess-9')
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd packages/chat-core && npm install && npm test`
Expected: FAIL — cannot resolve `../src/reduce.ts`.

- [ ] **Step 4: Write `types.ts`**

```ts
/** One thing the engine says while a turn is running.
 *
 *  Closed on purpose: the reducer is a switch over this, and a kind nobody
 *  handles is a silent no-op rather than a visible bug. */
export type TurnEvent =
  | { kind: 'conversation'; id: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: string; phase: 'start' | 'done' | 'failed'; detail?: string }
  | { kind: 'ticket'; jobId: string; title: string }
  | { kind: 'done'; text?: string; costUsd?: number }
  | { kind: 'error'; text: string }

export interface ToolStep {
  tool: string
  phase: 'start' | 'done' | 'failed'
  detail?: string
}

/** Something the assistant made or started, that you can go and look at. */
export interface Card {
  kind: 'ticket' | 'loop' | 'dashboard'
  id: string
  title: string
  status: string
  /** Still moving — the card shows a pulsing dot and expects updates. */
  live: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  steps: ToolStep[]
  cards: Card[]
  streaming?: boolean
  failed?: boolean
}

export interface ChatState {
  conversationId: string | null
  messages: Message[]
  busy: boolean
}
```

- [ ] **Step 5: Write `reduce.ts`**

```ts
import type { ChatState, Message, TurnEvent } from './types.ts'

export const empty = (): ChatState => ({ conversationId: null, messages: [], busy: false })

let seq = 0
const id = () => `m${++seq}`

/** The person asks. The empty reply is created here so every event that
 *  follows has somewhere to land, whatever order they arrive in. */
export function ask(state: ChatState, text: string): ChatState {
  const user: Message = { id: id(), role: 'user', text, steps: [], cards: [] }
  const reply: Message = { id: id(), role: 'assistant', text: '', steps: [], cards: [], streaming: true }
  return { ...state, busy: true, messages: [...state.messages, user, reply] }
}

export function reduce(state: ChatState, event: TurnEvent): ChatState {
  if (event.kind === 'conversation') return { ...state, conversationId: event.id }

  const messages = [...state.messages]
  let i = messages.length - 1
  if (i < 0 || messages[i].role !== 'assistant') {
    // An event with no reply to attach to: the turn began elsewhere, or was
    // restored from history. Make somewhere for it rather than dropping it.
    messages.push({ id: id(), role: 'assistant', text: '', steps: [], cards: [], streaming: true })
    i = messages.length - 1
  }
  const m = { ...messages[i], steps: [...messages[i].steps], cards: [...messages[i].cards] }
  messages[i] = m

  switch (event.kind) {
    case 'text':
      m.text += event.text
      return { ...state, messages }

    case 'tool': {
      if (event.phase === 'start') {
        m.steps.push({ tool: event.tool, phase: 'start', detail: event.detail })
        return { ...state, messages }
      }
      // Resolve the most recent unfinished step for this tool. Searching
      // backwards is what makes two calls to the same tool two steps.
      for (let k = m.steps.length - 1; k >= 0; k--) {
        if (m.steps[k].tool === event.tool && m.steps[k].phase === 'start') {
          m.steps[k] = { ...m.steps[k], phase: event.phase, detail: event.detail ?? m.steps[k].detail }
          break
        }
      }
      return { ...state, messages }
    }

    case 'ticket':
      m.cards.push({ kind: 'ticket', id: event.jobId, title: event.title, status: 'Running', live: true })
      return { ...state, messages }

    case 'done':
      // The turn's own answer wins over the deltas: a partial stream can be
      // truncated, and this is the text the engine stands behind.
      if (event.text) m.text = event.text
      m.streaming = false
      return { ...state, messages, busy: false }

    case 'error':
      m.streaming = false
      m.failed = true
      return { ...state, messages, busy: false }
  }
}
```

`src/index.ts` re-exports both modules, the way `packages/design/src/index.ts` does.

- [ ] **Step 6: Run them to verify they pass**

Run: `cd packages/chat-core && npm test`
Expected: PASS, nine tests, and `tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add packages/chat-core
git commit -m "chat-core: the part of a chat that is not a rectangle

React Native and the DOM cannot share a rendered component, so the two chat
screens share the half that is decisions: what a turn is, how deltas
accumulate, when a step resolves, what a ticket becomes.

Every interesting case is here and testable with no app, no network and no
renderer — a tool failing mid-turn, a ticket before the text finishes, an
error after partial output, two calls to the same tool."
```

---

### Task 5: `@lyzn/chat-core` — the adapter and the hook

**Files:**
- Create: `packages/chat-core/src/adapter.ts`, `src/useConversation.ts`
- Modify: `packages/chat-core/package.json` (add react as a peer)
- Create: `packages/chat-core/test/useConversation.test.ts`

**Interfaces:**
- Consumes: `ChatState`, `ask`, `reduce`, `empty` (Task 4).
- Produces: `interface Adapter`, `useConversation(adapter, conversationId)` returning `{ state, send, retry, stop }`.

- [ ] **Step 1: Write `adapter.ts`**

```ts
import type { Message, TurnEvent } from './types.ts'

export interface ConversationSummary {
  id: string
  title: string
  opening: string
  updated: string
}

/** How a chat reaches its engine. The package does no I/O itself: the desktop
 *  reads NDJSON from KARMAX over IPC, the phone reads SSE from the backend,
 *  and neither transport belongs in shared code. */
export interface Adapter {
  send(conversationId: string | null, text: string, onEvent: (e: TurnEvent) => void): Promise<void>
  stop(): void
  list(): Promise<ConversationSummary[]>
  history(id: string): Promise<Message[]>
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { empty, ask, reduce } from '../src/reduce.ts'
import type { Adapter } from '../src/adapter.ts'

// The hook is thin; what is worth testing is that a whole turn driven through
// an adapter lands in the state the screen renders.
test('a turn driven through an adapter lands in state', async () => {
  const adapter: Adapter = {
    async send(_id, _text, onEvent) {
      onEvent({ kind: 'conversation', id: 'sess-1' })
      onEvent({ kind: 'tool', tool: 'Bash', phase: 'start' })
      onEvent({ kind: 'text', text: 'Found 14.' })
      onEvent({ kind: 'tool', tool: 'Bash', phase: 'done' })
      onEvent({ kind: 'done', text: 'Found 14.' })
    },
    stop() {},
    async list() { return [] },
    async history() { return [] },
  }

  let s = ask(empty(), 'archive them')
  await adapter.send(null, 'archive them', (e) => { s = reduce(s, e) })

  assert.equal(s.conversationId, 'sess-1')
  assert.equal(s.busy, false)
  assert.equal(s.messages.at(-1)!.text, 'Found 14.')
  assert.deepEqual(s.messages.at(-1)!.steps, [{ tool: 'Bash', phase: 'done', detail: undefined }])
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/chat-core && npm test`
Expected: FAIL — cannot resolve `../src/adapter.ts`.

- [ ] **Step 4: Write `useConversation.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Adapter } from './adapter.ts'
import { ask, empty, reduce } from './reduce.ts'
import type { ChatState } from './types.ts'

/** One conversation, held outside the screen.
 *
 *  The reply reduces into this state rather than into component state:
 *  leaving the thread mid-answer must not kill the turn. */
export function useConversation(adapter: Adapter, conversationId: string | null) {
  const [state, setState] = useState<ChatState>(empty())
  const lastAsked = useRef<string>('')

  useEffect(() => {
    let live = true
    if (!conversationId) { setState(empty()); return }
    void adapter.history(conversationId).then((messages) => {
      if (live) setState({ conversationId, messages, busy: false })
    })
    return () => { live = false }
  }, [adapter, conversationId])

  const send = useCallback(async (text: string) => {
    lastAsked.current = text
    let next = ask(state, text)
    setState(next)
    await adapter.send(state.conversationId, text, (e) => {
      next = reduce(next, e)
      setState(next)
    })
  }, [adapter, state])

  const retry = useCallback(() => {
    if (lastAsked.current) void send(lastAsked.current)
  }, [send])

  return { state, send, retry, stop: adapter.stop }
}
```

Add `"peerDependencies": { "react": ">=18" }` to `package.json`.

- [ ] **Step 5: Run it to verify it passes**

Run: `cd packages/chat-core && npm test`
Expected: PASS, ten tests.

- [ ] **Step 6: Commit**

```bash
git add packages/chat-core
git commit -m "chat-core: one hook, and an interface for the transport

The package does no I/O. The desktop reads NDJSON from the engine over IPC,
the phone reads SSE from the backend, and neither of those belongs in code
both of them import."
```

---

### Task 6: Desktop main process — the engine adapter

**Files:**
- Create: `desktop/electron/chat.ts`
- Modify: `desktop/electron/ipc.ts`, `desktop/electron/preload.ts`, `desktop/electron/shared/types.ts`
- Modify: `desktop/test/integration.ts`

**Interfaces:**
- Consumes: Task 3's routes; `apiStream` (already in `desktop/electron/api.ts`).
- Produces: IPC `chat:send`, `chat:stop`, `chat:list`, `chat:history`, `chat:delete`, broadcast channel `chat:event`; bridge `window.karmax.chat`.

- [ ] **Step 1: Write `chat.ts`**

Model it on `desktop/electron/connect.ts`, which already streams NDJSON from the engine and broadcasts progress — same line-assembly across chunk boundaries, same one-at-a-time guard.

```ts
// The chat's transport, in the main process.
//
// The renderer never sees the engine's URL or its token: the token can invoke
// shell.exec, and the rule that it stays here is not relaxed for a chat.
import { EventEmitter } from 'node:events'
import { api, apiStream } from './api.js'
import type { TurnEvent, ConversationSummary, EngineMessage } from './shared/types.js'

export class ChatRunner extends EventEmitter {
  private abort: AbortController | null = null

  async send(conversationId: string | null, message: string): Promise<{ ok: boolean; error?: string }> {
    this.abort?.abort()
    this.abort = new AbortController()
    const res = await apiStream('POST', '/api/chat/stream',
      { conversationId, message }, this.abort.signal)
    if (!res.ok || !res.body) {
      this.emit('event', { kind: 'error', text: res.error ?? 'The engine would not answer.' })
      return { ok: false, error: res.error ?? undefined }
    }
    void this.pump(res.body)
    return { ok: true }
  }

  stop(): void { this.abort?.abort() }

  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        let cut = buffer.indexOf('\n')
        while (cut >= 0) {
          const line = buffer.slice(0, cut).trim()
          buffer = buffer.slice(cut + 1)
          cut = buffer.indexOf('\n')
          if (line) {
            try { this.emit('event', JSON.parse(line) as TurnEvent) } catch { /* half a line from a cut stream */ }
          }
        }
      }
    } catch (e) {
      const err = e as Error
      this.emit('event', { kind: 'error', text: err.name === 'AbortError' ? 'Stopped.' : err.message })
    }
  }
}
```

- [ ] **Step 2: Add the types**

In `shared/types.ts`, add `TurnEvent` (mirroring `@lyzn/chat-core`'s union),
`ConversationSummary`, and `EngineMessage` — deliberately *not* named `Message`,
because it is the engine's shape (role, text, at, steps) and not the package's
(which adds an id and cards). The adapter in Task 8 maps one to the other; two
types with one name is how that mapping gets forgotten.

And to `KarmaxBridge`:

```ts
  /** The assistant, answered by the engine on this machine. */
  chat: {
    send(conversationId: string | null, message: string): Promise<{ ok: boolean; error?: string }>
    stop(): Promise<void>
    list(): Promise<{ conversations: ConversationSummary[]; brain: string }>
    history(id: string): Promise<EngineMessage[]>
    remove(id: string): Promise<void>
    onEvent(cb: (e: TurnEvent) => void): () => void
  }
```

- [ ] **Step 3: Wire the IPC**

In `ipc.ts`, beside the connect handlers:

```ts
  const chatRunner = new ChatRunner()
  ipcMain.handle('chat:send', (_e, id: string | null, message: string) => chatRunner.send(id, message))
  ipcMain.handle('chat:stop', () => chatRunner.stop())
  ipcMain.handle('chat:list', async () => {
    const res = await api<{ conversations: ConversationSummary[]; brain: string }>('GET', '/api/chat/conversations')
    return res.ok ? res.data : { conversations: [], brain: '' }
  })
  ipcMain.handle('chat:history', async (_e, id: string) => {
    const res = await api<{ messages: EngineMessage[] }>('GET', `/api/chat/conversations/${encodeURIComponent(id)}`)
    return res.ok ? (res.data?.messages ?? []) : []
  })
  ipcMain.handle('chat:delete', (_e, id: string) =>
    api('DELETE', `/api/chat/conversations/${encodeURIComponent(id)}`))
  chatRunner.on('event', (e: TurnEvent) => broadcast('chat:event', e))
```

And in `preload.ts`, the matching bridge entry using `subscribe('chat:event', cb)`.

- [ ] **Step 4: Extend the core test**

In `desktop/test/integration.ts`, beside the browser/access/connect checks:

```ts
  const convs = await api<{ conversations: unknown[]; brain: string }>('GET', '/api/chat/conversations')
  ok(
    'the engine lists chat conversations',
    convs.ok && Array.isArray(convs.data?.conversations),
    convs.ok ? `${convs.data?.conversations.length} conversations, brain ${convs.data?.brain}` : (convs.error ?? ''),
  )
```

- [ ] **Step 5: Run it**

Run: `cd desktop && npm run typecheck && npm run test:core`
Expected: typecheck clean; the new check passes with a real daemon. If the daemon is older than Task 3, rebuild it: `KARMAX_SRC=$KARMAX_SRC bash scripts/build-core.sh`.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron desktop/test/integration.ts
git commit -m "desktop: the chat's transport, in the main process

The renderer names a conversation and a message. It never sees the engine's
URL or its token, because that token can invoke shell.exec and a chat screen
is not a reason to relax the one rule this app has about it."
```

---

### Task 7: Desktop — rename the nav and add Mira

**Files:**
- Modify: `desktop/src/components/Chrome.tsx:19-28`
- Modify: `desktop/src/App.tsx:17,65-71`
- Rename: `desktop/src/routes/Overview.tsx` → `Dashboard.tsx`, `Automations.tsx` → `Loops.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `Route = 'mira' | 'dashboard' | 'tickets' | 'apps' | 'loops' | 'memory' | 'settings'`, default route `'mira'`.

- [ ] **Step 1: Rename the files and the route union**

```bash
cd desktop/src/routes
git mv Overview.tsx Dashboard.tsx
git mv Automations.tsx Loops.tsx
```

In `Chrome.tsx`:

```ts
export type Route = 'mira' | 'dashboard' | 'tickets' | 'apps' | 'loops' | 'memory' | 'settings'

const NAV: { id: Route; label: string; icon: typeof Gauge }[] = [
  { id: 'mira', label: 'Mira', icon: MessageSquare },
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'tickets', label: 'Tickets', icon: ReceiptText },
  { id: 'apps', label: 'Apps', icon: Blocks },
  { id: 'loops', label: 'Loops', icon: Repeat2 },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]
```

Import `MessageSquare` from `lucide-react`.

- [ ] **Step 2: Update `App.tsx`**

```tsx
  const [route, setRoute] = useState<Route>('mira')
```

```tsx
                {route === 'mira' && <Mira />}
                {route === 'dashboard' && <Dashboard status={status} onRoute={setRoute} />}
                {route === 'tickets' && <Tickets />}
                {route === 'apps' && <Apps status={status} />}
                {route === 'loops' && <Loops status={status} />}
```

And `onEscape={() => setRoute('mira')}` on the Boundary, since Mira is now home.

- [ ] **Step 3: Fix every internal reference**

Run: `cd desktop && grep -rn "'home'\|'automations'\|Overview\|Automations" src/ electron/ | grep -v node_modules`
Fix each hit. `Dashboard.tsx` routes to other screens via `onRoute`; those string literals must move too.

- [ ] **Step 4: Verify**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: both clean. A missed literal shows up as a type error on `Route`, which is the point of the union.

- [ ] **Step 5: Commit**

```bash
git add -A desktop/src
git commit -m "desktop: Loops, Dashboard, and Mira at the front

Automations was never the word — KARMAX calls them loops and recipes, and the
screen now says what the thing is called. Overview becomes Dashboard because
it is about to become several of them.

Mira opens first, which is the app's answer to what it is for."
```

---

### Task 8: Desktop — the Mira screen

**Files:**
- Create: `desktop/src/routes/Mira.tsx`
- Create: `desktop/src/routes/chat/adapter.ts`, `chat/Turn.tsx`, `chat/StepLine.tsx`
- Modify: `desktop/package.json` (add `@lyzn/chat-core`)

**Interfaces:**
- Consumes: `useConversation`, `Adapter` (Task 5); `window.karmax.chat` (Task 6).
- Produces: the `Mira` default export.

- [ ] **Step 1: Add the dependency**

In `desktop/package.json`: `"@lyzn/chat-core": "file:../packages/chat-core"`, then `npm install`.

- [ ] **Step 2: Write the adapter**

```ts
import type { Adapter } from '@lyzn/chat-core'

/** The bridge, shaped as the package expects. Every call names an intent; the
 *  engine's address stays in the main process. */
export const engineAdapter: Adapter = {
  send(conversationId, text, onEvent) {
    return new Promise((resolve) => {
      const off = window.karmax.chat.onEvent((e) => {
        onEvent(e)
        if (e.kind === 'done' || e.kind === 'error') { off(); resolve() }
      })
      void window.karmax.chat.send(conversationId, text).then((r) => {
        if (!r.ok) { off(); resolve() }
      })
    })
  },
  stop() { void window.karmax.chat.stop() },
  async list() { return (await window.karmax.chat.list()).conversations },
  async history(id) {
    // The engine's message and the package's are not the same shape: a
    // transcript read from disk has no ids and no cards, because neither
    // exists until a screen renders it.
    const msgs = await window.karmax.chat.history(id)
    return msgs.map((m, i) => ({
      id: `${id}:${i}`,
      role: m.role,
      text: m.text,
      steps: m.steps ?? [],
      cards: [],
    }))
  },
}
```

- [ ] **Step 3: Write `StepLine.tsx`**

The collapsed line is the screen's whole aliveness budget. Closed by default;
shows the step happening now, and after the turn the outcome.

```tsx
/** What it is doing, in one line.
 *
 *  Closed by default and it stays closed: nothing reflows under somebody
 *  reading the reply. Open it to see every step. */
export function StepLine({ steps, busy }: { steps: ToolStep[]; busy: boolean }) {
  const [open, setOpen] = useState(false)
  if (steps.length === 0) return null

  const live = steps.find((s) => s.phase === 'start')
  const head = live ?? steps[steps.length - 1]
  const tone = live ? 'var(--accent)' : head.phase === 'failed' ? 'var(--bad)' : 'var(--ok)'

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 font-mono text-[11.5px] text-[var(--fg-dim)] hover:text-[var(--fg)]"
      >
        <span className="text-[9px] text-[var(--fg-faint)]">{open ? '▾' : '▸'}</span>
        <span
          className="inline-block h-[5px] w-[5px] rounded-full"
          style={{ background: tone, animation: live ? 'pulse 1.1s ease-in-out infinite' : undefined }}
        />
        {label(head)}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 pl-[22px]">
          {steps.map((s, i) => (
            <div key={i} className="font-mono text-[11px] text-[var(--fg-faint)]">{label(s)}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function label(s: ToolStep): string {
  return s.detail ? `${verb(s.tool)} · ${s.detail}` : verb(s.tool)
}
```

And the vocabulary, which must match KARMAX's `internal/setupagent` `doing()` —
the same tool must not be called two different things in two places in one
product:

```tsx
/** A tool's name, in a person's words.
 *
 *  An unknown tool falls through to its own name rather than to nothing, so a
 *  tool added later degrades to honest jargon instead of silence. */
function verb(tool: string): string {
  if (tool === 'Bash') return 'running a command'
  if (tool === 'Read') return 'reading a file'
  if (tool === 'Write' || tool === 'Edit') return 'writing a file'
  if (tool === 'Glob' || tool === 'Grep') return 'searching'
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'reading the web'
  if (tool.includes('navigate')) return 'opening a page'
  if (tool.includes('click')) return 'clicking'
  if (tool.includes('snapshot') || tool.includes('screenshot')) return 'reading the page'
  if (tool.startsWith('memory')) return 'searching your memory'
  return tool
}
```

Add to `src/styles/theme.css`:

```css
@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }
.caret { display:inline-block; width:7px; height:14px; background:var(--accent);
         vertical-align:-2px; animation:blink .9s step-end infinite; }
@keyframes blink { 50% { opacity: 0 } }
```

- [ ] **Step 4: Write `Turn.tsx`**

```tsx
/** One exchange: the person's words on the right, the reply on the left with
 *  what it did above and what it made below. */
export function Turn({ message, onRoute }: { message: Message; onRoute: (r: Route) => void }) {
  if (message.role === 'user') {
    return (
      <div className="mb-3.5 ml-auto w-fit max-w-[76%] bg-[var(--skin-2)] px-3 py-2 text-[13px]">
        {message.text}
      </div>
    )
  }
  return (
    <div className="mb-4">
      <StepLine steps={message.steps} busy={!!message.streaming} />
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--fg)]">
        {message.text}
        {message.streaming && <span className="caret" />}
      </div>
      {message.cards.map((c) => (
        <ReceiptCard key={c.id} card={c} onOpen={onRoute} />
      ))}
      {message.failed && (
        <p className="mt-1.5 text-[12px] text-[var(--bad)]">
          That stopped before it finished. Ask again to retry.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4b: Write `Mira.tsx`**

Tokens only, never a hex — a colour literal in a route is a colour that will be
wrong in the other theme.

```tsx
export default function Mira({ onRoute }: { onRoute: (r: Route) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const { state, send } = useConversation(engineAdapter, selected)
  const convs = useAsync(() => window.karmax.chat.list(), [state.conversationId])
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages.length, state.messages.at(-1)?.text])

  const submit = () => {
    const text = draft.trim()
    if (!text || state.busy) return
    setDraft('')
    void send(text)
  }

  const list = convs.data?.conversations ?? []
  const codex = convs.data?.brain === 'codex'

  return (
    <div className="flex h-full gap-4">
      <aside className="w-[190px] flex-none">
        <Button variant="ghost" onClick={() => setSelected(null)}>New conversation</Button>
        {codex && list.length === 0 && (
          <p className="mt-2 px-2 text-[12px] text-[var(--fg-dim)]">
            Conversations are only kept for Claude Code at the moment.
          </p>
        )}
        {list.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c.id)}
            className={cn('block w-full px-2 py-1.5 text-left text-[12px]',
              c.id === selected ? 'bg-[var(--skin-1)] text-[var(--fg)]' : 'text-[var(--fg-dim)]')}
          >
            {c.title || c.opening || 'New conversation'}
          </button>
        ))}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto pr-1">
          {state.messages.length === 0 ? (
            <EmptyState title="Ask for something"
              body="It runs on this machine, so it can actually do it." />
          ) : (
            state.messages.map((m) => <Turn key={m.id} message={m} onRoute={onRoute} />)
          )}
          <div ref={endRef} />
        </div>
        <Input
          value={draft}
          placeholder="Ask anything…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          }}
        />
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Verify against a live engine**

Run: `cd desktop && npm run typecheck && npm run build`, then run the app and
ask Mira something that uses a tool ("what's in my home directory?").

Expected: text arrives progressively, the step line shows a live step with a
pulsing dot, then settles to the outcome with a green dot, and the thread is
still there after switching conversations and back.

- [ ] **Step 6: Commit**

```bash
git add desktop/src desktop/package.json
git commit -m "desktop: Mira

The reply streams, and above it one line says what it is doing — closed by
default, because nothing should reflow under somebody who is reading.

The line shows the step happening now while it happens, and afterwards the
outcome rather than the literal last step: when those differ, the outcome is
the more useful sentence."
```

---

### Task 9: Desktop — the receipt card

**Files:**
- Create: `desktop/src/routes/chat/ReceiptCard.tsx`
- Modify: `desktop/src/routes/chat/Turn.tsx`

**Interfaces:**
- Consumes: `Card` (Task 4).
- Produces: `<ReceiptCard card={card} onOpen={(route) => …} />`.

- [ ] **Step 1: Write the component**

One anatomy, three kinds. A dashed rule under the header is the receipt
vocabulary the product already uses.

```tsx
/** Something the assistant made or started.
 *
 *  One shape for tickets, loops and dashboards: kind, stamp, title, a live
 *  status row, and a way in. A thing that now exists reads differently from a
 *  thing that happened, and these are the former. */
export function ReceiptCard({ card, onOpen }: { card: Card; onOpen: (r: Route) => void }) {
  const dest: Record<Card['kind'], Route> = { ticket: 'tickets', loop: 'loops', dashboard: 'dashboard' }
  return (
    <div className="my-2 max-w-[340px] border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-dashed border-[var(--line)] px-3 py-1.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.11em] text-[var(--fg-faint)]">{card.kind}</span>
        <span
          className="border px-1.5 font-mono text-[9px] uppercase tracking-[0.08em]"
          style={{ color: card.live ? 'var(--accent)' : 'var(--ok)', borderColor: card.live ? 'var(--accent)' : 'var(--ok)' }}
        >
          {card.status}
        </span>
      </div>
      <div className="px-3 py-2">
        <div className="text-[13px] text-[var(--fg)]">{card.title}</div>
      </div>
      <button
        onClick={() => onOpen(dest[card.kind])}
        className="w-full border-t border-[var(--line)] px-3 py-1.5 text-left font-mono text-[10.5px] text-[var(--accent)]"
      >
        Open in {dest[card.kind] === 'tickets' ? 'Tickets' : dest[card.kind] === 'loops' ? 'Loops' : 'Dashboard'} →
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Render cards in `Turn.tsx`**

Below the prose, `message.cards.map((c) => <ReceiptCard key={c.id} card={c} onOpen={onRoute} />)`.
`Mira` takes `onRoute` from `App.tsx` so a card can navigate.

- [ ] **Step 3: Verify**

Run: `cd desktop && npm run typecheck && npm run build`, then ask Mira for
something long enough to go to the background and confirm a card appears and
its button lands on Tickets.

If the engine never emits a `ticket` event, that is Task 3's background-policy
wiring rather than this component — check the agent's guidance mentions going
background past about a minute.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/routes/chat
git commit -m "desktop: one card for everything it makes

A ticket, a loop and a dashboard are the same object to a reader: a thing that
now exists, with a state and a way in. One component, so the third kind costs
nothing."
```

---

### Task 10: Mobile — port onto the shared reducer

**Files:**
- Modify: `mobile/src/state/chat.ts`
- Modify: `mobile/package.json`
- Create: `mobile/src/state/backendAdapter.ts`

**Interfaces:**
- Consumes: `ask`, `reduce`, `empty`, `Adapter` (Tasks 4–5).
- Produces: no change to anything the screen imports. `useChat` keeps its current shape.

- [ ] **Step 1: Record the behaviour you must not break**

Before touching anything, run the app and write down what happens for: a reply
streaming in, tool steps appearing, leaving the thread mid-answer and coming
back, retry after a failure, two conversations streaming at once, and an
attachment upload. This is the acceptance list for Step 5.

- [ ] **Step 2: Add the dependency**

`"@lyzn/chat-core": "file:../packages/chat-core"` in `mobile/package.json`, then
`npm install`.

- [ ] **Step 3: Write the backend adapter**

Attachments stay here: they are the phone's transport concern and the package
has no opinion about them.

```ts
import type { Adapter, TurnEvent } from '@lyzn/chat-core'
import { api, streamChatTurn, type ChatToolEvent } from '../api/client'

/** The LYZN backend, shaped as the package expects.
 *
 *  The backend speaks its own event vocabulary; translating it here is what
 *  lets one reducer serve two engines that have nothing else in common. */
export function backendAdapter(uploads: () => Promise<string[]>): Adapter {
  let abort: AbortController | null = null
  return {
    async send(conversationId, text, onEvent) {
      abort = new AbortController()
      const attachments = await uploads()
      await streamChatTurn(
        { conversationId: conversationId ?? crypto.randomUUID(), message: text, attachments },
        {
          onDelta: (d: string) => onEvent({ kind: 'text', text: d }),
          onTool: (t: ChatToolEvent) =>
            onEvent({ kind: 'tool', tool: t.name, phase: t.status,
                      detail: t.hits != null ? `${t.hits} hits` : undefined }),
          onDone: (final?: string) => onEvent({ kind: 'done', text: final }),
          onError: (m: string) => onEvent({ kind: 'error', text: m }),
          signal: abort.signal,
        },
      )
    },
    stop() { abort?.abort() },
    async list() {
      const res = await api.get<{ chats: { id: string; title: string; updatedAt: string }[] }>('/chats')
      return (res.chats ?? []).map((c) => ({
        id: c.id, title: c.title, opening: '', updated: c.updatedAt,
      }))
    },
    async history(id) {
      const res = await api.get<{ messages: { role: 'user' | 'assistant'; content: string }[] }>(`/chats/${id}`)
      return (res.messages ?? []).map((m, i) => ({
        id: `${id}:${i}`, role: m.role, text: m.content, steps: [], cards: [],
      }))
    },
  }
}
```

The `onDelta`/`onTool`/`onDone`/`onError` names are the shape `streamChatTurn`
is adapted *to*; read its current signature in `mobile/src/api/client.ts` and
match it rather than changing it — this task must not touch the transport.

- [ ] **Step 4: Move the store onto the reducer**

The store keeps its zustand shape and every export the screen imports. What
changes is the middle: `ask()` and `reduce()` replace the hand-rolled bubble
mutation.

```ts
import { ask, empty, reduce, type ChatState, type Message, type ToolStep } from '@lyzn/chat-core'

// The screen imports these names; they stay, as the package's types, so no
// import in any component has to move.
export type Bubble = Message
export type { ToolStep }

export const useChat = create<ChatStore>((set, get) => ({
  conversations: {},

  send: async (id, message, attachments) => {
    const adapter = backendAdapter(async () => uploadAttachments(attachments ?? []))
    const at = (s: ChatState) => set((st) => ({ conversations: { ...st.conversations, [id]: s } }))

    let next = ask(get().conversations[id] ?? empty(), message)
    at(next)
    await adapter.send(id, message, (e) => { next = reduce(next, e); at(next) })
  },

  // load / retry / drop keep their current bodies; only `send` moves.
}))
```

- [ ] **Step 5: Verify against the list from Step 1**

Run: `cd mobile && npx tsc --noEmit && npm test`
Then run the app and walk the acceptance list. Every item must behave as
recorded. A difference is a bug in the port, not a new design.

- [ ] **Step 6: Commit**

```bash
git add mobile packages
git commit -m "mobile: one reducer, two screens

The phone's chat had its own answer to what a turn is, and so did the
desktop's. They are the same answer, and now there is one of them.

Nothing visual changes: the screen keeps every component it had. What moved
is the part underneath that decides when a step resolves and what a delta
does."
```

---

## Not in this plan

- **`karmax preflight`** (spec §3). Nothing here depends on it and it is a
  self-contained deliverable; it gets its own plan.
- **Loops** beyond the rename — provenance, removing manual creation, AI
  authoring. Own cycle.
- **Publishing and the marketplace.** Own cycle.
- **Dashboards** beyond the rename. Own cycle.
