# What the harness says, and how the transcript shows it

Date: 2026-09-13. Status: approved in conversation; implementation follows this
document.

## Context

The desktop chat shipped and works: a turn streams, a step line names what it
is doing, conversations come from Claude Code's own session files. The verdict
on the result was "that UI of conversations (Mira) still really sucks", with a
pointer at [t3code](https://github.com/pingdotgg/t3code) (MIT, T3 Tools Inc.)
as the bar.

Reading that codebase says the UI is a symptom. Mira is thin because the event
model underneath it is thin. KARMAX's `harness.Event` is
`{Kind, Text, Tool, Phase, JobID}`, and `emit` populates two of those fields
from two event shapes. There is very little for a transcript to draw.

Four findings from the review set the shape of this work.

**t3code has no single protocol, and that is the lesson.** Six harnesses, three
transports: Claude gets a bespoke ~5,400-line adapter over `stream-json`, Codex
speaks its own app-server protocol, and Cursor, Grok, OpenCode and Antigravity
speak ACP (the Agent Client Protocol, schema v0.11.3). Behind all of them sits
one internal event model. **The abstraction belongs to the host, not to any
vendor.** KARMAX already has that seam; it is simply far too narrow.

**ACP's `SessionUpdate` is the vocabulary to borrow**, whether or not the
protocol is spoken. Its variants are `user_message_chunk`,
`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`,
`plan`, `available_commands_update` and `current_mode_update`. Three of those
carry things KARMAX currently destroys: reasoning, a live plan, and tool calls
with a stable id, a human title, a semantic kind, a four-state status and the
file locations they touched.

**Claude Code already emits most of it.** `thinking_delta` arrives on the same
`content_block_delta` path `emit` already reads and currently ignores; t3code
maps it to `reasoning_text` against `assistant_text`. `content_block_start`
carries a block `id` that t3code uses as a stable handle rather than guessing
by position. **But thinking is off by default** — a probe on this machine
emitted only `text` blocks, and t3code exposes `thinking` as a per-model
boolean option rather than assuming it. So the thought stream is real, and it
is opt-in.

**Mira's transcript is a message list; t3code's is a row model.** Ten row
kinds, including grouped tool calls with a live one and a "+N more" toggle, a
foldable turn, a visible context-compaction marker, a proposed-plan card, and
assistant metadata as its own row. Their scrolling has three modes, and the
interesting one is `anchoring-new-turn`: the question you just asked pins near
the top and the reply grows beneath it. Mira chases the bottom, which is why a
long reply races past.

These decisions were made explicitly in conversation; none is open:

| Decision | Choice |
|---|---|
| Spec shape | A roadmap for all seven pieces, full depth on the first four |
| The abstraction | KARMAX's own event model, ACP-shaped. Not ACP-the-dependency at the core |
| Claude support | A rich adapter in KARMAX, ported from t3code's (MIT, attributed) |
| ACP | Specified here, built after the event model and Mira |
| Thinking | Opt-in per conversation, because it is off by default |
| Inline approvals | Out of scope — see "Out of scope" below |
| Loops, marketplace, dashboards | Roadmap sketches only, own specs later |

## Roadmap

| # | Piece | Repo | Depends on |
|---|---|---|---|
| 1 | Harness event model | KARMAX | — |
| 2 | Claude adapter | KARMAX | 1 |
| 3 | Mira transcript | monorepo | 1, 2 |
| 4 | ACP client | KARMAX | 1 |
| 5 | Loops: provenance and AI authoring | both | 3 |
| 6 | Loop marketplace | both | 5 |
| 7 | Custom dashboards | both | 3 |

Pieces 1–4 are one arc: one internal model, two producers, one consumer. They
are §§1–4 below, in build order, and **1+2+3 ship without 4** — the ACP client
adds harnesses to a model that already works. Pieces 5–7 are sketched under
"The rest of the roadmap"; the numbered sections of this document stop at 4, so
a bare number always means a roadmap piece.

---

## 1. The event model

`internal/harness`. The current `Event` is replaced, not extended — it has two
consumers (the chat endpoint and its runtime adapter) and both change here.

```go
// Event is one thing a harness says while a turn is running.
//
// Shaped after ACP's SessionUpdate rather than after any one CLI's output, so
// that a second harness is an adapter rather than a second vocabulary.
type Event struct {
    Kind EventKind

    // Text carries KindMessage, KindThought and KindError.
    Text string

    // Tool is set for KindTool and KindToolUpdate. The same ID arrives more
    // than once: a call is announced, then revised as it runs and completes.
    Tool *ToolEvent

    // Plan replaces the whole plan each time. The agent revises it wholesale,
    // and merging entry-by-entry would invent a history it does not have.
    Plan []PlanEntry
}

type EventKind string

const (
    KindMessage    EventKind = "message"  // the reply, as deltas
    KindThought    EventKind = "thought"  // reasoning, when enabled
    KindTool       EventKind = "tool"
    KindToolUpdate EventKind = "tool_update"
    KindPlan       EventKind = "plan"
    KindError      EventKind = "error"
)

// ToolEvent is the streaming view of one tool call: announced, then revised.
//
// Deliberately NOT the existing harness.ToolCall, which is the settled record
// of a call inside a Turn and carries the raw Input and Command the audit
// allowlist reads. That one has consumers (harnesshost's allowlist audit,
// harnessbrain, chathost's ticket extraction) and keeps its name and shape.
type ToolEvent struct {
    // ID is stable for the life of the call. Without it a completion can only
    // be matched by name, which is what the chat reducer does today and why a
    // second call to the same tool resolves the wrong step.
    ID        string
    Title     string   // the agent's own words, not a lookup table of ours
    Kind      ToolKind // read|edit|delete|move|search|execute|think|fetch|other
    Status    Status   // pending|in_progress|completed|failed
    Locations []Location
    Output    string // see the truncation rule below
}

type Location struct {
    Path string
    Line int // 0 when the call named a file but not a line
}

type PlanEntry struct {
    Content  string
    Priority string // high|medium|low
    Status   string // pending|in_progress|completed
}
```

**Output is truncated to 2 KB at the adapter**, keeping the head, with a
trailing `\n…` when anything was cut. A tool result can be a whole file; the
transcript shows a preview and the raw bytes are of no use to it. Truncating
where the event is built keeps the cap in one place rather than at each
consumer.

`Options` gains `Thinking bool`. `Turn` — what `Session.Send` already returns —
gains `Model string` and `Duration time.Duration`; it has `CostUSD` already.
Those three are what the transcript's metadata row is drawn from, and Claude
Code's `result` event already carries all of them. `Turn.ToolCalls` is
untouched: the audit path depends on it.

### The wire

`POST /api/chat/stream`'s event set becomes `conversation | message | thought |
tool | tool_update | plan | meta | done | error`, with `ticket` unchanged.
`text` is gone, replaced by `message`.

**Amended during implementation:** the turn's metadata gets its own `meta`
kind rather than riding on `done`, and `costUsd` moves off `done` with it.
Hanging three fields on `done` meant every consumer of a terminal event had to
know about billing, and the alternative considered — smuggling the model into a
text field and the duration into a job id — was worse still. `meta` is emitted
after the tickets and before `done`, for the same reason tickets are: its facts
only exist once the turn has finished. Each kind still writes only its own fields — the
existing per-kind `send` switch in `internal/api/chat.go` extends rather than
changes shape.

This breaks `packages/chat-core`'s `TurnEvent` union, and with it `Message`:
`steps: ToolStep[]` becomes `toolCalls: ToolCall[]`, and `thought: string` is
added. TypeScript's `ToolCall` is the mirror of Go's `ToolEvent` — the name is
free on that side, and `ToolCall` is what the wire kind is called. Both sides
ship in one commit, so the break is a compile error rather than a runtime
surprise.

## 2. The Claude adapter

`internal/harness/claude`. Today `emit` is fifteen lines reading two event
shapes. This is the part ported from t3code's `ClaudeAdapter.ts`.

**What is ported and what is not.** Of roughly 110 top-level functions there,
about 35 are stream extraction — tool assembly, message and delta handling,
usage and limits. The rest are Effect plumbing, t3code's own contracts, and
features we do not have (citations, snapshots). We port the extraction core:
**1,200–1,800 lines of Go, not 5,400 of TypeScript.** The file header credits
t3code and its MIT licence.

What it must do that `emit` does not:

- **Assemble a tool call across four events.** `content_block_start` gives the
  block id and the tool name; `input_json_delta` streams its arguments in
  pieces; the `assistant` message carries the finished `tool_use`; the
  following `user` message carries the `tool_result`. One `ToolEvent` is built
  from all four and emitted twice — `KindTool` when it begins, `KindToolUpdate`
  when it resolves. The settled `Turn.ToolCalls` entry is still appended
  alongside it, unchanged, for the audit path.
- **Title each call** from its input: `Bash` with a `description` uses it;
  `Read`/`Edit` use the file's base name; a web tool uses the host. This
  replaces the desktop's hand-written `verb()` table, which guesses from the
  tool name alone and cannot say *which* file.
- **Classify its kind**, so the transcript can pick an icon rather than parse a
  string: `Read`→read, `Edit`/`Write`→edit, `Bash`→execute, `Glob`/`Grep`→search,
  `WebFetch`/`WebSearch`→fetch, MCP browser tools→fetch, everything else→other.
- **Collect locations** from the input — the `file_path` of an edit, the paths
  a search returned — so a turn can say which files it touched.
- **Separate thought from message** on `delta.type`: `thinking_delta` becomes
  `KindThought`, `text_delta` becomes `KindMessage`. Both already arrive on the
  path `emit` reads; only `text_delta` is currently looked at.
- **Read the plan** from `TodoWrite`'s input, which is where Claude Code keeps
  one, and emit `KindPlan`.

**Enabling thinking — settled by probe, 2026-09-13.** `Options.Thinking` maps to
the `MAX_THINKING_TOKENS` environment variable on the CLI invocation. A recorded
probe confirms that lever works: the stream carries real `thinking_delta` events,
a rising `thinking_tokens` count, and a final `thinking` content block.

**But the reasoning text is not exposed under subscription auth.** Every delta
and the settled block came back with an empty `thinking` field carrying only an
opaque signature, and a follow-up probe asking for the interleaved-thinking beta
was refused outright: *"Custom betas are only available for API key users."* So
on an OAuth/subscription login the thought stream exists and says nothing.

The consequence is that this feature ships plumbed, correct, and dormant, and it
degrades honestly. A live turn was measured emitting **eleven empty thought
events**, so `emit` now drops any delta whose text is empty — nothing reaches
the wire at all, rather than eleven events that say nothing. Downstream,
`deriveRows` only emits a thought row when there is something in it, so no empty
row could be drawn even if one arrived. The day an API-key login exposes the
text, the whole path lights up unchanged.

No `thinking.jsonl` fixture is committed. One recorded under this auth would
hold only empty thoughts, and asserting against it would mean weakening the very
check that catches a wrong-delta-field read — the bug the test exists for. The
replay test stays in the suite and skips while the fixture is absent, which is
self-documenting rather than silent.

**Unchanged, deliberately:** `Session.Send`'s own accumulation into the turn
text, and the rule that the `assistant` event never re-emits text the deltas
already streamed. Both were bugs once; the tests that pin them stay.

## 3. Mira's transcript

`packages/chat-core` gains the row model; `desktop/src/routes/chat` renders it.

### deriveRows

A pure `deriveRows(messages: Message[], ui: RowUiState) → Row[]`, living in
chat-core and tested with no renderer. This mirrors t3code separating
`MessagesTimeline.logic.ts` from `MessagesTimeline.tsx` and testing the logic
hard — the right instinct, and the reason their 4,000-line component is
tractable.

`RowUiState` is what the person has clicked, and nothing else: the set of
folded turn ids, the set of expanded thought ids, and the set of expanded work
groups. It is renderer state, held by the screen and passed in, so `deriveRows`
stays a function of its arguments.

```ts
type Row =
  | { kind: 'message';     id: string; message: Message }
  | { kind: 'thought';     id: string; text: string; expanded: boolean }
  | { kind: 'work';        id: string; calls: ToolCall[] }   // settled, grouped
  | { kind: 'work-live';   id: string; call: ToolCall }      // the one running
  | { kind: 'work-toggle'; id: string; hidden: number; expanded: boolean }
  | { kind: 'plan';        id: string; entries: PlanEntry[] }
  | { kind: 'turn-fold';   id: string; turnId: string; label: string }
  | { kind: 'meta';        id: string; model: string; durationMs: number; costUsd?: number }
```

**Grouping is the change that fixes the step line.** Today every tool call in a
turn collapses into one line with a chevron. Instead:

- Consecutive settled calls **of the same `ToolKind`** become one `work` row
  summarising them ("read 4 files"). A call of a different kind starts a new
  group, so "read three files, ran a command, read two more" stays three rows
  and stays truthful.
- The call currently running is its own `work-live` row, always visible.
- **Beyond four groups in a turn**, the older ones fold behind a `work-toggle`
  row carrying the hidden count. Four is a starting number, not a finding;
  change it if it reads badly.

A turn that read twelve files and ran one command is two rows, not twelve lines
and not one opaque one.

**Thought is collapsed by default** and rendered dimmer than the reply, in the
same mono the step line uses. It is evidence of work, not the answer.

**`turn-fold`** collapses a whole past turn to its question. A conversation of
forty turns stays navigable.

**`meta`** is drawn from the `done` event's `model`, `durationMs` and
`costUsd`, and appears only on a settled assistant turn.

### Scrolling

Three modes, replacing the current "follow the bottom if within 120px":

- `following-end` — a short reply grows and the view follows.
- `anchoring-new-turn` — **the default when a turn starts.** The question pins
  near the top and the reply grows beneath it. A long reply no longer races
  past the thing you asked.
- `free-scrolling` — you scrolled; nothing moves until you return to the end.

The mode is derived, never a stored preference: starting a turn enters
anchoring, reaching the end enters following, scrolling away enters free. It is
a three-state machine and is tested as one, apart from the DOM.

The listener stays on the shell's `<main>`, found via `closest('main')` — the
screen does not own the scrolling element, and binding to its own div was a bug
once already.

### Composer

Slash commands from `available_commands_update`, `@` file mentions, and a model
picker per conversation (`Options.Model` already exists on the supervisor),
plus the per-conversation thinking toggle §1 introduces — held on the desktop
alongside the model choice and sent with each turn. **Not** inline approvals;
see "Out of scope".

## 4. The ACP client

`internal/harness/acp`. A JSON-RPC-over-stdio client, ACP schema v0.11.3,
protocol version 1.

Agent methods used: `initialize`, `authenticate`, `session/new`,
`session/load`, `session/prompt`, `session/cancel`, `session/set_model`.
Client methods handled: `session/update` (the event stream),
`fs/read_text_file`, `fs/write_text_file`.

`session/update`'s variants map to §1 almost one-to-one, which is the point of
having shaped §1 after them: `agent_message_chunk`→`KindMessage`,
`agent_thought_chunk`→`KindThought`, `tool_call`→`KindTool`,
`tool_call_update`→`KindToolUpdate`, `plan`→`KindPlan`.

A provider is a launch recipe — binary, args, auth check — so adding Cursor
after Codex is a table entry. `karmax preflight`
(`2026-09-11-desktop-chat-design.md` §3) grows a check per provider.

**`session/request_permission` is deliberately not handled here.** Answering it
is the approvals work described below; until then the client declines, which is
what the current `--dangerously-skip-permissions` posture already amounts to.

---

## Testing

The adapter is where the risk is, and it is testable without a model: capture
real `stream-json` from each supported harness into `testdata/`, replay it, and
assert the emitted events. That is how the double-delivery bug was caught last
time, and the fixture from it stays.

Specifically:

- **A recorded turn that reads three files and runs a command** produces one
  `KindTool`/`KindToolUpdate` pair per call with the right ids, titles, kinds
  and locations — and delivers the reply exactly once.
- **A recorded turn with thinking enabled** (the probe capture from §2)
  separates `KindThought` from `KindMessage` with no leakage either way.
- **A recorded tool result larger than 2 KB** is truncated with the marker, and
  the untruncated bytes never reach the wire.
- **`deriveRows`** is a pure-function suite: same-kind grouping, a different
  kind breaking a group, the live call, the toggle threshold, wholesale plan
  replacement, turn folding — no renderer, no network.
- **The scroll state machine** is tested as a state machine.
- The existing `npm run test:core` check gains the new wire kinds; it starts a
  real daemon, which is what makes it worth keeping.

## Out of scope

**Inline approvals.** t3code surfaces permission requests in the composer
because its harnesses run in a mode that asks. KARMAX runs
`--dangerously-skip-permissions`, or `--permission-mode dontAsk` under an
access policy — there is nothing to surface. Making approvals real means
changing how the harness is invoked, adding an answer channel back through the
endpoint and the IPC bridge, and deciding what an unanswered request does to a
turn that is already streaming. That is a sub-project, not a composer feature,
and it is the natural successor to this arc — ACP hands us
`session/request_permission` for free the day we want it.

**Codex's app-server protocol.** ACP covers Cursor, Grok, OpenCode and
Antigravity. t3code talks to Codex over its own protocol instead. Whether Codex
is worth a third transport is a question for after §4 ships and we know what
ACP actually bought.

## The rest of the roadmap

Pieces 5–7 get their own specs. They are recorded here so the order is visible.

**5 — Loops: provenance and AI authoring.** The Loops screen is currently a
rename of Automations and still offers manual creation. It should distinguish
what you and the assistant made from what shipped with the engine or came from
the marketplace, drop manual creation in favour of asking for it in Mira, and
give the assistant a tool that writes a recipe or a workflow and reports it
back as a receipt card. Open question already surfaced: whether a new loop
arrives armed, or as a draft you arm.

**6 — Loop marketplace.** Publishing pushes a branch to the KARMAX loops
repository and opens a PR. The hard part is the person with no GitHub account:
either a LYZN bot account commits on their behalf with attribution in the loop
manifest, or the PR comes from a shared fork. Either way the review stays a
diff in a public repo, which is the property worth keeping.

**7 — Custom dashboards.** Dashboard is currently a renamed Overview. It should
hold several, one default and the rest authored by asking. The open question is
what a dashboard *is* — a saved query set, a declarative widget list, or
generated code — and it should be answered before anything is built.

## Attribution

§2's adapter and §3's row model and scroll modes are ported from or directly
informed by [t3code](https://github.com/pingdotgg/t3code), MIT, Copyright (c)
2026 T3 Tools Inc. Ported files carry that notice in their header.
