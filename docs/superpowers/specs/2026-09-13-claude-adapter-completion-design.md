# Claude stays native, and learns its own limits

Date: 2026-09-13. Status: approved in conversation; implementation follows
this document. KARMAX only.

## Context

The ask was "wire acp-go into KARMAX, and write the Claude Code adapter for
ACP based on how it is in t3code." Investigating both halves changed both
answers.

**The wiring is already done.** KARMAX's `acp-session-interface` branch has
sixteen commits consuming `github.com/MelloB1989/acp-go v0.1.0`: the `session`
interface, `acpSession`, a provider registry dispatching on `transport`,
resolved-model application, audit recording, a bounded handshake, and a live
interop test that drives a real agent end to end. There is no wiring work
left to specify.

**t3code does not route Claude through ACP.** Checked directly:
`ClaudeAdapter.ts` (5,391 lines) and `CodexAdapter.ts` (2,743) contain **zero**
`effect-acp` imports. `CursorAdapter`, `GrokAdapter` and `AntigravityAdapter`
each import it. Claude and Codex are native adapters by deliberate choice, and
the reference we were asked to follow made that choice.

**For KARMAX the reason is sharper than preference — it is the breaker.**

- `supervisor.go:228` calls `s.breaker.Observe(turn.Limits)` on **every** turn.
- `turn.Limits` is populated in exactly one place: `session.go:268`, from
  Claude Code's `rate_limit_event`.
- `acpsession.go` contains no reference to `Limits` at all, because ACP has no
  vocabulary for an account's quota windows.

Routing Claude through an ACP shim would therefore hand the breaker `nil` on
every turn, forever. The quota discipline visibly working in this daemon's
logs — *"five_hour window is 45% used, past KARMAX's 40% share — running on
the cheap model"* — would stop, silently, with no error anywhere. That is a
capability regression on the mechanism that keeps inference spend bounded.

So Claude stays native. What is actually missing is the rest of the port: the
earlier session brought over t3code's extraction core (tool assembly, titling,
kinds, locations, thought, plan) and left two things behind. One of them now
matters considerably more than it did, because the category work routes work
across four different models.

| Decision | Choice |
|---|---|
| Claude's transport | **Stays stream-json.** Never routed through ACP — see above |
| An ACP shim for Claude | Not built. It would blind the breaker |
| What to port | Model-scoped rate limits (§2) and a capabilities probe (§3) |
| Unverified claims | `rate_limits.model_scoped` is read from t3code's source, not from data observed here. §2's first task proves it before anything is built on it |

## 1. Claude stays native, on the record

`*Session` (stream-json) and `*acpSession` already satisfy the same `session`
interface, so Claude is uniform with every ACP provider everywhere it matters:
the pool, `MaxLive`, reaping, the audit hook, and the provider registry.
Uniformity was the goal, and the interface already delivers it. Forcing the
transport to match as well buys nothing and costs the breaker its input.

If Claude Code ever speaks ACP natively — and exposes quota telemetry through
it — this is worth revisiting. Until then, a second transport for the same
harness is two code paths to maintain for one capability loss.

## 2. Per-model rate limits

**The gap.** `RateLimit` (`protocol.go:95`) carries `UnifiedWindows
map[string]Window` and `Worst()`. `Breaker.Decide()` returns an account-wide
`Decision{Allow, Degrade, Reason}`, and `supervisor.go:215` uses `Degrade` to
swap in one fixed `CheapModel`.

t3code reads more. `claudeUsageLimits.ts` has:

```ts
function readModelScoped(rateLimits: object): ReadonlyArray<ModelScopedWindow> {
  const raw = (rateLimits as { readonly model_scoped?: unknown }).model_scoped;
  ...
}
interface ModelScopedWindow {
  readonly display_name: string;
  readonly utilization: number | null;
  readonly resets_at: string | null;
}
```

**Why it matters now.** The category system
(`2026-09-13-utility-model-tiers-design.md`) routes `low_one_shot`→haiku,
`high_one_shot`→sonnet, `high_multi_step`→opus, `flagship`→fable. Today an
account past its share on *any* measure degrades *everything* to one cheap
model. With per-model windows, exhausting opus degrades opus-tier work while
haiku-tier work — the memory loops, the cheap utilities — carries on
untouched. That is the difference between "the assistant is degraded" and
"the expensive tier is degraded," and only the second is true.

**The shape.**

```go
type ModelWindow struct {
	DisplayName string
	Utilization float64
	ResetsAt    int64
}
```

`RateLimit` gains `ModelScoped []ModelWindow`. `Breaker` gains
`DecideFor(model string) Decision`; `Decide()` remains for callers that only
need the account-level refusal. `open()` calls `DecideFor` with the resolved
model, and on degrade picks the cheapest model whose own window is **not**
past share, rather than the fixed `CheapModel`.

**The hazard, named.** `display_name` is a human string from the API — "Claude
Opus 4.5" — and KARMAX's config uses aliases: `haiku`, `sonnet`, `opus`,
`fable`. Matching one to the other is where this silently half-works: an
unmatched name means a window nobody consults, and the degrade path quietly
reverts to today's behaviour while appearing to be model-aware. t3code hit
this too — `makeClaudeScopedLimitNames` and `scopedWindowId(displayName)`
exist for it.

So: matching is case-insensitive substring on the alias, and **an unmatched
window is logged at warn, not dropped silently**. A test asserts that a
`model_scoped` entry whose name matches nothing produces a warning — the
difference between a feature that degraded gracefully and one that never ran.

**This is unverified and must be proven first.** No `rate_limit_event`
payload was available to inspect here: this daemon's log records the
interpreted quota message rather than the raw JSON, and KARMAX's `testdata/`
was removed in an earlier cleanup. The claim that `model_scoped` exists in
this install's output comes from t3code's source alone.

Task one captures a real `rate_limit_event` from a live turn, inspects it,
and commits it as a fixture. If `model_scoped` is absent, **stop and report** —
§2 is then not buildable against this Claude version, and the honest outcome
is that `UnifiedWindows` is all there is. Do not synthesise the field.

## 3. A capabilities probe

**The gap.** KARMAX assumes what the installed `claude` supports. Two
assumptions were checked by hand this session and neither was obvious:
`MAX_THINKING_TOKENS` turned out to enable the thinking stream but return
empty text under subscription auth, and `--agents`' ability to set a
sub-agent's model was documented nowhere and needed a live probe.

t3code institutionalises this: `probeClaudeCapabilities` runs once against the
installed binary — its test notes the probe "follows initialize with get_usage
on the same process" — and the result is consumed rather than guessed.

**The shape.** A `Capabilities` struct recording what this binary supports,
probed once per binary path plus version and cached; `claude --version` is the
cache key, so an upgrade re-probes. What to record, in priority order:

- the model aliases the binary accepts (so a configured `fable` that this
  build rejects is caught at startup, not mid-turn)
- whether `--agents` accepts a bare `model` override
- whether thinking returns text under the current auth

The probe must never fail a start. An unprobeable binary yields a zero
`Capabilities` and everything behaves exactly as it does today — this is
information that improves decisions, not a gate that blocks them.

**Where it is consumed.** `karmax preflight` reports it, and the category
resolver logs a warning when a configured model is not in the accepted set.
Neither refuses the turn; both make a silent failure visible.

## 4. What is deliberately not built

**An ACP shim for Claude.** §1. It would blind the breaker.

**The remaining ~3,500 lines of `ClaudeAdapter.ts`.** Most of it is Effect
plumbing, t3code's own contracts, and features KARMAX does not have
(citations, snapshots). The extraction core is already ported. §2 and §3 are
the parts with a live consumer; the rest is not a backlog, it is someone
else's product.

**Changing `CheapModel`'s meaning.** It stays the account-level floor. §2 adds
a per-model path beside it and leaves the existing behaviour as the fallback
when `model_scoped` is absent or unmatched.

## 5. Testing

- **The fixture probe, first.** A live turn captured to
  `internal/harness/testdata/rate-limit.jsonl`, inspected for `model_scoped`.
  Everything in §2 is gated on what it shows.
- **Parsing**, against that fixture: `ModelScoped` populated, and an absent
  `model_scoped` leaving it empty without error.
- **`DecideFor`**: an exhausted opus window degrades an opus request and
  leaves a haiku request untouched. This is the behaviour the whole section
  exists for and it should fail loudly if reversed.
- **The name-matching hazard**: an unmatched `display_name` warns, and the
  decision falls back to account-level behaviour rather than treating the
  model as unlimited.
- **The probe never blocks a start**: a binary that fails to probe yields zero
  capabilities and a working supervisor.
- The existing suite passes unchanged — `Decide()`'s behaviour is untouched
  for every caller that does not opt into `DecideFor`.

## 6. Out of scope

**Codex.** It is still the one-shot `exec` path, unchanged. Whether it ever
becomes an ACP provider is a finding for when Codex speaks ACP.

**The agent role.** `acp-go` is a client. Unchanged.

**Per-model limits for ACP providers.** ACP reports no quota telemetry, so
there is nothing to read. Their sessions keep the account-level decision.
