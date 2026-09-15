# Work gets a category before it gets a model

Date: 2026-09-13. Status: approved in conversation; implementation follows
this document. KARMAX only — no monorepo/desktop change. **Revises this
file's own earlier design** — the ordered `cheap/standard/capable` tier list
in the first version is replaced below by a named work-category system; see
§7 for exactly what changed and why.

## Context

The original question was narrow: why does memory maintenance need a metered
API key when the whole point of KARMAX is that a coding harness does the
thinking. §0 below is unchanged from the first pass — two loops
(`memory-review`, `memory-merge`) already try the harness first, via a path
that's been silently broken since it was written.

The question then widened, in the user's own words: **every harness should
have three to four models in increasing order of cost and intelligence, so
it's easier for KARMAX to decide which model to use** — and the deciding
should happen by first naming *what kind of work this is*, not by each call
site picking a model name for itself. The user's own worked example, for
Claude Code:

| # | Category | Model | Sub-agents |
|---|---|---|---|
| 1 | Low one-shot tasks | haiku | — |
| 2 | Medium one-shot tasks | haiku | — |
| 3 | High one-shot tasks | sonnet | — |
| 4 | High multi-step, multi-agent tasks | opus | sonnet |
| 5 | Flagship model tasks | fable | opus |

That table is the actual design. What follows is making it real: a category
enum any caller can declare or leave for the orchestrator to default, a
per-harness mapping from category to model (and, for the two delegating
categories, a sub-agent model), and the two live call sites wired to it.

Two things stay exactly as the first pass found them:

**`internal/agent/memorymodel.go` and `summarymodel.go` have zero callers
anywhere in the repository.** Still dead code. Still not migrated on
guesswork.

**`review.go` and `memmerge/merge.go` already have an `Ask`-then-`karmahelper`
shape**, and the `Ask` path — `harnessAnswer` sending with `kind: "summary"` —
has never once produced a `"kind":"summary"` session-open log line in this
daemon's history. `"summary"` has no entry in `harness.kinds`. That absence is
still the concrete evidence something here has never worked, not a theory.

Two CLI facts, checked directly against `claude --help` on this machine
rather than assumed, because guessing a flag that doesn't exist the way you
think is exactly the mistake `codex.go`'s own comment already warns against
for the other harness:

- **`--model <model>` documents `fable` itself**: *"Provide an alias for the
  latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name
  (e.g. 'claude-fable-5')."* Confirmed, not probed.
- **There is no dedicated sub-agent-model flag.** The only lever is
  `--agents <json>`: *"JSON object defining custom agents (e.g.
  '{"reviewer": {"description": "...", "prompt": "..."}}')"*. Whether an
  entry can override just `model` on the *built-in* `general-purpose` agent
  type without redefining its `description`/`prompt`, or whether it needs to
  fully redefine it to take effect, is **not** shown by that example and is
  not something to build on top of unverified — see §5's first task.

Decided in conversation, added to the table from the first pass:

| Decision | Choice |
|---|---|
| The routing axis | A named work category, not a bare cost tier. Five categories, matching the user's table exactly |
| Who assigns a category | The caller, when it knows its own shape (a loop declares one). The orchestrator, when it doesn't — see §4 |
| Default when uncategorized | **The cheapest category for the declared shape, never the most expensive.** One-shot defaults to category 1; multi-step defaults to category 4, never 5 |
| Per-harness configurability | The `categories:` block under each harness in `karmax.yaml` is the whole configuration surface — no separate settings UI |
| Codex's categories | The same five-name schema exists in config; every model field ships empty, for the same reason `codex.go` already passes no `--model` flag |
| Sub-agent model mechanism | `--agents <json>` overriding `general-purpose`'s model — the only lever that exists, and its exact behaviour is a first-task probe, not an assumption |

---

## 0. Why review.go and memmerge/merge.go are broken today

Unchanged from the first pass, restated because the fix in §5 depends on it:
both take an `Ask func(ctx, key, prompt) (string, bool)` callback wired in
`internal/runtime/runtime.go` to `harnessAnswer`
(`internal/runtime/harnesshost.go`), which calls
`rt.harness.Send(ctx, key, "summary", prompt)` before falling to
`karmahelper.NewSession(...).Chat(...)` on `ok == false`. `"summary"` resolves
through `Supervisor.policy("summary")` to `withDefaults(Policy{})` — a
generic 2-minute timeout, 10-minute idle, **no model override** — because no
`harness.kinds.summary` entry exists. Zero `"kind":"summary"` session-opens
have ever appeared in this daemon's logs.

## 1. The category enum

New file, `internal/harness` package (it is a fact about the harness, not
about any one caller of it):

```go
// Category names what kind of work a call is, independent of which harness
// or model ends up doing it. A caller that knows its own shape says so; one
// that doesn't gets the cheapest default for the shape it's in — see
// internal/utilitymodel's DefaultCategory.
type Category string

const (
	// LowOneShot and MediumOneShot are both single-turn, no-tools, no-
	// delegation exchanges — a classification, a short rewrite, a yes/no
	// judgment. They are named separately because "trivial" and "moderate"
	// are not the same request even when, on today's model lineup, both
	// happen to resolve to the same cheap model. A future lineup — or a
	// future harness — may split them for real.
	LowOneShot    Category = "low_one_shot"
	MediumOneShot Category = "medium_one_shot"
	// HighOneShot is a demanding single-turn exchange: real reasoning, still
	// no delegation to sub-agents.
	HighOneShot Category = "high_one_shot"
	// HighMultiStep delegates to sub-agents. The default target for any
	// uncategorized work that needs delegation — see DefaultCategory.
	HighMultiStep Category = "high_multi_step"
	// Flagship is the top of the ladder: the best model, delegating to
	// sub-agents on the tier below it. Never a default — see DefaultCategory.
	// A caller reaches it by asking for it, not by KARMAX guessing it's
	// warranted.
	Flagship Category = "flagship"
)
```

## 2. Per-harness category mapping

`internal/config/types.go`. This **replaces** the first pass's `HarnessTier`/
`Tiers []HarnessTier`/`HarnessKindConfig.Tier` — see §7.

```go
// HarnessCategoryConfig is one harness's answer to one Category: which model
// runs the call, and — for a category that delegates — which model its
// sub-agents run on.
type HarnessCategoryConfig struct {
	Model         string `yaml:"model"`
	SubagentModel string `yaml:"subagent_model,omitempty"`
}

type HarnessConfig struct {
	// ...unchanged fields...

	// Categories maps each Category this harness recognises to a model.
	// Existing kinds (chat/agent/task) keep their literal Model string and
	// never read this — it exists for callers that ask by category instead
	// of by kind. An entry with an empty Model is valid: it means "no
	// override is configured yet", not "misconfigured" — see Codex below.
	Categories map[string]HarnessCategoryConfig `yaml:"categories"`
}
```

Claude's mapping is the user's own table, verbatim:

```yaml
harness:
  # ...existing fields, untouched...
  categories:
    low_one_shot:    { model: haiku }
    medium_one_shot: { model: haiku }
    high_one_shot:   { model: sonnet }
    high_multi_step: { model: opus,  subagent_model: sonnet }
    flagship:        { model: fable, subagent_model: opus }
  kinds:
    chat:    { model: "haiku" }   # unchanged — literal, as today
    agent:   { model: "sonnet" }  # unchanged
    task:    { model: "opus" }    # unchanged
```

**The mapping is keyed by provider, not hardcoded per transport.** The first
draft of this section put Claude's categories on `HarnessConfig` and Codex's
under `utility.codex` — two ad-hoc blocks, because those were the only two
harnesses. ACP is now confirmed as the next piece of work, and it brings
several more (Cursor, Grok, OpenCode, Antigravity). Writing the schema twice
means churning it in every real install's `karmax.yaml`, so it gets written
once, provider-keyed, now:

```yaml
harness:
  # existing fields (binary, kinds, window_share, ...) unchanged
  providers:
    claude:
      transport: stream_json
      binary: claude
      categories:
        low_one_shot:    { model: haiku }
        medium_one_shot: { model: haiku }
        high_one_shot:   { model: sonnet }
        high_multi_step: { model: opus,  subagent_model: sonnet }
        flagship:        { model: fable, subagent_model: opus }
    codex:
      transport: exec
      binary: codex
      categories: {}   # empty — see below
```

`transport` names which mechanism runs the provider: `stream_json` for the
existing Supervisor, `exec` for the one-shot `codex.go` pattern, and `acp`
once that lands. A provider whose transport KARMAX does not implement yet is
skipped, not an error — that is what lets an ACP provider be configured
before the ACP client exists.

**Codex's mapping exists as the same five-name schema, and ships empty.**
Codex has no sub-agent delegation mechanism in KARMAX at all today — its
entire invocation is the one-shot `exec.Command` in `codex.go` — so its
`high_multi_step`/`flagship` entries have nowhere to put a `subagent_model`
even in principle, and are left as `model`-only slots alongside the rest:

```go
type UtilityCodexConfig struct {
	Binary     string                           `yaml:"binary"` // default "codex"
	Categories map[string]HarnessCategoryConfig `yaml:"categories"` // every Model empty by default
}
```

```yaml
utility:
  codex:
    binary: "codex"
    categories:
      low_one_shot:    { model: "" }
      medium_one_shot: { model: "" }
      high_one_shot:   { model: "" }
      high_multi_step: { model: "" }
      flagship:        { model: "" }
```

When a category's `Model` is empty, the Codex call in §5 omits `--model`
entirely — bit-for-bit what `codex.go` already does. **This block is the
whole answer to "make it configurable": an operator edits these five lines
per harness in `karmax.yaml` to change which model does which kind of work,
including filling in Codex's the day someone has a real Codex CLI to verify a
value against.** No separate mechanism, no settings screen — the same file
that already configures `harness.kinds` today.

**This daemon's own `karmax.yaml` has none of this**, and must not need a
hand edit for the fix to take effect — the same principle as the first pass.
`utilitymodel.New` (§5) applies the table above as an in-memory default
whenever `HarnessConfig.Categories` is empty, never written back to the file.
An operator who adds an explicit `categories:` block overrides it the same
way any configured kind already overrides `withDefaults`.

## 3. Loops declare a category; the orchestrator defaults the rest

`LoopConfig` (`internal/config/types.go`) already has a `Harness string`
field for a loop that wants to run directly through a coding harness. It
gains a sibling:

```go
type LoopConfig struct {
	// ...unchanged fields...

	// Category names what kind of work this loop's prompt is. Read only when
	// Harness is also set — a loop with no Harness runs through the main
	// agent's existing kind system and never reaches utilitymodel at all.
	// Empty (with Harness set) is valid: DefaultCategory decides.
	Category string `yaml:"category"`
}
```

**`Category` only means anything on a loop that already sets `Harness`.** A
plain `LoopConfig` with no `Harness` fires its prompt at the main agent brain
through the existing kind system (`chat`/`agent`/`task`, unchanged, §2) —
that path has never gone through `utilitymodel` and this spec does not touch
it. `Category` is read only for the loops that already bypass the main model
by naming a harness directly.

The two built-in Go loops declare theirs at construction, not in YAML, since
they aren't `LoopConfig`-driven:

- **`memory-merge`** → `harness.HighOneShot`. A judgment about one specific,
  already-narrowed pair — real reasoning, no delegation.
- **`memory-review`** → `harness.MediumOneShot`. Synthesis over a short list
  of candidates picking the single stalest one — more than trivial, not
  demanding enough to warrant `sonnet` over `haiku`.

**`utilitymodel.Model.Complete` (§4) always takes an already-resolved,
concrete `Category` — it never defaults anything itself.** Defaulting
happens one layer up, in whatever dispatches a `LoopConfig` entry: it reads
`cfg.Category` if the loop author set one, and calls `DefaultCategory`
otherwise, before ever calling `Complete`. This keeps `Complete`'s own
contract simple — execute this named category — and gives defaulting exactly
one place to live rather than duplicating the rule at every call site.

```go
// internal/utilitymodel

// DefaultCategory is what a LoopConfig with no Category gets, resolved by
// the loop dispatcher before it ever calls Complete. It is deliberately
// the cheapest category for the shape of work described, never a guess at
// how important the work might be — a maintenance pass that runs on haiku
// when it could have used sonnet is a missed nicety; a maintenance pass that
// silently runs on the flagship model because nobody categorized it is the
// exact failure mode that put this daemon $13/month over budget once
// already. delegates says whether the caller asked for sub-agent
// delegation; that alone decides one-shot vs multi-step, and nothing here
// infers "this deserves the best model" from content.
func DefaultCategory(delegates bool) Category {
	if delegates {
		return HighMultiStep
	}
	return LowOneShot
}
```

`Flagship` is reachable only by a caller naming it explicitly — a loop's own
`category: flagship` in config, or a human asking for the best the system has
through chat/agent's existing kind system (unchanged, §2). Nothing defaults
into it.

## 4. `internal/utilitymodel`, extended

The interface from the first pass gains the category:

```go
type Model interface {
	Complete(ctx context.Context, category harness.Category, systemPrompt, userPrompt string) (string, error)
}
```

Provider order, key strategy (`FreshPerCall` for memory-merge,
`StableKey` for memory-review), the scratch-workdir isolation, and
`ErrUnavailable`-on-total-failure are all unchanged from the first pass — see
that version's §3 for the parts this does not touch.

**What's new: resolving a category to an actual spawn.**

```go
func (m *claudeModel) Complete(ctx context.Context, cat harness.Category, systemPrompt, userPrompt string) (string, error) {
	catCfg, ok := m.categories[string(cat)]
	if !ok || catCfg.Model == "" {
		return "", ErrUnavailable // no mapping for this category on this harness
	}
	opt := harness.Options{
		Instructions: systemPrompt,
		Workdir:      m.scratchDir,
		Model:        catCfg.Model,
	}
	if catCfg.SubagentModel != "" {
		// See §5 — unverified until the probe there confirms --agents can
		// override just the model on the built-in general-purpose agent.
		opt.Agents = map[string]harness.AgentOverride{
			"general-purpose": {Model: catCfg.SubagentModel},
		}
	}
	turn, err := m.sup.SendWith(ctx, m.sessionKey(), "utility", userPrompt, opt)
	if err != nil {
		return "", err
	}
	return turn.Text, nil
}
```

`harness.Options` gains one field:

```go
// AgentOverride sets one field of a named agent's definition for --agents.
// Only Model exists because it's the only field this codebase has a use for
// today — see §5 for whether the flag accepts it alone on a built-in agent.
type AgentOverride struct {
	Model string `json:"model"`
}
```

`Options.Agents map[string]AgentOverride`, applied at `spawn()` as
`--agents <json-encoding-of-the-map>` when non-empty.

For Codex, `catCfg.SubagentModel` is always empty (§2), so the branch above
never fires — the Codex path stays the plain `exec.Command` from the first
pass, `--model` appended only when `catCfg.Model` is set.

## 5. The probe that must run before this is trusted

**First task, before anything above is wired to a live call.** Confirm,
against a real signed-in `claude` install, that `--agents
'{"general-purpose": {"model": "haiku"}}'` (a) is accepted without also
supplying `description`/`prompt`, and (b) actually changes what model a
delegated sub-agent runs on — not just what the top-level session runs on.
Recorded the same way the `MAX_THINKING_TOKENS` probe was: capture the
`stream-json` output, check the sub-agent's own `assistant` events for the
model field, keep the capture as a fixture.

**If it does not work this way**, the fallback is not to invent a second
mechanism — it is to *not build the sub-agent-model half of categories 4 and
5 yet*, ship the top-level model override alone (which `Options.Model`
already does today, proven), and record honestly in this file that
`SubagentModel` is configured but inert until a real mechanism is found. A
category system that quietly ignores half its own config is worse than one
that says plainly it doesn't do that part yet.

## 6. Testing

- The `--agents` probe above.
- `DefaultCategory(true)`/`DefaultCategory(false)` — the two branches, and a
  test that would fail if either branch pointed at `Flagship` or
  `HighOneShot` instead of the cheapest option for its shape.
- Category resolution: a configured category resolves to its model; an
  unconfigured one (Codex, by default) returns `ErrUnavailable`, not a call
  with an empty `--model`.
- The in-memory default table applies when `HarnessConfig.Categories` is
  empty, and a configured entry overrides it per-category (not all-or-
  nothing).
- `memory-merge`/`memory-review` construct their `Model` with their declared
  category and never call `DefaultCategory` themselves — they know their own
  shape.
- Everything carried over from the first pass's testing section: fresh-vs-
  stable session keys, `ErrUnavailable` treated as a clean skip not an error,
  Codex's no-flag-when-empty behaviour.

## 7. What this revises from the first pass

The first version of this file specified `HarnessTier{Name, Model}`, an
ordered `Tiers []HarnessTier` list (cheapest first), and
`HarnessKindConfig.Tier string` resolving through a `ModelForTier` lookup.
That design is **replaced, not kept alongside this one** — a repo with two
competing "which model for this call" mechanisms is exactly the wire-format
problem the rest of this session has been about fixing, aimed at its own
config schema this time. Concretely: `ModelForTier`, `HarnessTier`, and
`HarnessKindConfig.Tier` from the first pass do not get built. §2 above is
their replacement.

Everything else from the first pass stands: §0's root-cause finding,
`memorymodel.go`/`summarymodel.go` staying untouched dead code, the
fresh-per-call vs. stable-key session strategy, the scratch-workdir
isolation, skip-not-fallback on total unavailability, and the in-memory
built-in default so this exact daemon needs no manual `karmax.yaml` edit.

## 8. Out of scope

**Per-kind tool restriction.** Unchanged from the first pass — a
`--dangerously-skip-permissions` question for `internal/fsscope`, not this.

**Migrating `chat`/`agent`/`task` to categories.** They keep their literal
`model:` strings. Nothing here forces the change, and the category system is
available to them the day someone wants it.

**A semantic classifier for one-shot categories 1–3.** Distinguishing "low"
from "medium" from "high" one-shot work by looking at what the prompt
actually asks is a real, harder problem — it would need its own model call to
judge difficulty, spending tokens to save tokens, with no guarantee of a net
win. §3's rule sidesteps it by defaulting to the cheapest and asking callers
who know better to say so. Revisit if that default proves wrong in practice,
not before.

**Codex's real model names and its own multi-agent story.** Both wait for
someone with a real Codex CLI to verify against, per §2 and §4.
