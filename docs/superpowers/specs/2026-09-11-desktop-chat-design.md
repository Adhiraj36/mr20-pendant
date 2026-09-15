# The desktop assistant: a chat screen on the local engine

Date: 2026-09-11. Status: approved by Kartik in conversation; implementation
follows this document.

## Context

The LYZN desktop app supervises KARMAX and has no chat. The phone has one —
Mira, streaming, with tool steps — talking to the LYZN backend, with
conversations stored in GitLoom. This project gives the desktop its own chat,
answered by the KARMAX engine already running on the machine.

Five findings from the design pass set the shape of the work. Each was checked
against the code rather than assumed.

**The desktop app has no user identity.** It holds a *daemon* token, and
`internal/api/daemonauth.go` is explicit that this is deliberate: "a Clerk
session token says which person is asking; a daemon token says which *machine*
is asking". The chat routes on the backend are Clerk-authed. This is why the
desktop cannot simply read the phone's conversations, and why the decision to
keep the two sets of threads separate removes a whole sub-project rather than
merely simplifying one.

**KARMAX's chat endpoint does not stream.** `handleChat`
(`internal/api/server.go:195`) calls `ag.Chat(ctx, message)` under a three-minute
timeout and writes one JSON body. `ChatDetailed` additionally returns which
tools ran, but only after the turn ends. Built as-is, the desktop chat would be
a spinner followed by a wall of text.

**But the stream already exists and is being discarded.** The harness runs
`claude --print --input-format stream-json --output-format stream-json
--verbose` (`internal/harness/session.go:59`) and already parses `assistant`,
`tool_use` and `result` events at `session.go:184` — then collapses them into a
`Turn{Text, ToolCalls, Usage, CostUSD, Limits, NumTurns, Err}`. Streaming the
chat is forwarding events that are already read, not building a streaming stack.

**Claude Code already stores conversations, titles included.** Session
transcripts live at `~/.claude/projects/<slug>/<session-id>.jsonl`, where the
slug is the working directory with `/`, `.` and `_` replaced by `-` — the path
`removeClaudeSession` (`internal/tools/builtin/claude_code.go`) already builds.
The file carries an `ai-title` record written by Claude Code itself (observed:
`'Go back navigation error and phone validation'`) alongside `user` and
`assistant` turns. `ClaudeCodeTool` already mints `--session-id` and resumes
with `--resume`. There is nothing for KARMAX to store.

**KARMAX has no concept of multiple conversations.** The app thread is a single
list per agent — `AppendAppMessage` / `ClearAppMessages`
(`internal/store/app_message_store.go`), where "new conversation" means wiping
it. A conversation list is new capability, not a view over something that
exists; the finding above is what makes it cheap anyway.

Decisions were made explicitly with the user; none of the following is open:

| Decision | Choice |
|---|---|
| Which assistant answers on the desktop | The local KARMAX engine, not the backend |
| Conversation sync | None. Phone threads sync with the backend; laptop threads stay local |
| What *is* shared | Memory. The harness reaches GitLoom through a plugin, so both bodies know the same things about the person |
| Conversation storage | None in KARMAX. A conversation is a harness session; title, turns and compaction are Claude Code's |
| Streaming | Yes, both token deltas and live tool events |
| Steps in the UI | Inline, collapsed by default, showing one live line |
| Where chat lives | "Mira", first in the nav, opens on launch |
| What the chat hands back | A receipt card — one anatomy for tickets, loops and dashboards |
| When a ticket card appears | When work is long, not when the assistant is incapable |
| Shared package | `@lyzn/chat-core`, headless. Types, reducer, hooks. No rendering |
| Prerequisites | `karmax preflight` owns the catalogue; the desktop calls it |
| Codex | Claude Code adapter first; the list says so plainly under Codex |

### A note on size

This is one arc but it is not small: three pieces of KARMAX, a new package, a
new desktop screen, and a port of a working mobile file. §3 (`preflight`) is the
one part that is genuinely separable — nothing else here depends on it, and it
could be lifted into its own plan if this turns out to be too much for one. The
rest is not separable in any useful way: a screen with no endpoint and an
endpoint with no screen are both unverifiable.

---

## 1. KARMAX — conversations, read from the harness

A new package, `internal/chatlog`, whose whole job is to read Claude Code's
session directory and answer three questions: what conversations exist, what is
in one, and delete this one.

```go
type Conversation struct {
    ID      string    // the harness session id
    Title   string    // the ai-title record; "" until Claude Code writes one
    Opening string    // first user turn, trimmed, for a list that has no title yet
    Updated time.Time // file mtime
}

// Message is one turn as the client needs it: the steps are the tool_use
// blocks that were inside that assistant message, so a transcript read back
// from disk shows the same collapsed step line a live turn showed.
type Message struct {
    Role  string // "user" | "assistant"
    Text  string
    At    time.Time
    Steps []Step // empty for user turns
}

type Step struct {
    Tool   string
    Phase  string // "done" | "failed"; a transcript has no live steps
    Detail string
}

func List(dir string) ([]Conversation, error)
func Read(dir, id string) ([]Message, error)
func Delete(dir, id string) error
```

`dir` is the project slug directory for `hostpaths.WorkDir()`, computed with the
same replacer `removeClaudeSession` uses. That replacer moves into this package
and `claude_code.go` calls it, so the path is built in one place rather than two.

`Read` maps the jsonl to messages: `user` and `assistant` records become turns,
`tool_use` blocks inside an assistant message become the steps that ran, and
every other record type is ignored. The types observed in real files are
`ai-title`, `user`, `assistant`, `system`, `attachment`, `mode`,
`permission-mode`, `last-prompt`, `file-history-snapshot`, `cost-state`,
`queue-operation`, `bridge-session` — this is an open set and unknown types must
be skipped rather than error.

**This couples KARMAX to another program's on-disk format.** That coupling
already exists — `removeClaudeSession` builds this exact path and `session.go`
parses this exact stream — so this deepens it rather than introducing it. It is
confined to `internal/chatlog` so a format change is one file, and every reader
tolerates unknown record types.

Codex stores sessions elsewhere and differently. `chatlog` gains a Codex
implementation later; until then `List` returns empty for a Codex brain and the
API says which brain is configured so the UI can explain itself rather than show
an empty list.

## 2. KARMAX — a streaming turn

### 2.1 The harness learns to be watched

`Supervisor.Send`/`SendWith` gain an optional sink in `Options`:

```go
type Options struct {
    // …existing fields
    OnEvent func(Event) // nil means behave exactly as today
}

type Event struct {
    Kind  string // "text" | "tool" | "ticket" | "error"
    Text  string // for text: the delta. for error: the message
    Tool  string // for tool: the tool's name
    Phase string // for tool: "start" | "done" | "failed"
    JobID string // for ticket
}
```

There are **two vocabularies here and they are not the same set.** The harness
sink emits what the harness can see: `text`, `tool`, `ticket`, `error`. The
wire adds two the harness has no business knowing about — `conversation`, sent
once at the start when a session was just created, and `done`, which the
endpoint writes after the turn returns and which carries usage and cost. The
client's closed set is therefore `conversation` | `text` | `tool` | `ticket` |
`done` | `error`, and that is what `TurnEvent` in §4 models.

The session loop at `session.go:184` already visits each parsed event on its way
to building a `Turn`; it calls the sink there and is otherwise unchanged. With a
nil sink the existing behaviour is bit-for-bit identical, which is what keeps
every current caller — the task runner, loops, `harnessSendTool` — out of this
change.

`--include-partial-messages` is added to the CLI args so `text` arrives as token
deltas rather than whole blocks.

### 2.2 The endpoint

```
POST /api/chat/stream   → application/x-ndjson, one event per line
GET  /api/chat/conversations
GET  /api/chat/conversations/{id}
DELETE /api/chat/conversations/{id}
```

`POST` takes `{conversationId?, message}`. A missing `conversationId` starts a
new harness session and the first event returned is `{"kind":"conversation",
"id":"<session id>"}` so the client can address it from then on. The stream ends
with `{"kind":"done", "text":..., "usage":..., "costUsd":...}` or
`{"kind":"error", "text":...}`.

Nothing may buffer the response: `Content-Type: application/x-ndjson`,
`Cache-Control: no-store`, `X-Accel-Buffering: no`, and an explicit flush per
line. A progress stream that arrives at the end is not a progress stream.

The existing blocking `/api/chat` stays. The phone-app route and the task runner
use it, and there is no reason to move them.

### 2.3 Tickets

When the agent delegates with `background: true` it already receives a job id
and the result arrives later as an event on the bus. The sink emits
`{"kind":"ticket","jobId":...}` when that happens, and the desktop renders a
card. The card is a view onto the task the Tickets screen already reads — no new
task system, no new storage.

The policy for *when* to go background is written into the agent's guidance:
work expected to exceed roughly a minute. A model left to decide unaided either
never does it or does it for everything.

## 3. KARMAX — `karmax preflight`

`karmax doctor` reports and stops (`cmd/karmax/runtime_cmd.go:241`); it prints
"MISSING (run 'karmax init')". `preflight` is the half that acts.

One catalogue, in KARMAX, covering Go, gog, wacli, a Chromium-family browser,
the coding harness, and harness plugins — GitLoom among them. It checks, it
installs what it can, and it streams its progress as NDJSON on the same shape
the connect agent uses, so the desktop can render it in the UI it already has
for streamed host commands.

The desktop's `electron/installs.ts` catalogue shrinks to installing KARMAX
itself. Two catalogues of the same dependencies is a bug nobody can see from
either side, and this is the moment the second one becomes avoidable.

`karmax preflight --check` reports without installing, which is what `doctor`
becomes internally.

## 4. `packages/chat-core`

Headless. No React Native, no DOM, no I/O.

```
packages/chat-core/
  src/types.ts      Message, ToolStep, Card, TurnEvent
  src/reduce.ts     (state, event) => state
  src/useConversation.ts
  src/adapter.ts    the transport interface
```

`TurnEvent` is the closed union above. `reduce` is pure and is where every
interesting case lives: deltas interleaved with tool events, a tool failing
mid-turn, a ticket arriving before the text finishes, an error after partial
output, a second turn starting while the first is still streaming.

```ts
interface Adapter {
  send(conversationId: string | null, text: string,
       onEvent: (e: TurnEvent) => void): Promise<void>
  stop(): void
  list(): Promise<ConversationSummary[]>
  history(id: string): Promise<Message[]>
}
```

The desktop adapter reads NDJSON from KARMAX over IPC, never in the renderer —
the API token can invoke `shell.exec` and the rule that it stays in the main
process is not relaxed for this. The phone adapter wraps the backend's SSE.

`useConversation(adapter, id)` returns `{messages, steps, busy, send, retry,
stop}`.

The package is added to `mobile/package.json` and `desktop/package.json` by
`file:` path, the way `@lyzn/design` already is.

## 5. Desktop — the Mira screen

First in the nav, and what opens on launch. `Overview` is renamed `Dashboard`
and `Automations` is renamed `Loops` in the same change, because the nav is one
list and renaming it twice is worse than renaming it once.

Two columns: conversations on the left, the thread on the right.

**A turn.** The user's message sits right, on carbon. The assistant's reply
streams left as prose. Above the reply, one collapsed line in Martian Mono,
showing the step happening now with a pulsing violet dot, and after the turn the
outcome with a settled-green dot — "moved 14 files to Downloads/Archive" rather
than the literal last step, because when the two differ the outcome is the more
useful sentence. A chevron expands the full list. Collapsed is the default and
nothing auto-expands.

**Receipt cards** render inline in the reply: a dashed-rule header carrying the
kind and a stamp, the title, a live status row, and a footer that opens the
thing. One component, three kinds — `ticket`, `loop`, `dashboard`. A ticket
card's status row updates from the same completion event the Tickets screen
listens to.

The screen is built from the desktop's own `components/ui.tsx` primitives
against `@lyzn/chat-core`'s state. Tokens come from `@lyzn/design`, so the
phone's chat and this one agree on colour and type without sharing a component.

## 6. Mobile — the port

`mobile/src/state/chat.ts` (190 lines) becomes an adapter plus the shared
reducer. The screen keeps every one of its own components; nothing visual
changes.

This touches a working screen, so the order matters: the reducer and its tests
land first, the adapter second, and the screen's behaviour — streaming, tool
steps, retry, attachments, two conversations streaming at once — is verified
against the current build before and after.

## 7. Testing

The reducer carries the load, because it is where the logic is. Unit tests over
event sequences, no app and no network.

The stream endpoint is tested against **recorded harness output**: real
`stream-json` captured from Claude Code, so the tests assert what it actually
emits rather than what we believe it emits. Fixtures come from the capture done
during the connect-agent work.

`internal/chatlog` is tested against real session files, including ones carrying
record types it does not know, to prove unknown types are skipped.

The desktop gets the treatment `npm run test:core` already gives: start a real
daemon, call the real endpoints, assert the answers. A new conversation, a turn,
the transcript read back, a delete.

No snapshot tests of rendered chat.

## 8. Out of scope

These belong to their own design cycles and are named here so the boundary is
explicit:

- **Loops** — the rename lands here, but provenance (mine vs installed vs
  shipped), removing manual creation, and AI authoring do not.
- **Publishing and the marketplace**, including identity for people with no
  GitHub account.
- **Dashboards** — the rename lands here; multiple dashboards and AI authoring
  do not.

## 9. Carried forward

Open questions this arc deliberately did not settle:

1. **Does a loop arrive armed, or as a draft you arm?** Choosing the plain
   receipt card over the expandable one moved that review to the Loops screen,
   which means the Loops screen needs somewhere to do it.
2. **The Codex conversation adapter** — `chatlog` is Claude Code only to begin
   with.
3. **karma's version in KARMAX.** KARMAX pins `v1.21.3`; the backend is on
   `v1.26.0`. Nothing here requires the bump, but the gap is worth knowing about
   before something does.
