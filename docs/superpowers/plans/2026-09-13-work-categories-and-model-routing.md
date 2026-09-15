# Work Categories and Model Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give KARMAX a named work-category vocabulary, map each category to a model per harness in config, and route the two live background loops through it so they stop needing a metered API key.

**Architecture:** Five categories live in `internal/harness`. Each provider maps them to models under `harness.providers.<name>` in `karmax.yaml`, keyed by `transport` so an ACP provider drops in later without a schema change. A new `internal/utilitymodel` package resolves a category to a spawn — `stream_json` via the existing Supervisor, `exec` via the one-shot codex pattern, `ErrUnavailable` when none answer. `review.go` and `memmerge/merge.go` call it and skip their tick when it returns that.

**Tech Stack:** Go 1.23, KARMAX only. No monorepo or desktop change.

**Spec:** `docs/superpowers/specs/2026-09-13-utility-model-tiers-design.md`

## Global Constraints

- **Repo:** `/private/tmp/claude-501/-Users-0mellob-Developer-code-mr20-pendant/ccbf241b-56d9-4493-b05e-3b302a9e4a90/scratchpad/KARMAX/KARMAX`, branch off `main` (`9df6dbb`). This checkout was re-cloned today; `origin` uses `gh`'s credential helper, no embedded token.
- **Keep comments sparse.** The user asked for this explicitly and it overrides the usual house density. One line only where the reason is genuinely non-obvious. Reviewers: do not ask for more.
- **Commit locally. Never `git push`.**
- Category names, verbatim: `low_one_shot`, `medium_one_shot`, `high_one_shot`, `high_multi_step`, `flagship`.
- Claude's mapping, verbatim: haiku, haiku, sonnet, opus+sonnet subagents, fable+opus subagents. `fable` is a confirmed `--model` alias (`claude --help`).
- Codex's mapping ships with **every model empty**. No `--model` flag is passed when empty — identical to `codex.go` today.
- `chat`/`agent`/`task` kinds keep their literal `model:` strings. Untouched.
- `go build ./...`, `go test ./...`, `go vet ./...` clean; `gofmt -l` silent on touched files.

## File Structure

| File | Responsibility |
|---|---|
| `internal/harness/category.go` (new) | The `Category` enum. |
| `internal/harness/supervisor.go` (modify) | `Options.Agents`, `AgentOverride`. |
| `internal/harness/session.go` (modify) | `spawn` emits `--agents`. |
| `internal/config/types.go` (modify) | `HarnessCategoryConfig`, `HarnessProviderConfig`, `HarnessConfig.Providers`, `LoopConfig.Category`. |
| `internal/utilitymodel/model.go` (new) | `Model`, `Complete`, Claude + Codex impls, `ErrUnavailable`, `DefaultCategory`, built-in defaults. |
| `internal/utilitymodel/model_test.go` (new) | The package's tests. |
| `internal/review/review.go` (modify) | Use `Model`; drop `Ask`/`Provider`/`Model`/`Fallbacks`. |
| `internal/memmerge/merge.go` (modify) | Same. |
| `internal/runtime/runtime.go` (modify) | Build one `Model` per namespace; pass to both. |
| `internal/runtime/harnesshost.go` (modify) | Delete `harnessAnswer`. |
| `internal/agent/agent.go` (modify) | `runHarnessLoop` resolves a category to a model. |

---

## Task 1: Probe whether `--agents` can set a sub-agent's model

Everything in categories 4 and 5 rests on this. `claude --help` documents `--agents <json>` with an example showing only `description` and `prompt` — never `model`. Prove it before building on it.

**Files:** none — this task produces a finding and a fixture.

- [ ] **Step 1: Run the probe**

```bash
cd /tmp && mkdir -p agentprobe && cd agentprobe
claude --print --output-format stream-json --verbose \
  --dangerously-skip-permissions \
  --model opus \
  --agents '{"general-purpose":{"model":"haiku","description":"probe","prompt":"You are a probe."}}' \
  'Use the Task tool to ask a general-purpose subagent to reply with exactly the word PROBE. Then tell me what it said.' \
  > /tmp/agentprobe/with-model.jsonl 2>&1
echo "exit=$?"
```

- [ ] **Step 2: Read what model the sub-agent actually ran on**

```bash
grep -o '"model":"[^"]*"' /tmp/agentprobe/with-model.jsonl | sort | uniq -c
```

Expected if it works: both `opus` (the top-level session) and `haiku` (the sub-agent) appear.

- [ ] **Step 3: Re-run without the `model` key, as a control**

```bash
cd /tmp/agentprobe
claude --print --output-format stream-json --verbose \
  --dangerously-skip-permissions --model opus \
  --agents '{"general-purpose":{"description":"probe","prompt":"You are a probe."}}' \
  'Use the Task tool to ask a general-purpose subagent to reply with exactly the word PROBE. Then tell me what it said.' \
  > /tmp/agentprobe/without-model.jsonl 2>&1
grep -o '"model":"[^"]*"' /tmp/agentprobe/without-model.jsonl | sort | uniq -c
```

If the two runs differ, the `model` key works. If identical, it does not.

- [ ] **Step 4: Record the finding**

Write `docs/superpowers/specs/2026-09-13-utility-model-tiers-design.md` §5's outcome into the spec file as a short "Probe result:" line, and copy the working capture to `internal/harness/testdata/agents-model.jsonl` if it worked.

**If it did not work:** stop and report. Task 3 then ships `Options.Agents` unbuilt, categories 4 and 5 keep only their top-level `model`, and the spec records `SubagentModel` as configured-but-inert. Do not invent a second mechanism.

- [ ] **Step 5: Commit the fixture and spec note**

```bash
git add docs/superpowers/specs/2026-09-13-utility-model-tiers-design.md internal/harness/testdata/ 2>/dev/null
git commit -m "Probe: whether --agents can set a subagent's model"
```

---

## Task 2: The category enum and its config

**Files:**
- Create: `internal/harness/category.go`
- Modify: `internal/config/types.go`
- Test: `internal/harness/category_test.go`

**Interfaces produced:**
- `harness.Category` + the five constants
- `config.HarnessCategoryConfig{Model, SubagentModel}`
- `config.HarnessProviderConfig{Transport, Binary, Categories}`; `config.HarnessConfig.Providers`
- `config.LoopConfig.Category string`

- [ ] **Step 1: Write the failing test**

`internal/harness/category_test.go`:

```go
package harness

import "testing"

func TestCategoryValuesAreTheAgreedStrings(t *testing.T) {
	want := map[Category]string{
		LowOneShot:    "low_one_shot",
		MediumOneShot: "medium_one_shot",
		HighOneShot:   "high_one_shot",
		HighMultiStep: "high_multi_step",
		Flagship:      "flagship",
	}
	for c, s := range want {
		if string(c) != s {
			t.Errorf("%v = %q, want %q", c, string(c), s)
		}
	}
}

func TestKnownCategoriesListsAllFive(t *testing.T) {
	if got := len(KnownCategories()); got != 5 {
		t.Fatalf("got %d categories, want 5", got)
	}
}
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
go test ./internal/harness/ -run TestCategory 2>&1 | head
```

Expected: `undefined: LowOneShot`.

- [ ] **Step 3: Write `internal/harness/category.go`**

```go
package harness

// Category names what kind of work a call is, independent of which harness
// or model runs it.
type Category string

const (
	LowOneShot    Category = "low_one_shot"
	MediumOneShot Category = "medium_one_shot"
	HighOneShot   Category = "high_one_shot"
	HighMultiStep Category = "high_multi_step"
	Flagship      Category = "flagship"
)

func KnownCategories() []Category {
	return []Category{LowOneShot, MediumOneShot, HighOneShot, HighMultiStep, Flagship}
}
```

- [ ] **Step 4: Extend `internal/config/types.go`**

Provider-keyed, so ACP providers drop in later without a second schema. Add:

```go
// HarnessCategoryConfig is one provider's answer to one Category. An empty
// Model means no override is configured yet, not a misconfiguration.
type HarnessCategoryConfig struct {
	Model         string `yaml:"model"`
	SubagentModel string `yaml:"subagent_model,omitempty"`
}

// HarnessProviderConfig is one harness KARMAX can route work to. Transport
// picks the mechanism: stream_json (the Supervisor), exec (one-shot, as
// codex.go), or acp once that exists. An unimplemented transport is skipped,
// not an error.
type HarnessProviderConfig struct {
	Transport  string                           `yaml:"transport"`
	Binary     string                           `yaml:"binary"`
	Categories map[string]HarnessCategoryConfig `yaml:"categories"`
}
```

Add `Providers map[string]HarnessProviderConfig \`yaml:"providers"\`` to `HarnessConfig`.

Add `Category string \`yaml:"category"\`` to `LoopConfig`, with a one-liner noting it is read only when `Harness` is set.

No `utility:` block — Codex is a provider entry like any other.

- [ ] **Step 5: Run tests and commit**

```bash
go build ./... && go test ./internal/harness/ ./internal/config/ && gofmt -l internal/harness internal/config
git add internal/harness/category.go internal/harness/category_test.go internal/config/types.go
git commit -m "Name the five work categories and let each harness map them"
```

---

## Task 3: `Options.Agents` and the `--agents` flag

**Gated on Task 1.** If the probe failed, skip this task entirely and say so in the report.

**Files:**
- Modify: `internal/harness/supervisor.go` (`Options`)
- Modify: `internal/harness/session.go` (`spawn`)
- Test: `internal/harness/session_test.go` or extend `sink_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestSpawnArgsCarryAgentsJSON(t *testing.T) {
	got := agentsArg(map[string]AgentOverride{"general-purpose": {Model: "haiku"}})
	want := `{"general-purpose":{"model":"haiku"}}`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if agentsArg(nil) != "" {
		t.Error("nil map must produce no argument")
	}
}
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
go test ./internal/harness/ -run TestSpawnArgs 2>&1 | head
```

- [ ] **Step 3: Implement**

In `supervisor.go`, beside the other `Options` fields:

```go
// AgentOverride sets fields of a named agent definition for --agents.
type AgentOverride struct {
	Model string `json:"model"`
}
```

Add `Agents map[string]AgentOverride` to `Options`.

In `session.go`, add a helper and call it in `spawn`:

```go
func agentsArg(a map[string]AgentOverride) string {
	if len(a) == 0 {
		return ""
	}
	b, err := json.Marshal(a)
	if err != nil {
		return ""
	}
	return string(b)
}
```

`spawn` needs the value threaded in — it currently takes `(ctx, bin, s, workdir, resume, env, fallbackModel)`. Add an `agents string` parameter, and append `--agents <agents>` when non-empty. Update `Session` to carry it from `Options` the same way `Model` and `Thinking` already are, and update the one call site at `supervisor.go:299`.

- [ ] **Step 4: Run and commit**

```bash
go build ./... && go test ./internal/harness/ && gofmt -l internal/harness
git add internal/harness/
git commit -m "A session can name the model its subagents run on"
```

---

## Task 4: `internal/utilitymodel`

The core of the change.

**Files:**
- Create: `internal/utilitymodel/model.go`, `internal/utilitymodel/model_test.go`

**Interfaces consumed:** `harness.Category` (Task 2), `harness.Options.Agents` (Task 3, if built), `config.HarnessConfig` (incl. `Providers`).

**Interfaces produced:**
- `Model` interface with `Complete(ctx, category, systemPrompt, userPrompt) (string, error)`
- `ErrUnavailable`
- `KeyStrategy` (`FreshPerCall`, `StableKey`)
- `New(sup *harness.Supervisor, hcfg config.HarnessConfig, keyBase string, strategy KeyStrategy) Model` — reads providers from `hcfg.Providers`, trying them in order: `stream_json` first, then `exec`, skipping unimplemented transports
- `DefaultCategory(delegates bool) harness.Category`
- `DefaultCategories() map[string]config.HarnessCategoryConfig`

- [ ] **Step 1: Write the failing tests**

```go
package utilitymodel

import (
	"testing"

	"github.com/MelloB1989/karmax/internal/config"
	"github.com/MelloB1989/karmax/internal/harness"
)

func TestDefaultCategoryNeverGuessesUpward(t *testing.T) {
	if got := DefaultCategory(false); got != harness.LowOneShot {
		t.Errorf("one-shot default = %q, want low_one_shot", got)
	}
	if got := DefaultCategory(true); got != harness.HighMultiStep {
		t.Errorf("delegating default = %q, want high_multi_step", got)
	}
	if DefaultCategory(true) == harness.Flagship || DefaultCategory(false) == harness.Flagship {
		t.Error("flagship must never be a default")
	}
}

func TestDefaultCategoriesMatchTheAgreedTable(t *testing.T) {
	d := DefaultCategories()
	cases := []struct{ cat, model, sub string }{
		{"low_one_shot", "haiku", ""},
		{"medium_one_shot", "haiku", ""},
		{"high_one_shot", "sonnet", ""},
		{"high_multi_step", "opus", "sonnet"},
		{"flagship", "fable", "opus"},
	}
	for _, c := range cases {
		got, ok := d[c.cat]
		if !ok {
			t.Fatalf("%s missing", c.cat)
		}
		if got.Model != c.model || got.SubagentModel != c.sub {
			t.Errorf("%s = %+v, want %s/%s", c.cat, got, c.model, c.sub)
		}
	}
}

func TestEmptyConfigFallsBackToBuiltInDefaults(t *testing.T) {
	m := newClaude(nil, config.HarnessConfig{}, "k", StableKey)
	if got := m.categories["low_one_shot"].Model; got != "haiku" {
		t.Errorf("got %q, want the built-in haiku", got)
	}
}

func TestConfiguredCategoryOverridesPerEntryNotWholesale(t *testing.T) {
	cfg := config.HarnessConfig{Categories: map[string]config.HarnessCategoryConfig{
		"high_one_shot": {Model: "opus"},
	}}
	m := newClaude(nil, cfg, "k", StableKey)
	if got := m.categories["high_one_shot"].Model; got != "opus" {
		t.Errorf("configured entry = %q, want opus", got)
	}
	if got := m.categories["low_one_shot"].Model; got != "haiku" {
		t.Errorf("unconfigured entry = %q, want the built-in haiku", got)
	}
}

func TestFreshPerCallNeverRepeatsAKey(t *testing.T) {
	m := newClaude(nil, config.HarnessConfig{}, "utility:merge", FreshPerCall)
	if m.sessionKey() == m.sessionKey() {
		t.Error("FreshPerCall returned the same key twice")
	}
}

func TestStableKeyAlwaysReturnsTheSameKey(t *testing.T) {
	m := newClaude(nil, config.HarnessConfig{}, "utility:review:ns", StableKey)
	if m.sessionKey() != m.sessionKey() {
		t.Error("StableKey returned different keys")
	}
}

func TestUnmappedCategoryIsUnavailableNotAnEmptyModel(t *testing.T) {
	cfg := config.HarnessProviderConfig{Transport: "exec", Binary: "codex",
		Categories: map[string]config.HarnessCategoryConfig{"low_one_shot": {Model: ""}}}
	if _, err := newExec(cfg).Complete(nil, harness.LowOneShot, "s", "u"); err != ErrUnavailable {
		t.Errorf("got %v, want ErrUnavailable", err)
	}
}
```

- [ ] **Step 2: Run, confirm they fail**

```bash
go test ./internal/utilitymodel/ 2>&1 | head
```

- [ ] **Step 3: Implement `model.go`**

Structure, comments sparse:

```go
// Package utilitymodel answers one system-prompt-plus-user-prompt question
// through whichever coding harness is available, so background work never
// needs a metered API key.
package utilitymodel
```

- `ErrUnavailable = errors.New("no harness available for this utility call")`
- `DefaultCategories()` returns the agreed table.
- `DefaultCategory(delegates bool)` returns `HighMultiStep` or `LowOneShot`. Never `Flagship`.
- `newClaude(sup, hcfg, keyBase, strategy)` merges `DefaultCategories()` with `hcfg.Categories` **per entry** (configured wins for that key only).
- `sessionKey()` returns `keyBase` under `StableKey`, `keyBase + ":" + uuid.New().String()` under `FreshPerCall`.
- `claudeModel.Complete` looks up the category; empty `Model` → `ErrUnavailable`; builds `harness.Options{Instructions: systemPrompt, Workdir: scratch, Model: cat.Model}`, sets `Agents` when `SubagentModel != ""` **and Task 3 shipped**; calls `sup.SendWith(ctx, key, "utility", userPrompt, opt)`; returns `turn.Text`.
- `newCodex(cfg)` / `codexModel.Complete` mirrors `codex.go`: `exec.CommandContext(ctx, binary, "--quiet", systemPrompt+"\n\n"+userPrompt)`, appending `--model` only when the category's model is non-empty. Empty model → `ErrUnavailable` (do not shell out with no mapping).
- `New(...)` returns a `chain` that tries Claude then Codex, returning `ErrUnavailable` only when both decline. Any error from Claude moves to Codex.
- Scratch workdir: `filepath.Join(hcfg.WorkdirRoot, "utility", sanitized(keyBase))`, created with `os.MkdirAll`.

- [ ] **Step 4: Run and commit**

```bash
go build ./... && go test ./internal/utilitymodel/ -v 2>&1 | tail -20
gofmt -l internal/utilitymodel
git add internal/utilitymodel/
git commit -m "Route a category to whichever harness can answer it"
```

---

## Task 5: Wire review and memmerge, delete the old path

**Files:**
- Modify: `internal/review/review.go`, `internal/memmerge/merge.go`
- Modify: `internal/runtime/runtime.go` (~lines 700–760)
- Modify: `internal/runtime/harnesshost.go` (delete `harnessAnswer`, lines 364–373)

**Note the behaviour change to state in your report:** `memmerge` currently sets `MaxTokens: 8000` on its karmahelper session, with a comment recording that 3000 truncated the JSON mid-structure and wasted whole passes. `harness.Options` has no output-token control, so that explicit guarantee is gone. The existing `extractJSONObject` + unparseable-output path already degrades safely (warns, returns 0, skips the pass), so this is a known, bounded regression — not a silent one. Say so.

- [ ] **Step 1: Change both Configs**

In `review.Config`: delete `Provider`, `Model`, `Fallbacks`, `Ask`. Add:

```go
Model    utilitymodel.Model
Category harness.Category
```

Same in `memmerge.Config`.

- [ ] **Step 2: Replace the call site in `review.go`**

Replace the `Ask`-then-`karmahelper` block (around lines 122–137) with:

```go
resp, err := r.cfg.Model.Complete(ctx, r.cfg.Category, judgePrompt, question)
if errors.Is(err, utilitymodel.ErrUnavailable) {
	r.log.Info("review: no harness available, skipping tick")
	return nil
}
if err != nil {
	return fmt.Errorf("review judge: %w", err)
}
```

Delete the now-unused `karmahelper` import.

- [ ] **Step 3: Replace the call site in `merge.go`**

Replace the `sess := karmahelper.NewSession(...)` block and the `Ask`-then-`Chat` block (around lines 157–183) with:

```go
resp, err := mg.cfg.Model.Complete(ctx, mg.cfg.Category, mergePrompt, question)
if errors.Is(err, utilitymodel.ErrUnavailable) {
	mg.log.Info("memory-merge: no harness available, skipping tick")
	return 0, nil
}
if err != nil {
	return 0, fmt.Errorf("merge model: %w", err)
}
```

- [ ] **Step 4: Rewire `runtime.go`**

Build one `Model` per loop, replacing the `Ask:` closures:

```go
reviewModel := utilitymodel.New(harnessRT.get().harness, rt.cfg.Harness,
	"utility:review:"+ns, utilitymodel.StableKey)
mergeModel := utilitymodel.New(harnessRT.get().harness, rt.cfg.Harness,
	"utility:merge", utilitymodel.FreshPerCall)
```

Pass `Model: reviewModel, Category: harness.MediumOneShot` to `review.New`, and `Model: mergeModel, Category: harness.HighOneShot` to `memmerge.New`. Drop the `fbs`/`provider`/`model` plumbing that fed only these two.

`harnessRT.get().harness` is late-bound today via the `Ask` closure; keep that laziness — if `utilitymodel.New` needs the supervisor before the runtime exists, pass a getter func rather than the pointer.

- [ ] **Step 5: Delete `harnessAnswer`**

Remove `internal/runtime/harnesshost.go:364-373` and any now-unused imports.

- [ ] **Step 6: Run everything and commit**

```bash
go build ./... && go test ./... 2>&1 | grep -E "^(FAIL|ok.*(review|memmerge|runtime))" 
go vet ./... && gofmt -l internal/
git add internal/review internal/memmerge internal/runtime
git commit -m "Memory review and merge ask a harness, and skip when there is none"
```

---

## Task 6: Declarative loops carry a category

`LoopConfig.Harness` flows `runtime.go:1209` → the job payload → `agent.go:1784 runHarnessLoop`, which dispatches to the `claude_code.call` / `codex.call` tools. Category rides the same path.

**Files:**
- Modify: `internal/runtime/runtime.go` (~1205–1212)
- Modify: `internal/agent/agent.go` (`runHarnessLoop`, ~1776–1815)
- Modify: `internal/tools/builtin/claude_code.go`, `internal/tools/builtin/codex.go`
- Test: `internal/agent/agent_test.go` or a new focused test

- [ ] **Step 1: Write the failing test**

Test that `runHarnessLoop` resolves a declared category to the configured model, and an absent one to `DefaultCategory(false)` → `low_one_shot` → `haiku`:

```go
func TestHarnessLoopResolvesCategoryToModel(t *testing.T) {
	if got := modelForLoopCategory("high_one_shot", defaultCats()); got != "sonnet" {
		t.Errorf("declared: got %q, want sonnet", got)
	}
	if got := modelForLoopCategory("", defaultCats()); got != "haiku" {
		t.Errorf("absent: got %q, want haiku (the cheapest, not a guess upward)", got)
	}
}
```

- [ ] **Step 2: Run it, confirm it fails**

- [ ] **Step 3: Carry the category through**

`runtime.go`: beside `payload["harness"] = loop.Harness`, add `payload["category"] = loop.Category` when non-empty. Add `"category"` to the reserved-key skip list three lines below.

`agent.go` `runHarnessLoop`: read `inner["category"]`, resolve via the config's categories (falling back to `utilitymodel.DefaultCategory(false)` — these tools are one-shot, no delegation), and pass the resolved model into the tool input:

```go
res, err := tool.Execute(ctx, map[string]any{"prompt": prompt, "model": model})
```

- [ ] **Step 4: Teach both tools an optional `model`**

`claude_code.go`: read `input["model"]`; when non-empty append `--model <v>` to its args. Add `model` to the manifest's parameter schema.

`codex.go`: same, and because Codex's configured models are empty by default, the flag stays absent exactly as today. Add `model` to its schema too.

- [ ] **Step 5: Run and commit**

```bash
go build ./... && go test ./internal/agent/ ./internal/tools/... && gofmt -l internal/
git add internal/runtime internal/agent internal/tools
git commit -m "A declarative loop can say what kind of work it is"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 category enum | 2 |
| §2 per-harness mapping, Codex empty, in-memory defaults | 2, 4 |
| §3 loop declares; `DefaultCategory` never guesses upward | 4 (function), 6 (loop path) |
| §4 `Complete` + `Options.Agents` | 3, 4 |
| §5 the `--agents` probe | 1 |
| §6 testing | 2, 4, 6 |
| §0 root cause (missing `summary` kind) | 5 — the path is deleted outright |

**Gaps I am naming rather than hiding:**

- `kinds.utility` policy (idle/max_turns/turn_timeout) is never added to config in any task. `Supervisor.policy("utility")` therefore falls to `withDefaults(Policy{})` — 2min timeout, 10min idle. That is survivable (unlike `"summary"`, the model now comes from `Options.Model`, so the missing kind costs only policy tuning, not correctness). **Task 2 should add a `utility` entry to the built-in default config if one is easy to thread; if not, record it as accepted.**
- Task 6's `modelForLoopCategory` helper is named in the test before it is specified in Step 3. The implementer should place it wherever it reads best in `internal/agent` and keep the signature the test uses.
- Nothing migrates `chat`/`agent`/`task`. Deliberate.

**Type consistency:** `harness.Category` is the type everywhere — `config` stores category keys as plain `map[string]` (YAML keys are strings), and `utilitymodel` converts with `string(cat)` at the lookup. `Model`/`SubagentModel` field names match across `config`, `utilitymodel`, and the YAML.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-13-work-categories-and-model-routing.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
