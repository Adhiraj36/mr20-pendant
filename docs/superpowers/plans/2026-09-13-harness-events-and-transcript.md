# Harness Events and Mira's Transcript — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen KARMAX's harness event model from `{Kind, Text, Tool, Phase, JobID}` to an ACP-shaped one — stable tool ids, human titles, semantic kinds, four-state status, file locations, reasoning and a live plan — then rebuild Mira's transcript as a tested row model that draws it.

**Architecture:** Three layers, in build order. The Claude adapter in KARMAX turns `stream-json` into the new `harness.Event`. The NDJSON endpoint forwards it kind by kind. `packages/chat-core` reduces it into messages and derives rows from them with a pure function, which the desktop renders. Every layer below the renderer is tested without a model, a subprocess or a DOM.

**Tech Stack:** Go 1.23 (KARMAX, separate repo), TypeScript + React 19 (monorepo), `node --test --experimental-strip-types` for chat-core, Vite + Tailwind v4 for the desktop renderer.

**Spec:** `docs/superpowers/specs/2026-09-13-harness-events-and-transcript-design.md`

## Global Constraints

- **Local commits only. Never `git push`, never open a PR, in either repo.** The user asked for this explicitly.
- **Two repos.** KARMAX is at `$KARMAX` = `/private/tmp/claude-501/-Users-0mellob-Developer-code-mr20-pendant/ccbf241b-56d9-4493-b05e-3b302a9e4a90/scratchpad/KARMAX/KARMAX` (clean at `6d68d8c`). The monorepo is `/Users/0mellob/Developer/code/mr20-pendant`. Commit in the repo each task names.
- **The scratchpad is purge-prone.** macOS temp cleanup has already destroyed this checkout once. If `$KARMAX` is missing, stop and report — do not re-clone and lose uncommitted work.
- **t3code reference clone:** `.../scratchpad/t3code` (MIT, T3 Tools Inc.). If missing: `git clone --depth 1 https://github.com/pingdotgg/t3code.git`. Files ported from it carry the MIT notice in their header.
- **This plan covers spec sections 1–3 only.** Section 4 (the ACP client) is a separate plan; the spec states 1+2+3 ship without it.
- **Tool kinds are ACP's, verbatim:** `read | edit | delete | move | search | execute | think | fetch | switch_mode | other`. Statuses are ACP's, verbatim: `pending | in_progress | completed | failed`.
- **Tool output is truncated to 2 KB** at the adapter, on a rune boundary, with a trailing `\n…`.
- **No hex colours in a desktop route.** Use the role tokens (`--fg-dim`, `--skin-2`, `--accent`, `--ok`, `--bad`, `--edge`, `--fg-faint`). This is a standing rule in `desktop/CLAUDE.md`.
- **No jargon on screen.** The desktop audience is non-technical. "The engine", not "the daemon".
- **Go comments explain *why*, one line, usually by naming the failure prevented.** Do not narrate what a line does. Match the density of the surrounding file.

---

## File Structure

**KARMAX (`$KARMAX`):**

| File | Responsibility |
|---|---|
| `internal/harness/toolmeta.go` (new) | Pure: tool name + input → kind, title, locations. The port of t3code's titling instinct. |
| `internal/harness/toolmeta_test.go` (new) | Table tests for the above. |
| `internal/harness/protocol.go` (modify) | The new vocabulary types; the widened `event`/`contentBlock` decode surface; `planFrom`, `toolResultText`, `truncateOutput`. |
| `internal/harness/protocol_test.go` (modify) | Decode and helper tests. |
| `internal/harness/session.go` (modify) | `Event`, `emit`, `Turn.Model`/`Duration`, `spawn`'s thinking env. |
| `internal/harness/sink_test.go` (modify) | `replay`-driven emit tests. |
| `internal/harness/supervisor.go` (modify) | `Options.Thinking` → `Session.Thinking` → `spawn`. |
| `internal/harness/testdata/` (add) | Recorded `stream-json` fixtures. |
| `internal/api/server.go` (modify) | `ChatEvent` widened. |
| `internal/api/chat.go` (modify) | The per-kind `send` switch. |
| `internal/api/chat_test.go` (modify) | NDJSON shape assertions. |
| `internal/runtime/chathost.go` (modify) | `harness.Event` → `api.ChatEvent`. |

**Monorepo (`/Users/0mellob/Developer/code/mr20-pendant`):**

| File | Responsibility |
|---|---|
| `packages/chat-core/src/types.ts` (modify) | `TurnEvent`, `ToolCall`, `PlanEntry`, `Message`. |
| `packages/chat-core/src/reduce.ts` (modify) | Merge tool updates by id; accumulate thought; replace plan. |
| `packages/chat-core/src/rows.ts` (new) | `deriveRows` — the row model. Pure. |
| `packages/chat-core/src/scroll.ts` (new) | The three-mode scroll state machine. Pure. |
| `packages/chat-core/src/index.ts` (modify) | Re-export the two new modules. |
| `packages/chat-core/test/rows.test.ts` (new) | Row model suite. |
| `packages/chat-core/test/scroll.test.ts` (new) | State machine suite. |
| `desktop/electron/shared/types.ts` (modify) | The restated wire union — must move in lockstep. |
| `desktop/src/routes/chat/adapter.ts` (modify) | History mapping to the new `Message`. |
| `desktop/src/routes/chat/rows/` (new dir) | One small component per row kind. |
| `desktop/src/routes/chat/Transcript.tsx` (new) | Renders `Row[]`, owns `RowUiState`. |
| `desktop/src/routes/chat/StepLine.tsx` (delete) | Replaced by `rows/WorkRow.tsx`. `verb()` dies with it. |
| `desktop/src/routes/Mira.tsx` (modify) | Uses `Transcript` and the scroll machine. |

---

## Task 1: Tool metadata — kind, title, locations

The heart of why the new transcript reads better. Pure functions, no wiring, no
callers yet. Ported in spirit from t3code's `titleForTool` / `classifyToolItemType`
(`apps/server/src/provider/Layers/ClaudeAdapter.ts:1400-1440`), which prefer the
agent's own `description` over serialised JSON.

**Repo:** KARMAX

**Files:**
- Create: `$KARMAX/internal/harness/toolmeta.go`
- Test: `$KARMAX/internal/harness/toolmeta_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ToolKind string` with constants `ToolRead`, `ToolEdit`, `ToolDelete`, `ToolMove`, `ToolSearch`, `ToolExecute`, `ToolThink`, `ToolFetch`, `ToolSwitchMode`, `ToolOther`
  - `type Status string` with constants `StatusPending`, `StatusInProgress`, `StatusCompleted`, `StatusFailed`
  - `type Location struct { Path string; Line int }`
  - `func toolKind(name string) ToolKind`
  - `func toolTitle(name string, input json.RawMessage) string`
  - `func toolLocations(name string, input json.RawMessage) []Location`

- [ ] **Step 1: Write the failing test**

Create `$KARMAX/internal/harness/toolmeta_test.go`:

```go
package harness

import (
	"encoding/json"
	"testing"
)

func TestToolKindClassifiesTheToolsWeActuallySee(t *testing.T) {
	cases := map[string]ToolKind{
		"Read":                             ToolRead,
		"NotebookRead":                     ToolRead,
		"Edit":                             ToolEdit,
		"Write":                            ToolEdit,
		"NotebookEdit":                     ToolEdit,
		"Bash":                             ToolExecute,
		"BashOutput":                       ToolExecute,
		"Glob":                             ToolSearch,
		"Grep":                             ToolSearch,
		"WebFetch":                         ToolFetch,
		"WebSearch":                        ToolFetch,
		"Task":                             ToolThink,
		"mcp__playwright__browser_navigate": ToolFetch,
		"mcp__whatever__something":         ToolOther,
		"SomethingNobodyHasWrittenYet":     ToolOther,
	}
	for name, want := range cases {
		if got := toolKind(name); got != want {
			t.Errorf("toolKind(%q) = %q, want %q", name, got, want)
		}
	}
}

// The agent's own description beats anything we could invent for it.
func TestToolTitlePrefersTheAgentsDescription(t *testing.T) {
	in := json.RawMessage(`{"command":"go test ./...","description":"Check the tests pass"}`)
	if got := toolTitle("Bash", in); got != "Check the tests pass" {
		t.Errorf("got %q, want the description", got)
	}
}

// Without one, the command itself says more than the word "Bash" does.
func TestToolTitleFallsBackToTheCommand(t *testing.T) {
	in := json.RawMessage(`{"command":"go build ./..."}`)
	if got := toolTitle("Bash", in); got != "go build ./..." {
		t.Errorf("got %q, want the command", got)
	}
}

// A long command must not push the reply off the screen.
func TestToolTitleTrimsALongCommandToOneLine(t *testing.T) {
	in := json.RawMessage(`{"command":"one\ntwo\nthree"}`)
	if got := toolTitle("Bash", in); got != "one" {
		t.Errorf("got %q, want only the first line", got)
	}
	long, _ := json.Marshal(map[string]string{"command": string(make([]byte, 0)) + repeat("x", 200)})
	got := toolTitle("Bash", long)
	if len([]rune(got)) != 60 {
		t.Errorf("got %d runes, want 60", len([]rune(got)))
	}
}

// A file's base name is what a person recognises; the full path is noise.
func TestToolTitleNamesTheFile(t *testing.T) {
	in := json.RawMessage(`{"file_path":"/Users/x/code/app/src/main.ts"}`)
	if got := toolTitle("Read", in); got != "main.ts" {
		t.Errorf("got %q, want the base name", got)
	}
}

func TestToolTitleUsesPatternHostAndQuery(t *testing.T) {
	if got := toolTitle("Grep", json.RawMessage(`{"pattern":"func main"}`)); got != "func main" {
		t.Errorf("Grep: got %q", got)
	}
	if got := toolTitle("WebFetch", json.RawMessage(`{"url":"https://example.com/a/b?c=d"}`)); got != "example.com" {
		t.Errorf("WebFetch: got %q", got)
	}
	if got := toolTitle("WebSearch", json.RawMessage(`{"query":"go generics"}`)); got != "go generics" {
		t.Errorf("WebSearch: got %q", got)
	}
}

// Never empty: a blank line in the transcript is worse than honest jargon.
func TestToolTitleFallsBackToTheToolName(t *testing.T) {
	if got := toolTitle("Mystery", json.RawMessage(`{}`)); got != "Mystery" {
		t.Errorf("got %q, want the tool name", got)
	}
	if got := toolTitle("Mystery", nil); got != "Mystery" {
		t.Errorf("nil input: got %q, want the tool name", got)
	}
	if got := toolTitle("Mystery", json.RawMessage(`not json at all`)); got != "Mystery" {
		t.Errorf("bad json: got %q, want the tool name", got)
	}
}

func TestToolLocationsCarryTheFileAndLine(t *testing.T) {
	got := toolLocations("Read", json.RawMessage(`{"file_path":"/a/b.go","offset":42}`))
	want := []Location{{Path: "/a/b.go", Line: 42}}
	if len(got) != 1 || got[0] != want[0] {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

// A tool that names no file has no locations — not one empty location.
func TestToolLocationsAreEmptyWhenNoFileIsNamed(t *testing.T) {
	if got := toolLocations("Bash", json.RawMessage(`{"command":"ls"}`)); len(got) != 0 {
		t.Errorf("got %+v, want none", got)
	}
}

func repeat(s string, n int) string {
	out := make([]byte, 0, n*len(s))
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$KARMAX" && go test ./internal/harness/ -run 'TestTool' 2>&1 | head -20
```

Expected: FAIL — `undefined: toolKind`, `undefined: ToolRead`, and so on.

- [ ] **Step 3: Write the implementation**

Create `$KARMAX/internal/harness/toolmeta.go`:

```go
package harness

import (
	"encoding/json"
	"net/url"
	"path"
	"strings"
)

// ToolKind is what sort of thing a tool does, in ACP's vocabulary.
//
// The point of a kind is that a transcript can pick an icon and group
// consecutive calls without parsing tool names it has never heard of.
type ToolKind string

const (
	ToolRead       ToolKind = "read"
	ToolEdit       ToolKind = "edit"
	ToolDelete     ToolKind = "delete"
	ToolMove       ToolKind = "move"
	ToolSearch     ToolKind = "search"
	ToolExecute    ToolKind = "execute"
	ToolThink      ToolKind = "think"
	ToolFetch      ToolKind = "fetch"
	ToolSwitchMode ToolKind = "switch_mode"
	ToolOther      ToolKind = "other"
)

// Status is where a tool call has got to, in ACP's vocabulary.
type Status string

const (
	StatusPending    Status = "pending"
	StatusInProgress Status = "in_progress"
	StatusCompleted  Status = "completed"
	StatusFailed     Status = "failed"
)

// Location is a file a tool call touched, and where in it.
type Location struct {
	Path string `json:"path"`
	Line int    `json:"line,omitempty"`
}

// titleMax is where a title stops being a label and starts being a paragraph.
const titleMax = 60

func toolKind(name string) ToolKind {
	switch name {
	case "Read", "NotebookRead":
		return ToolRead
	case "Edit", "Write", "MultiEdit", "NotebookEdit":
		return ToolEdit
	case "Bash", "BashOutput", "KillShell", "KillBash":
		return ToolExecute
	case "Glob", "Grep", "LS":
		return ToolSearch
	case "WebFetch", "WebSearch":
		return ToolFetch
	case "Task":
		return ToolThink
	}
	// MCP tools arrive as mcp__<server>__<tool>. A browser driven by one is
	// reaching outside this machine, which is what "fetch" means to a reader.
	if strings.HasPrefix(name, "mcp__") && strings.Contains(name, "browser") {
		return ToolFetch
	}
	return ToolOther
}

// toolInput is every field any titled tool reads. One struct rather than one
// per tool: the CLI ignores unknown keys and so can we.
type toolInput struct {
	Description  string `json:"description"`
	Command      string `json:"command"`
	FilePath     string `json:"file_path"`
	NotebookPath string `json:"notebook_path"`
	Path         string `json:"path"`
	Pattern      string `json:"pattern"`
	URL          string `json:"url"`
	Query        string `json:"query"`
	Prompt       string `json:"prompt"`
	Offset       int    `json:"offset"`
}

func parseInput(input json.RawMessage) toolInput {
	var in toolInput
	// A tool with no input, or one whose input is not an object, is not an
	// error worth losing the call over — it just has no title of its own.
	_ = json.Unmarshal(input, &in)
	return in
}

// toolTitle is what the transcript writes on the line, in the agent's own
// words wherever it gave any.
//
// Never empty: the desktop draws an icon and this string, and a blank line
// reads as a bug rather than as a tool nobody has taught us about.
func toolTitle(name string, input json.RawMessage) string {
	in := parseInput(input)
	if s := clip(in.Description); s != "" {
		return s
	}
	switch toolKind(name) {
	case ToolRead, ToolEdit:
		if p := firstNonEmpty2(in.FilePath, in.NotebookPath, in.Path); p != "" {
			return path.Base(p)
		}
	case ToolExecute:
		if s := clip(in.Command); s != "" {
			return s
		}
	case ToolSearch:
		if s := clip(in.Pattern); s != "" {
			return s
		}
		if p := firstNonEmpty2(in.Path, in.FilePath); p != "" {
			return path.Base(p)
		}
	case ToolFetch:
		if in.URL != "" {
			if u, err := url.Parse(in.URL); err == nil && u.Host != "" {
				return u.Host
			}
			return clip(in.URL)
		}
		if s := clip(in.Query); s != "" {
			return s
		}
	case ToolThink:
		if s := clip(in.Prompt); s != "" {
			return s
		}
	}
	return name
}

// toolLocations is the files a call touched, so a turn can say where it went.
func toolLocations(name string, input json.RawMessage) []Location {
	in := parseInput(input)
	p := firstNonEmpty2(in.FilePath, in.NotebookPath)
	if p == "" && toolKind(name) == ToolSearch {
		p = in.Path
	}
	if p == "" {
		return nil
	}
	return []Location{{Path: p, Line: in.Offset}}
}

// clip reduces a value to one line of at most titleMax runes.
//
// Rune-wise, not byte-wise: cutting a multi-byte character in half puts U+FFFD
// on screen.
func clip(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	r := []rune(s)
	if len(r) > titleMax {
		return string(r[:titleMax])
	}
	return s
}

func firstNonEmpty2(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "$KARMAX" && go test ./internal/harness/ -run 'TestTool' -v 2>&1 | tail -30
```

Expected: PASS, every subtest.

- [ ] **Step 5: Vet and commit**

```bash
cd "$KARMAX" && go vet ./internal/harness/ && gofmt -l internal/harness/
git -C "$KARMAX" add internal/harness/toolmeta.go internal/harness/toolmeta_test.go
git -C "$KARMAX" commit -m "A tool call can say what it is doing and where"
```

`gofmt -l` must print nothing. **Do not push.**

---

## Task 2: Reading a plan, a tool result, and knowing when to stop

Three more pure helpers, same package. Separate from Task 1 because they read
*results* rather than *inputs*, and because the tool-result shape has a trap in
it that cost us a bug before in `internal/chatlog`.

**Repo:** KARMAX

**Files:**
- Modify: `$KARMAX/internal/harness/protocol.go` (append; and extend `contentBlock`)
- Modify: `$KARMAX/internal/harness/protocol_test.go` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `type PlanEntry struct { Content, Status, ActiveForm, Priority string }`
  - `func planFrom(input json.RawMessage) []PlanEntry`
  - `func toolResultText(raw json.RawMessage) string`
  - `func truncateOutput(s string) string`
  - `const maxToolOutput = 2048`
  - `contentBlock` gains `Content json.RawMessage \`json:"content"\``

- [ ] **Step 1: Write the failing test**

Append to `$KARMAX/internal/harness/protocol_test.go`:

```go
// TodoWrite is where Claude Code keeps a plan, so that is where we read one.
func TestPlanFromTodoWrite(t *testing.T) {
	in := json.RawMessage(`{"todos":[
		{"content":"Read the spec","status":"completed","activeForm":"Reading the spec"},
		{"content":"Write the test","status":"in_progress","activeForm":"Writing the test"}
	]}`)
	got := planFrom(in)
	if len(got) != 2 {
		t.Fatalf("got %d entries, want 2", len(got))
	}
	if got[0].Content != "Read the spec" || got[0].Status != "completed" {
		t.Errorf("first entry wrong: %+v", got[0])
	}
	if got[1].ActiveForm != "Writing the test" {
		t.Errorf("activeForm lost: %+v", got[1])
	}
}

// An older or newer TodoWrite shape must not cost us the whole plan.
func TestPlanFromToleratesAMissingPriority(t *testing.T) {
	got := planFrom(json.RawMessage(`{"todos":[{"content":"x","status":"pending"}]}`))
	if len(got) != 1 || got[0].Priority != "" {
		t.Errorf("got %+v", got)
	}
}

func TestPlanFromRejectsRubbish(t *testing.T) {
	if got := planFrom(json.RawMessage(`{"todos":"not a list"}`)); got != nil {
		t.Errorf("got %+v, want nil", got)
	}
	if got := planFrom(nil); got != nil {
		t.Errorf("nil input: got %+v, want nil", got)
	}
}

// A tool_result's content is written either as a plain string or as a list of
// blocks. Reading only one shape is how a transcript loses half its output —
// the same trap internal/chatlog fell into with message content.
func TestToolResultTextReadsBothShapes(t *testing.T) {
	if got := toolResultText(json.RawMessage(`"total 4\n"`)); got != "total 4\n" {
		t.Errorf("string shape: got %q", got)
	}
	blocks := json.RawMessage(`[{"type":"text","text":"one "},{"type":"text","text":"two"}]`)
	if got := toolResultText(blocks); got != "one two" {
		t.Errorf("block shape: got %q", got)
	}
	if got := toolResultText(nil); got != "" {
		t.Errorf("nil: got %q", got)
	}
	if got := toolResultText(json.RawMessage(`{"unexpected":true}`)); got != "" {
		t.Errorf("object: got %q", got)
	}
}

func TestTruncateOutputLeavesShortResultsAlone(t *testing.T) {
	if got := truncateOutput("hello"); got != "hello" {
		t.Errorf("got %q", got)
	}
}

// A tool result can be a whole file. The transcript shows a preview; the bytes
// are of no use to it and paying to stream them is worse than useless.
func TestTruncateOutputCapsAndMarks(t *testing.T) {
	got := truncateOutput(repeat("x", 5000))
	if len(got) > maxToolOutput+len("\n…") {
		t.Errorf("got %d bytes, want at most %d", len(got), maxToolOutput+len("\n…"))
	}
	if !strings.HasSuffix(got, "\n…") {
		t.Errorf("no truncation marker: %q", got[len(got)-10:])
	}
}

// Cutting mid-rune puts U+FFFD on screen.
func TestTruncateOutputCutsOnARuneBoundary(t *testing.T) {
	got := truncateOutput(repeat("é", 4000))
	if !utf8.ValidString(strings.TrimSuffix(got, "\n…")) {
		t.Error("truncation produced invalid UTF-8")
	}
}
```

Add `"strings"` and `"unicode/utf8"` to that file's imports if they are not
already there.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$KARMAX" && go test ./internal/harness/ -run 'TestPlanFrom|TestToolResultText|TestTruncateOutput' 2>&1 | head -20
```

Expected: FAIL — `undefined: planFrom`, `undefined: toolResultText`, `undefined: truncateOutput`.

- [ ] **Step 3: Write the implementation**

In `$KARMAX/internal/harness/protocol.go`, add `Content` to `contentBlock`:

```go
type contentBlock struct {
	Type string `json:"type"` // text | tool_use | tool_result
	Text string `json:"text"`

	// tool_use
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`

	// tool_result
	ToolUseID string          `json:"tool_use_id"`
	IsError   bool            `json:"is_error"`
	Content   json.RawMessage `json:"content"`
}
```

Then append to the same file:

```go
// PlanEntry is one line of the agent's plan.
//
// Claude Code keeps a plan in TodoWrite's input, so that is where this is read
// from; ACP delivers the same thing as a `plan` session update.
type PlanEntry struct {
	Content    string `json:"content"`
	Status     string `json:"status"` // pending | in_progress | completed
	ActiveForm string `json:"activeForm,omitempty"`
	Priority   string `json:"priority,omitempty"`
}

// planFrom reads a plan out of a TodoWrite call's input.
//
// Every field is optional on purpose: the todo shape has changed upstream
// before, and losing the whole plan over one renamed key is not a trade worth
// making.
func planFrom(input json.RawMessage) []PlanEntry {
	var in struct {
		Todos []PlanEntry `json:"todos"`
	}
	if json.Unmarshal(input, &in) != nil || len(in.Todos) == 0 {
		return nil
	}
	return in.Todos
}

// toolResultText reads a tool_result's content.
//
// The CLI writes it either as a plain string or as a list of blocks, and
// handling only one shape silently drops half the results — which is exactly
// the bug internal/chatlog had with message content.
func toolResultText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var blocks []contentBlock
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	var b strings.Builder
	for _, bl := range blocks {
		if bl.Type == "text" {
			b.WriteString(bl.Text)
		}
	}
	return b.String()
}

// maxToolOutput is as much of a result as a transcript can use.
const maxToolOutput = 2048

// truncateOutput caps a tool result at the adapter.
//
// Capping here rather than at each consumer keeps one number in one place, and
// keeps a result that happens to be a whole file off the wire entirely.
func truncateOutput(s string) string {
	if len(s) <= maxToolOutput {
		return s
	}
	// Back up to a rune start: slicing mid-rune renders as U+FFFD.
	cut := maxToolOutput
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "\n…"
}
```

Add `"unicode/utf8"` to `protocol.go`'s imports.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "$KARMAX" && go test ./internal/harness/ -run 'TestPlanFrom|TestToolResultText|TestTruncateOutput' -v 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Vet and commit**

```bash
cd "$KARMAX" && go vet ./internal/harness/ && gofmt -l internal/harness/
git -C "$KARMAX" add internal/harness/protocol.go internal/harness/protocol_test.go
git -C "$KARMAX" commit -m "A result has two shapes, a plan has one, and neither is unbounded"
```

**Do not push.**

---

## Task 3: The new event, and the emit that fills it

The centre of the change. `Event` is replaced; `emit` grows from fifteen lines
over two event shapes to the full vocabulary over four.

**Design note the implementer must not "fix":** this does *not* accumulate
`input_json_delta`. t3code does, because it renders a tool call as its
arguments stream. We emit `KindTool` from the `assistant` event, which already
carries the *complete* input — so one tool call is exactly two emissions
(announce, resolve), no delta buffer and no index→id bookkeeping. The cost is
that a call appears when its input finishes streaming rather than when it
starts, which is tens of milliseconds.

**Repo:** KARMAX

**Files:**
- Modify: `$KARMAX/internal/harness/session.go:140-181` (`Event`, `emit`)
- Modify: `$KARMAX/internal/harness/protocol.go` (`event.StreamEvent.Delta`, `ToolEvent`)
- Modify: `$KARMAX/internal/harness/sink_test.go`

**Interfaces:**
- Consumes: `toolKind`, `toolTitle`, `toolLocations`, `Location`, `Status`, `ToolKind` (Task 1); `planFrom`, `toolResultText`, `truncateOutput`, `PlanEntry`, `contentBlock.Content` (Task 2).
- Produces:
  - `type EventKind string`, constants `KindMessage`, `KindThought`, `KindTool`, `KindToolUpdate`, `KindPlan`, `KindError`
  - `type ToolEvent struct { ID, Title string; Kind ToolKind; Status Status; Locations []Location; Output string }`
  - `type Event struct { Kind EventKind; Text string; Tool *ToolEvent; Plan []PlanEntry; JobID string }`
  - `func emit(sink func(Event), ev event)` — unchanged signature

- [ ] **Step 1: Write the failing test**

Replace the body of `$KARMAX/internal/harness/sink_test.go` with:

```go
package harness

import (
	"encoding/json"
	"testing"
)

// collect replays a list of raw CLI lines and returns what the sink saw.
func collect(t *testing.T, lines ...string) []Event {
	t.Helper()
	var evs []event
	for _, l := range lines {
		var ev event
		if err := json.Unmarshal([]byte(l), &ev); err != nil {
			t.Fatalf("fixture line is not json: %v\n%s", err, l)
		}
		evs = append(evs, ev)
	}
	var got []Event
	replay(func(e Event) { got = append(got, e) }, evs)
	return got
}

func TestTextDeltasBecomeMessages(t *testing.T) {
	got := collect(t,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Found "}}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"14."}}}`,
	)
	if len(got) != 2 || got[0].Kind != KindMessage || got[1].Text != "14." {
		t.Fatalf("got %+v", got)
	}
}

// Reasoning is a different stream from the reply, and the delta field it
// arrives in is named "thinking", not "text".
func TestThinkingDeltasBecomeThoughts(t *testing.T) {
	got := collect(t,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Let me check "}}}`,
	)
	if len(got) != 1 || got[0].Kind != KindThought || got[0].Text != "Let me check " {
		t.Fatalf("got %+v", got)
	}
}

// The whole point of the id: two calls to one tool are two calls.
func TestAToolCallIsAnnouncedWithItsIdentity(t *testing.T) {
	got := collect(t,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/a/main.go"}}]}}`,
	)
	if len(got) != 1 {
		t.Fatalf("got %d events, want 1: %+v", len(got), got)
	}
	e := got[0]
	if e.Kind != KindTool || e.Tool == nil {
		t.Fatalf("got %+v", e)
	}
	if e.Tool.ID != "toolu_1" || e.Tool.Title != "main.go" || e.Tool.Kind != ToolRead {
		t.Errorf("identity wrong: %+v", e.Tool)
	}
	if e.Tool.Status != StatusInProgress {
		t.Errorf("status = %q, want in_progress", e.Tool.Status)
	}
	if len(e.Tool.Locations) != 1 || e.Tool.Locations[0].Path != "/a/main.go" {
		t.Errorf("locations wrong: %+v", e.Tool.Locations)
	}
}

func TestAToolResultResolvesByID(t *testing.T) {
	got := collect(t,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"package main"}]}}`,
	)
	if len(got) != 1 || got[0].Kind != KindToolUpdate || got[0].Tool == nil {
		t.Fatalf("got %+v", got)
	}
	if got[0].Tool.ID != "toolu_1" || got[0].Tool.Status != StatusCompleted {
		t.Errorf("got %+v", got[0].Tool)
	}
	if got[0].Tool.Output != "package main" {
		t.Errorf("output = %q", got[0].Tool.Output)
	}
}

func TestAFailedToolResultSaysSo(t *testing.T) {
	got := collect(t,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_2","is_error":true,"content":"no such file"}]}}`,
	)
	if len(got) != 1 || got[0].Tool.Status != StatusFailed {
		t.Fatalf("got %+v", got)
	}
}

// TodoWrite is a plan, not a tool call worth a line of its own.
func TestTodoWriteBecomesAPlanAndNotATool(t *testing.T) {
	got := collect(t,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_3","name":"TodoWrite","input":{"todos":[{"content":"Ship it","status":"pending"}]}}]}}`,
	)
	if len(got) != 1 || got[0].Kind != KindPlan {
		t.Fatalf("got %+v", got)
	}
	if len(got[0].Plan) != 1 || got[0].Plan[0].Content != "Ship it" {
		t.Errorf("plan wrong: %+v", got[0].Plan)
	}
}

// The bug this file was written for: --include-partial-messages sends the
// deltas AND the finished text again, so emitting both doubles every reply.
func TestAssistantTextIsNotEmittedTwice(t *testing.T) {
	got := collect(t,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}`,
	)
	if len(got) != 1 {
		t.Fatalf("got %d events, want 1 — the reply was doubled: %+v", len(got), got)
	}
}

func TestANilSinkIsNotACrash(t *testing.T) {
	replay(nil, []event{{Type: "assistant"}})
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$KARMAX" && go test ./internal/harness/ -run 'TestTextDeltas|TestThinking|TestATool|TestAFailed|TestTodoWrite|TestAssistantText|TestANilSink' 2>&1 | head -20
```

Expected: FAIL — `undefined: KindMessage`, `e.Tool.ID undefined (type string has no field ID)`.

- [ ] **Step 3: Widen the decode surface**

In `$KARMAX/internal/harness/protocol.go`, replace the `StreamEvent` and
`Message` fields of `event`:

```go
	// assistant / user
	Message struct {
		// Model names the brain that answered, for the transcript's footer.
		Model   string         `json:"model"`
		Content []contentBlock `json:"content"`
	} `json:"message"`

	// stream_event, only present with --include-partial-messages
	StreamEvent struct {
		Type  string `json:"type"` // content_block_delta | message_start | …
		Delta struct {
			Type string `json:"type"` // text_delta | thinking_delta
			Text string `json:"text"`
			// Reasoning arrives under its own key, not under Text. Reading
			// Text for a thinking_delta yields empty thoughts, silently.
			Thinking string `json:"thinking"`
		} `json:"delta"`
	} `json:"event"`
```

Then append the `ToolEvent` type to `protocol.go`:

```go
// ToolEvent is the streaming view of one tool call: announced, then revised.
//
// Deliberately not ToolCall, which is the settled record of a call inside a
// Turn and carries the raw Input and Command the audit allowlist reads. That
// one has consumers — the allowlist audit, harnessbrain, the chat's ticket
// extraction — and keeps its name and shape.
//
// A KindToolUpdate carries only ID, Status and Output: the consumer merges it
// into the call it already has, the way ACP's tool_call_update does.
type ToolEvent struct {
	// ID is stable for the life of the call. Without it a completion can only
	// be matched by name, and a second call to the same tool resolves the
	// wrong one.
	ID        string     `json:"id"`
	Title     string     `json:"title,omitempty"`
	Kind      ToolKind   `json:"kind,omitempty"`
	Status    Status     `json:"status"`
	Locations []Location `json:"locations,omitempty"`
	Output    string     `json:"output,omitempty"`
}
```

- [ ] **Step 4: Replace Event and emit**

In `$KARMAX/internal/harness/session.go`, replace lines 140–173 (the `Event`
type and `emit`) with:

```go
// EventKind is one thing a harness can say while a turn is running.
type EventKind string

const (
	KindMessage    EventKind = "message"     // the reply, as deltas
	KindThought    EventKind = "thought"     // reasoning, when it is enabled
	KindTool       EventKind = "tool"        // a call, announced
	KindToolUpdate EventKind = "tool_update" // the same call, resolved
	KindPlan       EventKind = "plan"
	KindError      EventKind = "error"
)

// Event is one thing worth telling a caller while a turn is still running.
//
// Shaped after ACP's SessionUpdate rather than after any one CLI's output, so
// that a second harness is an adapter rather than a second vocabulary. The set
// is still narrower than the wire's: "conversation" and "done" are the
// endpoint's, added there because the harness has no business knowing either.
type Event struct {
	Kind EventKind

	// Text carries KindMessage, KindThought and KindError.
	Text string

	// Tool is set for KindTool and KindToolUpdate.
	Tool *ToolEvent

	// Plan replaces the whole plan each time. The agent revises it wholesale,
	// and merging entry by entry would invent a history it does not have.
	Plan []PlanEntry

	JobID string
}

// emit hands one parsed CLI event to the sink, if there is one.
//
// Stateless on purpose. A tool call is announced from the assistant message,
// which already carries its complete input, and resolved from the tool_result
// that follows — so nothing has to be remembered between events, and an
// update carrying only an id is merged by whoever is keeping the transcript.
func emit(sink func(Event), ev event) {
	if sink == nil {
		return
	}
	switch ev.Type {
	case "stream_event":
		if ev.StreamEvent.Type != "content_block_delta" {
			return
		}
		switch ev.StreamEvent.Delta.Type {
		case "text_delta":
			sink(Event{Kind: KindMessage, Text: ev.StreamEvent.Delta.Text})
		case "thinking_delta":
			sink(Event{Kind: KindThought, Text: ev.StreamEvent.Delta.Thinking})
		}

	case "assistant":
		// Text is not emitted here: the deltas above already streamed it, and
		// this block is that same text again, sent whole — emitting it too
		// would double every reply.
		for _, c := range ev.Message.Content {
			if c.Type != "tool_use" {
				continue
			}
			// The plan is the useful artifact; a line saying "kept track" is
			// not. The tool_result that follows is dropped by the consumer,
			// which ignores updates for calls it never saw announced.
			if c.Name == "TodoWrite" {
				if plan := planFrom(c.Input); plan != nil {
					sink(Event{Kind: KindPlan, Plan: plan})
				}
				continue
			}
			sink(Event{Kind: KindTool, Tool: &ToolEvent{
				ID:        c.ID,
				Title:     toolTitle(c.Name, c.Input),
				Kind:      toolKind(c.Name),
				Status:    StatusInProgress,
				Locations: toolLocations(c.Name, c.Input),
			}})
		}

	case "user":
		for _, c := range ev.Message.Content {
			if c.Type != "tool_result" {
				continue
			}
			status := StatusCompleted
			if c.IsError {
				status = StatusFailed
			}
			sink(Event{Kind: KindToolUpdate, Tool: &ToolEvent{
				ID:     c.ToolUseID,
				Status: status,
				Output: truncateOutput(toolResultText(c.Content)),
			}})
		}
	}
}
```

- [ ] **Step 5: Run the whole harness package**

```bash
cd "$KARMAX" && go build ./... && go test ./internal/harness/ 2>&1 | tail -30
```

Expected: the new tests PASS. **Other packages will fail to build** —
`internal/runtime/chathost.go` still reads `e.Tool` as a string. That is Task 5;
if `go build ./...` fails only there, continue. If `go test ./internal/harness/`
itself fails, fix it before moving on.

- [ ] **Step 6: Commit**

```bash
cd "$KARMAX" && gofmt -l internal/harness/
git -C "$KARMAX" add internal/harness/session.go internal/harness/protocol.go internal/harness/sink_test.go
git -C "$KARMAX" commit -m "The harness can say what it thought, what it called, and what it plans"
```

**Do not push.**

---

## Task 4: What a turn cost, and whether it may think

Two small additions that the transcript's footer and the thinking toggle need.

**The constraint discovered while planning, which the implementer must honour:**
thinking is set by an environment variable on the child process, so it is fixed
when the process **spawns**. A session is long-lived and reused across turns, so
`Thinking` behaves exactly like `Model` already does — it takes effect on a new
session or on the next resume, never mid-conversation. Since a chat conversation
*is* a harness session (`Options.SessionID`), "per conversation" is the right
granularity; "per turn" is not achievable and must not be promised in the UI.

**Repo:** KARMAX

**Files:**
- Modify: `$KARMAX/internal/harness/protocol.go` (`Turn`)
- Modify: `$KARMAX/internal/harness/session.go` (`Session`, `spawn`, `Send`)
- Modify: `$KARMAX/internal/harness/supervisor.go` (`Options`, the `spawn` call, `open`)
- Modify: `$KARMAX/internal/harness/protocol_test.go`
- Create: `$KARMAX/internal/harness/testdata/thinking.jsonl` (from the probe)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Turn.Model string`, `Turn.Duration time.Duration`, `Options.Thinking bool`, `Session.Thinking bool`.

- [ ] **Step 1: Write the failing test**

Append to `$KARMAX/internal/harness/protocol_test.go`:

```go
// The transcript's footer says which brain answered and how long it took.
func TestTurnCarriesModelAndDuration(t *testing.T) {
	var assistant, result event
	mustLine(t, &assistant, `{"type":"assistant","message":{"model":"claude-opus-5","content":[{"type":"text","text":"hi"}]}}`)
	mustLine(t, &result, `{"type":"result","duration_ms":7830,"total_cost_usd":0.012,"result":"hi"}`)

	if assistant.Message.Model != "claude-opus-5" {
		t.Errorf("model not decoded: %q", assistant.Message.Model)
	}
	if result.DurationMS != 7830 {
		t.Errorf("duration not decoded: %d", result.DurationMS)
	}
}

func mustLine(t *testing.T, into *event, line string) {
	t.Helper()
	if err := json.Unmarshal([]byte(line), into); err != nil {
		t.Fatalf("fixture is not json: %v", err)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "$KARMAX" && go test ./internal/harness/ -run TestTurnCarriesModel 2>&1 | head
```

Expected: FAIL — `assistant.Message.Model undefined` if Task 3's decode widening
was skipped; otherwise it passes the decode half and you still add the `Turn`
fields below.

- [ ] **Step 3: Add the Turn fields**

In `protocol.go`, extend `Turn`:

```go
type Turn struct {
	Text      string
	ToolCalls []ToolCall
	Usage     Usage
	CostUSD   float64
	// Model and Duration are what the transcript's footer reports. The CLI
	// names the model on every assistant message and the elapsed time on the
	// result, so neither has to be measured here.
	Model     string
	Duration  time.Duration
	Limits    *RateLimit
	NumTurns  int
	Err       error
}
```

Add `"time"` to `protocol.go`'s imports.

- [ ] **Step 4: Populate them in Send**

In `session.go`'s `Send`, in the `case "assistant":` branch, before the content
loop:

```go
			case "assistant":
				if ev.Message.Model != "" {
					turn.Model = ev.Message.Model
				}
				for _, c := range ev.Message.Content {
```

And in `case "result":`, after `turn.NumTurns = ev.NumTurns`:

```go
				turn.Duration = time.Duration(ev.DurationMS) * time.Millisecond
```

- [ ] **Step 5: Plumb Thinking through to the process**

In `session.go`, add the field to `Session` beside `Model`:

```go
type Session struct {
	Key   string
	Kind  string
	ID    string // the CLI's session uuid, for --resume
	Model string
	// Thinking is fixed when the process spawns, so like Model it takes
	// effect on a new session or on the next resume — never mid-conversation.
	Thinking bool
```

Change `spawn`'s environment handling. After `cmd.Env = env`, replace that line
with:

```go
	cmd.Env = env
	if s.Thinking {
		// Extended thinking is off unless the child is given a budget for it.
		cmd.Env = append(cmd.Env, "MAX_THINKING_TOKENS=8000")
	}
```

In `supervisor.go`, add to `Options` beside `Model`:

```go
	// Thinking asks for the reasoning stream, which is off by default.
	//
	// Applied when the process is spawned, so like Model it takes effect on a
	// new session or on the next resume. A conversation is a session, which is
	// why per-conversation is the granularity this can honestly offer.
	Thinking bool
```

In `supervisor.go`'s `open`, wherever `sess.Model` is set from `opt.Model`, set
`sess.Thinking = opt.Thinking` alongside it.

- [ ] **Step 6: Run the package tests**

```bash
cd "$KARMAX" && go test ./internal/harness/ 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 7: Record the thinking probe — this is the verification step**

The spec flags `MAX_THINKING_TOKENS` as the documented lever but **unproven on
this machine**. Prove it now; do not build anything else on it first.

```bash
cd /tmp && MAX_THINKING_TOKENS=8000 claude --print \
  --output-format stream-json --verbose --include-partial-messages \
  --dangerously-skip-permissions \
  'Think step by step about why 1729 is interesting, then answer in one sentence.' \
  > /tmp/thinking-probe.jsonl 2>/dev/null
grep -c thinking_delta /tmp/thinking-probe.jsonl
```

Expected: a count greater than zero.

**If the count is zero**, `MAX_THINKING_TOKENS` is not the lever. Stop, find the
one that is (check `claude --help`, then the CLI's own docs), fix `spawn`, and
re-run. Report what you found. Nothing else in this plan depends on the answer —
`thinking_delta` handling in `emit` is already correct and tested against a
synthetic line.

Once it produces deltas, keep it as a fixture:

```bash
cp /tmp/thinking-probe.jsonl "$KARMAX/internal/harness/testdata/thinking.jsonl"
```

- [ ] **Step 8: Assert against the real capture**

Append to `sink_test.go`:

```go
// Ground truth from a real turn with thinking enabled: reasoning and reply
// must not leak into each other.
func TestRecordedThinkingTurnSeparatesThoughtFromReply(t *testing.T) {
	f, err := os.Open("testdata/thinking.jsonl")
	if err != nil {
		t.Skip("no thinking fixture recorded yet")
	}
	defer f.Close()

	var thought, message int
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for sc.Scan() {
		var ev event
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		emit(func(e Event) {
			switch e.Kind {
			case KindThought:
				thought++
				if e.Text == "" {
					t.Error("a thought arrived empty — wrong delta field")
				}
			case KindMessage:
				message++
			}
		}, ev)
	}
	if thought == 0 {
		t.Error("no thoughts emitted from a turn recorded with thinking on")
	}
	if message == 0 {
		t.Error("no reply emitted")
	}
}
```

Add `"bufio"` and `"os"` to that file's imports.

- [ ] **Step 9: Run and commit**

```bash
cd "$KARMAX" && go test ./internal/harness/ -v -run Recorded 2>&1 | tail -10
gofmt -l internal/harness/
git -C "$KARMAX" add internal/harness/ && git -C "$KARMAX" commit -m "A turn reports its brain and its clock, and may be asked to think"
```

**Do not push.**

---

## Task 5: The wire

Carry the new vocabulary through `api.ChatEvent` to NDJSON. This is the task
that makes `go build ./...` whole again.

**Repo:** KARMAX

**Files:**
- Modify: `$KARMAX/internal/api/server.go:51-61` (`ChatEvent`)
- Modify: `$KARMAX/internal/api/chat.go:77-101` (the `send` switch)
- Modify: `$KARMAX/internal/runtime/chathost.go:34-36` (the mapping)
- Modify: `$KARMAX/internal/api/chat_test.go`

**Interfaces:**
- Consumes: `harness.Event`, `harness.ToolEvent`, `harness.PlanEntry` (Task 3); `Turn.Model`, `Turn.Duration` (Task 4).
- Produces: the NDJSON kinds `conversation | message | thought | tool | tool_update | plan | ticket | done | error`.

Note `internal/api` must **not** import `internal/harness` — that constraint is
recorded at `server.go:51-54` and is why `ChatEvent` exists at all. The runtime
adapter does the translation.

- [ ] **Step 1: Write the failing test**

Append to `$KARMAX/internal/api/chat_test.go`:

```go
// Each kind writes only its own fields. A blanket dump would put an empty
// "tool" on every text delta and force the client's union to make every field
// optional to read it.
func TestStreamTurnWritesOneShapePerKind(t *testing.T) {
	var lines []string
	sink := &lineSink{onLine: func(s string) { lines = append(lines, s) }}

	streamTurn(sink, "conv-1", true, func(emit func(harnessEvent)) (string, error) {
		emit(harnessEvent{Kind: "message", Text: "Found "})
		emit(harnessEvent{Kind: "thought", Text: "checking"})
		emit(harnessEvent{Kind: "tool", Tool: &ChatTool{
			ID: "toolu_1", Title: "main.go", Kind: "read", Status: "in_progress",
			Locations: []ChatLocation{{Path: "/a/main.go", Line: 12}},
		}})
		emit(harnessEvent{Kind: "tool_update", Tool: &ChatTool{
			ID: "toolu_1", Status: "completed", Output: "package main",
		}})
		emit(harnessEvent{Kind: "plan", Plan: []ChatPlanEntry{{Content: "Ship it", Status: "pending"}}})
		return "Found 14.", nil
	})

	got := make([]map[string]any, 0, len(lines))
	for _, l := range lines {
		var m map[string]any
		if err := json.Unmarshal([]byte(l), &m); err != nil {
			t.Fatalf("line is not json: %s", l)
		}
		got = append(got, m)
	}

	if got[0]["kind"] != "conversation" || got[0]["id"] != "conv-1" {
		t.Fatalf("first line: %+v", got[0])
	}
	if got[1]["kind"] != "message" || got[1]["text"] != "Found " {
		t.Errorf("message: %+v", got[1])
	}
	if _, extra := got[1]["tool"]; extra {
		t.Error("a message line carried a tool field")
	}
	if got[2]["kind"] != "thought" || got[2]["text"] != "checking" {
		t.Errorf("thought: %+v", got[2])
	}

	tool, ok := got[3]["tool"].(map[string]any)
	if !ok {
		t.Fatalf("tool line has no tool object: %+v", got[3])
	}
	if tool["id"] != "toolu_1" || tool["title"] != "main.go" || tool["kind"] != "read" {
		t.Errorf("tool: %+v", tool)
	}
	locs, ok := tool["locations"].([]any)
	if !ok || len(locs) != 1 {
		t.Errorf("locations: %+v", tool["locations"])
	}

	upd := got[4]["tool"].(map[string]any)
	if upd["id"] != "toolu_1" || upd["status"] != "completed" {
		t.Errorf("update: %+v", upd)
	}

	plan, ok := got[5]["plan"].([]any)
	if !ok || len(plan) != 1 {
		t.Fatalf("plan: %+v", got[5])
	}

	last := got[len(got)-1]
	if last["kind"] != "done" || last["text"] != "Found 14." {
		t.Errorf("done: %+v", last)
	}
}

// The error goes down the stream, not into a status code: the headers left
// before the first token did.
func TestStreamTurnReportsFailureInBand(t *testing.T) {
	var lines []string
	sink := &lineSink{onLine: func(s string) { lines = append(lines, s) }}
	streamTurn(sink, "conv-2", false, func(emit func(harnessEvent)) (string, error) {
		emit(harnessEvent{Kind: "message", Text: "part"})
		return "", errTest
	})
	var last map[string]any
	_ = json.Unmarshal([]byte(lines[len(lines)-1]), &last)
	if last["kind"] != "error" {
		t.Fatalf("got %+v", last)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "$KARMAX" && go test ./internal/api/ -run TestStreamTurn 2>&1 | head
```

Expected: FAIL — `undefined: ChatTool`.

- [ ] **Step 3: Widen ChatEvent**

Replace `$KARMAX/internal/api/server.go:51-61` with:

```go
// ChatEvent is one thing worth telling a streaming chat client while a turn is
// still running. It is this package's own type, not harness.Event, because
// internal/api must not import internal/harness — the runtime adapter that
// wires SetChatTurn is where a harness.Event becomes one of these.
type ChatEvent struct {
	Kind  string
	Text  string
	Tool  *ChatTool
	Plan  []ChatPlanEntry
	JobID string
}

// ChatTool is a tool call on its way to a client. A "tool" carries all of it;
// a "tool_update" carries only ID, Status and Output, and the client merges by
// id — which is what makes two calls to one tool two lines.
type ChatTool struct {
	ID        string         `json:"id"`
	Title     string         `json:"title,omitempty"`
	Kind      string         `json:"kind,omitempty"`
	Status    string         `json:"status"`
	Locations []ChatLocation `json:"locations,omitempty"`
	Output    string         `json:"output,omitempty"`
}

// ChatLocation is a file a tool call touched.
type ChatLocation struct {
	Path string `json:"path"`
	Line int    `json:"line,omitempty"`
}

// ChatPlanEntry is one line of the agent's plan.
type ChatPlanEntry struct {
	Content    string `json:"content"`
	Status     string `json:"status"`
	ActiveForm string `json:"activeForm,omitempty"`
	Priority   string `json:"priority,omitempty"`
}
```

- [ ] **Step 4: Extend the send switch**

In `$KARMAX/internal/api/chat.go`, replace the `switch e.Kind` block inside
`streamTurn` with:

```go
			obj := map[string]any{"kind": e.Kind}
			switch e.Kind {
			case "message", "thought", "error":
				obj["text"] = e.Text
			case "tool", "tool_update":
				obj["tool"] = e.Tool
			case "plan":
				obj["plan"] = e.Plan
			case "ticket":
				// A ticket's title rides in Text: ChatEvent has no title field
				// and giving it one would put a chat's concern in the wire type.
				obj["jobId"], obj["title"] = e.JobID, e.Text
			}
			send(obj)
```

- [ ] **Step 5: Translate in the runtime adapter**

In `$KARMAX/internal/runtime/chathost.go`, replace the `OnEvent` closure:

```go
		OnEvent: func(e harness.Event) {
			ev := api.ChatEvent{Kind: string(e.Kind), Text: e.Text, JobID: e.JobID}
			if e.Tool != nil {
				locs := make([]api.ChatLocation, 0, len(e.Tool.Locations))
				for _, l := range e.Tool.Locations {
					locs = append(locs, api.ChatLocation{Path: l.Path, Line: l.Line})
				}
				ev.Tool = &api.ChatTool{
					ID:        e.Tool.ID,
					Title:     e.Tool.Title,
					Kind:      string(e.Tool.Kind),
					Status:    string(e.Tool.Status),
					Locations: locs,
					Output:    e.Tool.Output,
				}
			}
			for _, p := range e.Plan {
				ev.Plan = append(ev.Plan, api.ChatPlanEntry{
					Content: p.Content, Status: p.Status,
					ActiveForm: p.ActiveForm, Priority: p.Priority,
				})
			}
			onEvent(ev)
		},
```

Also extend the `done` line in `chat.go` to carry the footer's facts. Change
`streamTurn`'s signature so `run` returns the turn's metadata:

```go
func streamTurn(w io.Writer, conversationID string, isNew bool,
	run func(sink func(harnessEvent)) (string, error)) {
```

stays as it is — instead, add the metadata to `ChatEvent` delivery by having
`chatTurn` emit a final `ChatEvent{Kind: "meta", ...}`. Simpler: in
`chathost.go`, after the tickets loop and before returning, emit:

```go
	onEvent(api.ChatEvent{
		Kind: "meta",
		Tool: nil,
		Text: turn.Model,
		// Duration rides in JobID rather than growing the type a numeric field
		// only one kind uses. The endpoint re-labels it; see chat.go.
		JobID: strconv.FormatInt(turn.Duration.Milliseconds(), 10),
	})
```

**Do not do the above.** It is exactly the kind of field-smuggling the existing
comment at `chat.go:88` warns against. Instead add explicit fields to
`ChatEvent`:

```go
type ChatEvent struct {
	Kind       string
	Text       string
	Tool       *ChatTool
	Plan       []ChatPlanEntry
	JobID      string
	Model      string
	DurationMS int64
	CostUSD    float64
}
```

and a `meta` case in the switch:

```go
			case "meta":
				obj["model"], obj["durationMs"], obj["costUsd"] = e.Model, e.DurationMS, e.CostUSD
```

and in `chathost.go`, after the tickets loop:

```go
	// The footer's facts, announced before `done` for the same reason tickets
	// are: they only exist once the turn has finished.
	onEvent(api.ChatEvent{
		Kind:       "meta",
		Model:      turn.Model,
		DurationMS: turn.Duration.Milliseconds(),
		CostUSD:    turn.CostUSD,
	})
```

Add `meta` to the test in Step 1 by appending an assertion that the
second-to-last line has `kind == "meta"` with a `model` field.

- [ ] **Step 6: Build everything and run both packages**

```bash
cd "$KARMAX" && go build ./... && go test ./internal/api/ ./internal/runtime/ ./internal/harness/ 2>&1 | tail -20
```

Expected: build clean, all three packages PASS.

- [ ] **Step 7: Commit**

```bash
cd "$KARMAX" && gofmt -l internal/
git -C "$KARMAX" add internal/api internal/runtime && git -C "$KARMAX" commit -m "The wire carries a whole tool call, a thought and a plan"
```

**Do not push.**

---

## Task 6: The TypeScript contract

The union changes on both sides of the IPC bridge at once. `chat-core` and
`desktop/electron/shared/types.ts` restate the same union deliberately (the
preload cannot bundle the package), so they move together or TypeScript breaks.

**Repo:** monorepo

**Files:**
- Modify: `packages/chat-core/src/types.ts`
- Modify: `packages/chat-core/src/reduce.ts`
- Modify: `packages/chat-core/test/reduce.test.ts`
- Modify: `desktop/electron/shared/types.ts:394-427`
- Modify: `desktop/src/routes/chat/adapter.ts:48-60`

**Interfaces:**
- Consumes: the NDJSON kinds from Task 5.
- Produces:
  - `ToolCall { id, title?, kind?, status, locations?, output? }`
  - `PlanEntry { content, status, activeForm?, priority? }`
  - `TurnMeta { model?, durationMs?, costUsd? }`
  - `Message { id, role, text, thought, toolCalls, plan, cards, meta?, streaming?, failed? }`
  - `TurnEvent` with kinds `conversation | message | thought | tool | tool_update | plan | ticket | meta | done | error`
  - `reduce`, `ask`, `rearm`, `empty` — unchanged signatures

- [ ] **Step 1: Write the failing test**

Replace `packages/chat-core/test/reduce.test.ts` with:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { empty, ask, reduce } from '../src/reduce.ts'

// Deltas accumulate into one reply rather than one bubble each.
test('message deltas accumulate', () => {
  let s = ask(empty(), 'hello')
  s = reduce(s, { kind: 'message', text: 'Found ' })
  s = reduce(s, { kind: 'message', text: '14.' })
  const last = s.messages.at(-1)!
  assert.equal(last.role, 'assistant')
  assert.equal(last.text, 'Found 14.')
  assert.equal(last.streaming, true)
})

// Reasoning is a separate stream and must never land in the reply.
test('thought deltas accumulate apart from the reply', () => {
  let s = ask(empty(), 'hello')
  s = reduce(s, { kind: 'thought', text: 'Let me ' })
  s = reduce(s, { kind: 'message', text: 'Yes.' })
  s = reduce(s, { kind: 'thought', text: 'check.' })
  const last = s.messages.at(-1)!
  assert.equal(last.thought, 'Let me check.')
  assert.equal(last.text, 'Yes.')
})

// The whole reason for the id: resolving by name resolved the wrong call.
test('a tool update resolves its own call, not the most recent one', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'tool', tool: { id: 'a', title: 'one.go', kind: 'read', status: 'in_progress' } })
  s = reduce(s, { kind: 'tool', tool: { id: 'b', title: 'two.go', kind: 'read', status: 'in_progress' } })
  s = reduce(s, { kind: 'tool_update', tool: { id: 'a', status: 'completed', output: 'package one' } })

  const calls = s.messages.at(-1)!.toolCalls
  assert.equal(calls.length, 2)
  assert.equal(calls[0].status, 'completed')
  assert.equal(calls[0].output, 'package one')
  assert.equal(calls[0].title, 'one.go', 'the update must not erase the title')
  assert.equal(calls[1].status, 'in_progress')
})

// TodoWrite's own tool_result has an id nobody announced.
test('an update for an unknown call is dropped', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'tool_update', tool: { id: 'ghost', status: 'completed' } })
  assert.deepEqual(s.messages.at(-1)!.toolCalls, [])
})

// The agent revises its plan wholesale; merging would invent a history.
test('a plan replaces the previous plan', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'plan', plan: [{ content: 'one', status: 'pending' }] })
  s = reduce(s, {
    kind: 'plan',
    plan: [{ content: 'one', status: 'completed' }, { content: 'two', status: 'in_progress' }],
  })
  const plan = s.messages.at(-1)!.plan
  assert.equal(plan.length, 2)
  assert.equal(plan[0].status, 'completed')
})

test('meta lands on the reply', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'meta', model: 'claude-opus-5', durationMs: 7830, costUsd: 0.012 })
  assert.equal(s.messages.at(-1)!.meta?.model, 'claude-opus-5')
  assert.equal(s.messages.at(-1)!.meta?.durationMs, 7830)
})

test('a ticket becomes a card', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'ticket', jobId: 'j1', title: 'Nightly report' })
  assert.deepEqual(s.messages.at(-1)!.cards, [
    { kind: 'ticket', id: 'j1', title: 'Nightly report', status: 'Running', live: true },
  ])
})

// The turn's own answer wins over the deltas: a partial stream can be truncated.
test('done settles the reply with the engine text', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'message', text: 'partial' })
  s = reduce(s, { kind: 'done', text: 'the whole answer' })
  assert.equal(s.messages.at(-1)!.text, 'the whole answer')
  assert.equal(s.messages.at(-1)!.streaming, false)
  assert.equal(s.busy, false)
})

test('error marks the reply failed and frees the composer', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'error', text: 'nope' })
  assert.equal(s.messages.at(-1)!.failed, true)
  assert.equal(s.busy, false)
})

test('conversation id is remembered', () => {
  const s = reduce(empty(), { kind: 'conversation', id: 'c1' })
  assert.equal(s.conversationId, 'c1')
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/packages/chat-core && npm test 2>&1 | head -20
```

Expected: FAIL — type errors on `kind: 'message'` and `last.thought`.

- [ ] **Step 3: Rewrite types.ts**

Replace `packages/chat-core/src/types.ts` with:

```ts
/** A tool call, as the engine reports it.
 *
 *  `kind` and `status` are ACP's vocabularies verbatim, so a second harness
 *  speaking that protocol needs no translation table here. */
export interface ToolCall {
  /** Stable for the life of the call. Updates are merged onto it by id —
   *  matching by name is what made two calls to one tool resolve each other. */
  id: string
  title?: string
  kind?: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  locations?: { path: string; line?: number }[]
  output?: string
}

/** One line of the agent's plan. */
export interface PlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
  priority?: string
}

/** What a finished turn cost, for the transcript's footer. */
export interface TurnMeta {
  model?: string
  durationMs?: number
  costUsd?: number
}

/** One thing the engine says while a turn is running.
 *
 *  Closed on purpose: the reducer is a switch over this, and a kind nobody
 *  handles is a silent no-op rather than a visible bug. */
export type TurnEvent =
  | { kind: 'conversation'; id: string }
  | { kind: 'message'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; tool: ToolCall }
  | { kind: 'tool_update'; tool: Pick<ToolCall, 'id' | 'status'> & Partial<ToolCall> }
  | { kind: 'plan'; plan: PlanEntry[] }
  | { kind: 'ticket'; jobId: string; title: string }
  | { kind: 'meta'; model?: string; durationMs?: number; costUsd?: number }
  | { kind: 'done'; text?: string }
  | { kind: 'error'; text: string }

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
  /** Reasoning, when the conversation asked for it. Kept apart from `text`
   *  because it is evidence of work, not the answer. */
  thought: string
  toolCalls: ToolCall[]
  plan: PlanEntry[]
  cards: Card[]
  meta?: TurnMeta
  streaming?: boolean
  failed?: boolean
}

export interface ChatState {
  conversationId: string | null
  messages: Message[]
  busy: boolean
}
```

- [ ] **Step 4: Rewrite reduce.ts**

Replace `packages/chat-core/src/reduce.ts` with:

```ts
import type { ChatState, Message, TurnEvent } from './types.ts'

export const empty = (): ChatState => ({ conversationId: null, messages: [], busy: false })

let seq = 0
const id = () => `m${++seq}`

const blank = (role: Message['role'], text = ''): Message => ({
  id: id(), role, text, thought: '', toolCalls: [], plan: [], cards: [],
})

/** The person asks. The empty reply is created here so every event that
 *  follows has somewhere to land, whatever order they arrive in. */
export function ask(state: ChatState, text: string): ChatState {
  const user = blank('user', text)
  const reply = { ...blank('assistant'), streaming: true }
  return { ...state, busy: true, messages: [...state.messages, user, reply] }
}

/** Retry after a failure: drop the failed reply and open a fresh one, but
 *  leave the user's message where it is — `ask` would post it a second time. */
export function rearm(state: ChatState): ChatState {
  const messages = [...state.messages]
  const last = messages.at(-1)
  if (last?.role === 'assistant' && last.failed) messages.pop()
  messages.push({ ...blank('assistant'), streaming: true })
  return { ...state, busy: true, messages }
}

export function reduce(state: ChatState, event: TurnEvent): ChatState {
  if (event.kind === 'conversation') return { ...state, conversationId: event.id }

  const messages = [...state.messages]
  let i = messages.length - 1
  if (i < 0 || messages[i].role !== 'assistant') {
    // An event with no reply to attach to: the turn began elsewhere, or was
    // restored from history. Make somewhere for it rather than dropping it.
    messages.push({ ...blank('assistant'), streaming: true })
    i = messages.length - 1
  }
  const m: Message = {
    ...messages[i],
    toolCalls: [...messages[i].toolCalls],
    cards: [...messages[i].cards],
  }
  messages[i] = m

  switch (event.kind) {
    case 'message':
      m.text += event.text
      return { ...state, messages }

    case 'thought':
      m.thought += event.text
      return { ...state, messages }

    case 'tool':
      m.toolCalls.push(event.tool)
      return { ...state, messages }

    case 'tool_update': {
      // Merge onto the call this update names. An update for a call nobody
      // announced is dropped rather than invented: TodoWrite becomes a plan,
      // so its own tool_result arrives with an id the transcript never saw.
      const k = m.toolCalls.findIndex((c) => c.id === event.tool.id)
      if (k >= 0) m.toolCalls[k] = { ...m.toolCalls[k], ...event.tool }
      return { ...state, messages }
    }

    case 'plan':
      // Replaced wholesale: the agent revises the whole list each time, and
      // merging entry by entry would invent a history it does not have.
      m.plan = event.plan
      return { ...state, messages }

    case 'ticket':
      m.cards.push({ kind: 'ticket', id: event.jobId, title: event.title, status: 'Running', live: true })
      return { ...state, messages }

    case 'meta':
      m.meta = { model: event.model, durationMs: event.durationMs, costUsd: event.costUsd }
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

- [ ] **Step 5: Restate the union for the bridge**

In `desktop/electron/shared/types.ts`, replace lines 394–427 with the same
union plus the engine-message shape:

```ts
/** One thing the engine says while a turn of the chat is running.
 *
 *  The same union as `@lyzn/chat-core`'s, restated because this file is the
 *  contract between the two processes and must not depend on a package the
 *  preload does not bundle. The reducer there switches over these, so a kind
 *  added to one has to be added to the other. */
export type TurnEvent =
  | { kind: 'conversation'; id: string }
  | { kind: 'message'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; tool: WireToolCall }
  | { kind: 'tool_update'; tool: Pick<WireToolCall, 'id' | 'status'> & Partial<WireToolCall> }
  | { kind: 'plan'; plan: WirePlanEntry[] }
  | { kind: 'ticket'; jobId: string; title: string }
  | { kind: 'meta'; model?: string; durationMs?: number; costUsd?: number }
  | { kind: 'done'; text?: string }
  | { kind: 'error'; text: string }

export interface WireToolCall {
  id: string
  title?: string
  kind?: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  locations?: { path: string; line?: number }[]
  output?: string
}

export interface WirePlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
  priority?: string
}

/** One past conversation, as the list of them shows it. */
export interface ConversationSummary {
  id: string
  title: string
  opening: string
  updated: string
}

/** A stored message, in the engine's shape.
 *
 *  Deliberately not `Message`: `@lyzn/chat-core` has one of those and it is a
 *  different thing — it carries an id and the cards the window drew. This is
 *  what the engine remembers. The renderer maps one to the other, and two
 *  types with one name is how that mapping gets forgotten. */
export interface EngineMessage {
  role: 'user' | 'assistant'
  text: string
  at: string
  toolCalls?: WireToolCall[]
}
```

- [ ] **Step 6: Fix the history mapping**

In `desktop/src/routes/chat/adapter.ts`, replace the `history` method's map:

```ts
  async history(id): Promise<Message[]> {
    // The engine's message and the package's are not the same shape: a
    // transcript read from disk has no ids and no cards, because neither
    // exists until a screen renders it.
    const msgs = await window.karmax.chat.history(id)
    return msgs.map((m, i) => ({
      id: `${id}:${i}`,
      role: m.role,
      text: m.text,
      thought: '',
      toolCalls: m.toolCalls ?? [],
      plan: [],
      cards: [],
    }))
  },
```

- [ ] **Step 7: Run the tests**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/packages/chat-core && npm test 2>&1 | tail -20
```

Expected: PASS. `useConversation.test.ts` may need its event literals updated
from `kind: 'text'` to `kind: 'message'` — do that if it fails.

The desktop will not typecheck yet: `StepLine.tsx` and `Turn.tsx` still read
`message.steps`. That is Task 9.

- [ ] **Step 8: Commit**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant
git add packages/chat-core desktop/electron/shared/types.ts desktop/src/routes/chat/adapter.ts
git commit -m "A tool call keeps its identity across the bridge"
```

**Do not push.**

---

## Task 7: deriveRows

The row model. Pure, in chat-core, tested with no renderer — the separation
t3code gets right in `MessagesTimeline.logic.ts`, and the reason their
4,000-line component stays tractable.

**Repo:** monorepo

**Files:**
- Create: `packages/chat-core/src/rows.ts`
- Create: `packages/chat-core/test/rows.test.ts`
- Modify: `packages/chat-core/src/index.ts`

**Interfaces:**
- Consumes: `Message`, `ToolCall`, `PlanEntry`, `TurnMeta` (Task 6).
- Produces:
  - `interface RowUiState { foldedTurns: ReadonlySet<string>; expandedThoughts: ReadonlySet<string>; expandedWork: ReadonlySet<string> }`
  - `const emptyUi: RowUiState`
  - `type Row` — the eight-kind union in the spec
  - `function deriveRows(messages: Message[], ui: RowUiState): Row[]`
  - `const WORK_GROUP_LIMIT = 4`

- [ ] **Step 1: Write the failing test**

Create `packages/chat-core/test/rows.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRows, emptyUi, WORK_GROUP_LIMIT } from '../src/rows.ts'
import type { Message, ToolCall } from '../src/types.ts'

const call = (id: string, kind: ToolCall['kind'], status: ToolCall['status'] = 'completed'): ToolCall =>
  ({ id, kind, status, title: `${id}.go` })

const reply = (over: Partial<Message> = {}): Message => ({
  id: 'a1', role: 'assistant', text: '', thought: '',
  toolCalls: [], plan: [], cards: [], ...over,
})

const asked = (text = 'go'): Message => ({
  id: 'u1', role: 'user', text, thought: '', toolCalls: [], plan: [], cards: [],
})

test('a bare exchange is two message rows', () => {
  const rows = deriveRows([asked(), reply({ text: 'Done.' })], emptyUi)
  assert.deepEqual(rows.map((r) => r.kind), ['message', 'message'])
})

// Twelve reads and one command must not be thirteen lines.
test('consecutive calls of one kind become a single work row', () => {
  const rows = deriveRows(
    [asked(), reply({ toolCalls: [call('a', 'read'), call('b', 'read'), call('c', 'read')], text: 'ok' })],
    emptyUi,
  )
  const work = rows.filter((r) => r.kind === 'work')
  assert.equal(work.length, 1)
  assert.equal(work[0].kind === 'work' && work[0].calls.length, 3)
})

// "read three, run one, read two more" is three groups, and saying otherwise
// would be a lie about what happened.
test('a different kind breaks the group', () => {
  const rows = deriveRows(
    [asked(), reply({
      toolCalls: [call('a', 'read'), call('b', 'read'), call('c', 'execute'), call('d', 'read')],
      text: 'ok',
    })],
    emptyUi,
  )
  const work = rows.filter((r) => r.kind === 'work')
  assert.equal(work.length, 3)
})

// The one still running is always its own row, always visible.
test('a running call gets its own live row', () => {
  const rows = deriveRows(
    [asked(), reply({ toolCalls: [call('a', 'read'), call('b', 'execute', 'in_progress')], streaming: true })],
    emptyUi,
  )
  assert.equal(rows.filter((r) => r.kind === 'work-live').length, 1)
  const live = rows.find((r) => r.kind === 'work-live')
  assert.equal(live?.kind === 'work-live' && live.call.id, 'b')
})

test('beyond the limit the older groups fold behind a toggle', () => {
  const kinds: ToolCall['kind'][] = ['read', 'execute', 'search', 'fetch', 'edit', 'read']
  const rows = deriveRows(
    [asked(), reply({ toolCalls: kinds.map((k, i) => call(`t${i}`, k)), text: 'ok' })],
    emptyUi,
  )
  const toggle = rows.find((r) => r.kind === 'work-toggle')
  assert.ok(toggle, 'expected a toggle row')
  assert.equal(toggle.kind === 'work-toggle' && toggle.hidden, kinds.length - WORK_GROUP_LIMIT)
  assert.equal(rows.filter((r) => r.kind === 'work').length, WORK_GROUP_LIMIT)
})

test('expanding the toggle shows every group', () => {
  const kinds: ToolCall['kind'][] = ['read', 'execute', 'search', 'fetch', 'edit', 'read']
  const ui = { ...emptyUi, expandedWork: new Set(['a1']) }
  const rows = deriveRows([asked(), reply({ toolCalls: kinds.map((k, i) => call(`t${i}`, k)), text: 'ok' })], ui)
  assert.equal(rows.filter((r) => r.kind === 'work').length, kinds.length)
})

test('a thought is its own row, collapsed by default', () => {
  const rows = deriveRows([asked(), reply({ thought: 'hmm', text: 'Yes.' })], emptyUi)
  const t = rows.find((r) => r.kind === 'thought')
  assert.ok(t)
  assert.equal(t.kind === 'thought' && t.expanded, false)
  const open = deriveRows(
    [asked(), reply({ thought: 'hmm', text: 'Yes.' })],
    { ...emptyUi, expandedThoughts: new Set(['a1']) },
  )
  const t2 = open.find((r) => r.kind === 'thought')
  assert.equal(t2?.kind === 'thought' && t2.expanded, true)
})

test('a plan becomes one row', () => {
  const rows = deriveRows(
    [asked(), reply({ plan: [{ content: 'one', status: 'pending' }], text: 'ok' })],
    emptyUi,
  )
  assert.equal(rows.filter((r) => r.kind === 'plan').length, 1)
})

test('meta appears only on a settled reply', () => {
  const settled = deriveRows([asked(), reply({ text: 'ok', meta: { model: 'x', durationMs: 10 } })], emptyUi)
  assert.equal(settled.filter((r) => r.kind === 'meta').length, 1)
  const live = deriveRows(
    [asked(), reply({ text: 'ok', streaming: true, meta: { model: 'x', durationMs: 10 } })],
    emptyUi,
  )
  assert.equal(live.filter((r) => r.kind === 'meta').length, 0)
})

// Forty turns has to stay navigable.
test('a folded turn collapses to its question', () => {
  const rows = deriveRows(
    [asked('what is up'), reply({ text: 'much', toolCalls: [call('a', 'read')] })],
    { ...emptyUi, foldedTurns: new Set(['u1']) },
  )
  assert.deepEqual(rows.map((r) => r.kind), ['turn-fold'])
  assert.equal(rows[0].kind === 'turn-fold' && rows[0].label, 'what is up')
})

test('every row id is unique', () => {
  const rows = deriveRows(
    [asked(), reply({
      thought: 'hmm', text: 'ok',
      toolCalls: [call('a', 'read'), call('b', 'execute')],
      plan: [{ content: 'one', status: 'pending' }],
      meta: { model: 'x' },
    })],
    emptyUi,
  )
  const ids = rows.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length, `duplicate row ids: ${ids.join(', ')}`)
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/packages/chat-core && npm test 2>&1 | head -10
```

Expected: FAIL — `Cannot find module '../src/rows.ts'`.

- [ ] **Step 3: Write rows.ts**

Create `packages/chat-core/src/rows.ts`:

```ts
// The transcript as rows, derived rather than stored.
//
// Kept apart from any renderer so the grouping rules — which are the whole
// reason a turn that read twelve files reads as two lines — can be tested
// without a DOM. The shape follows t3code's MessagesTimeline.logic.ts
// (https://github.com/pingdotgg/t3code, MIT, Copyright (c) 2026 T3 Tools Inc.)
import type { Message, PlanEntry, ToolCall, TurnMeta } from './types.ts'

/** Beyond this many groups in one turn, the older ones fold away.
 *
 *  A starting number, not a finding. Change it if it reads badly. */
export const WORK_GROUP_LIMIT = 4

/** What the person has clicked. Renderer state, passed in, so deriveRows
 *  stays a function of its arguments. */
export interface RowUiState {
  foldedTurns: ReadonlySet<string>
  expandedThoughts: ReadonlySet<string>
  expandedWork: ReadonlySet<string>
}

export const emptyUi: RowUiState = {
  foldedTurns: new Set(),
  expandedThoughts: new Set(),
  expandedWork: new Set(),
}

export type Row =
  | { kind: 'message'; id: string; message: Message }
  | { kind: 'thought'; id: string; ownerId: string; text: string; expanded: boolean }
  | { kind: 'work'; id: string; calls: ToolCall[] }
  | { kind: 'work-live'; id: string; call: ToolCall }
  | { kind: 'work-toggle'; id: string; ownerId: string; hidden: number; expanded: boolean }
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
  | { kind: 'turn-fold'; id: string; turnId: string; label: string }
  | { kind: 'meta'; id: string; meta: TurnMeta }

const settled = (c: ToolCall) => c.status === 'completed' || c.status === 'failed'

/** Consecutive settled calls of one kind are one group. A different kind
 *  starts a new one, so the summary never claims work that did not happen. */
function group(calls: ToolCall[]): ToolCall[][] {
  const out: ToolCall[][] = []
  for (const c of calls) {
    const last = out.at(-1)
    if (last && last[0].kind === c.kind) last.push(c)
    else out.push([c])
  }
  return out
}

export function deriveRows(messages: Message[], ui: RowUiState): Row[] {
  const rows: Row[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]

    if (m.role === 'user') {
      // A folded turn is the question and nothing else — the reply that
      // follows it is skipped with it.
      if (ui.foldedTurns.has(m.id)) {
        rows.push({ kind: 'turn-fold', id: `${m.id}:fold`, turnId: m.id, label: m.text })
        if (messages[i + 1]?.role === 'assistant') i++
        continue
      }
      rows.push({ kind: 'message', id: m.id, message: m })
      continue
    }

    if (m.thought) {
      rows.push({
        kind: 'thought',
        id: `${m.id}:thought`,
        ownerId: m.id,
        text: m.thought,
        expanded: ui.expandedThoughts.has(m.id),
      })
    }

    const groups = group(m.toolCalls.filter(settled))
    const expanded = ui.expandedWork.has(m.id)
    const shown = expanded ? groups : groups.slice(0, WORK_GROUP_LIMIT)
    const hidden = m.toolCalls.filter(settled).length -
      shown.reduce((n, g) => n + g.length, 0)

    if (hidden > 0 || (expanded && groups.length > WORK_GROUP_LIMIT)) {
      rows.push({
        kind: 'work-toggle',
        id: `${m.id}:toggle`,
        ownerId: m.id,
        hidden,
        expanded,
      })
    }
    for (const g of shown) {
      rows.push({ kind: 'work', id: `${m.id}:work:${g[0].id}`, calls: g })
    }

    // The running call is always visible, whatever the toggle says.
    const live = m.toolCalls.find((c) => !settled(c))
    if (live) rows.push({ kind: 'work-live', id: `${m.id}:live:${live.id}`, call: live })

    if (m.plan.length > 0) {
      rows.push({ kind: 'plan', id: `${m.id}:plan`, entries: m.plan })
    }

    rows.push({ kind: 'message', id: m.id, message: m })

    // Only once the turn has settled: a footer under a reply still being
    // written reports a duration that is not yet true.
    if (m.meta && !m.streaming) {
      rows.push({ kind: 'meta', id: `${m.id}:meta`, meta: m.meta })
    }
  }

  return rows
}
```

- [ ] **Step 4: Export it**

In `packages/chat-core/src/index.ts`, add:

```ts
export * from './rows.ts'
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/packages/chat-core && npm test 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant
git add packages/chat-core
git commit -m "A turn that read twelve files reads as two rows"
```

**Do not push.**

---

## Task 8: The scroll state machine

Three modes replacing "follow the bottom if within 120px". The interesting one
is `anchoring-new-turn`: the question pins near the top and the reply grows
beneath it, so a long answer stops racing past the thing you asked.

**Repo:** monorepo

**Files:**
- Create: `packages/chat-core/src/scroll.ts`
- Create: `packages/chat-core/test/scroll.test.ts`
- Modify: `packages/chat-core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ScrollMode = 'following-end' | 'anchoring-new-turn' | 'free-scrolling'`
  - `type ScrollSignal = { type: 'turn-started' } | { type: 'reached-end' } | { type: 'scrolled-away' } | { type: 'turn-settled' }`
  - `const initialScroll: ScrollMode`
  - `function nextScroll(mode: ScrollMode, signal: ScrollSignal): ScrollMode`

- [ ] **Step 1: Write the failing test**

Create `packages/chat-core/test/scroll.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialScroll, nextScroll } from '../src/scroll.ts'
import type { ScrollMode } from '../src/scroll.ts'

test('a conversation opens following the end', () => {
  assert.equal(initialScroll, 'following-end')
})

// The point of the whole machine: the question you just asked stays put.
test('starting a turn anchors the new question', () => {
  assert.equal(nextScroll('following-end', { type: 'turn-started' }), 'anchoring-new-turn')
  assert.equal(nextScroll('free-scrolling', { type: 'turn-started' }), 'anchoring-new-turn')
})

// Yanking the view back while somebody is reading further up is the rudest
// thing a chat can do.
test('scrolling away frees the view from every mode', () => {
  const modes: ScrollMode[] = ['following-end', 'anchoring-new-turn', 'free-scrolling']
  for (const m of modes) {
    assert.equal(nextScroll(m, { type: 'scrolled-away' }), 'free-scrolling', m)
  }
})

test('returning to the end resumes following', () => {
  assert.equal(nextScroll('free-scrolling', { type: 'reached-end' }), 'following-end')
})

// Reaching the end mid-reply must not break the anchor: the reply is still
// growing and the question should stay where it is.
test('reaching the end while anchored keeps the anchor', () => {
  assert.equal(nextScroll('anchoring-new-turn', { type: 'reached-end' }), 'anchoring-new-turn')
})

test('a settled turn releases the anchor', () => {
  assert.equal(nextScroll('anchoring-new-turn', { type: 'turn-settled' }), 'following-end')
  assert.equal(nextScroll('free-scrolling', { type: 'turn-settled' }), 'free-scrolling')
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/packages/chat-core && npm test 2>&1 | head -10
```

Expected: FAIL — `Cannot find module '../src/scroll.ts'`.

- [ ] **Step 3: Write scroll.ts**

Create `packages/chat-core/src/scroll.ts`:

```ts
// Where the transcript looks while a reply is being written.
//
// Derived from what happened, never stored as a preference: a mode somebody
// has to choose is a mode somebody has to understand.
export type ScrollMode =
  /** A short reply grows and the view follows. */
  | 'following-end'
  /** The question pins near the top and the reply grows beneath it, so a long
   *  answer does not race past the thing that was asked. */
  | 'anchoring-new-turn'
  /** They scrolled. Nothing moves until they come back to the end. */
  | 'free-scrolling'

export type ScrollSignal =
  | { type: 'turn-started' }
  | { type: 'reached-end' }
  | { type: 'scrolled-away' }
  | { type: 'turn-settled' }

export const initialScroll: ScrollMode = 'following-end'

export function nextScroll(mode: ScrollMode, signal: ScrollSignal): ScrollMode {
  switch (signal.type) {
    case 'turn-started':
      return 'anchoring-new-turn'
    case 'scrolled-away':
      return 'free-scrolling'
    case 'reached-end':
      // Not while anchored: the reply is still growing under a question that
      // is meant to stay where it is.
      return mode === 'anchoring-new-turn' ? mode : 'following-end'
    case 'turn-settled':
      return mode === 'anchoring-new-turn' ? 'following-end' : mode
  }
}
```

- [ ] **Step 4: Export it**

In `packages/chat-core/src/index.ts`, add:

```ts
export * from './scroll.ts'
```

- [ ] **Step 5: Run and commit**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/packages/chat-core && npm test 2>&1 | tail -10
cd /Users/0mellob/Developer/code/mr20-pendant
git add packages/chat-core
git commit -m "The question you asked stays on screen while the answer is written"
```

**Do not push.**

---

## Task 9: Mira renders rows

The visible payoff. `StepLine.tsx` and its hand-written `verb()` table are
deleted: the engine now sends a title, so guessing from a tool name is over.

**Repo:** monorepo

**Files:**
- Create: `desktop/src/routes/chat/Transcript.tsx`
- Create: `desktop/src/routes/chat/rows/WorkRow.tsx`
- Create: `desktop/src/routes/chat/rows/ThoughtRow.tsx`
- Create: `desktop/src/routes/chat/rows/PlanRow.tsx`
- Create: `desktop/src/routes/chat/rows/MetaRow.tsx`
- Create: `desktop/src/routes/chat/rows/TurnFoldRow.tsx`
- Delete: `desktop/src/routes/chat/StepLine.tsx`
- Modify: `desktop/src/routes/chat/Turn.tsx`
- Modify: `desktop/src/routes/Mira.tsx`

**Interfaces:**
- Consumes: `deriveRows`, `Row`, `RowUiState`, `emptyUi` (Task 7); `nextScroll`, `initialScroll`, `ScrollMode` (Task 8); `Message`, `ToolCall`, `PlanEntry` (Task 6).
- Produces: `<Transcript messages ... />`, rendered by `Mira`.

Design constraints, all from `desktop/CLAUDE.md` and the existing look:
- Role tokens only. `--accent` for live, `--ok` settled, `--bad` failed,
  `--fg-faint` for the mono step text, `--edge` for rules.
- Square corners. Nothing glows. The mono is the step/meta voice; the reply is
  the sans.
- No jargon: a work row says "read 4 files", not "4 read tool calls".

- [ ] **Step 1: Write the work-row summary helper and its test**

The one piece of row rendering worth testing headlessly is the sentence. Put it
in chat-core so it is testable, and import it into the component.

Append to `packages/chat-core/src/rows.ts`:

```ts
const NOUN: Record<string, [one: string, many: string]> = {
  read: ['file', 'files'],
  edit: ['file', 'files'],
  delete: ['file', 'files'],
  move: ['file', 'files'],
  search: ['search', 'searches'],
  execute: ['command', 'commands'],
  fetch: ['page', 'pages'],
  think: ['thought', 'thoughts'],
}

const VERB: Record<string, string> = {
  read: 'read', edit: 'wrote', delete: 'deleted', move: 'moved',
  search: 'searched', execute: 'ran', fetch: 'fetched', think: 'considered',
}

/** What a group of calls did, in a person's words.
 *
 *  One call says what it touched, because the title is the useful part;
 *  several say how many, because four file names in a row is noise. */
export function summarise(calls: ToolCall[]): string {
  const kind = calls[0].kind ?? 'other'
  if (calls.length === 1) {
    const verb = VERB[kind]
    return verb ? `${verb} ${calls[0].title ?? ''}`.trim() : (calls[0].title ?? 'did something')
  }
  const verb = VERB[kind] ?? 'ran'
  const noun = NOUN[kind]?.[1] ?? 'things'
  return `${verb} ${calls.length} ${noun}`
}
```

Append to `packages/chat-core/test/rows.test.ts`:

```ts
test('one call says what it touched; several say how many', () => {
  assert.equal(summarise([call('a', 'read')]), 'read a.go')
  assert.equal(summarise([call('a', 'read'), call('b', 'read')]), 'read 2 files')
  assert.equal(summarise([call('a', 'execute'), call('b', 'execute'), call('c', 'execute')]), 'ran 3 commands')
})
```

and add `summarise` to that file's import from `../src/rows.ts`.

- [ ] **Step 2: Run the chat-core tests**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/packages/chat-core && npm test 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 3: Write the row components**

Create `desktop/src/routes/chat/rows/WorkRow.tsx`:

```tsx
// What it did, in one line.
//
// The engine sends a title now, so nothing here guesses from a tool name —
// which is what the old StepLine's verb() table was, and why it could never
// say WHICH file.
import { summarise } from '@lyzn/chat-core'
import type { ToolCall } from '@lyzn/chat-core'
import { cn } from '@/lib/util'

const TONE: Record<string, string> = {
  pending: 'var(--fg-faint)',
  in_progress: 'var(--accent)',
  completed: 'var(--ok)',
  failed: 'var(--bad)',
}

export function WorkRow({ calls, live }: { calls: ToolCall[]; live?: boolean }) {
  const status = live ? 'in_progress' : (calls.at(-1)?.status ?? 'completed')
  return (
    <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] text-[var(--fg-faint)]">
      <span className="relative flex size-1.5 shrink-0">
        {live && (
          <span
            className="absolute inset-0 animate-ping rounded-full opacity-70"
            style={{ background: TONE.in_progress }}
          />
        )}
        <span className="relative size-1.5 rounded-full" style={{ background: TONE[status] }} />
      </span>
      <span className={cn('truncate', live && 'text-[var(--fg-dim)]')}>{summarise(calls)}</span>
    </div>
  )
}
```

Create `desktop/src/routes/chat/rows/ThoughtRow.tsx`:

```tsx
// Reasoning, kept quieter than the answer.
//
// Closed by default: it is evidence of work, not the thing that was asked for.
import { ChevronRight } from 'lucide-react'

export function ThoughtRow({
  text,
  expanded,
  onToggle,
}: {
  text: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="mb-2 select-none">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center gap-2 font-mono text-[11px] text-[var(--fg-faint)] transition-colors duration-150 hover:text-[var(--fg-dim)]"
      >
        <ChevronRight
          size={10}
          className="shrink-0 transition-transform duration-200 [transition-timing-function:var(--ease-out-soft)]"
          style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
        />
        <span>thought about it</span>
      </button>
      {expanded && (
        <p
          className="mt-1.5 whitespace-pre-wrap border-l pl-3.5 font-mono text-[11px] leading-relaxed text-[var(--fg-faint)]"
          style={{ borderColor: 'var(--edge)' }}
        >
          {text}
        </p>
      )}
    </div>
  )
}
```

Create `desktop/src/routes/chat/rows/PlanRow.tsx`:

```tsx
// The plan it is working to, as it currently stands.
import { Check } from 'lucide-react'
import type { PlanEntry } from '@lyzn/chat-core'

export function PlanRow({ entries }: { entries: PlanEntry[] }) {
  return (
    <ol className="mb-3 border-l pl-3.5" style={{ borderColor: 'var(--edge)' }}>
      {entries.map((e, i) => (
        <li key={i} className="flex items-start gap-2 py-0.5 text-[12px] leading-snug">
          <span className="mt-[3px] flex size-3 shrink-0 items-center justify-center">
            {e.status === 'completed' ? (
              <Check size={10} style={{ color: 'var(--ok)' }} />
            ) : (
              <span
                className="size-1.5 rounded-full"
                style={{
                  background: e.status === 'in_progress' ? 'var(--accent)' : 'var(--fg-faint)',
                }}
              />
            )}
          </span>
          <span
            className={
              e.status === 'completed'
                ? 'text-[var(--fg-faint)] line-through'
                : e.status === 'in_progress'
                  ? 'text-[var(--fg)]'
                  : 'text-[var(--fg-dim)]'
            }
          >
            {e.status === 'in_progress' ? (e.activeForm ?? e.content) : e.content}
          </span>
        </li>
      ))}
    </ol>
  )
}
```

Create `desktop/src/routes/chat/rows/MetaRow.tsx`:

```tsx
// What the turn cost, for anyone who wants to know.
import type { TurnMeta } from '@lyzn/chat-core'

/** A short model name. "claude-opus-5" is the engine's business; "opus 5" is
 *  as much of it as belongs on screen. */
function brain(model?: string): string {
  if (!model) return ''
  const m = model.match(/(opus|sonnet|haiku)[-_]?(\d+(?:\.\d+)?)/i)
  return m ? `${m[1].toLowerCase()} ${m[2]}` : model
}

export function MetaRow({ meta }: { meta: TurnMeta }) {
  const bits = [
    brain(meta.model),
    meta.durationMs ? `${(meta.durationMs / 1000).toFixed(1)}s` : '',
  ].filter(Boolean)
  if (bits.length === 0) return null
  return (
    <p className="mb-5 font-mono text-[10.5px] text-[var(--fg-faint)]">{bits.join(' · ')}</p>
  )
}
```

Create `desktop/src/routes/chat/rows/TurnFoldRow.tsx`:

```tsx
// A past turn, folded to the question that started it.
import { ChevronRight } from 'lucide-react'

export function TurnFoldRow({ label, onUnfold }: { label: string; onUnfold: () => void }) {
  return (
    <button
      onClick={onUnfold}
      className="mb-3 flex w-full items-center gap-2 text-left text-[12px] text-[var(--fg-faint)] transition-colors duration-150 hover:text-[var(--fg-dim)]"
    >
      <ChevronRight size={10} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}
```

- [ ] **Step 4: Write Transcript.tsx**

Create `desktop/src/routes/chat/Transcript.tsx`:

```tsx
// The conversation, as rows.
//
// deriveRows decides what the rows ARE and is tested in @lyzn/chat-core with
// no DOM; this file only decides what they look like. Keeping the two apart is
// why the grouping rules can be changed without opening a component.
import { useState } from 'react'
import { deriveRows, emptyUi } from '@lyzn/chat-core'
import type { Message, RowUiState } from '@lyzn/chat-core'
import type { Route } from '@/components/Chrome'
import { Turn } from '@/routes/chat/Turn'
import { MetaRow } from '@/routes/chat/rows/MetaRow'
import { PlanRow } from '@/routes/chat/rows/PlanRow'
import { ThoughtRow } from '@/routes/chat/rows/ThoughtRow'
import { TurnFoldRow } from '@/routes/chat/rows/TurnFoldRow'
import { WorkRow } from '@/routes/chat/rows/WorkRow'

/** Adds or removes one id, returning a new set — React will not re-render for
 *  a set mutated in place. */
const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

export function Transcript({
  messages,
  onRoute,
  onRetry,
  canRetry,
  anchorId,
}: {
  messages: Message[]
  onRoute: (r: Route) => void
  onRetry: () => void
  canRetry: boolean
  /** The question the view is anchored to, given a scroll-margin so it lands
   *  below the sticky header rather than under it. */
  anchorId?: string
}) {
  const [ui, setUi] = useState<RowUiState>(emptyUi)
  const rows = deriveRows(messages, ui)

  return (
    <div className="pt-1">
      {rows.map((row) => {
        switch (row.kind) {
          case 'message':
            return (
              <div
                key={row.id}
                id={`turn-${row.id}`}
                style={row.id === anchorId ? { scrollMarginTop: '0.5rem' } : undefined}
              >
                <Turn
                  message={row.message}
                  onRoute={onRoute}
                  onRetry={onRetry}
                  canRetry={canRetry}
                  onFold={
                    row.message.role === 'user'
                      ? () => setUi((u) => ({ ...u, foldedTurns: toggle(u.foldedTurns, row.message.id) }))
                      : undefined
                  }
                />
              </div>
            )

          case 'thought':
            return (
              <ThoughtRow
                key={row.id}
                text={row.text}
                expanded={row.expanded}
                onToggle={() =>
                  setUi((u) => ({ ...u, expandedThoughts: toggle(u.expandedThoughts, row.ownerId) }))
                }
              />
            )

          case 'work':
            return <WorkRow key={row.id} calls={row.calls} />

          case 'work-live':
            return <WorkRow key={row.id} calls={[row.call]} live />

          case 'work-toggle':
            return (
              <button
                key={row.id}
                onClick={() => setUi((u) => ({ ...u, expandedWork: toggle(u.expandedWork, row.ownerId) }))}
                className="mb-1.5 font-mono text-[11px] text-[var(--fg-faint)] transition-colors duration-150 hover:text-[var(--fg-dim)]"
              >
                {row.expanded ? 'show less' : `+${row.hidden} more`}
              </button>
            )

          case 'plan':
            return <PlanRow key={row.id} entries={row.entries} />

          case 'meta':
            return <MetaRow key={row.id} meta={row.meta} />

          case 'turn-fold':
            return (
              <TurnFoldRow
                key={row.id}
                label={row.label}
                onUnfold={() => setUi((u) => ({ ...u, foldedTurns: toggle(u.foldedTurns, row.turnId) }))}
              />
            )
        }
      })}
    </div>
  )
}
```

- [ ] **Step 5: Simplify Turn.tsx**

Replace `desktop/src/routes/chat/Turn.tsx` with:

```tsx
// One exchange: what the person said, and what came back.
//
// The person's words sit on carbon and the reply does not sit on anything.
// Two bubbles facing each other reads as a transcript of two strangers; one
// bubble and then plain prose reads as someone answering you, which is what
// this is.
//
// The work, the thought and the plan are rows of their own now — Transcript
// places them. This draws only the words.
import type { Message } from '@lyzn/chat-core'
import type { Route } from '@/components/Chrome'
import { Button } from '@/components/ui'
import { ReceiptCard } from '@/routes/chat/ReceiptCard'

export function Turn({
  message,
  onRoute,
  onRetry,
  canRetry,
  onFold,
}: {
  message: Message
  onRoute: (r: Route) => void
  onRetry: () => void
  /** Retrying mid-turn would leave two replies under one question, so the
   *  offer only exists while nothing is in flight. */
  canRetry: boolean
  onFold?: () => void
}) {
  if (message.role === 'user') {
    return (
      <div className="mb-5 flex justify-end">
        <button
          onClick={onFold}
          title={onFold ? 'Fold this turn' : undefined}
          className="max-w-[78%] cursor-default text-left"
        >
          <p className="whitespace-pre-wrap bg-[var(--skin-2)] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--fg)]">
            {message.text}
          </p>
        </button>
      </div>
    )
  }

  const empty = message.text.length === 0

  return (
    <div className="mb-7">
      {/* An empty streaming reply still needs the caret, or the moment between
          asking and the first token looks like nothing happened. */}
      {(!empty || message.streaming) && (
        <p className="whitespace-pre-wrap text-[13.5px] leading-[1.65] text-[var(--fg)]">
          {message.text}
          {message.streaming && (
            <span
              className="ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] animate-pulse"
              style={{ background: 'var(--accent)' }}
              aria-hidden="true"
            />
          )}
        </p>
      )}

      {message.cards.length > 0 && (
        <div className="mt-3 space-y-2">
          {message.cards.map((c) => (
            <ReceiptCard key={c.id} card={c} onOpen={onRoute} />
          ))}
        </div>
      )}

      {message.failed && (
        <div className="mt-2.5 flex items-center gap-3">
          <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
            That stopped before it finished.
          </p>
          {canRetry && (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Wire the scroll machine into Mira**

In `desktop/src/routes/Mira.tsx`, replace the scroll block (lines 26–50) and the
transcript block (lines 123–136). Imports to add:

```tsx
import { initialScroll, nextScroll, useConversation } from '@lyzn/chat-core'
import type { ScrollMode } from '@lyzn/chat-core'
import { Transcript } from '@/routes/chat/Transcript'
```

Remove the `Turn` import. Then:

```tsx
  const foot = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const mode = useRef<ScrollMode>(initialScroll)

  // The shell owns the scrolling element, not this screen, so the listener has
  // to go on that ancestor: bound to our own div it would never fire, and the
  // view would snap on every token no matter where they had scrolled to.
  useEffect(() => {
    const el = root.current?.closest('main')
    if (!el) return
    const onScroll = () => {
      const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      mode.current = nextScroll(mode.current, { type: atEnd ? 'reached-end' : 'scrolled-away' })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // The question just asked, so the anchored view has something to hold on to.
  const lastAsk = [...state.messages].reverse().find((m) => m.role === 'user')

  const last = state.messages.at(-1)
  useEffect(() => {
    if (mode.current === 'free-scrolling') return
    if (mode.current === 'anchoring-new-turn') {
      document.getElementById(`turn-${lastAsk?.id}`)?.scrollIntoView({ block: 'start' })
      return
    }
    foot.current?.scrollIntoView({ block: 'end' })
  }, [state.messages.length, last?.text, last?.toolCalls.length, lastAsk?.id])

  // A settled turn releases the anchor, so the next short reply follows again.
  useEffect(() => {
    if (!state.busy) mode.current = nextScroll(mode.current, { type: 'turn-settled' })
  }, [state.busy])
```

In `submit`, replace `pinned.current = true` with:

```tsx
    mode.current = nextScroll(mode.current, { type: 'turn-started' })
```

And replace the transcript block:

```tsx
        ) : (
          <Transcript
            messages={state.messages}
            onRoute={onRoute}
            onRetry={retry}
            canRetry={!state.busy}
            anchorId={lastAsk?.id}
          />
        )}
```

- [ ] **Step 7: Delete StepLine and typecheck**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/desktop
rm src/routes/chat/StepLine.tsx
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20
```

Expected: no output. Fix anything that still references `message.steps` or
`StepLine`.

- [ ] **Step 8: Build the renderer**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/desktop && npm run build 2>&1 | tail -15
```

Expected: a clean Vite build.

- [ ] **Step 9: Rebuild the engine and run the real check**

The desktop bundles a built KARMAX binary; Tasks 1–5 changed it.

```bash
cd /Users/0mellob/Developer/code/mr20-pendant/desktop
KARMAX_SRC="$KARMAX" ./scripts/build-core.sh 2>&1 | tail -5
npm run test:core 2>&1 | tail -20
```

Expected: `test:core` PASSES. It starts a real daemon — a mock would not have
caught the two bugs it has caught so far.

- [ ] **Step 10: Look at it**

Start the app, ask something that reads several files and runs a command, and
check by eye:

- the work rows group ("read 4 files"), and the running one is visible and pulsing
- a long reply does **not** race past the question — it grows beneath it
- clicking a question folds the turn; clicking the fold restores it
- the plan renders when the engine writes one
- the footer shows the model and the duration once the turn settles
- nothing glows, corners are square, and it reads the same in both themes

Fix what looks wrong before committing. This is the task where "the UI must be
amazing, sexy, aesthetic, simple" is actually judged.

- [ ] **Step 11: Commit**

```bash
cd /Users/0mellob/Developer/code/mr20-pendant
git add desktop packages/chat-core
git commit -m "Mira reads as a transcript, not a log"
```

**Do not push.**

---

## Task 5b: History keeps its tool calls

Found in the pre-flight scan, not in the original plan. `internal/chatlog`
reads past conversations off disk and emits `steps: [{tool, phase}]`. Task 6
renames the TypeScript field to `toolCalls`, so without this task **every
reopened conversation silently loses its tool history** — `m.toolCalls` would
be `undefined` forever, and nothing would error.

That is the exact class of bug this spec exists to kill: a mismatch that
matches on the wrong thing and fails quietly.

**Repo:** KARMAX

**Files:**
- Modify: `$KARMAX/internal/harness/toolmeta.go` (export two wrappers)
- Modify: `$KARMAX/internal/chatlog/chatlog.go`
- Modify: `$KARMAX/internal/chatlog/chatlog_test.go`

**Interfaces:**
- Consumes: `toolKind`, `toolTitle` (Task 1); `ToolKind` (Task 1).
- Produces: `harness.ToolTitle(name string, input json.RawMessage) string`,
  `harness.ToolKindOf(name string) ToolKind`, and
  `chatlog.Message.ToolCalls []chatlog.ToolCall`.

`internal/chatlog` importing `internal/harness` is safe: harness does not
import chatlog, so there is no cycle. This was checked, not assumed.

- [ ] **Step 1: Write the failing test**

Append to `$KARMAX/internal/chatlog/chatlog_test.go`:

```go
// A reopened conversation must still show what the assistant did, with the
// same vocabulary a live turn uses. Emitting the old {tool, phase} shape here
// while the wire emits tool calls is how history silently loses its work.
func TestHistoryCarriesWholeToolCalls(t *testing.T) {
	dir := t.TempDir()
	line := `{"type":"assistant","timestamp":"2026-09-13T10:00:00Z","message":{"content":[` +
		`{"type":"tool_use","id":"toolu_9","name":"Read","input":{"file_path":"/a/main.go"}}]}}`
	if err := os.WriteFile(filepath.Join(dir, "c1.jsonl"), []byte(line+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	msgs, err := Read(dir, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	calls := msgs[0].ToolCalls
	if len(calls) != 1 {
		t.Fatalf("got %d tool calls, want 1", len(calls))
	}
	if calls[0].ID != "toolu_9" {
		t.Errorf("id = %q, want toolu_9", calls[0].ID)
	}
	if calls[0].Title != "main.go" {
		t.Errorf("title = %q, want main.go", calls[0].Title)
	}
	if calls[0].Kind != "read" {
		t.Errorf("kind = %q, want read", calls[0].Kind)
	}
	// A transcript has no live calls: everything in it already finished.
	if calls[0].Status != "completed" {
		t.Errorf("status = %q, want completed", calls[0].Status)
	}
}
```

Ensure `os`, `path/filepath` and `testing` are imported in that file.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "$KARMAX" && go test ./internal/chatlog/ -run TestHistoryCarriesWholeToolCalls 2>&1 | head
```

Expected: FAIL — `msgs[0].ToolCalls undefined`.

- [ ] **Step 3: Export the two helpers**

Append to `$KARMAX/internal/harness/toolmeta.go`:

```go
// ToolTitle and ToolKindOf expose the naming rules to other packages, so a
// transcript read back from disk describes a call the same way a live turn
// does. Two vocabularies for one tool is how history stops matching the
// present.
func ToolTitle(name string, input json.RawMessage) string { return toolTitle(name, input) }

// ToolKindOf classifies a tool by name. Named with the suffix because ToolKind
// is the type.
func ToolKindOf(name string) ToolKind { return toolKind(name) }
```

- [ ] **Step 4: Emit tool calls from chatlog**

In `$KARMAX/internal/chatlog/chatlog.go`, replace the `Step` type with:

```go
// ToolCall is one tool the assistant invoked, as a transcript remembers it.
//
// The same shape a live turn streams, so a reopened conversation and a running
// one describe the same work in the same words.
type ToolCall struct {
	ID     string `json:"id"`
	Title  string `json:"title,omitempty"`
	Kind   string `json:"kind,omitempty"`
	Status string `json:"status"` // always "completed": a transcript has no live calls
}
```

Change `Message`:

```go
	ToolCalls []ToolCall `json:"toolCalls"`
```

The content block type in this file needs the tool_use id and input. Add to it:

```go
	ID    string          `json:"id"`
	Input json.RawMessage `json:"input"`
```

Replace the `tool_use` case:

```go
			case "tool_use":
				msg.ToolCalls = append(msg.ToolCalls, ToolCall{
					ID:     c.ID,
					Title:  harness.ToolTitle(c.Name, c.Input),
					Kind:   string(harness.ToolKindOf(c.Name)),
					Status: "completed",
				})
```

Update the two other `Steps` references: the empty initialiser
(`ToolCalls: []ToolCall{}`), the emptiness check (`len(msg.ToolCalls) == 0`),
and the turn-merge append (`out[n-1].ToolCalls = append(out[n-1].ToolCalls, msg.ToolCalls...)`).

Add the harness import.

- [ ] **Step 5: Run the chatlog package**

```bash
cd "$KARMAX" && go test ./internal/chatlog/ 2>&1 | tail -20
```

Expected: PASS, including the existing tests. Fix any existing test that still
asserts on `Steps`.

- [ ] **Step 6: Commit**

```bash
cd "$KARMAX" && gofmt -l internal/
git -C "$KARMAX" add internal/chatlog internal/harness/toolmeta.go
git -C "$KARMAX" commit -m "History describes its work the same way a live turn does"
```

**Do not push.**

---


## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| §1 Event struct, EventKind, ToolEvent, Location, PlanEntry | 1, 2, 3 |
| §1 Output truncated to 2 KB at the adapter | 2 |
| §1 `Options.Thinking`, `Turn.Model`/`Duration` | 4 |
| §1 The wire: new kinds, `text`→`message`, `done` metadata | 5 |
| §1 chat-core `TurnEvent` and `Message` break together | 6 |
| §2 Assemble a tool call; title; classify; locations | 1, 3 |
| §2 Separate thought from message | 3 |
| §2 Read the plan from TodoWrite | 2, 3 |
| §2 Enabling thinking — recorded probe first | 4 step 7 |
| §2 Unchanged: no double text delivery; `Turn.ToolCalls` intact | 3 (test), 1 (note) |
| §3 `deriveRows`, `RowUiState`, the eight row kinds | 7 |
| §3 Same-kind grouping, live call, toggle at 4 | 7 |
| §3 Thought collapsed by default | 7, 9 |
| §3 `turn-fold`; `meta` on settled turns only | 7, 9 |
| §3 Three scroll modes, derived, tested apart from the DOM | 8, 9 |
| §Testing all six bullets | 1–9 |

Two deliberate gaps, both recorded rather than forgotten:

1. **§3's composer** — slash commands, `@` file mentions, model picker, thinking
   toggle. Not in this plan. The thinking toggle in particular needs the
   per-session semantics Task 4 discovered, and the other three need endpoints
   that do not exist yet (`available_commands_update` arrives with ACP). This is
   the first task of the next plan.
2. **§3's `context-compaction` row** — the spec's Context section mentions
   t3code has one; the spec's own row list does not include it, and KARMAX emits
   no compaction event. Nothing to draw. Left out on purpose.

**Placeholder scan.** No TBD/TODO. Every code step carries the code. Task 5
step 5 deliberately shows a wrong approach and then rejects it — that is a
warning against field-smuggling, not a placeholder, and the step ends with the
real change.

**Type consistency.** `ToolEvent` (Go) ↔ `ChatTool` (Go wire) ↔ `ToolCall` (TS)
↔ `WireToolCall` (bridge) all carry `id/title/kind/status/locations/output`.
`Status` values are ACP's four everywhere. `ToolKind` values are ACP's ten
everywhere. `PlanEntry` is `content/status/activeForm/priority` in all four
places. `deriveRows(messages, ui)` in Task 7 matches its call in Task 9.
`summarise` is defined in Task 9 step 1 and used in Task 9 step 3.

---

## Execution Handoff

Plan complete and saved to
`docs/superpowers/plans/2026-09-13-harness-events-and-transcript.md`.
