# Browser Tasks and Skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a chat session able to drive the browser itself, ship skills that tell a harness how to use KARMAX, and land the Instagram comment-to-DM skill.

**Architecture:** `spawn()` learns two flags — `--mcp-config` (browser) and `--plugin-dir` (skills). The chat and agent hosts fill the first from the running browser; the daemon materialises skills under the profile at startup and fills the second. The Instagram automation is skill content, needing no Go change.

**Tech Stack:** Go 1.26 (KARMAX), Markdown + Node/Python for skill scripts.

**Spec:** `docs/superpowers/specs/2026-09-13-browser-tasks-and-skills-design.md` — read it; this plan points at its sections rather than restating them.

## Global Constraints

- **Never put `Co-Authored-By` or `Claude-Session` lines in commit messages.** Subject and body only.
- **Commit locally. Never `git push`.**
- **Keep comments sparse** — one line where the reason is non-obvious.
- **Repo:** `~/Developer/code/KARMAX`. Branch **off `main`**, not off `acp-session-interface` — the browser fix must be shippable without the unmerged ACP work. Expect a small future conflict in `session.go`/`supervisor.go` when ACP merges; that is accepted.
- `go build ./...`, `go test ./...`, `go vet ./...` clean; `gofmt -l` silent on touched files.
- **The `utility` kind never receives the browser.** A cheap one-shot judgment has no use for one.

## File Structure

| File | Responsibility |
|---|---|
| `internal/harness/supervisor.go` | `Options.MCPConfig`, `Options.PluginDir` |
| `internal/harness/session.go` | `spawn` appends the two flags |
| `internal/runtime/chathost.go` | Chat sessions get the browser |
| `internal/runtime/harnesshost.go` | Agent sessions get the browser; browser start/stop recycles idle sessions |
| `internal/skills/` (new) | Embedded skills, materialised under the profile |
| `internal/skills/assets/` | The shipped skill content |

---

## Task 1: `spawn` learns `--mcp-config` and `--plugin-dir`

Both flags together — they are the same shape and the same function, and splitting them would mean two conflicting edits to one arg list.

**Files:** `internal/harness/supervisor.go`, `internal/harness/session.go`, `internal/harness/session_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestSpawnArgsCarryMCPConfigAndPluginDir(t *testing.T) {
	got := extraArgs(Options{MCPConfig: `{"mcpServers":{}}`, PluginDir: "/tmp/skills"})
	want := []string{"--mcp-config", `{"mcpServers":{}}`, "--plugin-dir", "/tmp/skills"}
	if !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
	if len(extraArgs(Options{})) != 0 {
		t.Error("empty options must add no arguments")
	}
}
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
cd ~/Developer/code/KARMAX && go test ./internal/harness/ -run TestSpawnArgs 2>&1 | head
```

- [ ] **Step 3: Implement**

Add `MCPConfig string` and `PluginDir string` to `Options`, each with a one-line comment saying what it grants. Add `extraArgs(opt Options) []string` returning the flags for whichever are non-empty. Thread the values onto `Session` the way `Model` and `Thinking` already are, and append `extraArgs(...)` in `spawn`.

**Ordering matters.** `claude_code.go:45` records that `--mcp-config` is variadic and must not precede a positional prompt. The harness sends its prompt on stdin via `--input-format stream-json`, so there is no positional prompt to collide with — append at the end and add a test asserting the flags come after `--include-partial-messages`.

- [ ] **Step 4: Run, vet, commit**

```bash
go build ./... && go test ./internal/harness/ && go vet ./internal/harness/ && gofmt -l internal/harness/
git add internal/harness/ && git commit -m "A session can be handed a browser and a skills directory"
```

---

## Task 2: Chat and agent sessions get the browser

**Files:** `internal/runtime/chathost.go`, `internal/runtime/harnesshost.go`, tests alongside

- [ ] **Step 1: Write the failing tests**

```go
func TestChatSessionGetsTheBrowserWhenItIsRunning(t *testing.T) {}
func TestChatSessionGetsNoBrowserWhenItIsNotRunning(t *testing.T) {}
func TestUtilityKindNeverGetsTheBrowser(t *testing.T) {}
```

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement**

In `chatTurn` (`chathost.go:29`) and the agent equivalent, call `rt.browser.MCPConfigJSON(ctx)` and set `Options.MCPConfig` on success. `browser.ErrNotRunning` is the normal case, not an error — leave the field empty and continue. Never set it for the `utility` kind.

- [ ] **Step 4: Run and commit**

---

## Task 3: A browser that starts or stops recycles idle sessions

Spec §1's lifecycle answer. `--mcp-config` is fixed at spawn, so a warm session outlives the browser state that justified it.

**Files:** `internal/runtime/harnesshost.go`, `internal/browser/browser.go`, tests

- [ ] **Step 1: Write the failing tests**

```go
func TestBrowserStartClosesIdleChatSessions(t *testing.T) {}
func TestBrowserStopClosesIdleChatSessions(t *testing.T) {}
func TestABusySessionIsLeftAlone(t *testing.T) {}
func TestUtilitySessionsAreNotRecycled(t *testing.T) {}
```

The busy case matters most: closing a session mid-turn would kill a running answer.

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement**

Give `browser.Session` a way to report start/stop — a callback or a channel, whichever fits its existing shape; read it before choosing. On either event, walk the supervisor's live sessions and `Close()` the idle ones whose kind takes a browser. `Supervisor` already has `Busy()` per session and `Live()`; use them rather than adding state.

- [ ] **Step 4: Run and commit**

---

## Task 4: Skills materialise under the profile

**Files:** `internal/skills/skills.go` (new), `internal/skills/assets/` (new), wiring in `internal/runtime/runtime.go`

- [ ] **Step 1: Write the failing tests**

```go
func TestSkillsMaterialiseOnFirstRun(t *testing.T) {}
func TestAnOperatorEditIsNotOverwritten(t *testing.T) {}
func TestAMissingSkillIsRestored(t *testing.T) {}
```

The second is the one that matters: the spec promises a skill is editable without a rebuild, so a restart must not clobber it.

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement**

`//go:embed assets` a directory of skills. At startup materialise to `<data_dir>/skills/`, writing a file only when it is absent. Record shipped content hashes in `<data_dir>/skills/.shipped.json` so "absent" and "edited" are distinguishable and a future version can report drift without overwriting.

Set `Options.PluginDir` to that directory for chat and agent kinds.

- [ ] **Step 4: Run and commit**

---

## Task 5: The two general skills

Content, not Go. Runs in parallel with Tasks 1–4.

**Files:** `internal/skills/assets/karmax-tools/SKILL.md`, `internal/skills/assets/browser-sessions/SKILL.md`

- [ ] **Step 1: Read what actually exists before writing about it**

```bash
cd ~/Developer/code/KARMAX
grep -rhoE '"[a-z_]+\.[a-z_]+"' internal/tools/builtin/*.go | sort -u | head -60
sed -n '1,30p' internal/browser/browser.go
```

A skill that describes tools KARMAX does not have is worse than no skill. Every tool named must be verified present.

- [ ] **Step 2: Write `karmax-tools/SKILL.md`**

What the daemon is, which tool families exist, which are read-only, and which compose. Include the frontmatter Claude Code skills use (`name`, `description`) — the description is what decides whether the skill gets loaded, so it must name the situations it applies to.

- [ ] **Step 3: Write `browser-sessions/SKILL.md`**

That the browser is shared with the operator, that it is KARMAX's own profile and not their daily Chrome, that being open is the grant, and that closing it revokes. Name the Playwright tools available and the fact that `document.cookie` cannot see httpOnly cookies while `browser_run_code_unsafe` can.

- [ ] **Step 4: Commit**

---

## Task 6: The Instagram comment-to-DM skill

Spec §3 is the procedure; follow it exactly. Runs in parallel with Tasks 1–4.

**Files:** `internal/skills/assets/instagram-dm/SKILL.md`, `internal/skills/assets/instagram-dm/scripts/`

- [ ] **Step 1: Write `SKILL.md`**

The ordered procedure from spec §3: preconditions checked not assumed, harvest cookies to a `0600` file, **discover endpoints from real traffic rather than hardcoding them**, collect commenters fully before sending anything, then send detached.

State plainly in the skill that it reads one post's comments and has no path to an imported list or a follower scrape — spec §"What keeps this a creator tool".

- [ ] **Step 2: Write `scripts/collect_comments.py`**

Paginate the comment endpoint with harvested cookies, dedupe by user id, write `commenters.json`. Takes the endpoint and headers as arguments — it must not embed them, because they are discovered per run.

- [ ] **Step 3: Write `scripts/send_dms.py`**

Progress and control come from the `tasks` row (spec §3b), not a dashboard:
write `progress` after each recipient, re-read `status` **before** each one,
idle on `paused`, stop cleanly on `cancelled`. Take the task id and the DB
path as arguments — the script must not discover them.

- `progress.jsonl`: `attempted` written **before** the request, `sent` **after**.
- On resume, `attempted` without `sent` is **skipped, never retried**.
- Pace with jitter; interval and per-run cap are arguments with conservative defaults.
- Halt on a streak of consecutive failures.
- `--dry-run` does everything except send, and is what the skill runs first.

- [ ] **Step 4: Test the resume property without touching Instagram**

```bash
python3 scripts/send_dms.py --dry-run --progress /tmp/p.jsonl --recipients /tmp/r.json
```

Craft a `progress.jsonl` containing an `attempted` with no `sent`, re-run, and assert that recipient is skipped. This is the one behaviour that must not be wrong; it is testable with no network.

- [ ] **Step 5: Commit**

---

## Task 7: A long run reports progress and can be paused

Spec §3b. The `tasks` table already carries `goal`, `status`, `progress`,
`attempts`, `last_error`, `next_action_at` and is unused; background work
currently reports only `delegation.completed`.

**Files:** `internal/store/task_store.go` (or wherever `tasks` is served —
find it), `internal/tools/builtin/` for the kickoff tool, tests alongside.

- [ ] **Step 1: Find what already reads and writes `tasks`**

```bash
cd ~/Developer/code/KARMAX
grep -rn "FROM tasks\|INTO tasks\|UPDATE tasks" internal/ | grep -v _test
```

The table exists with zero rows. If no store methods exist, this task adds
them; if partial ones do, extend rather than duplicate.

- [ ] **Step 2: Write the failing tests**

```go
func TestProgressRoundTripsOnATaskRow(t *testing.T) {}
func TestStatusPausedIsVisibleToAReader(t *testing.T) {}
func TestCancelledLeavesProgressIntact(t *testing.T) {}
```

The third matters: cancelling must not erase the ledger, or a later resume
loses its record of who was already messaged.

- [ ] **Step 3: Implement**

Store methods to create a task, update `progress`, read `status`, and list
open tasks. `progress` holds a small JSON blob (`{sent, attempted, total,
last_at}`) — a string column, so encode and decode at the boundary.

- [ ] **Step 4: Emit a ticket when a long run starts**

The turn that kicks off a run emits the existing `ticket` event with the task
id, so the desktop shows a live card immediately. Reuse `chatTickets`'
vocabulary rather than adding a second one.

- [ ] **Step 5: Run and commit**

---

## Task 8: Make the ticket event actually fire

Task 7's Step 4 turned out not to be implementable as written. `chatTickets`
(`internal/runtime/chathost.go:128`) has never emitted an event — it matches
KARMAX tool names against a list that only ever holds Claude Code's own, and
it reads `job_id` from a tool's input when that field exists only in the
output. See the 2026-09-13 amendment in spec §3b for the full derivation.

**Files:** `internal/runtime/chathost.go`, `internal/runtime/harnesshost.go`,
tests alongside. Full brief:
`.superpowers/sdd/2026-09-13-browser-tasks-and-skills/task-8-brief.md`.

**Part A — emit the ticket from the stream.** `session.go:274` populates
`Output` on the `tool_update` event, so the tool's real result is available in
`chatTurn`'s existing `OnEvent` closure. Emit there, keyed on **an id in a
tool result** (`task_id`, `job_id`, `run_id`) rather than on a tool name —
name-matching is what broke this the first time, and the three tools that
start background work all arrive under different harness tool names. Parse
defensively: `Output` is truncated before it is seen, so a cut-off JSON object
means "no ticket", never a panic. Dedupe per `e.Tool.ID`. Delete
`chatTickets`; do not leave it beside its replacement.

**Part B — the two deferred Task 2 findings**, separate commits:

- **B1:** `browserMCPConfig` runs a real loopback probe (`alive()`, 1.5s
  timeout) on every turn, but `open()` consumes `MCPConfig` only when it
  spawns — so every warm turn pays for nothing. Cache it and refresh on
  Task 3's `Session.OnStateChange` signal, which now exists.
- **B2:** `TestUtilityKindNeverGetsTheBrowser` would pass against a hardcoded
  denylist of `{"utility"}`, so it does not test the allowlist property it is
  named for. Probe an arbitrary unlisted kind too. Same shape in
  `TestHarnessPluginDirForOtherKinds`.

---

## Task 9: The brain monitor watches the wrong brain

Not from the original plan — found in the live daemon's log while Tasks 6–8
ran. A shipped bug that alarms the operator's phone about an outage that is
not happening.

`brain-monitor` (`internal/runtime/runtime.go:777`) pings `a0.Provider`/
`a0.Model` through `karmahelper` — the metered API path, which has no key on
this install. Every ping 401s, then three fallback models 401 identically:
four dead round trips every ten minutes. Measured in
`~/.karmax-desktop/logs/daemon.log`: **1,561** `401 Unauthorized` lines,
**14** `brain-monitor: DOWN` against **1** `recovered`. Each `DOWN` fires
`PushAppNotification` *and* a WhatsApp send, so all fourteen reached the
operator. Meanwhile the real brain — Claude Code via the harness — was fine.

Point the monitor at `rt.harness.Send` with the cheapest kind (see the tier
table in `docs/CLAUDE-ONLY-ORCHESTRATOR.md`).

**The trap:** an open breaker means the daemon is deliberately pausing on
quota — the system working as designed. Reporting that as "brain is down"
swaps one false alarm for another, firing on exactly the schedule where it is
most likely. `harnesstools.go:95` shows the existing shape for telling them
apart. Keep the edge-triggering so one outage is one alert.

Scoped to the monitor. The general move of background utilities off the
metered API is `2026-09-13-utility-model-tiers-design.md`, not yet built.

Full brief: `.superpowers/sdd/2026-09-13-browser-tasks-and-skills/task-9-brief.md`.

---

## Task 10: The task row needs a read and a write from outside

Found by the Task 7 review. Task 7 landed `SetTaskProgress`/`SetTaskStatus`
on the store and `task.start` to create a row, but nothing exposes progress or
status as a **tool** — so the detached script §3b is entirely about has no
supported way to report in or to learn it has been paused. It was left
choosing between raw SQL into the daemon's own SQLite file and not reporting
at all.

The route is `karmax tool call <name> key=value ...`
(`cmd/karmax/api_cmd.go:294` → `Agent.ExecuteTool`), so the parameters must
work as flat key=value pairs.

- **`task.progress`** writes the counters and **returns the current status**,
  so a paced send makes one call per recipient rather than a write plus a
  poll. The returned status is the control signal.
- **`task.status`** reads, and sets `running`/`paused`/`cancelled`. This is
  the pause button §3b describes as "one `UPDATE`".

Also registers `task.start`, which the Task 7 review found was registered
nowhere and therefore uncallable.

**Known landmine:** `UpdateTask` unconditionally writes `last_error` and
`next_action_at`, so `SetTaskProgress` silently clears both. Inert today,
live the moment a script records a failure and then reports a success.

Full brief: `.superpowers/sdd/2026-09-13-browser-tasks-and-skills/task-10-brief.md`.

---

## Task 11: An unconfigured kind runs on the expensive model

Found while reviewing Task 9. `Supervisor.policy` falls back to
`withDefaults(Policy{})`, which sets a turn timeout and an idle window but
**no model** — and an empty model means no `--model` flag at all
(`session.go:91`), so the kind runs on whatever bare `claude` defaults to.

The live profile configures only `chat`, `agent` and `task`. The code also
asks for `gateway` (`loophost.go:1263`), `summary` (`harnesshost.go:481`) and
`classify` (Task 9's monitor). All three run unpinned.

`gatewayViaHarness`'s own comment says the gateway is "the highest-frequency
call in the system and the one with the least judgement in it", and that
running it on the conversational model "is how an afternoon of group chatter
spends the window." The comment documents an intent the code does not
implement.

Precedent to follow, already in the tree at `harnesshost.go:118`: `CheapModel`
is defaulted in code *because* an empty value turns the degrade into a no-op.
Same bug class, same fix — default in code, not in the operator's yaml, and
reuse that value rather than hardcoding `"haiku"` twice.

Deliberately the minimal slice: the tier ladder belongs to
`2026-09-13-utility-model-tiers-design.md`.

Full brief: `.superpowers/sdd/2026-09-13-browser-tasks-and-skills/task-11-brief.md`.

---

## Task 12: The TOCTOU is fixed in one place out of four

From the Task 8 review. `CloseIfIdle` and `Session.claim()` are correct, but
were wired to `recycleIdleBrowserSessions` only.

- `Reap` (`supervisor.go:435`) ticks **every minute** against **every**
  session, not just browser kinds.
- `evictIfFull` (`supervisor.go:336`) runs inside every `open()` at `MaxLive`
  and picks an **unrelated** LRU victim — one conversation's cold start kills
  another's in-flight turn.

Proven by substituting `Close` for `CloseIfIdle` in the existing race test:
**30/30 iterations killed the turn**, with `-race` reporting a real data race
beneath it — `Session.Close()` never takes `Session.mu`, so its
`bufio.Writer.Flush` races `Send`'s `Write`.

**Fix the writer race at the root first.** Routing callers through
`CloseIfIdle` only *avoids* it by never closing a busy session; the race stays
live on every unconditional path. The constraint that caused the original
design: `Send` holds `Session.mu` for the whole turn, so `Close` cannot simply
take it.

Two further callers — `harness.close` and the set-model tool — are
operator-triggered, where killing a busy session may be correct. That is a
judgement call to make explicitly, not a mechanical migration.

Also: `browserMCPCache.refresh()` has no generation guard, so a probe in
flight when `invalidate()` fires overwrites it and pins the cache to a
pre-transition answer. Every turn until the next unrelated browser toggle then
spawns with the wrong `--mcp-config`, with no self-correction.

The review's sharpest point, worth keeping: a commit titled "closing a real
TOCTOU" while three call sites stand untouched "invites the next person not to
look further."

Full brief: `.superpowers/sdd/2026-09-13-browser-tasks-and-skills/task-12-brief.md`.

---

## Self-Review

**Spec coverage:** §1 → Tasks 1–3. §2 → Tasks 4–5. §3 → Task 6. §3b → Task 7. §4 is the acceptance run, done by hand after. §5 → tests within each task.

**Named gaps:**
- The acceptance run (spec §4) is not a task here: it needs a live Instagram login and a real reel, so it is operator-driven and comes after this plan lands.
- Task 3 depends on `browser.Session`'s existing shape, which the implementer must read before choosing callback vs channel. Deliberately unspecified.
- Branching off `main` while ACP sits unmerged means one future conflict in `session.go`. Accepted, recorded here so it is not a surprise.
