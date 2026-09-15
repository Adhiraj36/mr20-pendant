# The browser the agent can actually reach, and skills that tell it how

Date: 2026-09-13. Status: approved in conversation; implementation follows
this document. KARMAX only.

## Context

The goal is one task working end to end: **"Send a DM link to everyone who
commented on my Instagram reel."** Everything here is scoped to making that
real, and to leaving behind the two pieces it needs — a browser the agent can
reach from a conversation, and a place to put procedures like this one.

### Why browser tasks do not work today

Two places attach the browser, and neither is a conversation:

- `internal/tools/builtin/claude_code.go:58` — the `claude_code.call` delegation
- `internal/setupagent/setupagent.go:110` — the setup agent

The harness `spawn()` in `internal/harness/session.go`, which runs **every chat
and agent session**, passes no `--mcp-config`:

```go
args := []string{"--print", "--input-format", "stream-json",
  "--output-format", "stream-json", "--verbose",
  "--dangerously-skip-permissions", "--include-partial-messages"}
```

So asking Mira to do anything in the browser reaches a session with no browser
tools. It can only delegate to `claude_code.call`, which spawns a separate
process with its own workdir and session — losing the conversation, unable to
ask a follow-up, returning a blob at the end. For a stateful, multi-step task
that is the wrong shape, and it is the whole of "browser tasks don't work
properly."

### What the browser already gets right

`internal/browser` launches a headed Chromium with a profile KARMAX owns and
CDP on loopback. The operator signs into Instagram in that window; Playwright
MCP attaches over the same endpoint and finds the session already there. The
package's own doc calls the boundary out: the profile is never the person's
daily Chrome, so what the agent can reach is exactly what was deliberately
signed into. That design needs no change — only delivery to the right sessions.

### Verified, not assumed

- **The `sessionid` cookie is httpOnly**, so `document.cookie` via
  `browser_evaluate` cannot read it. Two exposed tools can:
  `browser_run_code_unsafe` (runs Playwright code, so
  `page.context().cookies()` works) and
  `browser_network_request(part: "request-headers")` (a captured request's
  real `Cookie:` header). **No new KARMAX tool is needed for this.**

  **Amendment, 2026-09-13, after Task 6.** Half of that is wrong, and the
  wrong half is the one §3 was built on. `browser_run_code_unsafe` can *read*
  the cookies — `page` is in scope — but it **cannot write them to a file**.
  Probed against the pinned `@playwright/mcp@0.0.80`:

  ```
  typeof require            → "undefined"
  typeof process            → "undefined"
  await import('node:fs')   → throws "A dynamic import callback was not specified."
  ```

  It runs in a sandboxed VM context with no Node API at all. So §3's "write
  them to `<workdir>/.ig-session.json`, mode `0600`" has no mechanism, and
  returning the cookies as the tool's result instead would put a full account
  credential straight into the transcript — the precise thing the `0600` rule
  exists to prevent.

  The replacement is better than the original and needs no new tool either.
  `browser_network_request` takes a **`filename`** parameter ("Filename to
  save the result to. If not provided, output is returned as text"), and it is
  in Playwright MCP's *Core automation* group, so it works with the args
  KARMAX already passes — `-y @playwright/mcp@<version> --cdp-endpoint <ep>`,
  no `--caps` flag. The captured `request-headers` therefore go straight to
  disk, never through the model, and they carry the genuine `Cookie:` header
  *plus* `x-csrftoken`, `x-ig-app-id` and `x-asbd-id` as Instagram actually
  sent them. That is this spec's own "discover rather than recall" principle
  applied to the headers as well as the endpoints.

  **On the file mode: solve it with the directory, not the file.** The MCP
  server chooses the mode it writes with and a chmod afterwards leaves a
  window. A `0700` directory makes the file's own bits irrelevant, because
  nothing else can traverse into it.

  **Verified by live execution, not by reading the schema:**

  - **`filename` must be relative.** It is confined to the server's allowed
    roots — the working directory and its `.playwright-mcp` subdirectory — and
    an absolute path outside them is refused outright:
    `File access denied: … is outside allowed roots`. This matters because the
    obvious defensive instinct, "always pass an absolute path so it cannot
    land somewhere unexpected", is precisely the thing that fails. The MCP
    server inherits the harness session's workdir, so a path relative to the
    session workdir is both correct and the only option.
  - A relative path lands in the **working-directory root**, not
    `.playwright-mcp`, despite the result rendering as `./name.txt`.
  - A relative **subdirectory** path is accepted, and a pre-created `0700`
    directory keeps its mode while the file inside is written `0644` —
    confirming both that the file's own bits are not controllable and that the
    directory is what makes that irrelevant.
  - The captured headers are **plain `Name: value` text**, one per line, with
    names **lowercased** (`cookie:`, not `Cookie:`) — so anything doing a
    case-sensitive lookup will silently miss.
  - `part` accepts exactly `request-headers`, `request-body`,
    `response-headers`, `response-body`.

  Two capability boundaries worth recording, since both were checked: the
  network-inspection tools (`browser_network_request`,
  `browser_network_requests`) and `browser_run_code_unsafe` are all Core and
  available today, but everything cookie- and storage-shaped
  (`browser_cookie_list`, `browser_storage_state`, …) sits behind
  `--caps=storage`, which KARMAX does not pass. Reaching for one of those in a
  future skill means changing `internal/browser/mcp.go` first.
- **Skills reach a session via `--plugin-dir`** (`claude --help`: "Load a
  plugin from a directory or .zip"), the same argument list the browser fix
  touches.
- **A turn cannot run for hours.** Configured timeouts are chat 4m, agent 12m,
  task 20m. Seven hundred paced DMs exceed all three by a wide margin, so the
  sending cannot happen inside a turn. §4 is built around that.

| Decision | Choice |
|---|---|
| Browser delivery | `spawn()` passes `--mcp-config` for chat and agent kinds |
| Skills delivery | `spawn()` passes `--plugin-dir` pointing at KARMAX's shipped skills |
| The DM automation | **Skill content, not Go code.** The tools it needs already exist |
| Credential handling | Cookies to a `0600` file in the session workdir, deleted when the run ends |
| Endpoint discovery | Observed from the browser's own traffic, never hardcoded |
| Sending | A detached, resumable script — never inside a turn |
| Progress and control | A `tasks` row: `progress` reports, `status` pauses. Not a new dashboard — see §3b |
| Who it messages | People who commented on the operator's **own** content. Never a scraped or imported list |

### What keeps this a creator tool

Comment-to-DM is a category other services charge a monthly fee for. Offering
it free is the point. It is also the category most easily turned into a spam
tool, and the line between the two is mechanical rather than a matter of
intent — so the mechanics are the specification:

- **The recipients opted in by acting.** They commented on the operator's own
  reel. This skill reads one post's comments; it has no path to an imported
  list, a follower scrape, or a hashtag search, and adding one would be a
  different product.
- **One message per person, ever.** The dedupe in §3 and the
  `attempted`/`sent` ledger are what enforce it. They are usually described as
  crash-safety, and they are, but repeat-messaging is the thing that actually
  turns a creator tool into spam.
- **Capped, and dry-run first.** A run states its size before it sends
  anything, and the operator sees the plan.
- **It is the operator's own account and audience**, through a browser they
  signed into themselves.

Those four are not anti-ban hygiene that happens to look ethical. They are the
difference, and they are testable, which is why §5 tests them.

## 1. Deliver the browser to conversations

`harness.Options` gains `MCPConfig string`. When non-empty, `spawn` appends
`--mcp-config <value>`.

`chathost.go` and the agent host fill it from `browser.Session.MCPConfigJSON`,
so chat and agent sessions get the browser exactly as `claude_code.call`
already does. The `utility` kind (see the categories spec) does **not** — a
cheap one-shot judgment has no use for a browser and should not hold one.

**The lifecycle problem, and the answer.** `--mcp-config` is fixed at spawn,
but harness sessions are long-lived and warm, while the existing grant model
is *"the browser being open IS the grant."* That held when every attachment
was a fresh one-shot process. It does not hold for a session that outlives the
browser's state.

So: **when the browser starts or stops, close idle sessions of the affected
kinds.** They respawn on the next turn with correct flags, and a busy session
is left alone to finish. This costs a cold start on a state change that
happens rarely, and it keeps the grant honest — a session spawned while the
browser was closed never holds a config pointing at a dead endpoint, and
opening the browser does not require the operator to wonder why nothing
changed.

## 2. A skills package

KARMAX ships a plugin directory of skills and passes `--plugin-dir` on every
harness spawn. Skills are procedures the harness loads when relevant; they
instruct, they do not execute.

Layout, shipped inside the binary's resources and materialised under the
profile at startup so a skill is editable by the operator without a rebuild:

```
<data_dir>/skills/
  karmax-tools/SKILL.md        what KARMAX's own tools are and when to reach for them
  browser-sessions/SKILL.md    how the shared browser works, and what it means that it is shared
  instagram-dm/SKILL.md        §3
  instagram-dm/scripts/        reference scripts the skill points at
```

`karmax-tools` matters beyond this task: the harness currently learns KARMAX's
91 built-in tools from tool descriptions alone. A skill can say what the
daemon *is*, which tools compose, and which are read-only — context a
one-line description cannot carry.

## 3. The Instagram DM skill

A playbook, in the order it must happen.

**Preconditions, checked and not assumed.** The browser is running and
Instagram is logged in. If either is false, say so and stop — do not attempt a
sign-in on the operator's behalf.

**Harvest the session.** `browser_run_code_unsafe` with
`page.context().cookies()`, filtered to `instagram.com`. Write
`sessionid`, `csrftoken`, `ds_user_id`, `mid` and `ig_did` to
`<workdir>/.ig-session.json`, mode `0600`. This file is a full account
credential: it is written inside the session workdir, never logged, never
echoed into the transcript, and deleted when the run finishes or aborts.

**Discover the endpoints rather than recall them.** Navigate to the reel, open
its comments, then read the actual traffic with `browser_network_requests`
followed by `browser_network_request(part: "request-headers")`. Take the
comment endpoint, the DM endpoint, and every header Instagram actually sent —
`x-csrftoken`, `x-ig-app-id`, `x-asbd-id` and friends. **Hardcoding these from
memory is how this breaks silently three weeks later**; they are internal
endpoints and they move. Record what was observed into the run directory so a
later run can diff against it.

**Collect the commenters.** A script, not scrolling: paginate the comment
endpoint with the harvested cookies until exhausted, dedupe by user id, and
write `commenters.json`. Seven hundred comments is a handful of paged requests
and seconds of work — this half is fast and safe, and it is worth completing
fully before a single DM is sent, so the run knows its own size.

**Send, detached and resumable.** The script:

- writes `progress.jsonl`, one record per recipient, **`attempted` before the
  request and `sent` after it.** On resume, an `attempted` with no `sent` is
  skipped, not retried — missing one DM is a smaller failure than sending two.
- paces with jitter between sends, with the interval and the per-run cap as
  parameters rather than constants, defaulting conservative.
- halts on a streak of consecutive failures rather than grinding through them.
  A run of errors is the signal to stop and look, not to try harder.
- supports `--dry-run`, which does everything except the send and is the
  default for the first invocation.

It runs **detached** — `claude_code.call` with `background: true`, or a plain
detached process — because the timeouts in §Context make a turn-bound run
impossible. The turn that starts it returns a job id and the count; completion
arrives as an event.

## 3b. A long run is a task row, watched and controllable

A paced send is hours long. It needs somewhere to report progress and a way
to be paused — and almost all of that already exists unused.

**What is already there.** The `tasks` table carries `goal`, `status`,
`progress`, `attempts`, `last_error` and `next_action_at`, with an index on
`(status, next_action_at)`. It currently holds zero rows. `ReceiptCard`
already renders a card with a live status for `ticket | loop | dashboard`, and
the chat already emits a `ticket` event when a turn starts background work.

**What is missing.** Background work reports **completion only** —
`delegation.completed` — and there is no control channel to pause it.

**So:**

- The run **registers a `tasks` row** at kickoff: `goal` is the operator's
  request, `status` is `running`, `progress` carries a small JSON blob
  (`{sent, attempted, total, last_at}`).
- The send script **writes `progress` after each recipient** and re-reads
  `status` **before** each one.
- `status` is the control channel. `paused` makes the script idle without
  exiting; `cancelled` makes it stop cleanly, leaving its ledger intact so a
  later resume is still safe. Nothing else needs inventing: pausing is one
  `UPDATE`.
- The turn that starts the run emits a `ticket` event, so it shows up in the
  desktop as a live card immediately.

**Amendment, 2026-09-13, after Task 7.** That last bullet said "the chat
already emits a `ticket` event when a turn starts background work." It does
not, and never has. `chatTickets` (`internal/runtime/chathost.go:128`) is dead
code twice over, found while wiring Task 7's Step 4:

- It matches the tool names `claude_code.call` and `codex.call`, but
  `turn.ToolCalls` is populated only at `internal/harness/session.go:302`,
  from the harness's own `tool_use` blocks — so the names there are Claude
  Code's (`Bash`, `Read`, `mcp__playwright__*`). KARMAX's builtin tools are
  never exposed to the harness over MCP; the only `mcpServers` producer in the
  tree is `internal/browser/mcp.go:30`, and it serves Playwright. A harness
  reaches a KARMAX tool by shelling out to the CLI onto `Agent.ExecuteTool`,
  which the harness records as a `Bash` call.
- It reads `job_id` from the tool's **input**, but `job_id` is only ever an
  output field (`internal/tools/builtin/claude_code.go:217`). The function's
  own comment says the id "is in the tool's RESULT" and then reads `Input`
  anyway. Even with matching names the field would be `""`.

The fix is not to repair the matcher. The *streaming* path already carries
what the settled-turn path lacks — `session.go:274` sets `Output` on the
`tool_update` event — so the ticket is emitted from `chatTurn`'s `OnEvent`
closure, keyed on **an id appearing in a tool result** rather than on a tool
name. Name-matching is what broke this the first time, and `task.start`,
`claude_code.call --background` and `sandbox.start` all reach the stream under
different harness tool names while all returning an id. `chatTickets` is
deleted rather than left beside its replacement.

This also corrects a claim in §3b's "What is already there": the chat's
ticket event was listed as existing infrastructure. It was infrastructure that
compiled, not infrastructure that ran.

One consequence is worth stating plainly. The desktop's Tickets route reads
LYZN cloud `/daemons/history`, **not** KARMAX's local `tasks` table, so a task
row still has no desktop surface of its own beyond the live chat card. That is
the same seam §3b already leaves for dashboards, and it is not widened here.

**Why not a custom dashboard.** The operator asked for one, and it is the
right long-term answer — but the feature does not exist: `Dashboard.tsx` is a
single fixed screen and nothing in KARMAX creates dashboards. It is roadmap
item 7, whose own spec says the open question is *what a dashboard is* and
that it should be answered before anything is built. Building it here would
turn "ship the browser fix" into a subsystem.

The seam is left deliberately: a dashboard, when it exists, is a view over
these same `tasks` rows. Nothing here has to change for it to arrive, and the
run is already observable and controllable without it.

## 4. What this task proves

The target task is the acceptance test, run in this order:

1. Ask Mira, in a conversation, to do it. She must reach the browser herself —
   no delegation — which is §1 working.
2. She loads the skill without being told the procedure, which is §2 working.
3. `--dry-run` produces a commenter list and a plan, and sends nothing.
4. A capped live run (ten recipients) sends, records progress, and survives
   being killed and resumed without double-sending. That last property is the
   one worth testing deliberately: kill it mid-run and restart it.

## 5. Testing

- `spawn` appends `--mcp-config` when `Options.MCPConfig` is set and omits it
  when empty, asserted on the argument list.
- Chat and agent sessions receive it; `utility` does not.
- Browser start/stop closes idle sessions of affected kinds and leaves busy
  ones alone.
- Skills materialise under the profile at startup, and an operator's edit
  survives a restart rather than being overwritten.
- The resume property, as a unit test over `progress.jsonl`: a file containing
  `attempted` without `sent` yields a skip.
- The live acceptance run in §4, recorded.

## 6. Out of scope

**`goinsta` for sending.** The connector stays read-only. This path uses the
operator's own browser session rather than a re-login, which is a different
mechanism, and the existing comment stays true of the old one.

**Sign-in on the operator's behalf.** The skill checks and stops.

**Generalising to other platforms.** The shape here — harvest, observe,
collect, pace — is reusable, but writing a second one before the first has run
would be guessing at what generalises.
