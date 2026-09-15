# Auth, payments and the shared design system — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buyer signs in with Clerk on lyzn.ai, pays Razorpay for a plan (and optionally the ₹1,500/month Automation subscription) in one sheet, the backend records what they chose, and the app — restyled onto the website's ink-and-paper, receipts-as-proof language through a package both consume — shows the same identity the same plan.

**Architecture:** Five workstreams. (1) `packages/design` holds the tokens, the receipt model and the barcode generator both platforms draw from; web consumes a generated `@theme` block, mobile consumes the TypeScript. (2) The backend gains a payments surface — `/orders`, `/orders/:ref/verify`, `/plan`, and a Razorpay webhook — recording orders and entitlement in the existing single table. (3) Web gets a `ClerkProvider`, sign-in inside the Details step, a live Razorpay Checkout in the Pay step, an order-fetching Confirmed page, and SEO with the brand assets. (4) Mobile is restyled per its existing spec, in that spec's own order, and reads `/plan`. (5) Razorpay itself gets the Plan and the webhook created, in test then live.

**Tech Stack:** Go 1.24 / Fiber / `razorpay-go` · CDK · React 19 + Vite + Tailwind v4 + `@clerk/clerk-react` · Expo 57 + Skia + Reanimated 4 + `@clerk/clerk-expo` (already wired) · one shared TS package via `file:` deps (web is npm, mobile is bun, there is no workspace).

**Specs:** `docs/superpowers/specs/2026-09-04-lyzn-website-design.md` (§5 visual system, §9 checkout) and `docs/superpowers/specs/2026-09-06-lyzn-app-ui-design.md` (the whole mobile restyle; §9 there is the order of work and is followed verbatim). Where the website spec and `web/src/index.css` disagree, the CSS wins — the app spec §0.2 already says so.

## Global Constraints

- Direct to `main` when verified; no users yet. Work happens on a branch so a labelled PR can prove the checkout on a preview backend in Razorpay **test** mode before anything touches live keys.
- Money: nothing charges a live card until the Razorpay live Plan id and webhook exist (W5) and the test-mode run has been observed end to end.
- The signal colour `#C9A76A` never fills anything larger than 8 px; no gradients; no blue, no green, no amber in UI. The **brand mark itself stays green** — it is the logo, not the palette (see Decision 3).
- Never `fontWeight` without the matching Geist family name on mobile (Android synthesises a fake bold).
- Rupee formatting `₹5,999`, `₹1,500 / month` with a non-breaking space; `money()`/`monthly()` are the only formatters.
- Razorpay key **secret** and webhook secret never leave the backend. The publishable key id is public.
- The Clerk publishable keys are public by design: prod `pk_live_Y2xlcmsubHl6bi5haSQ`, test `pk_test_d2lyZWQtZ29yaWxsYS00LmNsZXJrLmFjY291bnRzLmRldiQ` (both are base64 of the frontend host — verified against the prod key already in `app.json`).
- Data plane is `backend/lib/data-plane.ts`; no new table. New rows use the existing PK/SK and GSI1.
- Keep everything the app spec §9 "Keep" paragraph lists.
- GitLoom: **no SDK change is required by this plan.** Receipts in the app render from recording facts and tasks the API already returns; structured receipts from Mira's chat are the spec's `[MIRA_RECEIPTS]` slot and are out of scope. If that slot is ever filled, the structured event has to come from `gitloom-go`'s `WrapKarma` — contribute there first, then consume.

## Decisions made here (overrule before Workstream 5 runs)

**Decision 1 — the ₹1,500 subscription is set up in the same sheet, billed from today.** Razorpay Subscriptions accept `addons`: one-time charges added to the first invoice. So when Automation is on, the backend creates a *Subscription* on the ₹1,500 Plan with the chosen plan's price as an add-on, and one Checkout sheet takes ₹5,999 + ₹1,500 and establishes the monthly mandate. That is the seamless path. It changes the copy from "billed monthly from the day you activate it" to "billed monthly from today" — `AUTOMATION.checkoutLine` in `pricing.ts`. The alternative — record the intent, bill later on activation — does not "handle" the subscription, it defers it.

**Decision 2 — sign-in is required, and it is the Details step.** The point of recording the plan is that the app knows it, and the app identifies people by Clerk `sub`. A guest order cannot be linked. So the Details step opens with Clerk's `<SignIn>` (Google, Apple, email code) when signed out, and once signed in shows the form with name and email prefilled from the session and locked. One tap for a Google user; the order row is written under their `sub`.

**Decision 3 — logos come from `assets/lyzn/`, and they are green.** The app spec retires green from the *UI palette*; the brand mark is not UI. Favicon, touch icon, PWA icons, App Store icon and the Play icon are the verified assets. The Android adaptive-icon *background* goes from `#083F0A` to ink `#0B0B0C` per the spec; the mark on it stays.

## Dependency graph and parallelism

```
W1 design package ─┬─▶ W3 web (tokens)          W5 razorpay ops ─▶ W2 config
                   └─▶ W4 mobile (everything)
W2 backend ────────┬─▶ W3 web (endpoints)
                   └─▶ W4 mobile (Profile /plan)
```

Run **W1, W2, W5 in parallel** first. Then **W3 and W4 in parallel**. W4 is the long pole; after its foundations task, its screen groups can fan out to separate agents. W3's SEO task has no dependencies at all and can start at once.

---

## Workstream 1 — `packages/design`

### Task 1.1: The package, its tokens, and the receipt model

**Files:**
- Create: `packages/design/package.json`
- Create: `packages/design/tsconfig.json`
- Create: `packages/design/src/index.ts`
- Create: `packages/design/src/tokens.ts`
- Create: `packages/design/src/receipt.ts`
- Create: `packages/design/src/money.ts`
- Test: `packages/design/test/receipt.test.ts`, `packages/design/test/money.test.ts`

**Interfaces:**
- Produces: `colors`, `tones`, `space`, `radius`, `dur`, `ease`, `typeScale` (tokens); `ReceiptRowSpec`, `ReceiptSpec`, `barcodeBars(seed: string): number[]`; `money(n: number): string`, `monthly(n: number): string`.

- [ ] **Step 1: Package manifest.** TypeScript source is the artifact — both Vite and Metro compile TS, so there is no build step and no `dist/` to forget to rebuild.

```json
{
  "name": "@lyzn/design",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./tokens.css": "./tokens.css" },
  "scripts": {
    "gen:css": "node scripts/gen-css.mjs",
    "test": "tsc -p tsconfig.json --noEmit && node --test --experimental-strip-types test/*.test.ts"
  },
  "devDependencies": { "typescript": "~5.8.3", "@types/node": "^22.14.0" }
}
```

- [ ] **Step 2: Tokens.** Values are lifted verbatim from `web/src/index.css` `@theme` (the shipped values — the app spec §0.2 says the CSS wins over the website spec) and the app spec §4.1.

```ts
// packages/design/src/tokens.ts
/**
 * The LYZN visual system, as numbers.
 *
 * Warm monochrome: two grounds, ink and paper, and one signal colour that
 * never fills anything larger than 8px. The web reads these through a
 * generated @theme block; the app reads them directly. Neither may hold a
 * colour of its own — if something is missing, it is added here.
 */
export const colors = {
  ink: '#0B0B0C', charcoal: '#131315', void: '#050506',
  graphite: '#1C1C1F', graphite2: '#242428',
  paper: '#F3F1EC', paper2: '#EAE7E0', paper3: '#DDD9D0',
  fg: '#EDEAE4', fgMuted: '#A6A39D', fgFaint: '#8D8C87',
  inkFg: '#141416', inkMuted: '#5B5A57', inkFaint: '#66655F',
  signal: '#C9A76A', danger: '#B5483C',
  receiptPaper: '#FBFAF6', receiptInk: '#16181A', receiptFaint: '#8A8880',
} as const

export type Ground = 'ink' | 'paper'

export const tones = {
  ink: {
    bg: colors.ink, fg: colors.fg, muted: colors.fgMuted, faint: colors.fgFaint,
    line: 'rgba(237,234,228,0.10)', line2: 'rgba(237,234,228,0.22)',
    panel: colors.graphite, panel2: colors.graphite2,
    invBg: colors.fg, invFg: colors.ink, statusBar: 'light',
  },
  paper: {
    bg: colors.paper, fg: colors.inkFg, muted: colors.inkMuted, faint: colors.inkFaint,
    line: 'rgba(20,20,22,0.10)', line2: 'rgba(20,20,22,0.24)',
    panel: colors.paper2, panel2: colors.paper3,
    invBg: colors.inkFg, invFg: colors.paper, statusBar: 'dark',
  },
} as const satisfies Record<Ground, unknown>

/** 4pt rhythm. The website's scale (§5.3) and the app's agree on the base. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48, giant: 64 } as const

export const radius = { sm: 6, md: 10, lg: 14, xl: 20 } as const

export const dur = { micro: 120, ui: 160, reveal: 700, slow: 900 } as const
export const ease = {
  out: [0.16, 1, 0.3, 1], inOut: [0.65, 0, 0.35, 1], in: [0.4, 0, 1, 1],
} as const

/**
 * Sizes in px at a phone-width viewport; the web wraps the display sizes in
 * clamp() when it generates its CSS. Weights are 400/500/600 only — never 700.
 */
export const typeScale = {
  displayXL: { size: 44, weight: 500, tracking: -0.035, leading: 0.98 },
  displayL:  { size: 32, weight: 500, tracking: -0.03,  leading: 1.02 },
  displayM:  { size: 24, weight: 500, tracking: -0.02,  leading: 1.1 },
  bodyL:     { size: 18, weight: 400, tracking: -0.005, leading: 1.5 },
  body:      { size: 16, weight: 400, tracking: 0,      leading: 1.55 },
  small:     { size: 14, weight: 400, tracking: 0,      leading: 1.5 },
  label:     { size: 12, weight: 500, tracking: 0.12,   leading: 1.2, mono: true, uppercase: true },
} as const

export const fonts = {
  sans: "'Geist', 'Geist Fallback', 'Geist Fallback Arial', 'Inter Tight', 'Inter', ui-sans-serif, system-ui, sans-serif",
  mono: "'Geist Mono', 'Geist Mono Fallback', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const
```

- [ ] **Step 3: Failing test for the barcode.** The barcode must be deterministic — the same id always draws the same code on both platforms, or it admits it is decoration.

```ts
// packages/design/test/receipt.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barcodeBars } from '../src/receipt.ts'

test('same seed, same bars, on every call', () => {
  assert.deepEqual(barcodeBars('LYZN-ABC12'), barcodeBars('LYZN-ABC12'))
})
test('84 bars, each width 1 to 3', () => {
  const bars = barcodeBars('anything')
  assert.equal(bars.length, 84)
  assert.ok(bars.every((w) => w >= 1 && w <= 3))
})
test('different seeds differ', () => {
  assert.notDeepEqual(barcodeBars('LYZN-A'), barcodeBars('LYZN-B'))
})
```

- [ ] **Step 4: Run it, expect FAIL** — `cd packages/design && npm test` → "Cannot find module '../src/receipt.ts'".

- [ ] **Step 5: The receipt model.** The LCG is the one in `web/src/components/Receipt.tsx` today, moved here so both platforms share it and the web's `Barcode` becomes a consumer.

```ts
// packages/design/src/receipt.ts
/**
 * A receipt is proof of work: a heading, a cut, what was said, the rows
 * carried out, a total, a barcode nobody is meant to scan. This is the
 * model; each platform draws it.
 */
export type ReceiptRowSpec = {
  k: string
  v?: string
  /** A confirmed value: the one place the signal colour appears. */
  ok?: boolean
  /** Sentence case rather than the uppercase key — task text. */
  plain?: boolean
}

export type ReceiptSpec = {
  title?: string
  meta?: string
  /** DONE, FILED, PAID. Absent on a slip still open. */
  stamp?: string
  quote?: string
  rows?: ReceiptRowSpec[]
  total?: { k: string; v: string }
  /** Seeds the barcode and is printed under it. */
  barcode?: string
  footer?: string
}

export const RECEIPT_TITLE = 'LYZN · PROOF OF WORK'
export const BARCODE_BARS = 84

/** Bar widths 1–3 from a cheap hash of the seed. Deterministic on purpose. */
export function barcodeBars(seed: string): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const bars: number[] = []
  for (let i = 0; i < BARCODE_BARS; i++) {
    h = (h * 1103515245 + 12345) >>> 0
    bars.push(1 + ((h >>> 8) % 3))
  }
  return bars
}
```

- [ ] **Step 6: Money formatters and their test.** Moved out of `web/src/data/pricing.ts` so the app formats the same way.

```ts
// packages/design/src/money.ts
/** ₹5,999 — Indian grouping, no decimals; nothing here has paise. */
export function money(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`
}
/** ₹1,500 / month, with a non-breaking space before the slash. */
export function monthly(amount: number): string {
  return `${money(amount)} / month`
}
```
```ts
// packages/design/test/money.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { money, monthly } from '../src/money.ts'
test('rupees group Indian-style with no paise', () => assert.equal(money(5999), '₹5,999'))
test('monthly keeps the slash on the same line', () => assert.equal(monthly(1500), '₹1,500 / month'))
```

- [ ] **Step 7: `index.ts` re-exports everything; run `npm test`, expect PASS.**

- [ ] **Step 8: Commit** — `git add packages/design && git commit -m "@lyzn/design: the tokens, the receipt model and the barcode, shared"`

### Task 1.2: Generated CSS for the web

**Files:**
- Create: `packages/design/scripts/gen-css.mjs`
- Create (generated, committed): `packages/design/tokens.css`
- Modify: `web/src/index.css` — replace the hand-written `@theme { … }` block with `@import '@lyzn/design/tokens.css';`
- Modify: `web/package.json` — add `"@lyzn/design": "file:../packages/design"`
- Modify: `web/vite.config.ts` — `resolve.preserveSymlinks: true` if the file: link is a symlink; `server.fs.allow` to include `../packages`

**Interfaces:**
- Produces: `tokens.css` whose `@theme` custom properties are exactly the names the web already uses (`--color-ink`, `--color-fg-faint`, `--font-sans`, `--ease-out`, `--dur-ui` …), so no class in `web/src` changes.

- [ ] **Step 1: The generator.** It writes the same names the web has today; a diff of the generated file against the old block must show only ordering and comments.

```js
// packages/design/scripts/gen-css.mjs
import { writeFileSync } from 'node:fs'
import { colors, fonts, dur, ease } from '../src/tokens.ts'

const kebab = (s) => s.replace(/([A-Z0-9])/g, (m) => '-' + m.toLowerCase())
// The web's existing names for the few that do not kebab cleanly.
const names = { inkFg: 'inkfg', inkMuted: 'inkmuted', inkFaint: 'inkfaint', graphite2: 'graphite-2', paper2: 'paper-2', paper3: 'paper-3', fgMuted: 'fg-muted', fgFaint: 'fg-faint' }

let out = `/* Generated from @lyzn/design/src/tokens.ts — do not edit. */\n@theme {\n`
for (const [k, v] of Object.entries(colors)) out += `  --color-${names[k] ?? kebab(k)}: ${v.toLowerCase()};\n`
out += `  --font-sans: ${fonts.sans};\n  --font-mono: ${fonts.mono};\n`
for (const [k, v] of Object.entries(ease)) out += `  --ease-${kebab(k)}: cubic-bezier(${v.join(', ')});\n`
for (const [k, v] of Object.entries(dur)) out += `  --dur-${k}: ${v}ms;\n`
out += `}\n`
writeFileSync(new URL('../tokens.css', import.meta.url), out)
console.log('wrote tokens.css')
```

- [ ] **Step 2: Run `npm run gen:css`; diff against the current block** — `diff <(sed -n '/^@theme {/,/^}/p' web/src/index.css | grep -- '--' | sort) <(grep -- '--' packages/design/tokens.css | sort)`. Expected: no value differences (names identical; `receipt*` are additions).

- [ ] **Step 3: Wire the web to it.** `cd web && npm install ../packages/design`, replace the `@theme` block with the import, `npm run build`. Expected: build passes, `dist/assets/*.css` contains `--color-signal:#c9a76a`.

- [ ] **Step 4: Web's `Receipt.tsx` imports `barcodeBars` from `@lyzn/design`** and deletes its local copy; `pricing.ts` re-exports `money`/`monthly` from the package. `npm run build` again.

- [ ] **Step 5: Commit** — `"web reads its @theme from @lyzn/design, generated"`.

### Task 1.3: Mobile consumes the package

**Files:**
- Modify: `mobile/package.json` — `"@lyzn/design": "file:../packages/design"`
- Modify: `mobile/metro.config.js` — `watchFolders: [path.resolve(__dirname, '../packages/design')]`, `resolver.nodeModulesPaths` to include `mobile/node_modules`
- Modify: `mobile/tsconfig.json` — `paths` for `@lyzn/design` if Metro's resolution needs it
- Modify: `mobile/src/design/tokens.ts` — becomes a thin re-export plus RN-only additions (font family names, `readableWidth`)

- [ ] **Step 1: `cd mobile && bun add ../packages/design`**; confirm `node_modules/@lyzn/design` resolves to the source.
- [ ] **Step 2: `tokens.ts` re-exports** `colors`, `tones`, `space`, `radius`, `dur` from the package and keeps only what RN needs: `fontFamily` map (`Geist_400Regular` …), `readableWidth = 560`, and a `type` map built from `typeScale` that attaches the family name to every entry (spec §4.2: never a weight without its family).
- [ ] **Step 3: `bun run test`** — the existing suite passes; add `mobile/tests/design/tokens.test.ts` asserting `colors.signal === '#C9A76A'` and that every `type` entry has a `fontFamily`.
- [ ] **Step 4: Commit** — `"mobile reads tokens from @lyzn/design"`. The app still compiles on its *old* palette-using screens because the old `palette` export is kept as a deprecated alias until Workstream 4 removes it.

---

## Workstream 2 — Backend: orders, entitlement, webhook

### Task 2.1: Razorpay client and signature verification

**Files:**
- Create: `backend/go/internal/payments/razorpay.go`
- Create: `backend/go/internal/payments/signature.go`
- Test: `backend/go/internal/payments/signature_test.go`
- Modify: `backend/go/internal/config/config.go` — add `RazorpayPlanAutomation string \`env:"RAZORPAY_PLAN_AUTOMATION" optional:"true"\``; `Razorpay()` returns a third value `webhookSecret` from the JSON field `webhookSecret`
- Modify: `backend/go/go.mod` — `github.com/razorpay/razorpay-go`

**Interfaces:**
- Produces: `payments.Client(ctx) (*razorpay.Client, error)`; `payments.VerifyPayment(orderOrSubID, paymentID, signature, keySecret string) bool`; `payments.VerifyWebhook(body []byte, signature, webhookSecret string) bool`.

- [ ] **Step 1: Failing signature tests.** Razorpay signs `order_id|payment_id` (orders) or `payment_id|subscription_id` (subscriptions) with HMAC-SHA256 over the key secret; webhooks sign the raw body with the webhook secret.

```go
// signature_test.go
package payments

import "testing"

func TestVerifyPaymentOrder(t *testing.T) {
	// hmac_sha256("order_abc|pay_xyz", "secret") — computed once, pinned.
	sig := hmacHex("order_abc|pay_xyz", "secret")
	if !VerifyPayment("order_abc", "pay_xyz", sig, "secret") {
		t.Fatal("a correct signature must verify")
	}
	if VerifyPayment("order_abc", "pay_xyz", sig, "wrong") {
		t.Fatal("the wrong secret must not verify")
	}
	if VerifyPayment("order_abc", "pay_other", sig, "secret") {
		t.Fatal("a signature for another payment must not verify")
	}
}

func TestVerifySubscription(t *testing.T) {
	sig := hmacHex("pay_xyz|sub_abc", "secret")
	if !VerifySubscription("sub_abc", "pay_xyz", sig, "secret") {
		t.Fatal("subscription signatures are payment|subscription")
	}
}

func TestVerifyWebhook(t *testing.T) {
	body := []byte(`{"event":"payment.captured"}`)
	sig := hmacHex(string(body), "whsec")
	if !VerifyWebhook(body, sig, "whsec") {
		t.Fatal("a webhook signed with the webhook secret must verify")
	}
	if VerifyWebhook([]byte(`{"event":"tampered"}`), sig, "whsec") {
		t.Fatal("a changed body must not verify")
	}
}
```

- [ ] **Step 2: `go test ./internal/payments/` → FAIL (undefined).**

- [ ] **Step 3: Implement.** Constant-time comparison; never `==` on a MAC.

```go
// signature.go
package payments

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

func hmacHex(message, secret string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(message))
	return hex.EncodeToString(m.Sum(nil))
}

func equal(a, b string) bool { return hmac.Equal([]byte(a), []byte(b)) }

// VerifyPayment checks the signature Checkout returns for a one-time order.
func VerifyPayment(orderID, paymentID, signature, keySecret string) bool {
	return equal(hmacHex(orderID+"|"+paymentID, keySecret), signature)
}

// VerifySubscription checks the signature Checkout returns for a subscription
// authorisation. Note the operand order differs from an order's.
func VerifySubscription(subscriptionID, paymentID, signature, keySecret string) bool {
	return equal(hmacHex(paymentID+"|"+subscriptionID, keySecret), signature)
}

// VerifyWebhook checks X-Razorpay-Signature over the raw request body.
func VerifyWebhook(body []byte, signature, webhookSecret string) bool {
	return equal(hmacHex(string(body), webhookSecret), signature)
}
```

```go
// razorpay.go
package payments

import (
	"context"
	"sync"

	razorpay "github.com/razorpay/razorpay-go"

	"github.com/MelloB1989/mr20-pendant/backend/internal/config"
)

var (
	mu     sync.Mutex
	client *razorpay.Client
	keyID  string
	secret string
	whsec  string
)

// Client returns the shared Razorpay client, resolving credentials once per
// container. Live or test keys per environment — the secret name decides.
func Client(ctx context.Context) (*razorpay.Client, error) {
	mu.Lock()
	defer mu.Unlock()
	if client != nil {
		return client, nil
	}
	id, sec, wh, err := config.Razorpay(ctx)
	if err != nil {
		return nil, err
	}
	keyID, secret, whsec = id, sec, wh
	client = razorpay.NewClient(id, sec)
	return client, nil
}

// KeyID is the public half, handed to Checkout on the web.
func KeyID(ctx context.Context) (string, error) {
	if _, err := Client(ctx); err != nil {
		return "", err
	}
	return keyID, nil
}
func KeySecret(ctx context.Context) (string, error) { _, err := Client(ctx); return secret, err }
func WebhookSecret(ctx context.Context) (string, error) { _, err := Client(ctx); return whsec, err }
```

- [ ] **Step 4: `config.Razorpay` grows a third return** — the JSON secret is `{keyId, keySecret, webhookSecret}`; a missing `webhookSecret` is an error only when the webhook is verified, so return it as empty and let `VerifyWebhook`'s caller refuse. Update the existing callers (none yet) and the doc comment.

- [ ] **Step 5: `go get github.com/razorpay/razorpay-go@latest && go test ./internal/payments/` → PASS. `go vet ./...`.**

- [ ] **Step 6: Commit** — `"payments: Razorpay client and the three signatures it uses"`.

### Task 2.2: Order and plan rows

**Files:**
- Create: `backend/go/internal/ddb/orders.go`
- Test: `backend/go/internal/ddb/orders_test.go` (pure functions: key builders and the entitlement derivation)
- Modify: `backend/go/internal/ddb/ddb.go` — extend the key-scheme doc comment

**Interfaces:**
- Produces:
```go
type Order struct {
	Reference      string `dynamodbav:"reference"`
	UserID         string `dynamodbav:"userId"`
	Plan           string `dynamodbav:"plan"`      // pendant | software
	Quantity       int    `dynamodbav:"quantity"`
	Automation     bool   `dynamodbav:"automation"`
	DueToday       int    `dynamodbav:"dueToday"`  // rupees
	Monthly        int    `dynamodbav:"monthly"`   // rupees, 0 or 1500
	Status         string `dynamodbav:"status"`    // created | paid | failed
	RazorpayOrderID        string `dynamodbav:"rzpOrderId,omitempty"`
	RazorpaySubscriptionID string `dynamodbav:"rzpSubscriptionId,omitempty"`
	RazorpayPaymentID      string `dynamodbav:"rzpPaymentId,omitempty"`
	Contact        Contact `dynamodbav:"contact"`
	CreatedAt      string `dynamodbav:"createdAt"`
	PaidAt         string `dynamodbav:"paidAt,omitempty"`
}
type Contact struct { FullName, Email, Phone, Line1, Line2, City, State, Pin, InvoiceName, Gstin string; Address []string }
type Plan struct {
	Plan           string `dynamodbav:"plan"`       // pendant | software | none
	Automation     bool   `dynamodbav:"automation"`
	SubscriptionID string `dynamodbav:"subscriptionId,omitempty"`
	Status         string `dynamodbav:"status"`     // active | halted | cancelled | none
	Since          string `dynamodbav:"since,omitempty"`
	OrderReference string `dynamodbav:"orderReference,omitempty"`
}
func PutOrder(ctx, o Order) error
func GetOrder(ctx, userID, reference string) (Order, error)
func OrderByRazorpayID(ctx, id string) (Order, error)   // GSI1: RZP#<id> / ORDER
func MarkOrderPaid(ctx, userID, reference, paymentID string) error
func PutPlan(ctx, userID string, p Plan) error
func GetPlan(ctx, userID string) (Plan, error)          // zero-value Plan{Plan:"none",Status:"none"} when absent
func PlanFromOrder(o Order) Plan                        // pure
```
- Keys: `PK=USER#<sub> SK=ORDER#<reference>`, with `GSI1PK=RZP#<razorpay order or subscription id> GSI1SK=ORDER` so the webhook can find the row without a user id. `PK=USER#<sub> SK=PLAN` for the entitlement.

- [ ] **Step 1: Failing test for `PlanFromOrder` and the key builders.**
```go
func TestPlanFromOrder(t *testing.T) {
	o := Order{Reference: "LYZN-1", Plan: "pendant", Automation: true, RazorpaySubscriptionID: "sub_1", PaidAt: "2026-09-07T00:00:00Z"}
	p := PlanFromOrder(o)
	if p.Plan != "pendant" || !p.Automation || p.SubscriptionID != "sub_1" || p.Status != "active" || p.OrderReference != "LYZN-1" {
		t.Fatalf("got %+v", p)
	}
	if PlanFromOrder(Order{Plan: "software"}).Status != "active" { t.Fatal("a paid one-time plan is active") }
}
func TestOrderKeys(t *testing.T) {
	if orderPK("user_1") != "USER#user_1" || orderSK("LYZN-1") != "ORDER#LYZN-1" || rzpGSI("order_9") != "RZP#order_9" {
		t.Fatal("key scheme")
	}
}
```
- [ ] **Step 2: FAIL. Step 3: implement with the same `dynamodbav` patterns `ddb.go` uses for recordings (look at `PutProfile`/`GetProfile` for the shape). `MarkOrderPaid` is an `UpdateItem` with a condition `attribute_exists(PK)` and sets `status, rzpPaymentId, paidAt`. Step 4: PASS. Step 5: update the key-scheme comment at the top of `ddb.go`:**
```
//	Order      PK USER#<sub>   SK ORDER#<reference>   GSI1PK RZP#<rzp id>  GSI1SK ORDER
//	Plan       PK USER#<sub>   SK PLAN
```
- [ ] **Step 6: Commit** — `"ddb: orders and the plan a user is on"`.

### Task 2.3: `POST /orders`, verify, `GET /orders/:ref`, `GET /plan`

**Files:**
- Create: `backend/go/internal/api/orders.go`
- Modify: `backend/go/internal/api/app.go` — `registerOrderRoutes(authed)`
- Test: `backend/go/internal/api/orders_test.go` (request validation and amount computation, no network)

**Interfaces:**
- Consumes: `payments.Client/KeyID/KeySecret/VerifyPayment/VerifySubscription`, `ddb.PutOrder/GetOrder/MarkOrderPaid/PutPlan/PlanFromOrder`, `config.Get().RazorpayPlanAutomation`.
- Produces (HTTP):
  - `POST /orders` `{plan, quantity, automation, contact}` → `201 {reference, dueToday, monthly, checkout: {keyId, orderId?, subscriptionId?, amount, currency:"INR", name:"LYZN", description, prefill:{name,email,contact}, notes:{reference}}}`
  - `POST /orders/:reference/verify` `{razorpay_payment_id, razorpay_order_id?, razorpay_subscription_id?, razorpay_signature}` → `200 {order}` or `400 {error:"signature"}`
  - `GET /orders/:reference` → `{order}`
  - `GET /plan` → `{plan, automation, status, since, subscriptionId?}`

- [ ] **Step 1: Failing tests.** Amounts are computed server-side from a server-side price table — the client's numbers are never trusted.
```go
func TestQuoteMatchesPricing(t *testing.T) {
	q := quote("pendant", 2, false)
	if q.dueToday != 11998 || q.monthly != 0 { t.Fatalf("%+v", q) }
	q = quote("software", 5, true) // software clamps to one licence
	if q.dueToday != 3999 || q.monthly != 1500 { t.Fatalf("%+v", q) }
}
func TestQuoteRejectsUnknownPlan(t *testing.T) {
	if _, err := quoteChecked("gold", 1, false); err == nil { t.Fatal("unknown plan must be refused") }
}
func TestRupeesToPaise(t *testing.T) { if paise(5999) != 599900 { t.Fatal() } }
```
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.** The price table mirrors `pricing.ts` and is the source of truth for money:
```go
var prices = map[string]int{"pendant": 5999, "software": 3999}
const automationMonthly = 1500
const maxQuantity = 5
```
`createOrder`:
1. parse + validate (plan in table; quantity 1..5, forced to 1 for software; contact fields per `validateDetails` rules — name, email, 10-digit phone; address for pendant).
2. `reference := "LYZN-" + strings.ToUpper(base36(now)) + salt` (same shape as the web's `makeReference`, generated here so it is unique and server-owned).
3. If `!automation`: `client.Order.Create(map[string]any{"amount": paise(q.dueToday), "currency": "INR", "receipt": reference, "notes": {"reference": reference, "user": sub}})` → `rzpOrderId`.
4. If `automation`: `client.Subscription.Create({"plan_id": cfg.RazorpayPlanAutomation, "total_count": 120, "quantity": 1, "customer_notify": 1, "notes": {...}, "addons": [{"item": {"name": planName, "amount": paise(q.dueToday), "currency": "INR"}}]})` → `rzpSubscriptionId`. **Decision 1** lives here: one sheet, plan price as the first-invoice add-on.
5. `ddb.PutOrder` with `Status: "created"`.
6. Respond with the checkout block. `amount` is `paise(dueToday + monthly)` for subscriptions (what the sheet will show) and `paise(dueToday)` for orders.

`verifyOrder`: load the row (must belong to `sub`); pick `VerifyPayment` or `VerifySubscription` by which id is present and matches the row; on success `MarkOrderPaid` + `PutPlan(PlanFromOrder)`; return the order. A second verify of an already-paid order is a `200` (idempotent), not an error.

`getPlan`: `ddb.GetPlan(sub)`.

- [ ] **Step 4: PASS; `go vet ./...`.**
- [ ] **Step 5: Commit** — `"api: orders, their verification, and the plan a user is on"`.

### Task 2.4: The webhook

**Files:**
- Create: `backend/go/internal/api/webhooks.go`
- Modify: `backend/go/internal/api/app.go` — `app.Post("/webhooks/razorpay", razorpayWebhook)` registered on the **unauthenticated** app, before the `authed` group
- Test: `backend/go/internal/api/webhooks_test.go`

**Interfaces:**
- Consumes: `payments.VerifyWebhook/WebhookSecret`, `ddb.OrderByRazorpayID/MarkOrderPaid/PutPlan/GetPlan`.
- Handles events: `payment.captured`, `payment.failed`, `subscription.activated`, `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`. Everything else → `200` and ignored. Unknown ids → `200` (Razorpay retries on non-2xx; a row we do not have is not a reason to be retried forever) with a log line.

- [ ] **Step 1: Failing tests** — a signed body updates state; an unsigned one is `401`; a repeat of the same event is a no-op (idempotent: `MarkOrderPaid` on a paid order does nothing, `PutPlan` is a full overwrite so replays converge).
```go
func TestWebhookRejectsBadSignature(t *testing.T) {
	app := fiber.New(); app.Post("/webhooks/razorpay", razorpayWebhook)
	req := httptest.NewRequest("POST", "/webhooks/razorpay", strings.NewReader(`{"event":"payment.captured"}`))
	req.Header.Set("X-Razorpay-Signature", "nope")
	res, _ := app.Test(req)
	if res.StatusCode != 401 { t.Fatalf("got %d", res.StatusCode) }
}
func TestEventToPlanStatus(t *testing.T) {
	cases := map[string]string{"subscription.activated": "active", "subscription.charged": "active", "subscription.halted": "halted", "subscription.cancelled": "cancelled", "subscription.completed": "cancelled"}
	for ev, want := range cases { if statusFor(ev) != want { t.Fatalf("%s → %s", ev, statusFor(ev)) } }
}
```
- [ ] **Step 2: FAIL. Step 3: implement.** Read the raw body (`c.Body()`), verify, `json.Unmarshal` into `{event string; payload struct{ payment struct{entity struct{id, order_id, subscription_id string}}; subscription struct{entity struct{id, status string}} }}`. Resolve the order by `order_id` or `subscription_id` via GSI1. Apply. Always `c.SendStatus(200)` after a valid signature.
- [ ] **Step 4: PASS. Step 5: Commit** — `"api: Razorpay webhook, the source of truth for what was paid"`.

### Task 2.5: Config, stacks, deploy

**Files:**
- Modify: `backend/bin/app.ts` — `ENVIRONMENTS.{production,staging}.razorpayPlanAutomation` (ids from W5), passed as `razorpayPlanAutomation` prop
- Modify: `backend/lib/mr20-stack.ts`, `backend/lib/preview-stack.ts` — prop + `RAZORPAY_PLAN_AUTOMATION` env on `apiFn`
- Modify: `backend/README.md` — routes table gains the four endpoints and the webhook

- [ ] **Step 1: Wire the prop into both stacks the way `razorpaySecretName` is.**
- [ ] **Step 2: `npx tsc --noEmit -p tsconfig.json`; `npx cdk synth --quiet`; confirm `RAZORPAY_PLAN_AUTOMATION` differs between the production and preview templates.**
- [ ] **Step 3: `go build ./... && go test ./...`.**
- [ ] **Step 4: Commit** — `"stacks carry the Automation plan id per environment"`. Deployment happens through the normal path: the preview PR first (W6), then main.

---

## Workstream 3 — Web: Clerk, live checkout, SEO and logos

### Task 3.1: `ClerkProvider` and the API client

**Files:**
- Modify: `web/package.json` — `@clerk/clerk-react`
- Modify: `web/src/main.tsx` — wrap in `<ClerkProvider publishableKey={…} appearance={…}>`
- Create: `web/src/lib/api.ts`
- Create: `web/.env.example` is **not** created (previews, not laptops); instead `web/src/lib/env.ts` reads `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL` with the production values as defaults so a plain build is production

**Interfaces:**
- Produces: `useApi(): { get<T>(path): Promise<T>; post<T>(path, body): Promise<T> }` attaching `Authorization: Bearer <getToken()>`; `API_URL`.

- [ ] **Step 1: `env.ts`**
```ts
export const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? 'pk_live_Y2xlcmsubHl6bi5haSQ'
export const API_URL = (import.meta.env.VITE_API_URL ?? 'https://api.lyzn.ai').replace(/\/$/, '')
```
- [ ] **Step 2: `api.ts`** — a hook over `useAuth().getToken`; throws `ApiError {status, message}` on non-2xx; `credentials` untouched (Bearer, not cookies).
- [ ] **Step 3: `main.tsx`** — `ClerkProvider` with `appearance` set from tokens: `variables: { colorPrimary: colors.inkFg, colorBackground: colors.paper, colorText: colors.inkFg, fontFamily: fonts.sans, borderRadius: '10px' }` so Clerk's components sit on paper like the checkout. `afterSignOutUrl="/"`.
- [ ] **Step 4: `npm run build` passes. Commit** — `"web: Clerk provider and an authenticated API client"`.

### Task 3.2: Details step signs the buyer in (Decision 2)

**Files:**
- Modify: `web/src/pages/Details.tsx`
- Modify: `web/src/components/checkout/Fields.tsx` — name/email fields accept `locked`
- Modify: `web/src/order/OrderContext.tsx` — `setContact` on sign-in

- [ ] **Step 1:** In `Details`, `const { isSignedIn, isLoaded } = useUser()`. While `!isLoaded`: the form's skeleton. When `!isSignedIn`: render, in the Contact panel's place, `<SignIn routing="virtual" appearance={{ elements: { rootBox: 'w-full', card: 'shadow-none bg-transparent p-0' } }} />` under the eyebrow `SIGN IN TO CONTINUE` and one line of body: *Your order is tied to your account, so the app knows what you chose.* Clerk handles Google, Apple and email code; nothing is reimplemented.
- [ ] **Step 2:** On `isSignedIn`, `useEffect` → `setContact({ fullName: user.fullName ?? contact.fullName, email: user.primaryEmailAddress.emailAddress })` once, then the existing form renders with those two fields `locked` (rendered as text with a `Change` ghost link that opens `<UserButton>`'s account portal). Phone and address are typed as today.
- [ ] **Step 3:** `Pay` and `Confirmed` gain the guard the spec §9.6 describes: not signed in → `navigate('/order/details')`.
- [ ] **Step 4:** `npm run build`. Manually: `npm run dev`, `/order/details` shows Clerk's sign-in on paper; sign in with Google; the form appears prefilled. **Commit** — `"checkout: the buyer signs in at Details, so the order is theirs"`.

### Task 3.3: Pay step opens Razorpay Checkout

**Files:**
- Modify: `web/src/pages/Pay.tsx` — replace the `openHostedLink` / rehearsal branch (lines ~64–80)
- Modify: `web/src/data/payment.ts` — delete `RAZORPAY_LINK`, `hostedLinkFor`, `CREATE_ORDER_ENDPOINT`; keep `PAY_METHODS`; add `loadCheckout(): Promise<typeof window.Razorpay>` that injects `https://checkout.razorpay.com/v1/checkout.js` once
- Modify: `web/src/data/pricing.ts` — `AUTOMATION.checkoutLine` → *Lets LYZN complete tasks on your computer. Billed monthly from today. Cancel any time.* (Decision 1)
- Modify: `web/index.html` — `<link rel="preconnect" href="https://checkout.razorpay.com">`

- [ ] **Step 1: `onPay`:**
```ts
const api = useApi()
const created = await api.post<CreatedOrder>('/orders', { plan: config.plan, quantity: config.quantity, automation: config.automation, contact })
const Razorpay = await loadCheckout()
const rzp = new Razorpay({
  key: created.checkout.keyId,
  ...(created.checkout.orderId ? { order_id: created.checkout.orderId } : { subscription_id: created.checkout.subscriptionId }),
  name: 'LYZN', description: created.checkout.description, prefill: created.checkout.prefill,
  notes: created.checkout.notes, theme: { color: colors.inkFg },
  handler: async (r: RazorpayResponse) => {
    const verified = await api.post<{ order: Order }>(`/orders/${created.reference}/verify`, r)
    place(toPlacedOrder(verified.order)); navigate('/order/confirmed')
  },
  modal: { ondismiss: () => setNotice("Payment didn't go through. Nothing was charged.") },
})
rzp.on('payment.failed', () => setNotice("Payment didn't go through. Nothing was charged."))
rzp.open()
```
- [ ] **Step 2:** The button reads `Pay ₹X` where X is `dueToday + monthly` when automation is on (the sheet will show that figure), with the rail keeping the two lines separate as the spec requires; the rail's "Due today" footnote becomes *₹5,999 today, then ₹1,500 / month* when automation is on.
- [ ] **Step 3:** Network failure on `/orders` → inline notice, button re-enabled (spec §9.6). Remove the rehearsal notice block (`!PAYMENT_LIVE`) entirely.
- [ ] **Step 4:** `npm run build`. **Commit** — `"checkout: Razorpay Checkout, one sheet, plan and subscription alike"`.

### Task 3.4: Confirmed page is a receipt from the server

**Files:**
- Modify: `web/src/pages/Confirmed.tsx`

- [ ] **Step 1:** Read `reference` from `placed` (session) or `?ref=`; `api.get(`/orders/${reference}`)`; render the spec §9.4 layout, and render the summary block as **`<Receipt stamp="PAID" title="LYZN · ORDER" meta={date} rows={[…plan, quantity, automation, address…]} total={{k:'PAID', v: money(dueToday)}} barcode={reference} footer="KEEP THIS" />`** — the site's argument is receipts, and an order confirmation is the most literal one it will ever show.
- [ ] **Step 2:** Automation on → the extra "What happens next" row reads *Automation is active. ₹1,500 / month from today. Manage it from the app.*
- [ ] **Step 3:** `npm run build`. **Commit** — `"confirmed: the order, as the receipt it is"`.

### Task 3.5: SEO and the brand assets

**Files:**
- Modify: `web/index.html`
- Create: `web/public/robots.txt`, `web/public/sitemap.xml`, `web/public/manifest.webmanifest`
- Copy: `assets/lyzn/web/favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-192-maskable.png` → `web/public/`
- Create: `web/src/lib/useDocumentTitle.ts`; use it in every page (`Landing` → the existing title; `Choose` → *Choose your plan — LYZN*; `Details`, `Pay`, `Confirmed` → *Order — LYZN*; `Privacy`, `Terms`)

- [ ] **Step 1: `index.html` head** — keep what is there; add `<link rel="canonical" href="https://lyzn.ai/">`, `<link rel="icon" href="/favicon.ico" sizes="any">` (keep the SVG as the second `<link rel="icon" type="image/svg+xml">`), `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`, `<link rel="manifest" href="/manifest.webmanifest">`, `<meta property="og:url" content="https://lyzn.ai/">`, `<meta property="og:site_name" content="LYZN">`, `<meta name="twitter:title">`/`twitter:description`/`twitter:image`, and a JSON-LD block:
```html
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"LYZN Pendant","brand":{"@type":"Brand","name":"LYZN"},
 "description":"An AI pendant that remembers your conversations, turns them into tasks, and, if you let it, gets them done.",
 "image":"https://lyzn.ai/img/og.jpg","url":"https://lyzn.ai/",
 "offers":[{"@type":"Offer","name":"LYZN Pendant","price":"5999","priceCurrency":"INR","availability":"https://schema.org/PreOrder","url":"https://lyzn.ai/order?plan=pendant"},
           {"@type":"Offer","name":"Software","price":"3999","priceCurrency":"INR","availability":"https://schema.org/PreOrder","url":"https://lyzn.ai/order?plan=software"}]}
</script>
```
- [ ] **Step 2: `robots.txt`** allows all, `Sitemap: https://lyzn.ai/sitemap.xml`; `sitemap.xml` lists `/`, `/order`, `/privacy`, `/terms` (not the details/pay/confirmed steps). `manifest.webmanifest`: name LYZN, `theme_color #0B0B0C`, `background_color #0B0B0C`, the three icons with `purpose` set.
- [ ] **Step 3:** The `Nav` wordmark stays type (it is the site's own); the `Footer` gains the mark from `assets/lyzn/logo/lyzn-logo-vector.svg` inlined as a component `web/src/components/Mark.tsx` at 20 px in `currentColor`... **no** — the mark is green by brand (Decision 3): inline the SVG with its own `#226326` fill, 16 px, beside the wordmark in the footer only.
- [ ] **Step 4:** `npm run build`; `curl -s localhost:4173/robots.txt` after `npm run preview`. Validate the JSON-LD with `python3 -c "import json,re,sys;h=open('web/index.html').read();json.loads(re.search(r'ld\+json\">(.*?)</script>',h,re.S).group(1))"`. **Commit** — `"web: SEO, the manifest, and the brand mark from assets/lyzn"`.

---

## Workstream 4 — Mobile: the restyle, per its spec, plus `/plan`

The spec is the design. This workstream's tasks are the spec's §9 "Order of work" steps, each pointing at the spec sections that define it. An executor reads the spec section; the plan says what "done" is.

### Task 4.1: Foundations — the app runs end to end on the new palette (spec §9 step 1)

**Files:** `mobile/src/design/tokens.ts` (from Task 1.3), create `tone.tsx`, rewrite `motion.ts`, rewrite `primitives.tsx`, modify `app/_layout.tsx` (fonts), every `app/**/*.tsx` gets `<Screen ground=…>` per spec §1.1's route table.
- Spec: §3.1 Foundations, §4 (tokens, typography, motion), §1.1 routes with their ground, §9 "Fonts" and "Reanimated" notes.
- [ ] `bun add @expo-google-fonts/geist @expo-google-fonts/geist-mono`; `useFonts` in `_layout.tsx`; `SplashScreen.preventAutoHideAsync()` until fonts **and** Clerk are ready.
- [ ] `tone.tsx`: `ToneProvider`, `useTone()`, `Screen({ground, children})` — the only place a ground is chosen.
- [ ] `primitives.tsx` per §3.1/§3.2 export list; `Txt` variants carry `fontFamily`.
- [ ] Every route wrapped in `Screen`; `bun run test` passes; `npx expo run:ios` boots to the Library on paper with nothing green. Old `palette` export removed only when the grep in Task 4.7 says nothing reads it.
- [ ] **Commit** — `"app: ink and paper foundations; every screen has a ground"`.

### Task 4.2: Receipt, Stage, TickRow, Scrub, Toast, Mark (spec §9 step 2)

**Files:** create `mobile/src/design/Receipt.tsx`, `mobile/src/design/stage/*.tsx`, `TickRow.tsx`, `Scrub.tsx`; restyle `Toast.tsx`; rewrite `icons.tsx` (`Mark` from `assets/lyzn/logo/lyzn-logo-vector.svg` as an RN SVG, `AppleMark`, `GoogleMark`).
- Spec: §3.3 (the Receipt, exactly — Skia path with `PathOp.Difference` bites, shadow inside the path, barcode as `Rect`s from **`barcodeBars` in `@lyzn/design`**, the print animation via measured bands), §3.4 stage family, §9 "Receipt" note.
- Test: `mobile/tests/design/receipt.test.ts` — the row model accepts `plain`, the barcode draws 84 rects for a seed and the same 84 for the same seed.
- [ ] **Commit** — `"app: receipts as proof, the stage family, and the mark"`.

### Task 4.3: Library and recording detail — paper (spec §9 step 3; §2.6, §2.7)
- The printing receipt for a conversation in progress; the filed row when ready; `TaskRow`, `[ACTION_SOURCE]` sweep. Facts and tasks come from the existing `/recordings` API — this is where "each task and fact is a receipt row" becomes literal.
- [ ] **Commit** — `"app: the Library prints receipts and files them"`.

### Task 4.4: Pendant tab and the rig (spec §9 step 4; §2.13, §5)
- [ ] **Commit** — `"app: the pendant on ink"`.

### Task 4.5: Mira home, thread, voice, live (spec §9 step 5; §2.9–2.12)
- `StatusBlock` rows for memory tool steps; `[MIRA_RECEIPTS]` stays a slot (Global Constraints: no GitLoom change).
- [ ] **Commit** — `"app: Mira on ink"`.

### Task 4.6: Onboarding (spec §9 step 6; §2.1–2.5) — the pairing receipt on Ready
- [ ] **Commit** — `"app: onboarding, ending on a receipt"`.

### Task 4.7: Profile with the plan, categories, tab bar, icons, `app.json`, and the sweep (spec §9 steps 7–8; §2.14, §8)

**Files:** `app/profile.tsx`, `app/categories.tsx`, tab bar, `app.json`, `mobile/assets/*` icons, `mobile/src/api/plan.ts`.
- [ ] `plan.ts`: `fetchPlan(): Promise<{plan, automation, status, since}>` via the existing client → `GET /plan`.
- [ ] Profile gains a **`Receipt`** titled `LYZN · YOUR PLAN` with rows `PLAN … PENDANT`, `AUTOMATION … ON ✓` (ok when active) / `OFF`, `SINCE … 7 SEP 2026`, stamp `ACTIVE`/`HALTED`; when `plan === 'none'`: a `Panel` with *No plan yet* and a ghost link to lyzn.ai/order. Fetched on focus; cached in the store.
- [ ] Icons: `assets/lyzn/app-icon/ios-marketing-1024.png` → `mobile/assets/icon.png`; `assets/lyzn/app-icon/android-monochrome.png` → `android-icon-monochrome.png`; foreground from `assets/lyzn/logo/lyzn-landing-logo.png` (the mark, transparent); `android-icon-background.png` regenerated as a flat `#0B0B0C` 1024² PNG; `splash-icon.png` the transparent mark; `app.json`: splash `backgroundColor` and adaptive `backgroundColor` → `#0B0B0C`, notifications `color` → `#EDEAE4`.
- [ ] The grep from spec §9 step 8 returns nothing: `grep -rE 'GradientCard|AmbientWash|Tile|TickDial|DotMatrix|palette\.accent|speakerColor|radius\.pill|glow\(|lift' mobile/src mobile/app`.
- [ ] `bun run test`; `npx expo run:ios`; **Commit** — `"app: profile shows the plan as a receipt; icons from assets/lyzn; nothing green remains"`.

---

## Workstream 5 — Razorpay: the Plan and the webhook (ops, no code)

### Task 5.1: Create the Automation Plan, test then live
- [ ] `POST https://api.razorpay.com/v1/plans` with the **test** key: `{"period":"monthly","interval":1,"item":{"name":"LYZN Automation","amount":150000,"currency":"INR","description":"Lets LYZN complete tasks on your computer."}}` → `plan_…`. Repeat with the **live** key. Record both ids in `ENVIRONMENTS` (Task 2.5): staging = test id, production = live id.
### Task 5.2: Create the webhooks
- [ ] `POST /v1/webhooks` (test key) `{"url":"https://q5ohcn5mup3gnmfnvgsie7y2xa0jeijv.lambda-url.ap-south-1.on.aws/webhooks/razorpay","events":["payment.captured","payment.failed","subscription.activated","subscription.charged","subscription.halted","subscription.cancelled","subscription.completed"],"secret":"<generated>"}`; the same for live. The Function URL rather than `api.lyzn.ai` because that DNS record is not set yet; swap to the domain once it is.
- [ ] Put each `secret` into the matching `mr20/razorpay/{test,prod}` JSON as `webhookSecret` (a `put-secret-value` of the whole object with the new field — read, add, write).
- [ ] The preview stack shares production's ARN-less test webhook only by accident of both using the test key; previews rely on `/verify`, not the webhook.

---

## Workstream 6 — Prove it, then ship

### Task 6.1: The preview PR, in Razorpay test mode
- [ ] Branch `auth-payments-design-system`; all workstreams land on it. Open a PR, label `preview`. `VITE_API_URL` for a preview build is the commented preview URL; `VITE_CLERK_PUBLISHABLE_KEY` is the test key.
- [ ] Walk the checkout on the preview: sign in with a test Google account → pendant ×1 + Automation on → the sheet shows ₹7,499 → pay with Razorpay's test UPI `success@razorpay` → Confirmed shows the receipt with `PAID` → `GET /plan` on the preview returns `{plan:"pendant", automation:true, status:"active"}`; the preview's table has the ORDER and PLAN rows. Repeat for software without automation (₹3,999, an Order not a Subscription).
- [ ] Trigger a test webhook from the Razorpay dashboard for `subscription.halted`; `GET /plan` reads `halted`.

### Task 6.2: Ship
- [ ] `mobile`: `npx expo run:ios` and `run:android` boot; `bun run test` passes; nothing green in the grep.
- [ ] Merge to `main` (direct push is fine — early, no users). Backend CI deploys; web CI syncs. Swap the Razorpay webhook URL to `api.lyzn.ai` when that DNS record lands.
- [ ] Close the preview PR (teardown).

---

## Self-review

**Spec coverage.** Website spec §9.1–9.6: covered by 3.2–3.4 (sign-in added to §9.2, the sheet in §9.3, the receipt in §9.4, the notices in §9.6). App spec §9 steps 1–8: Tasks 4.1–4.7 in the same order. App spec §3 inventory: 4.1 (foundations), 4.2 (Receipt, stage, TickRow, Scrub, Toast, icons). §8 assets: 4.7. The user's asks: web auth (3.1–3.2), app auth (already complete — verified in `mobile/src/api/auth.ts` and `_layout.tsx`; nothing to do), design package (W1), built off web (Task 1.1 lifts `index.css`), Razorpay complete with plan recorded and the ₹1,500 subscription handled (W2, W5, 3.3), seamless (Decisions 1 and 2), SEO and logos (3.5, 4.7), receipts (Confirmed as a receipt, Profile plan as a receipt, Library facts and tasks as receipt rows), GitLoom (no change needed; trigger stated in Global Constraints).

**Placeholders.** None: every endpoint has its request and response shape; every signature has its operand order; the subscription add-on call is written out; the plan ids are created in 5.1 before 2.5 reads them.

**Type consistency.** `barcodeBars` (1.1) is what web `Receipt.tsx` (1.2) and mobile `Receipt.tsx` (4.2) import. `Order`/`Plan` (2.2) are what 2.3, 2.4 and `plan.ts` (4.7) read. `config.Razorpay` returns three values after 2.1; `payments.Client` is its only caller. `PlanFromOrder` sets `Status: "active"` for a paid one-time plan, so `/plan` is truthful for software buyers too.

**A gap, stated.** The mobile app currently identifies people by the same Clerk instance as the web (prod `clerk.lyzn.ai`), so a plan bought on the site appears in the app for the same account. On a **preview**, the web build uses the test Clerk instance and the preview backend trusts the test issuer — but the *shipped* app trusts production, so an app cannot be pointed at a preview backend without a dev build using the test publishable key. That is by design (production tokens are refused by staging); it means Task 6.1 proves `/plan` with `curl` and a test session token, not with the App Store build.
