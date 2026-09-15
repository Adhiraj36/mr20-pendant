# Round eight: functionality — the app does what it shows, and the daemon does the work

Base: `main` at `d03a65e`. This round adds no screens. Every screen already drawn must **work against the real backend**, and approved tasks must reach the LYZN daemon (KARMAX) on the person's own laptop.

## 0. The shape of the product, as the owner states it

1. The pendant records. The phone receives. The phone uploads to the cloud.
2. The cloud pipeline **already exists and works**: enhance vocals, reduce noise, trim silence, produce a processed file, transcribe with Deepgram **and** Sarvam, then apply Sarvam's diff onto Deepgram's transcript. Then summaries. Then GitLoom ingests the transcript and extracts stories, memories and facts. All async.
3. Tasks extracted from a conversation are the unit of work. **Approved tasks go to the daemon**, which executes them on the user's machine and returns proof.
4. KARMAX (→ "LYZN daemon") orchestrates with **Claude Code or Codex** as the default orchestrator.
   - **Act**: the customer brings their own Claude Code / Codex subscription. **This round.**
   - **Act Pro**: we supply a Claude-Code/Codex-compatible completions API and configure their daemon to use it. **Later round**, but nothing this round may block it.
5. KARMAX has no login. It joins LYZN as an **integration**, bound by a pairing code.

## 1. What is actually missing (audited, not assumed)

- **Payment cannot complete in the app.** `react-native-razorpay` cannot be linked (SwiftUICore, round seven), so `openCheckout()` returns `unavailable` and RESERVE is a dead end. This is the only genuinely dead control in the app.
- **No daemon anything**: no entity, no pairing, no work handoff, no receipts from execution. `POST /tasks/:id/approve` answers 402 behind two gates.
- **Fixtures** answer requests when `lyzn.fixtures` is on. That is a development switch and must never be reachable in a release build (it already is not — every call site is `__DEV__`), but the screens must be proven against the **real** API too.
- Everything else — recordings, transcripts, summaries, facts, tasks, receipts, memory search, Ask lyzn, categories, profile, pendant telemetry, notifications — has a live endpoint and a wired call site.

## 2. Payment, without a native module (Task P)

The web already takes payments with Razorpay's own checkout, in shipped, working code. Reuse it rather than re-implementing it natively.

- **Web** gains a route `/pay` (`web/src/pay/`): reads `ref`, `keyId`, `orderId`, `amount`, `currency`, `name`, `prefillEmail`, `prefillContact` from the query string, opens Razorpay Checkout, and on completion redirects to `lyzn://order/<ref>?paid=1`; on dismissal, `lyzn://order/<ref>?paid=0`. **No secret is ever in the URL**: the key id and the order id are public by design, and the amount is only what the already-created order says.
- **App**: `src/plan/razorpay.ts` keeps its shape and its `PaymentOutcome`, but the implementation becomes `WebBrowser.openAuthSessionAsync(payUrl, 'lyzn://order')` using **expo-web-browser, already installed**. No new native dependency.
- **Truth about payment stays server-side.** The app never verifies a signature. Razorpay's webhook (`POST /webhooks/razorpay`, HMAC-verified, already shipped) marks the order paid and writes the plan; the app polls `GET /orders/:reference` until `status === 'paid'` (bounded, with a "we will email you" fallback), then `user.reload()` so Clerk's metadata is fresh.
- The chooser's RESERVE, the receipt (U2) and the settings "Plan · CHOOSE ONE" row all end at a real payment.

## 3. The daemon, as an integration (Task D — backend, Task K — the loop)

**Pairing.** The daemon has no login, so LYZN issues a code and the daemon redeems it.

- `POST /daemons/code` (app, Clerk) → `{ code, expiresAt }` — a six-character code, five minutes, one use.
- `POST /daemons/claim` (daemon, **no** Clerk) `{ code, name, hostname, os, version }` → `{ daemonId, token }` — the token is the daemon's bearer credential from then on, stored hashed.
- `GET /daemons` (app) → the daemons on this account, with `lastHeartbeatAt`.
- `DELETE /daemons/:id` (app) — unpair.

**Work handoff.** The daemon polls; nothing is pushed at it.

- `POST /daemons/heartbeat` (daemon token) `{ status, version }` → `{ ok, tasks: n }`.
- `GET /daemons/work` (daemon token) → approved tasks not yet claimed, oldest first, with everything needed to act: `taskId, text, kind, quote, dueAt, recordingId, context{title, summary, facts}`.
- `POST /daemons/work/:taskId/claim` → conditional `approved → executing`; 409 if someone got there first.
- `POST /daemons/work/:taskId/result` `{ outcome: 'success'|'failure', summary, startedAt, finishedAt, artifacts?[] }` → writes the RECEIPT and flips the task `done`/`failed` in one transaction, and pushes `receipt.printed` to the phone.

**Entitlement.** `POST /tasks/:id/approve` and every `/daemons/*` route require `plan.automation` (Act and Act Pro). Capture tier gets 402 with a body the app already knows how to show. The `EXECUTION_ENABLED` env flag is replaced by `AppConfig.features.execution`, so it is switchable without a deploy.

**The loop (Task K).** A new loop in `karmax-loops` — `lyzn/` — that: reads `LYZN_DAEMON_TOKEN` and `LYZN_API` from the daemon's config, heartbeats, pulls work, hands each task to the orchestrator (Claude Code / Codex, the daemon's default), and posts the result back. The loop is where the Act-vs-Act-Pro split lives later: Act uses the customer's own orchestrator credentials as KARMAX already does; Act Pro will only change which base URL and key the orchestrator is configured with, which the loop must not hard-code.

## 4. The app is functional end to end (Task F)

Every screen proven against the real API with fixtures **off**, and every control that can act, acting:

- Home: pull to refresh, segment counts, category filter, selection and delete, the waiting-tasks card, the recording pill.
- Conversation: play, seek, speed, enhanced/original, rename speakers (→ memory re-filed, version bumps), retry, delete, export, Ask sheet with citations that scroll the transcript.
- Tasks: mark done → the receipt prints; dismiss; edit; approve (402 → the unlock sheet on Capture).
- Receipts: the roll, the detail, share.
- Ask lyzn: a real streamed answer with citation chips that open the conversation.
- Pendant: connect, sync, pause/resume, the three states.
- Settings: name, ink, theme, categories, cache, unpair, erase, sign out, delete everything — and the daemon section, which is where a person pairs their laptop (`features.daemon` on once Task D lands).

## 5. Constraints

- Gates per task: mobile `npx tsc -p tsconfig.json --noEmit` + `bun run test` + a simulator pass with **fixtures off** against production; backend `go vet ./... && go test ./...` and `cd backend && npm run build && npm run synth`; web `npm run lint && npx vite build`.
- Ownership: **P** owns `web/src/pay/**`, `web/src/App.tsx` routing, `mobile/src/plan/**`. **D** owns `backend/go/internal/{ddb,api}/daemons*.go`, `tasks.go`'s approve gate, `internal/push`. **F** owns `mobile/app/**` and `mobile/src/{api,state,home,tasks,recordings}/**`. **K** owns the `karmax-loops` clone only.
- Nothing pushes to `main`; the controller merges. Commit trailer as in round seven, with `Co-Authored-By: Claude Opus 5 (1M context)`.
- Report to `.superpowers/sdd/2026-09-08-app-round-eight/task-<id>-report.md`.
