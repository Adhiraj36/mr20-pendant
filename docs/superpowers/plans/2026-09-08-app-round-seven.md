# App, round seven: the desk, the receipts, and the memory layer

Base: `main` at `6a130db`. Reference: Claude Design project `0b482e7a-b91d-4682-a632-d165607ae87b`, file `lyzn App.dc.html` (condensed copy for agents: `docs/superpowers/specs/2026-09-08-app-design-canvas.txt`). Research reports feeding this plan are in `.superpowers/sdd/2026-09-08-app-round-seven/research/` (app inventory, backend inventory, NativeWind, GitLoom, Clerk/Razorpay/push).

## 0. What this round is

The app is rebuilt on the design canvas: a **desk** ground (`#E3E4DE`) with **paper** cards (`#FBFBF8`), ink type, one live-action violet (`stamp`), carbon yellow for anything waiting on the user, void red for recording and failure, settled green for done; a **dark** mode that keeps receipts paper; receipts as the product's vocabulary. Light is the default. Every component is reusable, configurable, and styled with Tailwind classes (NativeWind 4) reading `@lyzn/design` through a generated theme.

The product decisions fixed by the owner on 2026-09-08 (verbatim intent):

1. Cloud cost low, **everything serverless**.
2. **Remove the live transcript feature.**
3. The plan chosen on the pre-order website follows the user into the app via **Clerk public metadata**; no plan → **in-app plan chooser**, right there.
4. Plan chooser, prices, pre-order copy are **remote configuration** from the backend.
5. **Notifications properly set up.**
6. Every conversation shows **transcript, summary, tasks, and the facts / new memories learned**.
7. **Speaker relabel updates memory** (GitLoom).
8. **GitLoom is the memory and conversation layer**: history, tool calls, compaction, memories and their updates.
9. Premium, simple, aesthetic, unique. **Light default, dark option.** Desk/paper, receipts.

### Facts that shape the plan (from the inventories)

- Idle AWS spend ≈ $38–40/mo; ≈ 90% is the voice service (ALB + Fargate + public IPv4s), which has never served a session. The voice call screen and the live transcript both depend on it. **Decision (assumed, flagged to the owner): retire the voice call with the service; "Ask lyzn" is text.** A serverless voice rebuild (client-direct Deepgram + streaming Function URL) is a later round.
- The backend has recordings, transcripts (diarized utterances), enrichment (title/tags/summary/actionItems), devices with telemetry, plans (`automation` bit, unenforced), Expo push (one event). It has **no** task entity, approval state, daemon, WhatsApp, receipts, facts.
- GitLoom (`gitloom-go` v0.3.4) is a working **conversation** layer (history, branches, caller-triggered compaction with server summaries, titles). Its **memory** API is append-only and write-only-addressable: `Remember` returns nothing, no list/get/update/delete, no filter by source. So the backend owns its own facts and treats GitLoom's extraction as an index. Speaker relabel = re-ingest with names (possible duplication is a slot).
- NativeWind **4.2.6 + tailwindcss 3.4.19** (v4 unsupported; v5 is preview). Open regression #1781 (plain `StyleSheet` colour/border props dropped on RN 0.85+/React 19.2) must be probed on a device before the kit is written. Tone system uses `vars()`, not `dark:`; `dark:` is reserved for the app-wide appearance switch.
- App facts: no pairing gate (only sign-in); action items have no id; done state is AsyncStorage; the design's C1 "live recording" panel shows live transcription — that panel goes (decision 2); the recording state itself stays.
- The design describes a **laptop daemon**, **WhatsApp approvals** and an **Execution tier**. None exist. They ship as **feature-flagged slots** in remote config (`features.daemon`, `features.whatsapp`, `features.execution`, all `false`): screens hide them, onboarding skips O4/O5, tasks are the Capture-tier read-only list with `MARK DONE`, which prints a receipt.

### Slots (render nothing or the stated fallback; never ship a token)

| Slot | Missing | Fallback |
|---|---|---|
| `[DAEMON]` | daemon entity/heartbeat | hidden behind `features.daemon` |
| `[WHATSAPP]` | channel + webhooks | hidden behind `features.whatsapp`; O2 copy says "email", not WhatsApp |
| `[EXECUTION]` | approval → execution path | tasks are `proposed → done/dismissed` by the user; `approve` endpoints exist but the app shows them only when `features.execution` |
| `[GL_SUPERSEDE]` | whether a re-ingest supersedes or duplicates | store the sent dialogue + speaker map + `ingestVersion`; the detail screen says `REMEMBERED · v2` |
| `[GL_FACT_IDS]` | GitLoom created-memory ids | facts come from our enrichment pass; GitLoom gets them as a second `Remember` |
| `[VOICE]` | serverless voice | no voice screen this round |

## 1. Global constraints

- **Branches**: one per task, named below, cut from `main`. Merge order in §9. Never push to `main` from a task branch; the controller merges. The infra teardown branch is **held** until the owner confirms.
- **Gates** — mobile: `cd mobile && bun install && npx tsc -p tsconfig.json --noEmit && bun run test && npx expo export --platform ios --output-dir /tmp/exp-<task>`; plus, for UI tasks, screenshots from the iOS simulator (§8). Backend: `cd backend/go && go vet ./... && go test ./...` and `cd backend && npm run build && npm run synth`. Package: `cd packages/design && npm test && npm run gen:css` (commit regenerated `tokens.css`, `fonts.json`, `tokens.json`). Web must still build: `cd web && npm run lint && npx vite build`.
- **Design discipline**: no screen names a colour, radius, size or font of its own; everything is a Tailwind class from the generated theme or a kit prop. Mono labels uppercase, fragments joined with ` · `, empties dropped. Square buttons. Hairlines. No shadows except the receipt's. Copy centralised in `mobile/src/design/copy.ts` (screens) and remote config (pricing/pre-order).
- **Tests stay pure**: `node --test` reaches only React-free modules. New logic (task states, receipt models, config parsing, plan resolution, notification routing tables, theme persistence) lives in pure `.ts` files with tests.
- **Secrets**: never printed, never in the repo. The reference `.env` in the scratchpad is off-limits.
- **Report**: `.superpowers/sdd/2026-09-08-app-round-seven/task-<id>-report.md` (copy into the main checkout): COMPLETE/BLOCKED, sha, gate output verbatim, measurements, deviations with reasons, slots hit.
- Commit trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019s83HMh3LRiqEkP4xX3Yg4
  ```

## 2. Contracts (fixed names; producers and consumers are different tasks)

### 2.1 Design package (`packages/design/src/tokens.ts`)

```ts
export const colors = {
  ...existing,
  // the canvas' light theme: the desk, and what sits on it
  desk: '#E3E4DE', sheet: '#FBFBF8',            // existing
  deskInk: '#1C1C16', deskMuted: '#3B3B33', deskFaint: '#6E6F64', deskLine: '#D9D9D1',
  carbon: '#F1E8CC', carbonLine: '#DDD2AE',     // waiting on you
  stamp: '#3B2FD4', settled: '#1B6B45',         // existing
  danger: '#B03A2E',                            // was #B5483C — the reference's own void red, both surfaces
  // the canvas' dark theme
  night: '#1C1C16', nightPanel: '#111109', nightLine: '#4A4A3E', nightMuted: '#9C9C90', nightFaint: '#8A8A7E',
  carbonDeep: '#3A3323', carbonDeepLine: '#554C34', carbonDeepInk: '#EBDFB8', carbonDeepMuted: '#CFC7AE',
  stampNight: '#8B82FF', settledNight: '#6FCF9A', dangerNight: '#E0705E',
}
export type Ground = 'ink' | 'paper' | 'desk' | 'night'
export const tones = {
  ink, paper,                                    // unchanged (receipts and legacy)
  desk:  { bg: desk, fg: deskInk, muted: deskMuted, faint: deskFaint, line: deskLine, line2: deskInk,
           panel: sheet, panel2: '#EDEDE8', invBg: deskInk, invFg: sheet, statusBar: 'dark',
           carbon: carbon, carbonLine: carbonLine, stamp: stamp, settled: settled, danger: danger },
  night: { bg: night, fg: sheet, muted: nightMuted, faint: nightFaint, line: nightLine, line2: sheet,
           panel: nightPanel, panel2: '#1C1C16', invBg: sheet, invFg: night, statusBar: 'light',
           carbon: carbonDeep, carbonLine: carbonDeepLine, stamp: stampNight, settled: settledNight, danger: dangerNight },
}
export const stampAngle = -11                    // the receipt stamp's rotation on the canvas
export const toggle = { w: 44, h: 26, radius: 13 } // the one pill in the system (canvas CS "TOGGLES")
```

`ink`/`paper` tones gain the same five extra keys (`carbon, carbonLine, stamp, settled, danger`) so every tone has the full set. The generator emits, in addition to everything today: `--color-*` for every new colour; `tokens.json` (§2.2). `web/src/styles/pricing.css` keeps reading `--color-danger`, which now equals the reference's `#B03A2E` — a deliberate, visible-nowhere alignment.

### 2.2 `packages/design/tokens.json` (generated; the Tailwind theme)

Shape exactly as the NativeWind report §3: `colors` (kebab, `inkFg → inkfg` style as today), `spacing` (px strings), `radius`, `fontFamily` (`sans-400…800`, `mono-400…700`, `sans`, `mono`), `fontSize` (display keys special-cased to `display-xl/l/m`, plus `body-l`, `body`, `small`, `label`, `label-sm`, `mono-11`), `letterSpacing`, `duration`, `ease`, `tones` (the full table above, for `vars()`), `stampAngle`, `toggle`. Exported as `"./tokens.json"`. A test asserts `tokens.json` equals what `tokens.ts` generates (stale-theme guard).

### 2.3 Mobile theme and tone (`mobile/src/design/tone.tsx`, `theme.ts`)

- `Ground = 'desk' | 'night' | 'ink' | 'paper'`. `Screen` takes `ground` (default: the current theme's ground). `ToneProvider` sets `vars()` for `--tone-bg/fg/muted/faint/line/line2/panel/panel2/inv-bg/inv-fg/carbon/carbon-line/stamp/settled/danger`; Tailwind exposes them as `bg-tone-bg`, `text-tone-fg`, `border-tone-line`, `bg-tone-carbon`, `text-tone-stamp`, etc.
- `theme.ts` (pure): `Theme = 'light' | 'dark' | 'system'`, `THEME_STORAGE_KEY = 'lyzn.theme'`, `resolveGround(theme, systemScheme) → 'desk' | 'night'`, default `'light'`. `useTheme()` persists to AsyncStorage and re-applies on boot (NativeWind's `colorScheme.set` is not durable across OTA reloads — see report §1 item 5 — so we own persistence and set it on mount).
- Receipts are always `paper` tone regardless of theme (canvas D2: "receipts never go dark").

### 2.4 Backend API additions (all under Clerk auth unless stated)

**Remote config**
- `GET /config` — **public**, `Cache-Control: public, max-age=60`. Response `AppConfig`:
  ```json
  { "version": 3, "updatedAt": "…",
    "pricing": { "currency": "INR", "preorder": true,
      "tiers": [ { "id":"capture", "name":"Capture", "full":599900, "deposit":99900, "monthly":0, "enabled":true, "badge":"", "lines":["Pendant","Phone app","Unlimited recording","Commitments listed"] },
                 { "id":"act", "name":"Act", "full":999900, "deposit":399900, "monthly":0, "enabled":true, "badge":"Most chosen", "lines":[…] },
                 { "id":"act-pro", "name":"Act Pro", "full":1099900, "deposit":499900, "monthly":49900, "enabled":true, "badge":"", "lines":[…] } ],
      "copy": { "chooserTitle":"…", "chooserSub":"…", "depositNote":"…", "indiaOnly":"…", "receiptTitle":"LYZN · PROOF OF WORK" } },
    "features": { "daemon": false, "whatsapp": false, "execution": false, "askLyzn": true, "darkMode": true },
    "notifications": { "digestHour": 8 } }
  ```
  Amounts in paise. Stored in DynamoDB `PK=CONFIG SK=app` with the code's defaults seeded on first read; `orders.go` reads `deposit`/`full`/`monthly` from it (per-container cache, 60 s TTL) — the client never sends an amount.
- `PUT /admin/config` — requires Clerk `public_metadata.role == "admin"`; validates the schema; bumps `version`. `backend/scripts/config.md` documents a `curl` recipe.

**Plan in Clerk**
- On `POST /orders/:ref/verify` success and on the Razorpay webhook `paid` path, after the `PLAN` row is written: Clerk `user.UpdateMetadata(publicMetadata: { plan, planStatus, planSince, orderReference })`. Failure is logged, never fails the payment. `GET /plan` unchanged (source of truth stays DynamoDB).
- App resolution (`mobile/src/plan/resolve.ts`, pure): `resolvePlan(clerkPublicMetadata, apiPlan)` — API wins when present; Clerk metadata answers instantly at login; `none` → chooser.

**Tasks / receipts / facts**
- Entities (single table): `TASK#<createdAt>#<taskId>` with `taskId, recordingId, utteranceIndex?, text, owner?, kind ('message'|'spend'|'file'|'reminder'|'other'), status ('proposed'|'approved'|'done'|'dismissed'|'failed'), quote, dueAt?, doneAt?, receiptId?, createdAt, updatedAt`; GSI1 `TASKSTATUS#<sub>#<status>` / `<createdAt>`.
  `RECEIPT#<createdAt>#<receiptId>` with `receiptId, kind ('task'|'pairing'|'plan'|'conversation'), taskId?, recordingId?, title, quote?, rows [{k,v,ok?}], stamp ('DONE'|'READY'|'UNLOCKED'|'FILED'), createdAt`.
  Recording row gains `facts: [{text, kind:'fact'|'preference'|'person'|'decision'}]`, `memoryIngestVersion`, `memoryDialogueKey` (S3 key of the exact dialogue sent), `memorySpeakers` (the map as sent).
- Processor: enrichment prompt emits `facts[]` (≤ 12, ≤ 200 chars) alongside today's fields; writes one TASK row per action item (`status: proposed`, `kind` classified by the prompt); sends facts as a second `Remember` (`SessionID=recordingId`); byte-caps the dialogue at 240 KB (not 120k chars).
- Endpoints: `GET /tasks?status=&cursor=` · `PATCH /tasks/:id` `{text?, dueAt?}` · `POST /tasks/:id/done` (writes the task `done` **and** a `RECEIPT` in one transaction; returns `{task, receipt}`) · `POST /tasks/:id/dismiss` · `POST /tasks/:id/approve` (402 unless `features.execution` and plan `automation`) · `GET /receipts?cursor=` · `GET /receipts/:id` · `POST /receipts` `{kind:'pairing'|'plan', …}` (the app prints pairing/plan proofs server-side so they appear in the roll).
- `PATCH /recordings/:id` with `speakers` **re-ingests** the transcript with names substituted (`Speaker 1` → `Priya`), bumps `memoryIngestVersion`, stores the new dialogue key. Ingest at processing time already substitutes names when `speakers` are set.
- `GET /memory/search?q=` — GitLoom `Recall` surfaced: `{hits:[{path, score, snippet, when}]}` for "Ask lyzn" citations.
- Conversations: DynamoDB `CONV#<updatedAt>#<id>` `{id, kind:'text'|'voice', title, pinned, archived, exchanges}` replacing the `voice-` id-prefix hack and giving `GET /chats` pagination; `exchanges` is the durable compaction counter (compact every 5 exchanges).
- `DELETE /recordings/:id` writes `TOMBSTONE#<recordingId>` and `GET /memory/search` filters hits whose provenance names a tombstoned session (`[GL_ERASE]` slot: best effort).
- Fix: `gitloomx` honours `GITLOOM_BASE_URL`; `deleteChat` evicts the voice wrapper too.

**Notifications (Expo push)**: events `recording.ready` (exists), `recording.failed`, `tasks.proposed` (`{count, recordingId}`; title "n things you promised", body = first task), `plan.activated`, `receipt.printed` (task done by execution — flag-gated). Sender sets `priority: high` for tasks, `ttl`, `channelId` (`tasks` | `conversations` | `account`), `categoryId` (`task` with actions `Mark done` / `Open`), `badge`. `DeviceNotRegistered` deletes the token (exists).

### 2.5 Mobile routes (expo-router)

| Route | Canvas | Ground |
|---|---|---|
| `index` (gate) | — | theme |
| `onboarding/welcome` | O1 | theme |
| `onboarding/sign-in` | A1 (Apple · Google · email code) | theme |
| `onboarding/code` | O2 (email code; copy says email, `[WHATSAPP]`) | theme |
| `onboarding/plan` | U1 (chooser from config) → payment → U2 receipt | theme |
| `onboarding/pair` | O3 → O3b | theme |
| `onboarding/gates` | O5 — only when `features.execution` | theme |
| `onboarding/light` | O6 | theme |
| `onboarding/ready` | O7 receipt | theme |
| `(tabs)/index` Home | H1 with segments CONVERSATIONS · TASKS · RECEIPTS (T1/T0, R2), S1 banner slot, S3 empties, P2/P3 banners | theme |
| `(tabs)/lyzn` Ask lyzn | L1 · L2 · L3 (capture tier: locked copy, still shows the answer it would give) | theme |
| `(tabs)/pendant` | P1 · P2 · P3 | theme |
| `recording/[id]` | C2 (summary, commitments, facts/remembered, transcript) + C1 header state while recording | theme |
| `recording/[id]/ask` | C4 sheet | theme |
| `task/[id]` | T2 (detail) · T3 (edit) · T5 (failed) | theme |
| `receipt/[id]` | R1 · D2 | theme (receipt paper) |
| `settings` | SET (account, ink, theme, notifications, retention, export, delete) | theme |
| removed | `live`, `voice`, `chat/[id]` (folded into Ask lyzn), `categories` (categories become a filter chip row on Home; editing moves to settings) | — |

Tab bar per canvas: `HOME · LYZN · PENDANT`, paper strip, mono 10 labels, ink for the active tab.

## 3. Tasks — wave one (parallel, from `main`)

### T1 — Design package round seven (branch `r7-design`)
Implement §2.1–2.2 exactly; update the comments that describe the old world ("two grounds"); regenerate `tokens.css`/`fonts.json`/`tokens.json`; extend `packages/design/test` (tones complete, `tokens.json` fresh, `danger` is the reference red, `stampAngle`, `toggle`). Web gate must pass unchanged except `--color-danger`. Mobile's `tests/design/tokens.test.ts` "exactly two grounds" assertion is T2's to update; do not touch `mobile/`. Commit `"design: the desk, the night, carbon, and the theme as JSON"`.

### T2 — Mobile foundation: NativeWind, tone, theme (branch `r7-foundation`, after T1 is merged or by cherry-picking T1's package changes locally without committing them)
1. Install `nativewind@4.2.6`, `tailwindcss@3.4.19` (dev), per the NativeWind report §2: `babel.config.js` (drop the explicit worklets plugin, add `jsxImportSource: 'nativewind'` + `nativewind/babel`), `metro.config.js` wrapped last with `withNativeWind`, `global.css`, `tailwind.config.js` reading `@lyzn/design/tokens.json`, `nativewind-env.d.ts` committed, `src/design/interop.ts` (Animated, svg, LinearGradient, BlurView, lucide `Icon` map), imported from `app/_layout.tsx`.
2. **Probe #1781 on the simulator first** (`npx expo run:ios` to a booted iPhone 17 Pro; a throwaway screen with a `className` view and a plain `StyleSheet` bordered view). Record the result in the report. If the regression bites: apply the one-line `patch-package` fix from PR #1840 for LogBox regardless, and for #1781 either pin to `nativewind@4.2.2` (verify) or keep all colour/border in classes and document it as a kit rule. Decide, write it down, move on.
3. `tone.tsx` → §2.3 (`vars()` boundary; `useTone()` kept for imperative consumers); `theme.ts` + `useTheme()`; `Screen` reads the theme; status bar follows the tone; `app.json` `userInterfaceStyle: "automatic"`.
4. Keep every existing screen compiling (they still use `useTone()` styles) — this task changes no screen's look except the ground colours where a screen declares `ground="desk"` (none yet).
5. Update `tests/design/tokens.test.ts` (four grounds, every tone complete) and add `tests/design/theme.test.ts`.
Gates + simulator screenshot of the probe. Commit `"app: NativeWind on the design theme; tones as variables; light by default, dark by choice"`.

### T3a — Backend: remote config, plan in Clerk, orders read config (branch `r7-config`)
§2.4 "Remote config" and "Plan in Clerk". New files: `internal/ddb/config.go`, `internal/api/config.go`, `internal/clerkmeta/clerkmeta.go` (uses `github.com/clerk/clerk-sdk-go/v2`; key from the existing Clerk secret), `internal/api/admin.go`. `orders.go`: `prices`/`fullPrices`/monthly come from config; `backend/scripts/config.md`. Preview stack + CDK env unchanged except a CloudFront cache behaviour for `/config*` (60 s) on the API distribution. Tests for config validation, price lookup, plan metadata mapping. Commit `"backend: prices and copy are configuration; the plan follows the user into Clerk"`.

### T3b — Backend: tasks, receipts, facts, memory, notifications (branch `r7-memory`)
§2.4 "Tasks / receipts / facts", "Notifications", the GitLoom fixes, conversations rows, `GET /memory/search`, tombstones. New files under `internal/ddb/{tasks,receipts,conversations}.go`, `internal/api/{tasks,receipts,memory}.go`, prompt changes in `internal/enrich`, processor changes, `internal/push` fields. Route registration appended in `app.go` in one block. Tests: task transitions (conditional writes), receipt from task, facts coercion, name substitution in `AsDialogue`, byte cap, notification payloads. Commit `"backend: tasks and receipts as records, facts of our own, memory that knows who spoke"`.

### T4 — Infra: serverless only (branch `r7-serverless`, **held for owner confirmation before merge**)
Remove from `mr20-stack.ts`: VoiceVpc, VoiceCluster, VoiceTask, VoiceService, VoiceAlb, VoiceRepo, VoiceImageBuild, VoicedLogs, the `VoiceUrl` output; delete `backend/go/cmd/voiced`, `internal/voiced`, `internal/livestt`, `internal/voicewire`, `Dockerfile.voiced`; remove the voice steps from `backend-ci.yml`; `mobile/src/api/config.ts` loses `voiceUrl` (T6 removes the screens); README "nothing bills while idle" made true again. Consolidate Secrets Manager to one JSON secret per credential family where the code already resolves JSON (`config.ResolveObject`) — document the manual migration steps in the report rather than moving live secrets. S3 lifecycle for `clean/`, `transcripts/` (IA at 60 d), `chatmedia/`, `profile/`. `cdk synth` diff summarised in the report (what is destroyed). Commit `"infra: nothing bills while idle — the voice service is gone until it can be serverless"`.

## 4. Tasks — wave two (after T1 + T2 merged)

### T5 — The kit (branch `r7-kit`)
`mobile/src/design/kit/` — every component from the canvas' component sheet and screens, className-based, configurable by props, documented in `src/design/README.md`, with a dev-only gallery route `app/_kit.tsx` (excluded from production via `__DEV__`) that renders every variant for screenshots:
`Screen`, `TopRow` (`← TODAY` style back label + right actions), `Segments` (CONVERSATIONS · TASKS · RECEIPTS, ink active), `Button` (`primary` ink, `secondary` outline 1.5, `void` red, `stamp` violet, `ghost` mono link, `disabled`; `md`/`compact`; `full`), `Card` (`paper` | `carbon` | `void-border` | `stamp-border` | `dashed`; padded), `KeyValue` (dotted-leader rows, `ok` green, `void`), `TaskCard` (`waiting` | `running` | `done` | `failed` | `capture`; check square, kind eyebrow, quote line, actions), `ConversationRow` (time · place, duration, title, summary, chips `TE + EN`, `n COMMITMENTS`, `n DONE ✓`), `Receipt` (existing, restyled: `LYZN · PROOF OF WORK`, stamp −11°, paper always), `ReceiptCard` (compact roll item), `Banner` (`carbon` | `void` | `paper`; dot + label + action), `Toggle` (44×26 pill, settled green), `Field` (1.5 ink border, focus stamp, invalid void), `CodeBoxes` (6 boxes, caret stamp), `Chip`, `Sheet` (bottom sheet with handle, context strip), `AskBar` (input + ink `ASK`), `Progress` (3/6 px bar), `Waveform` (existing, void), `TabBar`, `InkPicker` (six inks, double ring), `EmptyCard` (eyebrow, statement, line, action), `NotificationCard` (for the in-app notification list), `RecordingPill` (void border, dot, `RECORDING`, timer, bars), `MetaLine`, `Label`, `Txt`.
Migrate `Touchable`, `Toast`, `Enter`, `MarkPulse`, `Scrub`, `TickRow` to classes. Keep `Receipt`'s Skia. Tests for pure models (`taskCardState`, `receiptFromTask`, label joins). Commit `"app: the kit — every part on the canvas, once, with its rule"`.

## 5. Tasks — wave three (after T5; API contracts from §2.4, mocked in the client until T3a/T3b merge)

### T6 — Onboarding, plan, pendant, settings (branch `r7-onboarding`)
O1, A1 (SSO + email code via Clerk), O2, U1 chooser (config-driven; payment per the Clerk/Razorpay report — native `react-native-razorpay` if new-arch-safe, else `react-native-webview` Standard Checkout; `POST /orders` → checkout → `POST /orders/:ref/verify` → `user.reload()`), U2 receipt, O3/O3b, O6, O7; P1/P2/P3 from real device fields (battery, storage, firmware, recording tri-state, unsynced audio, last sync persisted now); SET (account, ink, theme, notifications, retention copy, export, delete everything with confirm). Remove `live.tsx`, `voice.tsx`, `src/live`, `src/voice`, `voiceUrl`. Notification permission asked after the first pairing (O7), not at launch; channels/categories per §2.4; routing table (pure) tested. Commit `"app: the way in — welcome, sign in, choose, pair, the light, the first receipt"`.

### T7 — Home, conversations, Ask lyzn (branch `r7-home`)
H1 with the three segments; conversation rows from recordings; C1 state (recording pill + timer + waveform, **no live transcript**); C2 detail: title/meta, player, `n COMMITMENTS FOUND · n STILL OPEN` carbon card, `SUMMARY · n KEY POINTS`, **`REMEMBERED · n FACTS`** card (facts from the recording; `REMEMBERED · v2` after relabel), transcript with speaker chips and rename sheet (PATCH speakers → toast "Memory will be re-filed"); C4 Ask sheet (scoped to the conversation; answers cite `↳ 11:08` chips that scroll the transcript); L1/L2/L3 tab (GitLoom chat via existing `/chat` SSE; citations via `GET /memory/search`; capture tier shows the locked card); S3 empties. Commit `"app: home is the record — conversations, what they meant, and what was remembered"`.

### T8 — Tasks and receipts (branch `r7-tasks`)
TASKS segment (T1 list with `MARK DONE` in capture tier, batch select bar when `features.execution`), T2 detail (source quote → tapping opens the recording at the utterance, `WHAT WILL HAPPEN` only when execution), T3 edit, T4 states, T5 failed (only when execution); RECEIPTS segment (R2 roll by day, `YOUR EFFORT SAVED` card only when execution — else the count of receipts), R1 detail with `FROM` link back to the conversation, share as image (`react-native-view-shot` + `expo-sharing`); receipts for pairing/plan/task-done all come from `GET /receipts`. Notification taps route to task/receipt/recording. Commit `"app: tasks are the gate, receipts are the proof"`.

## 6. Wave four — integration (controller + one agent, branch `r7-integrate`)
Merge order, tab layout finalisation, dead code removal (`categories.tsx`, `chat/[id].tsx`, `Composer` if unused, `OrbVisual`/thinking-orbs if unused, `voice` deps), `bun run test`, `tsc`, `expo export`, simulator screenshot pass of every route in light and dark against the canvas, `app.json` version bump to 4.3.0, changelog in the ledger.

## 7. Verification on the simulator

`cd mobile && npx expo run:ios --device "iPhone 17 Pro"` builds the dev client locally (Xcode present). Screenshots: `xcrun simctl io booted screenshot <path>`. Navigate with `npx uri-scheme open "lyzn://<route>" --ios` or by tapping. Every UI task attaches screenshots of its screens in both themes to its report directory. Nothing visual is claimed without a screenshot.

## 8. Merge order

T1 → T2 → (T3a, T3b, T4 held) → T5 → (T6, T7, T8) → integration. Backend branches merge to `main` after their gates; T4 waits for the owner. Mobile branches merge in order; the release tag comes after integration.

## 9. Open for the owner (assumptions the plan proceeds under)

1. The voice call retires with the voice service (no voice screen in the canvas; serverless voice is a later round).
2. Sign-in is Apple · Google · email code (the canvas draws phone OTP; Clerk phone OTP is not set up).
3. In-app payment goes through Razorpay for the physical pre-order; the ₹499/mo Act Pro subscription is disclosed in-app but only started on the web (store policy).
4. Daemon, WhatsApp and execution ship as flagged slots, off.
