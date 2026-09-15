# ACP Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `github.com/MelloB1989/acp-go`, a complete Go client for the Agent Client Protocol, and make KARMAX drive ACP harnesses through it so a new harness is a config entry.

**Architecture:** Three stages. KARMAX's `Supervisor` first gets a `session` interface so a non-stream-json session can exist at all. Then the SDK is built as its own repo — types generated from the official `schema-v1.21.0` assets, a hand-written JSON-RPC client covering the whole client role. Then KARMAX adds an ACP session implementing that interface, selected by a provider's `transport` field.

**Tech Stack:** Go 1.26 (KARMAX), Go 1.23 (the SDK — lower floor so others can adopt it), stdlib `encoding/json` + `os/exec`. No third-party runtime dependencies in the SDK.

**Spec:** `docs/superpowers/specs/2026-09-13-acp-client-design.md`

## Global Constraints

- **Never put `Co-Authored-By` or `Claude-Session` lines in any commit message.** The user instructed this directly; these repos are public. Subject and body only.
- **Commit locally. Never `git push`** unless a task says to (only Task 12 does, and only after asking).
- **Keep comments sparse.** One line where the reason is genuinely non-obvious. This overrides the usual house density.
- **Two repos, and neither lives in a scratchpad.**
  - **KARMAX** — clone it fresh before Task 1; do not reuse any existing
    checkout under `/private/tmp`, which is session-scoped and has already
    been found with a corrupted object graph once:
    ```bash
    git clone https://github.com/MelloB1989/KARMAX.git ~/Developer/code/KARMAX
    cd ~/Developer/code/KARMAX && git fsck --full 2>&1 | grep -i "missing\|error" || echo "clean"
    export KARMAX=~/Developer/code/KARMAX
    ```
    Branch off `main`. `export KARMAX` in every shell that runs a task — the
    commands below use it.
  - **The SDK** — a fresh repo at `~/Developer/code/acp-go`, created in Task 2.
- **`gh` must be authenticated** (`gh auth status`). Task 2 downloads release
  assets with it and Task 12 creates a repo.
- **Schema pin is `schema-v1.21.0`.** Assets come from the upstream release, committed verbatim. Never hand-edit generated files.
- **The SDK takes no runtime dependencies.** Codegen tooling may be a dev dependency; the published module must build on stdlib alone.
- **Apache-2.0** on the SDK, with a `NOTICE` attributing the protocol to Zed Industries / agentclientprotocol.
- KARMAX: `go build ./...`, `go test ./...`, `go vet ./...` clean; `gofmt -l` silent on touched files.

## File Structure

**Stage 1 — KARMAX (`internal/harness/`):**

| File | Change |
|---|---|
| `session.go` | `ID()` accessor; `ID` field unexported |
| `supervisor.go` | `session` interface; `live map[string]session` |

**Stage 2 — the SDK (`~/Developer/code/acp-go`):**

| File | Responsibility |
|---|---|
| `go.mod`, `LICENSE`, `NOTICE`, `README.md` | Module identity and attribution |
| `schema/{schema,meta,lock}.json` | Pinned upstream assets |
| `internal/schemagen/main.go` | Codegen, dev-only |
| `types_gen.go` | Generated types. Never hand-edited |
| `jsonrpc.go` | Framing, request ids, dispatch |
| `transport.go` | `Transport` interface; stdio and in-memory |
| `client.go` | Outbound agent methods |
| `handlers.go` | Inbound client methods; `Handler` interface |
| `capabilities.go` | What the consumer advertises |
| `*_test.go` | In-memory conformance suite |

**Stage 3 — KARMAX integration:**

| File | Responsibility |
|---|---|
| `internal/harness/acpsession.go` | `session` impl wrapping the SDK |
| `internal/harness/acpsession_test.go` | Mapping tests |
| `internal/harness/supervisor.go` | Provider registry by `transport` |
| `internal/config/types.go` | Provider transport/args already added by the categories plan; extend if absent |

---

# Stage 1 — KARMAX can hold a session it did not spawn

## Task 1: Extract the `session` interface

Ships alone and green. It touches the hot path of every chat and agent turn, so a regression here must be attributable to this change and nothing else.

**Repo:** KARMAX

**Files:**
- Modify: `internal/harness/session.go`, `internal/harness/supervisor.go`

**Interfaces produced:** `harness.session` (unexported), satisfied by `*Session`.

- [ ] **Step 1: Find every external read of `Session`'s fields**

```bash
cd "$KARMAX"
grep -n "sess\.\|\.ID\b\|\.Key\b\|\.Kind\b" internal/harness/supervisor.go | grep -v "^.*//" | head -30
```

Every field read from outside `session.go` becomes either an interface method or stays a struct field used only internally. Write the list down before changing anything.

- [ ] **Step 2: Write the failing test**

`internal/harness/supervisor_test.go`:

```go
func TestSessionInterfaceIsSatisfiedByStreamJSON(t *testing.T) {
	var _ session = (*Session)(nil)
}

func TestSupervisorHoldsSessionsByInterface(t *testing.T) {
	s := &Supervisor{live: map[string]session{}}
	if s.live == nil {
		t.Fatal("live must be keyed by the interface, not *Session")
	}
}
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
go test ./internal/harness/ -run TestSession 2>&1 | head
```

Expected: `undefined: session`.

- [ ] **Step 4: Add the interface and the accessor**

In `supervisor.go`:

```go
type session interface {
	Send(ctx context.Context, text string, timeout time.Duration, sink func(Event)) (Turn, error)
	Close()
	Alive() bool
	Busy() bool
	PID() int
	ID() string
}
```

In `session.go`: rename the `ID` field to `id`, add `func (s *Session) ID() string { return s.id }`, and update the in-package writes (`s.id = ev.SessionID` in `Send`, and wherever `spawn` sets it).

Change `Supervisor.live` to `map[string]session`. Fix the call sites the compiler finds — they should all be method calls already.

- [ ] **Step 5: Prove nothing else changed**

```bash
go build ./... && go test ./... 2>&1 | grep -E "^(FAIL|ok)" | head -20
go vet ./internal/harness/ && gofmt -l internal/harness/
```

The whole existing suite must pass unchanged. If a test needed editing to compile, say which and why in the report — that is the signal this refactor was not purely mechanical.

- [ ] **Step 6: Commit**

```bash
git add internal/harness/
git commit -m "A session is an interface, so one can speak something else"
```

---

# Stage 2 — the SDK

Independently releasable. Nothing here imports KARMAX.

## Task 2: Bootstrap the module

**Repo:** `~/Developer/code/acp-go` (create it)

- [ ] **Step 1: Create the repo and module**

```bash
mkdir -p ~/Developer/code/acp-go && cd ~/Developer/code/acp-go
git init -q
go mod init github.com/MelloB1989/acp-go
go mod edit -go=1.23
```

- [ ] **Step 2: License and attribution**

`LICENSE`: Apache-2.0, full text, copyright the repo owner.

`NOTICE`:

```
acp-go
Copyright 2026 MelloB1989

This product includes schema definitions from the Agent Client Protocol
(https://github.com/agentclientprotocol/agent-client-protocol), Copyright
Zed Industries, licensed under the Apache License, Version 2.0.

The interoperability testing approach was informed by Tangerg/acp
(https://github.com/Tangerg/acp), licensed under the Apache License,
Version 2.0. No code was copied.
```

- [ ] **Step 3: Vendor the pinned schema**

```bash
mkdir -p schema
gh release download schema-v1.21.0 \
  --repo agentclientprotocol/agent-client-protocol \
  --pattern 'schema.json' --pattern 'meta.json' --dir schema
COMMIT=$(gh api repos/agentclientprotocol/agent-client-protocol/git/ref/tags/schema-v1.21.0 --jq '.object.sha')
cat > schema/lock.json <<JSON
{
  "repository": "https://github.com/agentclientprotocol/agent-client-protocol",
  "tag": "schema-v1.21.0",
  "commit": "$COMMIT",
  "assets": ["schema.json", "meta.json"]
}
JSON
ls -la schema/
```

- [ ] **Step 4: README stating scope honestly**

Must say: client role only; agent role is a v0 non-goal; schema version pinned; no runtime dependencies; API unstable until v1.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Bootstrap acp-go against schema-v1.21.0"
```

---

## Task 3: Generate the types

**Files:** `internal/schemagen/main.go`, `types_gen.go`, `schema_test.go`

- [ ] **Step 1: Write the drift test first**

`schema_test.go`:

```go
func TestSchemaMatchesLock(t *testing.T) {
	var lock struct {
		Tag    string   `json:"tag"`
		Assets []string `json:"assets"`
	}
	b, err := os.ReadFile("schema/lock.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &lock); err != nil {
		t.Fatal(err)
	}
	if lock.Tag == "" {
		t.Fatal("lock.json has no tag")
	}
	for _, a := range lock.Assets {
		if _, err := os.Stat(filepath.Join("schema", a)); err != nil {
			t.Errorf("%s named in lock.json but missing: %v", a, err)
		}
	}
}
```

- [ ] **Step 2: Inspect the schema's shape before generating**

```bash
cd ~/Developer/code/acp-go
python3 -c "
import json
s=json.load(open('schema/schema.json'))
print('top-level keys:', list(s.keys())[:10])
defs = s.get('\$defs') or s.get('definitions') or {}
print('definition count:', len(defs))
print('sample:', list(defs)[:15])
"
python3 -c "
import json
m=json.load(open('schema/meta.json'))
print(json.dumps(m, indent=1)[:1200])
"
```

Read the real structure before writing the generator. Do not assume `$defs`.

- [ ] **Step 3: Write the generator**

`internal/schemagen/main.go`, a `package main` run via `go:generate`. It reads `schema/schema.json` and `schema/meta.json` and emits `types_gen.go` containing:

- A Go struct or named type per definition in the client-role closure.
- Method-name constants from `meta.json` (never hand-typed method strings).
- The `SessionUpdate` variants as a discriminated union — a struct with the discriminator plus a typed payload accessor, since Go has no sum types.

Emit a `// Code generated by internal/schemagen. DO NOT EDIT.` header.

- [ ] **Step 4: Generate and verify it compiles**

```bash
go generate ./... && go build ./... && gofmt -l .
go test ./... -run TestSchema
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Generate client-role types from the pinned schema"
```

---

## Task 4: Transport and JSON-RPC framing

**Files:** `transport.go`, `jsonrpc.go`, `jsonrpc_test.go`, `transport_memory.go`

- [ ] **Step 1: Write the failing tests**

```go
func TestFramingRoundTripsOneMessagePerLine(t *testing.T) {
	a, b := NewMemoryTransport()
	defer a.Close()
	defer b.Close()

	want := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if err := a.Write(want); err != nil {
		t.Fatal(err)
	}
	got, err := b.Read()
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestRequestIDsAreUniqueAndMonotonic(t *testing.T) {
	c := &conn{}
	seen := map[int64]bool{}
	for i := 0; i < 100; i++ {
		id := c.nextID()
		if seen[id] {
			t.Fatalf("duplicate id %d", id)
		}
		seen[id] = true
	}
}

func TestAResponseWakesOnlyItsOwnCaller(t *testing.T) {
	// Two in-flight requests; deliver the second's response first and
	// confirm the first is still waiting.
}

func TestNotificationsHaveNoIDAndExpectNoReply(t *testing.T) {}

func TestUnknownMethodGetsMethodNotFound(t *testing.T) {}
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement**

`transport.go`:

```go
type Transport interface {
	Read() ([]byte, error)
	Write([]byte) error
	Close() error
}
```

`NewStdioTransport(r io.Reader, w io.Writer)` — newline-delimited, with a scanner buffer large enough for a big `tool_call_update` payload (the stream-json side uses 8MB; match it).

`NewMemoryTransport()` — a connected pair, for tests with no subprocess.

`jsonrpc.go`: a `conn` owning the transport, an id counter, a `map[int64]chan response` of in-flight calls, one read goroutine dispatching by id (response) or method (request/notification), and `Call`/`Notify`/`Respond`. Errors carry JSON-RPC codes.

- [ ] **Step 4: Run and commit**

```bash
go test ./... -v 2>&1 | tail -20
git add -A && git commit -m "JSON-RPC framing over a transport, with in-memory pairs for tests"
```

---

## Task 5: Outbound — the agent methods

**Files:** `client.go`, `capabilities.go`, `client_test.go`

- [ ] **Step 1: Write the failing tests**

Drive a fake agent over the memory transport; assert the wire, not the Go call:

```go
func TestInitializeSendsProtocolVersionAndCapabilities(t *testing.T) {}
func TestSessionNewReturnsASessionID(t *testing.T) {}
func TestSessionPromptStreamsUpdatesThenReturnsStopReason(t *testing.T) {}
func TestSessionCancelIsANotificationNotACall(t *testing.T) {}
func TestSetModelIsSkippedWhenTheAgentReportsNoSuchModel(t *testing.T) {}
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement `client.go`**

A `Client` over a `conn`, with one method per §3's outbound table. Every method takes a `context.Context` and honours cancellation by sending `session/cancel`.

`capabilities.go`: a `ClientCapabilities` struct the consumer fills and `initialize` sends. Advertising nothing is valid and means the agent may ask for nothing.

- [ ] **Step 4: Run and commit**

---

## Task 6: Inbound — the client methods

**Files:** `handlers.go`, `handlers_test.go`

- [ ] **Step 1: Write the failing tests**

```go
func TestSessionUpdateDispatchesPerVariant(t *testing.T) {}
func TestFSReadIsRefusedOutsideTheSessionRoot(t *testing.T) {}
func TestFSWriteIsRefusedOutsideTheSessionRoot(t *testing.T) {}
func TestUnadvertisedCapabilityGetsMethodNotFoundWithoutCallingAHandler(t *testing.T) {}
func TestRequestPermissionReturnsTheHandlersOutcome(t *testing.T) {}
```

The path-escape tests matter most: an agent asking for `../../.ssh/id_rsa` must be refused by the SDK, not by the consumer remembering to check. Test `..`, absolute paths, and a symlink pointing out of the root.

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement**

```go
type Handler interface {
	SessionUpdate(ctx context.Context, u SessionUpdate) error
	ReadTextFile(ctx context.Context, req ReadTextFileRequest) (string, error)
	WriteTextFile(ctx context.Context, req WriteTextFileRequest) error
	RequestPermission(ctx context.Context, req PermissionRequest) (PermissionOutcome, error)
	Terminal(ctx context.Context, req TerminalRequest) (TerminalResponse, error)
}
```

Provide a `BaseHandler` returning "not supported" for everything, so a consumer embeds it and overrides only what it advertises.

Root-scoping lives in the SDK: resolve the path, `filepath.EvalSymlinks`, and refuse anything outside the session root before a handler sees it.

- [ ] **Step 4: Run and commit**

---

## Task 7: Conformance suite

**Files:** `conformance_test.go`, `testdata/`

- [ ] **Step 1: A scripted fake agent**

A fake agent over the memory transport that replays a recorded `session/update` sequence covering every variant in §4, then returns a `stopReason`.

- [ ] **Step 2: Assert the full turn**

One test driving initialize → session/new → session/prompt → updates → return, asserting every variant arrived in order and the turn ended once.

- [ ] **Step 3: Cancellation and failure paths**

- Cancel mid-turn: `session/cancel` goes out, the turn returns, no goroutine leaks (`goleak` or a manual count).
- The agent closing stdout mid-turn returns an error, not a hang.
- A malformed line is skipped without killing the connection.

- [ ] **Step 4: Run with the race detector**

```bash
go test -race ./... 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

---

# Stage 3 — KARMAX drives ACP

## Task 8: The ACP session

**Repo:** KARMAX. Depends on Tasks 1 and 7.

**Files:** `internal/harness/acpsession.go`, `internal/harness/acpsession_test.go`

- [ ] **Step 1: Wire the local SDK**

```bash
cd "$KARMAX"
go mod edit -require=github.com/MelloB1989/acp-go@v0.0.0
go mod edit -replace=github.com/MelloB1989/acp-go=/Users/0mellob/Developer/code/acp-go
go mod tidy
```

The `replace` stays until Task 12 publishes a real version.

- [ ] **Step 2: Write the failing test**

Assert the §4 mapping against a fake agent, and that the type satisfies the interface:

```go
func TestACPSessionSatisfiesTheSessionInterface(t *testing.T) {
	var _ session = (*acpSession)(nil)
}

func TestAgentMessageChunkBecomesKindMessage(t *testing.T) {}
func TestToolCallBecomesKindToolWithIdentity(t *testing.T) {}
func TestToolCallUpdateBecomesKindToolUpdate(t *testing.T) {}
func TestPlanBecomesKindPlan(t *testing.T) {}
func TestUserMessageChunkIsDropped(t *testing.T) {}
func TestEmptyChunkEmitsNothing(t *testing.T) {}
```

The last two matter: echoing `user_message_chunk` would double every prompt, and the empty-delta guard is the bug already fixed once on the stream-json side.

- [ ] **Step 3: Implement `acpSession`**

Satisfies `session`. `Send` calls `session/prompt` and maps updates to `Event` through the sink; `Turn.Text` accumulates message chunks; `stopReason` fills `Turn.Err` on an abnormal stop. `Close` closes the connection and reaps the process. `PID` from the child. `ID` is the ACP session id.

A `harness.Handler` embedding the SDK's `BaseHandler`, overriding only `SessionUpdate`, `ReadTextFile`, `WriteTextFile`, and `RequestPermission` (which declines).

- [ ] **Step 4: Run and commit**

---

## Task 9: Provider registry

**Files:** `internal/harness/supervisor.go`, `internal/config/types.go`

- [ ] **Step 1: Write the failing test**

```go
func TestTransportSelectsTheSessionImplementation(t *testing.T) {}
func TestUnimplementedTransportIsSkippedNotAnError(t *testing.T) {}
```

- [ ] **Step 2: Implement**

`open()` reads the provider's `transport` and builds a `*Session` for `stream_json` or an `*acpSession` for `acp`. `exec` is skipped — it has no pooled session and lives in `utilitymodel`.

If the categories plan has not landed, add `HarnessProviderConfig` here; if it has, reuse it.

- [ ] **Step 3: Run and commit**

---

## Task 10: Model selection and capabilities

**Files:** `internal/harness/acpsession.go`

- [ ] **Step 1: Write the failing tests**

```go
func TestSetModelIsCalledWhenTheCategoryNamesOne(t *testing.T) {}
func TestAnUnknownModelLogsAndProceedsOnTheAgentDefault(t *testing.T) {}
func TestKARMAXAdvertisesFSButNeverTerminal(t *testing.T) {}
```

- [ ] **Step 2: Implement**

After `session/new` or `session/load`, call `session/set_model` when the resolved category names one. Not in the agent's list → log and continue.

Advertise `fs.readTextFile` and `fs.writeTextFile`. Never terminal.

- [ ] **Step 3: Run and commit**

---

## Task 11: Live interop, skipped when absent

**Files:** `internal/harness/acp_live_test.go`

- [ ] **Step 1: Find an installed ACP agent**

```bash
for b in gemini cursor-agent opencode grok; do
  command -v "$b" >/dev/null 2>&1 && echo "found: $b"
done
```

- [ ] **Step 2: Write the gated test**

Skips unless `KARMAX_LIVE_ACP=1` and the binary exists — the same gating as the existing `live_test.go`. One real turn: open, prompt "reply with OK", assert a `KindMessage` arrived and the turn ended.

- [ ] **Step 3: Run it if an agent is installed; record the outcome either way**

If none is installed, say so plainly in the report — an untested transport is a fact worth stating, not a gap to paper over.

- [ ] **Step 4: Commit**

---

## Task 12: Publish

**Stop and ask before this task.** It creates a public repo under the user's account — outward-facing and hard to reverse.

- [ ] **Step 1: Confirm with the user**

Confirm the repo name (`acp-go`), that it should be public, and that they want it published now rather than after KARMAX has used it for a while.

- [ ] **Step 2: Create and push**

```bash
cd ~/Developer/code/acp-go
gh repo create MelloB1989/acp-go --public --source=. --description "Go client for the Agent Client Protocol (ACP)"
git push -u origin main
git tag v0.1.0 && git push origin v0.1.0
```

- [ ] **Step 3: Switch KARMAX off the replace directive**

```bash
cd "$KARMAX"
go mod edit -dropreplace=github.com/MelloB1989/acp-go
go mod edit -require=github.com/MelloB1989/acp-go@v0.1.0
go mod tidy && go build ./... && go test ./...
git add go.mod go.sum && git commit -m "Take acp-go from its published version"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 session interface | 1 |
| §2 generated types, lock, drift test | 2, 3 |
| §3 complete client role, both tables | 5, 6 |
| §4 `session/update` → `Event` | 8 |
| §5 model selection via `session/set_model` | 10 |
| §6 efficiency: one process per session, existing pool | 8, 9 |
| §7 capabilities are the consumer's | 6 (SDK routes), 10 (KARMAX advertises) |
| §8 permissions declined | 8 |
| §9 provider registry by transport | 9 |
| §10 testing: memory transport, conformance, live | 4, 7, 11 |

**Gaps named rather than hidden:**

- **Task 3 is the least specified task**, deliberately. Codegen shape depends on what `schema.json` actually contains, and Step 2 inspects it before the generator is written. If the schema turns out to need a third-party JSON-Schema library, that breaks the no-runtime-dependencies rule only if it leaks into generated code — a dev-only dependency is fine. Report which it was.
- **`SessionUpdate` as a discriminated union** is the one genuinely awkward Go modelling problem here. Whatever shape Task 3 picks, Task 8's mapping tests are the check that it is usable.
- **Task 11 may find no ACP agent installed.** Then the transport ships tested only against a fake. That is a real limitation to state, not a blocker.
- **Stage 2 has no KARMAX dependency and could ship alone.** If Stage 3 stalls, the SDK is still a finished, publishable thing.

**Type consistency:** `session` (KARMAX, unexported) is satisfied by `*Session` and `*acpSession`. `Handler`/`BaseHandler` (SDK) is implemented by KARMAX's handler. `SessionUpdate` variants map to `harness.Event` kinds already defined in `internal/harness/session.go` — no new event vocabulary.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-13-acp-client.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — executed in this session with checkpoints.

**Which approach?**
