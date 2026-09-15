# Speaking ACP, so a harness is a config entry

Date: 2026-09-13. Status: approved in conversation; implementation follows
this document. KARMAX only.

## Context

KARMAX talks to exactly one harness today. `internal/harness.Supervisor`
spawns `claude` with Claude Code's own flags — `--print --input-format
stream-json --output-format stream-json --verbose
--dangerously-skip-permissions --include-partial-messages` — and
`Session.Send` parses that exact wire. `HarnessConfig.Binary`'s comment
claims *"anything speaking the same stream-json protocol works, which is how
a second harness becomes a config change,"* and that is true, but the set of
CLIs speaking Claude Code's stream-json is exactly one.

Codex is the proof: it does not speak it, so `internal/tools/builtin/codex.go`
shells out one-shot per call with no session, no pooling, and no streaming —
a second, parallel mechanism that shares nothing with the first.

ACP — the Agent Client Protocol — is the way out. It is JSON-RPC 2.0 over
stdio, and Cursor, Grok, OpenCode, Antigravity and Gemini CLI speak it.
One client implementation reaches all of them.

**The groundwork is already done.** §§1–3 of
`2026-09-13-harness-events-and-transcript-design.md` deliberately shaped
`harness.Event` after ACP's `SessionUpdate` — that spec's words: *"so that a
second harness is an adapter rather than a second vocabulary."* The mapping
below is near 1:1 because it was designed to be. What was never built is §4,
the client itself.

### Why we write it rather than import it

There is no official Go SDK. Six community implementations exist; the
evidence, gathered 2026-09-13:

| | coder | caelis-labs | Tangerg |
|---|---|---|---|
| Stars | 230 | 0 | 4 |
| Age | 12 months | 3 weeks | 12 days |
| Last push | 2026-06-05 | 2 days | today |
| Schema pinned | **0.13.5** | v1.21.0 | v1.21.0 |
| License | Apache-2.0 | Apache-2.0 | Apache-2.0 |

The most-adopted one is pinned to a pre-1.0 schema while stable is
**v1.21.0**, and has been quiet three months. The two that track current
schema are single-maintainer repos weeks old with ~zero adoption. There is
no safe, established option to import.

The protocol itself is the opposite: `agentclientprotocol/agent-client-protocol`
is Apache-2.0, 4,218 stars, pushed daily, and **attaches `schema.json` and
`meta.json` to every `schema-vX.Y.Z` release** — v1.19.1, v1.20.0, v1.21.0
shipped roughly monthly, each with a parallel `v2.0.0-alpha`.

So the contract is a downloadable, versioned artifact from a healthy project,
and only the Go bindings are immature. We generate our bindings from that
artifact. Porting a community SDK would mean inheriting one maintainer's
architecture and bugs and then diverging from upstream anyway; generating
from `schema.json` means a version bump is a regeneration, not a merge.

Decided in conversation:

| Decision | Choice |
|---|---|
| SDK | None imported. Types generated from the official `schema.json`, client hand-written |
| Schema pin | `schema-v1.21.0`, recorded in a lockfile. Bumps are deliberate reviewable commits |
| Role | **Client only.** KARMAX drives harnesses; it is never the agent |
| Method scope | **The complete client role**, not just KARMAX's nine methods — see §3 |
| Home | **A public module, `github.com/MelloB1989/acp-go`.** KARMAX consumes it like any other dependency |
| Agent role | Out of scope for v0. A documented non-goal, not an oversight |
| Permissions | `session/request_permission` is declined, matching today's `--dangerously-skip-permissions` posture |
| Prior art | Tangerg/acp's interop approach studied and attributed (Apache-2.0). No code ported |

## 1. The session interface

The load-bearing change, and the reason this is not just "add a package."

`Supervisor` holds `live map[string]*Session` — a concrete type whose
`Send` parses Claude Code's stream-json. ACP sessions cannot be that type.
Extract an interface first; everything else depends on it.

```go
// session is one live conversation with a harness, whatever it speaks.
type session interface {
	Send(ctx context.Context, text string, timeout time.Duration, sink func(Event)) (Turn, error)
	Close()
	Alive() bool
	Busy() bool
	PID() int
	ID() string
}
```

`*Session` (the stream-json one) satisfies this already except `ID()` — it
exposes `ID` as a mutable field that `Send` rewrites when the CLI reassigns
(`s.ID = ev.SessionID`), and `supervisor.go` reads it to record
`HarnessSessionID` in the store. Add the accessor; keep the field private.

`Supervisor.live` becomes `map[string]session`. Pooling, `MaxLive` eviction,
`Reap`, `ReapOrphans`, the breaker and the audit hook are unchanged — they
only ever needed those six methods.

**This refactor ships and is verified green before any ACP code is written.**
It touches the hot path of every existing chat and agent turn, and mixing it
with new-protocol work would make a regression impossible to attribute.

## 2. Generated types

`schema/` in the `acp-go` module.

- `schema.json`, `meta.json` — the assets from the upstream `schema-v1.21.0`
  release, committed verbatim.
- `lock.json` — the pinned tag and commit, so what we generated from is a
  fact rather than a memory.
- `types_gen.go` — generated. Never hand-edited.
- A `go:generate` line and a script that fetches the pinned assets and
  regenerates.

Generate the transitive closure of the **client role** — every type named by
§3's two tables. The agent's own request/response types are excluded; that is
the v0 non-goal, and excluding them keeps the generated surface honest about
what the module actually implements.

`meta.json` carries the method-name registry; use it rather than hand-typing
`"session/prompt"` strings into the client.

## 3. The client

The module is `github.com/MelloB1989/acp-go`; KARMAX imports it. JSON-RPC
2.0, newline-delimited, over the child's stdin/stdout.

**Scope is the complete client role, not KARMAX's subset.** A public SDK that
implements only the nine methods one consumer happens to need strands the
second consumer immediately. The client's obligation surface — every method
an agent may call on a client — is implemented in full. The agent role is a
separate product and an explicit v0 non-goal.

KARMAX uses the marked subset; the rest exists because the SDK is a client
implementation, not a KARMAX adapter.

**Outbound — agent methods the SDK can call (★ = KARMAX uses):**

| Method | When |
|---|---|
| `initialize` ★ | Once per process, at spawn |
| `authenticate` ★ | Only if `initialize` reports the agent needs it |
| `session/new` ★ | Opening a session |
| `session/load` ★ | Resuming a known session id |
| `session/set_model` ★ | After new/load, when a category names a model (§5) |
| `session/prompt` ★ | Every turn |
| `session/cancel` ★ | Turn timeout or caller cancellation |
| `session/set_mode` | Agents exposing modes |
| `session/list`, `session/delete`, `session/resume`, `session/close` | Session management |

**Inbound — client methods the SDK serves. The consumer supplies handlers;
the SDK routes, validates and replies:**

| Method | SDK | KARMAX's handler |
|---|---|---|
| `session/update` | Dispatches per variant | Mapped to `harness.Event`, §4 |
| `fs/read_text_file` | Routes | Read, scoped to the session workdir |
| `fs/write_text_file` | Routes | Write, scoped to the session workdir |
| `terminal/*` | Routes | **None.** Capability never advertised, §7 |
| `session/request_permission` | Routes | **Decline**, §8 |
| `elicitation/*` | Routes | None for now |

A method whose capability the consumer did not advertise gets a JSON-RPC
"method not found" from the SDK without reaching a handler.

## 4. `session/update` → `harness.Event`

Near 1:1, by construction:

| ACP variant | `harness.Event` |
|---|---|
| `agent_message_chunk` | `KindMessage`, text |
| `agent_thought_chunk` | `KindThought`, text |
| `tool_call` | `KindTool` + `ToolEvent{ID, Title, Kind, Status, Locations}` |
| `tool_call_update` | `KindToolUpdate` + `ToolEvent{ID, Status, Output}` |
| `plan` | `KindPlan` + `[]PlanEntry` |
| `user_message_chunk` | dropped — KARMAX sent it; echoing it would double it |
| `available_commands_update` | dropped for now; the composer that would use it is not built |
| `current_mode_update` | dropped |

`ToolKind` and `Status` are already ACP's vocabularies verbatim in
`internal/harness/toolmeta.go` — no translation table. The empty-delta guard
from `emit` applies here too: a chunk with no text is not worth an event.

A turn ends when `session/prompt` returns, and its `stopReason` fills
`Turn.Err` on an abnormal stop. Text accumulates into `Turn.Text` the same
way `Session.Send` already does.

## 5. Model selection

ACP has no `--model` flag. Models are chosen in-protocol with
`session/set_model`, against the model list `initialize` or `session/new`
reports.

This lands cleanly on the category work
(`2026-09-13-utility-model-tiers-design.md`): a provider's
`categories.<name>.model` is the model *id* to pass to `session/set_model`
rather than a CLI argument. `HarnessCategoryConfig` needs no change — only
the lever differs per transport, which is exactly why that config was made
provider-keyed.

If the configured id is not in the agent's reported list, log it and proceed
on the agent's default rather than failing the turn. A wrong model answers;
a refused session does not.

`subagent_model` has no ACP equivalent and is ignored for ACP providers.

## 6. Efficiency

The user's requirement, and the reason the package doc exists: a harness call
is normally one process per prompt, costing a cold start every time —
measured at 4.1s bare and 15.4s with a tool call. ACP must not reintroduce
that.

- **One process per session, reused across turns.** `initialize` is a
  handshake, not a per-turn cost; paying it per prompt would make ACP slower
  than the thing it replaces.
- **The existing pool is the pool.** `MaxLive`, idle reaping, the orphan
  sweep and the breaker all operate on the interface from §1, so ACP sessions
  inherit them with no new machinery.
- **One in-flight prompt per session.** ACP carries request ids, so
  concurrency is possible in principle — but `Turn` attribution is per
  session and the existing mutex already enforces this. Keep it.
- **Stream, never buffer.** `session/update` notifications go to the sink as
  they arrive.
- **No polling anywhere.** Read the child's stdout in one goroutine, dispatch
  by id and method.

## 7. Capabilities

What `initialize` advertises is what agents are permitted to ask for, so it
is a scope and security decision, not boilerplate — and it belongs to the
**consumer**, not the SDK. The SDK implements `terminal/*` because a client
SDK should; it advertises nothing on its own.

KARMAX advertises `fs.readTextFile` and `fs.writeTextFile`, and **not**
terminal. Declining to offer a shell to a third-party agent costs nothing
today — no caller needs it — and never advertising it is a stronger
guarantee than refusing the call later.

## 8. Permissions

`session/request_permission` is declined with the "cancelled" outcome.

This matches the posture everywhere else: the stream-json path runs
`--dangerously-skip-permissions` and has no permission prompt to surface.
Answering these properly means an answer channel out through the endpoint and
the IPC bridge, and a decision about what an unanswered request does to a
streaming turn — the sub-project the transcript spec already named and
deferred. Declining is honest; silently auto-approving would not be.

An agent that cannot proceed without permission will stop, and its
`stopReason` surfaces as a turn error rather than a hang.

## 9. Providers

`harness.providers.<name>.transport` selects the implementation:

- `stream_json` → the existing `*Session`
- `acp` → this client
- `exec` → **not a Supervisor session at all.** Codex's one-shot pattern has
  no session to pool; it stays in `utilitymodel`. Naming it here only so the
  registry can skip it rather than appear to have lost it.

A provider whose transport is unimplemented is skipped, not an error — that
is what lets an `acp` provider be configured before this ships.

Each ACP provider is a launch recipe: binary, args, and whether
`authenticate` is required. Adding Cursor after Gemini is a config entry.

## 10. Testing

- **In-memory transport first.** A fake agent speaking ACP over a pipe, no
  subprocess: the whole `session/update` → `Event` mapping, cancellation, and
  the decline path are testable without any binary installed.
- **Recorded conformance fixtures.** Capture a real agent's `session/update`
  stream once, replay it, assert the events — the discipline that caught the
  double-delivery bug on the stream-json side.
- **One live interop test, skipped when absent.** Against a real ACP agent
  (Gemini CLI is the most likely to be installed), gated on its binary
  existing so CI stays green on a machine without it.
- **Schema drift.** A test that fails when `lock.json` and the committed
  `schema.json` disagree, so a half-finished bump cannot ship.
- The §1 refactor is verified by the existing suite going green unchanged —
  that is the whole point of doing it first and alone.

## 11. Out of scope

**The agent role.** The SDK is a client implementation. Serving prompts as
an agent is a separate product; v0 says so plainly rather than half-doing it.

**KARMAX using terminals or elicitation.** The SDK routes them; KARMAX
advertises neither, so no agent asks.

**ACP v2.** `schema-v2.0.0-alpha.3` exists and ships alongside every stable
release. We pin stable. Revisit when it stabilises.

**Replacing Codex's `exec` path.** Codex does not speak ACP. If it ever
does, it becomes a provider entry and `codex.go` retires — but that is a
finding, not a plan.
