# Site, round four: pre-order prices, pay where you are, one type, one desk

Base: `main` at `45d5af2`.

Reference site, extracted: `/private/tmp/claude-501/-Users-0mellob-Developer-code-mr20-pendant/ccbf241b-56d9-4493-b05e-3b302a9e4a90/scratchpad/lyzn-site/lyzn-site` — `styles/tokens.css`, `styles/page.css`, `styles/pricing.css`, `styles/receipt.css`, `src/partials/base.html`. **Never open or copy its `.env`.**

## Global constraints (bind every task)

- Money is computed on the server from a table; the client never invents an amount. Every figure the site shows comes from `web/src/data/pricing.ts`.
- Gates before any commit: `cd web && npm run lint` (`tsc -b`; a bare `tsc --noEmit` checks nothing here) and `npx vite build`; for backend, `cd backend/go && go build ./... && go vet ./... && go test ./...`. Screenshot what you built if a browser is available; if not, say so — never claim it looks right. The Playwright MCP browser is shared with other agents this session: prefer a headless script of your own, or re-navigate right before every capture.
- Commit trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019s83HMh3LRiqEkP4xX3Yg4
  ```
- Report to `.superpowers/sdd/2026-09-07-site-round-four/task-<n>-report.md` (copy it to the main checkout too): COMPLETE/BLOCKED, sha, gate output verbatim, deviations with reasons.

## The pre-order price model (all tasks share this)

Every tier has a **full price** and a **pre-order amount** — what is charged today. The balance is due on dispatch (November 2026). Act Pro adds a monthly subscription from activation; **no mandate is taken today** — the device has not shipped, and a subscription for an unshipped product cannot be billed. It is disclosed on the card, the slip and the receipt, and set up from the app at activation.

| tier | full | pre-order today | recurring |
|---|---|---|---|
| Capture | ₹5,999 | **₹999** | — |
| Act | ₹9,999 | **₹3,999** | — |
| Act Pro | ₹4,999 | **₹4,999** | ₹499 / month from activation |

`pricing.ts`: `PLANS[id].price` stays the full price; add `deposit` (charged today) and keep `renewal` on Act Pro as `{ price: 499, from: 'activation' }`. `priceOrder` returns `dueToday = deposit × quantity`, `chargedToday = dueToday`, plus `full = price × quantity` and `balance = full − dueToday`. Backend `prices` map becomes the deposits; add a `fullPrices` map for the order record (`Order.Full`) so the receipt can say what is still owed.

## Task 1 — The model, both sides (branch `r4-model`)

- `web/src/data/pricing.ts`: `deposit` on each tier, `Totals.full`/`balance`, `chargedFor` unchanged in meaning (what was taken). Receipt rows on each tier's slip say `FULL PRICE`, `PRE-ORDER TODAY`, `BALANCE ON DISPATCH`, and for Act Pro `FROM ACTIVATION … ₹499/MO`. Update copy that says "paid once"/"total, forever" to what is now true (stamp `PRE-ORDER`; footer `Balance on dispatch · November 2026`).
- `backend/go/internal/api/orders.go`: `prices` = deposits (`capture 999, act 3999, act-pro 4999`), `fullPrices` = `5999, 9999, 4999`; `ddb.Order` gains `Full int`; `planLabel` reads e.g. `LYZN Act · pre-order`. **Contact validation for a pre-order needs only email and phone** — name optional (fall back to the email's local part), address not required; keep the address fields accepted if sent. Adjust `validateContact` and its tests; `TestQuoteMatchesPricing` pins the deposits.
- `web/index.html` JSON-LD: three offers at the full price with `"availability": "https://schema.org/PreOrder"` and a `priceSpecification` for the deposit is not required — keep it simple: price = full.
- Commit: `"pricing: pre-order — a deposit today, the balance on dispatch"`.

## Task 2 — Pay where you are (branch `r4-inline`)

The order sheet goes away. Nothing navigates: the pricing section's paysheet is the whole flow.

- In `web/src/sections/Pricing.tsx`, replace the phone/email form's submit with a **stateful inline flow** inside the same `.paysheet` column, one stage at a time, all in the reference's form style (mono labels, square inputs, `.btn`):
  1. **Phone + email** → `Reserve <tier> · ₹<deposit>` → this sends the Clerk email code (reuse the logic in `web/src/components/checkout/SignInCard.tsx`: sign-in first, sign-up fallback; extract a hook if that is cleaner). If the visitor is already signed in, skip to stage 3.
  2. **Code** — a six-digit field under the email row, `Verify`, resend after 30 s, inline errors.
  3. **Pay** — the button becomes `Pay ₹<deposit>`; on press `POST /orders` with `{plan, quantity: 1, contact: {email, phone, fullName?}}` (no address), open Razorpay Checkout exactly as `web/src/pages/Pay.tsx` does (`loadCheckout`, `handler` → `POST /orders/:ref/verify`), then
  4. **Receipt** — the paysheet's slip re-prints as the order receipt: stamp `PRE-ORDERED`, rows `TIER`, `PAID TODAY`, `BALANCE ON DISPATCH`, `REFERENCE`, meta the date; the form is replaced by a one-line confirmation and `A confirmation is on its way to <email>`.
- The mobile paysheet (`<details>` bottom sheet) carries the same stages.
- **Detach the sheet, don't delete it:** `OrderSheet` is no longer mounted from `Landing`; the `/order/*` redirects point at `/#pricing`; `openOrder` becomes a no-op that scrolls to `#pricing` and preselects the tier (the hero and nav buttons call it). Leave `OrderSheet.tsx` and the step pages in place with a one-line comment at the top saying they are detached as of this round, so they can return when the full checkout is needed.
- Codes against Task 1's shape: `PLANS[id].deposit`, `priceOrder(...).dueToday` as the amount charged. Until Task 1 lands in your worktree, read `deposit ?? price`.
- Commit: `"order: pay where you are — phone, email, a code, and the deposit"`.

## Task 3 — One type, one desk (branch `r4-type-desk`)

- **Type as the reference sets it.** Headings (`.display-xl`, `.display-l`, `.display-m`, `h1/h2/h3`) at Archivo **800** with the reference's tracking (`.intro h1`: `-.038em`, line-height `.97`; `.sec h2`: as in `page.css`). **Every button** is the reference's `.btn`: Martian Mono 11px 700, letter-spacing .1em, uppercase, 12px 18px padding, ink on paper, hover `--stamp` (#3B2FD4) with white text — `Button.tsx`, `.btn`, `.btn-primary/secondary/ghost/compact` in `index.css` all fold into that one look (ghost stays borderless, same type). The wordmark `LYZN` in the nav and footer is the reference's `.mark`: Martian Mono 700 15px .1em. Mono labels (`.label`, `.label-sm`) at Martian Mono 500 as they are. Nothing else changes face or weight. Remove any leftover `Geist` reference.
- **One ground.** The whole page sits on the reference's desk: body `background: #E3E4DE` with the 28px grid from `tokens.css`; every landing section is `transparent` (no `paper`/`paper-2` bands, no footer band); the pricing section stops painting its own desk (same value, one owner). Panels and slips on it are paper (`#FBFBF8`, the reference's `--paper`): set `--tone-panel` for the page ground to that value and `--tone-panel-2` to the current paper (`#F3F1EC`), so cards read as paper on a desk. Add `desk` to `packages/design/src/tokens.ts`, regenerate `tokens.css`.
- **Posters.** The three poster stills bake their ground in; on the desk they would be three lighter squares. Re-render `a`, `b`, `c` from the `/poster` dev route with its ground set to the desk (`Poster.tsx`), 1600×1600, `cwebp -q 84` — the route's own comment has the recipe. `og` stays on ink.
- Check the hero: the headline still has to clear the pendant at 1440 and 390 after the weight change; adjust `max-w-[12ch]` if 800 makes it wrap differently.
- Commit: `"site: the reference's type on every button and heading, and one desk under everything"`.

## Merge order

1 → 3 → 2. Task 2 touches `Pricing.tsx` heavily and Task 3 touches its ground; the controller resolves. After the merge: browser pass of the inline flow on the Clerk test instance (`+clerk_test` needs Test mode on the instance; otherwise a real inbox), Razorpay test mode on a preview, then main.
