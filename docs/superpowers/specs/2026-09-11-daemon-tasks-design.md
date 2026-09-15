# Sending tasks to the LYZN desktop daemon

Date: 2026-09-11. Status: approved by Kartik in conversation; implementation
follows this document.

## Context

The pipe that carries work to a laptop already exists end to end. A task
reaches a daemon by being **approved**: `POST /tasks/:id/approve` flips the row
to `approved`, which moves it into the `TASKSTATUS#<sub>#approved` partition,
which is precisely what `GET /daemons/work` polls. The daemon claims it under a
lease, runs it, posts a result, and a receipt is written. None of that changes
here.

What is missing is an **origin**. Every task in the system today is born in
`cmd/processor/main.go:tasksFromEnrichment` out of an `ActionItem` the
enrichment pass found in a conversation, with the id `<recordingID>-<i>`. There
is no `POST /tasks`: a person cannot say "do this on my laptop" unless they
first said it out loud to their pendant and LYZN happened to extract it.

This project adds two ways to say it — the assistant in the LYZN tab, and a
person typing in the tasks segment — and the one backend route they share.

Two findings from the design pass are worth stating up front, because they set
the shape of the work.

**The daemon needs no change, and neither does KARMAX.** `workItem`
(`internal/api/daemons.go:580`) carries `quote`, `recordingId` and `context`
with **no `omitempty` anywhere** — deliberately, so "the thing decoding this is
a program, and a program should not have to distinguish absent from empty". A
task with no conversation behind it therefore serialises as empty strings and
an empty context, and every existing client decodes it today.

**The assistant cannot call a tool as things stand.** Chat runs on Bedrock
(`internal/api/chat.go:130`, `ai.NewKarmaAI(..., ai.Bedrock, ...)`, Haiku), and
in karma v1.25.1 the Bedrock streaming path is
`bedrock.ConverseStream(ctx, params, onText)` — text in, text out, with no tool
plumbing at all (`ai/handlers.go:240`). `kai.GoFunctionTools` is translated for
the Claude path (`configureClaudeClientForMCP`) and the OpenAI path
(`configureOpenaiClientForMCP`) and is simply never read on the Bedrock one, as
is `kai.ToolsEnabled`. So the first section of this document is work in
`github.com/MelloB1989/karma`, not in this repository.

Decisions were made explicitly with the user; none of the following is open:

| Decision | Choice |
|---|---|
| Where a task can be sent from | Two surfaces: a tool the assistant may call, and a compose affordance in the tasks segment |
| How the assistant gets a tool | Add tool support to karma's Bedrock path. Not a provider switch, not MCP |
| What the tool may cause | It files the task **already approved** — the next daemon poll takes it, with no second tap |
| Daemon API / KARMAX | Unchanged. No new endpoint on the daemon half, no new fields on `workItem` |
| Task id with no recording | `own_<32 hex>` — the account's own task rather than a conversation's |
| Plan gate | `automationGate`, the same 402 `/approve` answers |
| Task kind | Optional, coerced, defaults to `other` |

---

## 1. karma — tools on the Bedrock path

Work in `~/Developer/code/karma`, released and pinned here. Nothing in sections
2 and 3 depends on it except the tool registration in §2.3.

### 1.1 `apis/aws/bedrock` learns tools but not orchestration

The package is a transport: it builds an input, makes the call, and returns a
normalised `ConverseResult`. It stays that way.

- `ConverseParams` gains `Tools []ToolSpec` and `ToolChoice string`, where
  `ToolSpec` is `{Name, Description string; InputSchema map[string]any}` — a
  JSON Schema object, which is what Bedrock's `ToolInputSchema` takes. No
  handler lives here; the transport does not run anything.
- `buildConverseInput` turns those into `types.ToolConfiguration` and sets it on
  both `ConverseInput` and `ConverseStreamInput`. Absent tools means an absent
  `ToolConfig`, so every existing caller is byte-identical.
- `ConverseResult` gains `ToolUses []ToolUse`, where `ToolUse` is
  `{ID, Name string; Input json.RawMessage}`. `StopReason` already exists and
  reads `tool_use` when the model wants one.
- `Converse` reads tool-use blocks out of
  `ConverseOutputMemberMessage.Value.Content`.
- `ConverseStream` accumulates them: `contentBlockStart` carries the tool's id
  and name, and `contentBlockDelta` carries its input as **partial JSON** that
  must be concatenated across deltas before it parses. Text deltas continue to
  reach `onText` untouched, so the SSE stream the app reads is unchanged while a
  tool call is being assembled.

### 1.2 `ai` runs the loop

`ai/handlers.go:handleBedrockStreamCompletion` gains what the other two
providers already have:

- A `bedrockToolSpecs(kai)` translation, the Bedrock sibling of
  `configureClaudeClientForMCP` and `configureOpenaiClientForMCP`: it maps
  `kai.GoFunctionTools` to `[]bedrock.ToolSpec` and is only consulted when
  `kai.ToolsEnabled` is set.
- The pass loop. While the result's stop reason is `tool_use` and passes remain
  under `kai.MaxToolPasses` (the option already exists), run each requested
  tool's `Handler`, append the assistant's tool-use turn and a user turn
  carrying the `toolResult` blocks, and converse again. The final natural-
  language answer is what the caller's `onText` has been streaming.
- A handler that returns an error becomes a `toolResult` with `status: error`
  and the error's text, not a failed request: a tool that could not run is
  something the model should be told about and allowed to answer around.
- A tool name the model asks for that is not registered is the same case.

The public API does not change. `ai.NewGoFunctionTool(name, description,
ai.NewFuncParams()..., handler)`, `AddGoFunctionTool`, `WithToolsEnabled` and
`WithMaxToolPasses` are already exported (`ai/funcparams.go:50` aliases the
internal type), so a caller writes the same code it would for OpenAI.

### 1.3 Tests

Both without AWS, in `apis/aws/bedrock`:

- `buildConverseInput` with two `ToolSpec`s produces a `ToolConfig` carrying
  both, and with none produces a nil `ToolConfig`.
- A canned sequence of stream events — `contentBlockStart` with a tool-use
  block, three `contentBlockDelta`s splitting `{"text":"ship it"}` across
  boundaries, `messageStop` with `tool_use` — reassembles into one `ToolUse`
  whose `Input` parses.

And in `ai`, that the loop stops at `MaxToolPasses` rather than looping while a
model keeps asking.

### 1.4 Release

Tag karma, then `go get github.com/MelloB1989/karma@<version>` in
`backend/go/go.mod`. The floor moves from v1.25.1 (see the dependency-floor
note in the project memory).

---

## 2. Backend — a task that no conversation produced

### 2.1 `POST /tasks`

Registered in `internal/api/tasks.go` beside the five routes already there, and
Clerk-authed like them.

```
POST /tasks
{ "text": "pull main and run the tests", "kind": "other", "dueAt": "", "approved": true }
→ 201 { "task": { … } }
```

- `text` is required, trimmed, and truncated to 400 — the same rule
  `patchTask` applies, in the same helper.
- `kind` is optional and goes through `types.CoerceTaskKind`, defaulting to
  `other`.
- `dueAt` is optional and validated exactly as `patchTask` validates it.
- `approved: true` runs `automationGate` **first**, so an account whose plan
  carries no automation gets the same 402 `/approve` gives it, with the same
  sentence. `approved: false` (or absent) writes a `proposed` task and needs no
  gate — a note to self is not execution.

### 2.2 One place a task is born

Both callers go through a single unexported `mintTask(ctx, userID, input)` in
`internal/api/tasks.go`, which builds the row and writes it with `ddb.PutTask`:

```go
ddb.Task{
    TaskID:      "own_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
    UserID:      userID,
    RecordingID: "",           // there was no conversation
    Quote:       "",           // and so there is nothing to quote
    Text:        text,
    Kind:        kind,
    Status:      status,       // proposed or approved
    CreatedAt:   nowISO(),
    UpdatedAt:   nowISO(),
}
```

The id is deliberately hyphen-free after its prefix. Extracted ids are
`<recordingID>-<index>`, and a client that splits one on its last hyphen would
be misled by a UUID's own hyphens; `own_` plus 32 hex characters cannot be
mistaken for either half of that shape.

`RecordingID` and `Quote` are already `omitempty` on the row and always-present
on the wire (§Context), so the app's task list and the daemon's work list both
render a recording-less task with no change.

### 2.3 The tool

Registered in `wrapperWith` (`internal/api/chat.go:112`), where the user id is
already in scope, using karma's public builder:

```go
ai.NewGoFunctionTool(
    "send_task_to_laptop",
    "File a task for the person's paired laptop to carry out. Use it when they "
        + "ask for something to be done on their machine. The task is queued the "
        + "moment this returns; it is not run here.",
    ai.NewFuncParams().
        SetString("text", "What to do, as one instruction, in the person's own words").
        SetStringEnum("kind", "What sort of act it is", []string{"message", "spend", "file", "reminder", "other"}).
        SetRequired("text"),
    handler,   // closes over the user id, calls mintTask with approved: true
)
```

`WithToolsEnabled()` and `WithMaxToolPasses(3)` go on the same `ai.NewKarmaAI`
call. `wrapperWith` is shared by the typed wrapper and the voice one
(`chat.go:97` and `:104`), so both gain the tool. That is intended and costs
nothing: a spoken "put that on my laptop" is the same request, and the voice
wrapper's own 220-token reply budget is untouched by a tool the model may or
may not call.

The handler:

1. Calls `automationState`. When the account may not queue work it returns that
   sentence to the model **as a successful tool result** — the model should say
   "your plan doesn't include that" in its own voice, not hit an error path.
2. Calls `mintTask` with `approved: true`.
3. Reads the daemon list for the account and returns, as JSON for the model:
   `{"taskId": …, "text": …, "queued": true, "machines": 2, "awake": 1}`.

That last field is why the tool returns anything at all: a queued task with no
machine awake is not the same as a task that will run in a minute, and the reply
should be able to say so. `awake` counts daemons whose last heartbeat is inside
`daemonStaleAfter` (`internal/api/daemons.go:251`, three missed beats), which is
the backend's existing rule and the same 90 seconds the app's own
`STALE_AFTER_SECONDS` uses for Home's `daemonAsleep` banner — one definition of
awake, already written twice, and not a third.

The tool never claims a task ran. It queued one.

### 2.4 The step event

The chat stream already emits `{"type":"tool","name":…,"status":…}` for the
wrapper's managed memory steps. The handler emits `task.sent` with `start` and
then `done` or `failed` through the same `toolEmit` sink, so the app can draw
the act as it happens rather than inferring it from prose.

### 2.5 Tests

In the house style of `internal/api/*_test.go`, with the store behind the
existing `ddb*` function variables:

- `POST /tasks` rejects empty text, truncates at 400, coerces an unknown kind
  to `other`, and mints an id matching `^own_[0-9a-f]{32}$`.
- `approved: true` without automation is a 402 and writes nothing.
- `approved: true` with automation writes `status=approved` — the assertion
  that matters, since that status is the whole delivery mechanism.
- The tool handler returns the plan sentence rather than an error when the
  account is not entitled, and reports `awake: 0` when every daemon's heartbeat
  is stale.

---

## 3. Mobile — the tasks segment, and what chat shows

### 3.1 The client

`src/api/tasks.ts` gains `create({ text, kind?, dueAt?, approved? })` returning
`{ task: Task }`, alongside the five calls already on `tasksApi`.

### 3.2 The compose affordance

In `src/home/TasksSegment.tsx`. The segment today lists tasks and carries a
selection bar that approves what is ticked; it gains a way to write one:

- An action in the segment (and in its empty state, which is where somebody with
  no tasks will look) opens a sheet: one `Field`, and a primary button reading
  **SEND TO LAPTOP**.
- Sending calls `create({ text, approved: true })`, inserts the returned task
  optimistically the way `approve` already updates the store, and closes.
- The button is disabled until the text is non-empty — the same rule the plan
  chooser's RESERVE now follows.

### 3.3 What it does when the account cannot use it

The affordance is drawn only when `features.execution && plan.automation`, the
same pair Home already reads for its daemon banners. Without them the action
opens the existing `UnlockSheet` rather than sending a request that will 402.

With the entitlement but **no paired machine**, the send still goes through —
the task waits in the queue, which is correct — and the sheet's confirmation
says so, reusing `daemonNone`'s wording rather than inventing a second sentence
for the same situation.

### 3.4 The chat step

`ChatToolEvent.name` is already an open string and per-message `steps` already
reach the LYZN tab, but `app/(tabs)/lyzn.tsx:403` only renders `memory.recall`.
This adds the line for `task.sent` — the assistant is seen filing the task, and
the transcript keeps a record of what was dispatched.

### 3.5 Tests

`tests/` here runs pure modules under `node --test`, so the testable parts are
the pure ones: the gate that decides whether the affordance is drawn, and the
optimistic-insert reducer. Both belong beside the existing task-model tests
rather than inside the component.

---

## 4. Not in this project

- **No un-send.** The tool files an approved task and the daemon may claim it
  within the heartbeat interval; a pull-back that races a claim is a second
  design, and `dismiss` already exists for a task no machine has taken.
- **No targeting a particular laptop.** The queue is per account, and whichever
  machine polls first takes the work. Routing to a named machine would change
  `GET /daemons/work`, which is a daemon-API change this project rules out.
- **No `list` or `status` tool.** One tool, one act. The app already shows what
  is running.
- **No new push notification.** A task the person just sent is not news.

## 5. Order of work

Sections 2 and 3 do not depend on section 1 and deliver a working feature on
their own: a person can type a task and their laptop will do it. Section 1 is
what lets the assistant do the same thing without being asked twice.

1. §2 backend — `POST /tasks` and `mintTask`, with tests.
2. §3 mobile — the client call and the compose sheet.
3. §1 karma — Bedrock tools, tested and released.
4. §2.3 the tool registration, once karma is pinned.

## 6. Risks

**A sentence becomes work.** The tool files tasks already approved, so a
misread request — or a hallucinated one — is an act rather than a suggestion.
This was chosen deliberately over a draft-then-approve flow. Two things blunt
it, both in this design: the tool answers the model with the task id and what it
filed, so the transcript is a record of every dispatch, and the task appears in
the tasks segment immediately, where `dismiss` already stops anything a machine
has not yet claimed.

**The tool loop is new code on the path every chat takes.** A bug in the
Bedrock pass loop is a bug in ordinary conversation, not only in tool calls.
The loop is therefore only entered when `ToolsEnabled` is set and a stop reason
actually says `tool_use`; a build with no tools registered takes exactly the
code path it takes today.
