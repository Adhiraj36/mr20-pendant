# Site, round three: order in place, ink, the reference's pricing, a plain sign-in

Base: `main` at `ece74c8` (light theme, four-station story, three tiers, Archivo + Martian Mono, square `.btn`).

Reference site, extracted: `/private/tmp/claude-501/-Users-0mellob-Developer-code-mr20-pendant/ccbf241b-56d9-4493-b05e-3b302a9e4a90/scratchpad/lyzn-site/lyzn-site` — read `src/pages/index.html`, `styles/tokens.css`, `styles/pricing.css`, `styles/receipt.css`, `styles/page.css`, `src/lib/ink.js`, `scripts/ink.js`, `build.js` (ink functions, lines 55–115). **Never print or copy its `.env`.**

## Global constraints (bind every task)

- Typefaces and colours are already the reference's; do not add faces or new hex values outside what a task names.
- **Every interactive control is square.** `border-radius: 0` on buttons, inputs, selects, segmented controls, steppers, radios-as-cards, checkboxes, focus rings. Non-interactive cards may keep their radius unless a task says otherwise.
- The tier model (Capture ₹5,999 / Act ₹8,999 / Act Pro ₹12,999, each paid once) and the backend are **not** changed. `PLANS`, `priceOrder`, `chargedToday` in `web/src/data/pricing.ts` are the source of truth; a section shows what they say.
- No Clerk keys in code. The publishable key stays in `web/src/lib/env.ts`.
- Gates before any commit: `npm run lint` (`tsc -b`, the real one — `tsc --noEmit` checks nothing here), `npx vite build`, and a screenshot of what you built if a browser is available to you; if not, say so in the report rather than claiming it looks right.
- Commit trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019s83HMh3LRiqEkP4xX3Yg4
  ```
- Report to `.superpowers/sdd/2026-09-07-site-round-three/task-<n>-report.md`: COMPLETE/BLOCKED, commit sha, gate output verbatim, deviations with reasons.

## Task 1 — The order happens on the page (branch `r3-order-sheet`)

Today every Preorder/Reserve link navigates to `/order`. Make ordering happen without leaving the landing page.

- Build `web/src/order/OrderSheet.tsx`: a right-hand sheet (full-height panel, ~480px on desktop, full-screen on phones) mounted from `Landing`, containing the existing steps — `Choose`, `Details`, `Pay`, and the `Confirmed` receipt — as panels inside the sheet. Reuse the step components; move the shell chrome (stepper, summary, sticky bar) into the sheet's own frame. The page behind stays scrollable-locked and dimmed; Escape and the scrim close it.
- URL-backed: `/?order=choose|details|pay|confirmed[&plan=act][&ref=LYZN-…]`. Back/forward walk the steps; refresh re-opens the sheet at the same step. Keep the `/order/*` routes as redirects to the equivalent `/?order=…` so links in emails and the JSON-LD `url`s still land in the right place (`/order/confirmed?ref=X` → `/?order=confirmed&ref=X`).
- Export from `web/src/order/OrderContext.tsx`:
  ```ts
  openOrder(plan: PlanId, prefill?: { phone?: string; email?: string }): void
  closeOrder(): void
  ```
  `openOrder` sets the plan, merges the prefill into `contact`, and pushes `?order=choose&plan=…`. **Task 2 codes against this signature; do not change it.**
- Point every existing `OrderButtonLink` (hero, nav Preorder, Preorder section) at `openOrder` (the nav's Preorder opens with the default tier `act`).
- Razorpay's own sheet still opens over everything; the Confirmed panel replaces the sheet's content on success.
- Square every control you touch: `PlanSwitch`, `QuantityStepper`, `PaymentMethod`, `CheckboxField`, `TextControl`/`StateSelect` inputs, the stepper links in `Shell.tsx`, `Fields.tsx` — radius 0, and `:focus-visible` in `index.css` gets `border-radius: 0`.
- Commit: `"order: the order happens on the page"`.

## Task 2 — What it costs, as the reference has it (branch `r3-pricing`)

The section must look **the same** as the reference's section 02. Port it, do not reinterpret it.

- Rewrite `web/src/sections/Pricing.tsx` (and add `web/src/styles/pricing.css` imported by it, or a scoped block in `index.css`) from the reference's `#preorder` markup and `styles/pricing.css` + `styles/receipt.css`, faithfully: the `.sec-head` with `02` / "What it costs" / the note; the `fieldset.tiers` radio cards (mono tier name and price, mono `.tier-line`, bullets and `.tier-foot` shown only for the checked tier, 1.5px `--rule` border, 2px `--ink` when checked); the sticky `.pricing-right` paysheet with the checked tier's `.slip.price.rcpt` receipt (scalloped edges by radial-gradient, `.s-head`/`.ln`/`.lead`/`.ln.sum`/`.was` PLAUD row/`.code` barcode/`.s-foot`, the rotated `--stamp` stamp, the `print` reprint animation on tier change); and the `.order` form below it — PHONE, EMAIL, the `RESERVE ACT · ₹8,999` button, the `.fine` line `SHIPS November 2026 · BATCH 01 · REFUNDABLE UNTIL DISPATCH`. Mobile (≤900px): the paysheet becomes the fixed bottom `<details>` sheet with the `.paysheet-bar` (name / total / RESERVE), exactly as the reference does it.
- Use the reference's tokens **scoped to this section** as CSS variables (`--desk #E3E4DE`, `--paper #FBFBF8`, `--ink #1C1C16`, `--faded #6E6F64`, `--rule #D5D5CC`, `--stamp #3B2FD4`, `--settled #1B6B45`, `--void #B03A2E`), and the reference's 28px grid on the desk ground for the section. The barcode: use `barcodeBars` from `@lyzn/design` seeded by tier id, drawn as the reference draws it (repeat-x background of bars).
- Content comes from `PLANS` / `COMPARE` / `PRICING` in `web/src/data/pricing.ts` and `content.ts` — names, prices, bullets, feet, receipt rows, footer, the PLAUD comparison — so the section can never disagree with the checkout. Add whatever string fields are missing to those objects rather than hard-coding in JSX.
- The form's submit validates phone (10 digits) and email like the reference's `form.js`, then calls `openOrder(tier, { phone, email })` from `@/order/OrderContext` (Task 1's contract). Until Task 1 lands in your worktree that import will not exist: stub it locally as `navigate('/order?plan=' + tier)` behind a single function so the swap is one line, and say so in the report.
- Delete nothing from `pricing.ts`; the old tier-card version of the section is replaced wholesale.
- Commit: `"pricing: what it costs, as the reference prints it"`.

## Task 3 — Ink (branch `r3-ink`)

The reference lets the reader pick the heading ink. Reproduce it.

- `web/src/lib/ink.ts`: the six inks from the reference's `src/lib/ink.js` (`ink #1C1C16` default, `red #A30002`, `orange #7D4600`, `green #006826`, `blue #0052A8`, `purple #8400A1`), storage key `lyzn.ink`.
- `<html data-ink="…">` drives `--heading`; `h1, h2, h3` (the `display-*` classes) take `color: var(--heading, var(--tone-fg))`. Add the `[data-ink="…"]{--heading:…}` rules to `index.css`. A bootstrap `<script>` in `web/index.html` reads localStorage before first paint so a stored ink never flashes the default (reference `inkBootstrap`).
- The header row of six dots (`.ink-row` / `.ink-dot`, square, `--ink-sw` sized to the nav button height, checked = double ring) in `Nav.tsx` between the links and the Preorder button, which **retires** after a pick for that page view (reference `retireHeader`), and the footer row with the `INK` label in `Footer.tsx` that never retires. Roving tabindex, `role="radiogroup"`. The stacked mobile nav gets the footer-style row.
- Keep it to headings, as the reference does — not the stamp, not buttons.
- Commit: `"site: pick your ink"`.

## Task 4 — A plain sign-in (branch `r3-signin`)

Details currently mounts Clerk's stock `<SignIn/>`. Replace it with a sign-in that is ours and minimal.

- `web/src/components/checkout/SignInCard.tsx` using Clerk's headless hooks (`useSignIn`, `useSignUp`, `useClerk`): one email field → **Send code** → a six-digit code field → done. Try `signIn.create({ identifier })` + `email_code` first factor; if the account does not exist, fall back to `signUp.create({ emailAddress })` + `prepareEmailAddressVerification`, verify with the same code field, then `setActive`. Errors inline, in the existing `Field` error style; the button disabled while a request is in flight; resend after 30 s.
- Same components as the rest of the form (`Field`, `TextControl`, `Button`), mono labels, square inputs. No logos, no social buttons, no Clerk CSS. The eyebrow/body copy stays `CHECKOUT.details.signIn`.
- Swap it in for `<SignIn/>` in `web/src/pages/Details.tsx` with the smallest possible change to that file — Task 1 is moving Details into a sheet at the same time.
- Do not touch the `ClerkProvider` or `env.ts`.
- Commit: `"checkout: sign in with an email and a code, nothing else"`.

## Merge order and the controller's checks

1 → 4 → 3 → 2 into `auth-payments-design-system`, then the controller (me) resolves the `Details.tsx` overlap between 1 and 4, swaps Task 2's stub for `openOrder`, and screenshot-verifies: hero → Preorder opens the sheet in place; the pricing section beside the reference at 1440 and 390; an ink pick persisting across reload; sign-in with a `+clerk_test@example.com` address and code `424242` on the test instance.
