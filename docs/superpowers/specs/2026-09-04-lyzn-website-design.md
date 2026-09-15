# LYZN preorder website: design specification and implementation handoff

**Date:** 2026-09-04
**Author:** creative direction pass (Fable)
**Implementer:** Opus, in `web/`
**Status:** ready for implementation, pending the confirmations listed in section 0

This document replaces the current `web/` landing page design (the warm-paper "technical drawing" site with Fraunces serif, green accent, feature readouts, use-case grid and FAQ). The checkout scaffolding in `web/src/order`, `web/src/components/checkout` and `web/src/data/payment.ts` is worth keeping and restyling. Everything visual on the landing page is replaced.

The whole site is built around one sentence:

**TALK. LYZN REMEMBERS. LYZN UNDERSTANDS. LYZN ACTS.**

---

## 0. Read this first: facts, assumptions and open slots

Everything below was checked against the repo, not the brief alone. Where the two disagree, the repo wins, because the site has to show the object that ships.

### 0.1 The pendant has a glass front, not a textile one

The brief describes a woven textile face. The 3D model in this repo (`mobile/assets/pendant.glb` and the baked `pendant_textured.glb`), the product video (`pendant-vid.mp4`, `mobile/assets/pendant.mp4`) and every existing render show a different object:

- rounded square, 35 × 35 × 11 mm, corner radius roughly a third of the width
- bead-blasted graphite metal shell (GLB material: base #1A1A1C, metallic 0.92, roughness 0.34, clearcoat)
- a flat, near-black glass panel inset on the front (+Z), sitting proud of a thin chamfered lip
- two microphone pinholes, upper-left of the glass in the photography; the GLB models the opening as a small mesh at the top centre of the glass
- one oblong button on the left edge, a USB-C tongue on the bottom lip
- a dished, domed back (−Z) shaped to lie against the sternum
- a braided textile cord in all photography (not part of the GLB)

The baked texture set is flat graphite: no weave, no fabric. **This spec designs for the object as modelled.** The "material" moment (3D state B) is the glass edge, the chamfer and the microphone opening at the top of the glass, and the braided cord carries the textile warmth in photography. If a new Blender export with a fabric face exists, swap the GLB and point state B at the face; nothing else in this document changes.

### 0.2 Assumptions the copy is written under (confirm or correct before launch)

| # | Assumption | Where it shows |
|---|---|---|
| A1 | ₹3,999 software-only is a **one-time** price. The brief gives no billing period. If it is yearly, append "/year" in `PRICING` and the checkout line item. | Pricing, checkout |
| A2 | Software-only means the LYZN app used without the pendant. Copy never says how audio gets in. | Pricing card B |
| A3 | Automation (₹1,500/month) is **reserved** at checkout and **billed from activation**, not from preorder day. | Checkout toggle, confirmation |
| A4 | Preorders are **charged at order** through an Indian payment provider (Razorpay is already wired in `payment.ts`). Cancellation/refund terms are a slot. | Pay step, footnotes |
| A5 | Ship window is unknown. Every occurrence is the token `[SHIP_MONTH]`. | Hero eyebrow, pricing, confirmation |
| A6 | GST treatment is unknown. Token `[GST_NOTE]`, default text "Prices include GST". | Pricing footnote, summary rail |
| A7 | Pendant quantity 1 to 5 per order. Software-only quantity is fixed at 1. | Select step |
| A8 | Verified hardware facts used in copy: 19 g, braided cord, wakes on speech, stops after about ten seconds of quiet, one button, two microphones, USB-C, a working day of battery. (Sources: repo README, `docs/hardware-handoff/01-product-features.md`.) | Lifestyle, material caption |

### 0.3 Privacy: what the repo confirms and what is a slot

Confirmed by the code and handoff docs:

- The pendant records only while there is sound; it stops itself after about ten seconds of quiet.
- Every pulled recording is checked on the phone for speech. Files with under 0.75 s of speech are deleted from the pendant and never uploaded.
- Audio is uploaded to LYZN's servers (AWS) where it is cleaned, transcribed, separated by speaker and summarised. The original audio is kept alongside the cleaned file.
- Every recording appears in the app's Library with title, summary and transcript.
- The pendant is worn visibly. It has a haptic motor.

Slots (do not ship these lines until product confirms them):

- `[PRIVACY_DELETE]` what deleting a recording removes, and whether copies remain
- `[PRIVACY_RETENTION]` how long audio and transcripts are kept
- `[PRIVACY_ACCESS]` who at LYZN can access audio, and whether it trains models
- `[PRIVACY_HAPTIC_START]` whether the pendant buzzes when it starts recording (the motor exists; auto-buzz on start is unverified)

### 0.4 The reference files

The only reference images in the repo (`references/1.png`, `references/2.png`) are green glassmorphic chat-app mockups ("Chubi"). They conflict with the brief's palette and are not a website reference. This spec treats them as unrelated. The site direction below takes its restraint from the brief's stated principles and from antimattr.one's structure (short declarative headline, almost no body copy, one "reserve" CTA repeated, product first). Nothing is copied from either.

---

## 1. Site map

| Route | Page | Notes |
|---|---|---|
| `/` | Landing | single scrolling experience, eight sections plus footer |
| `/order` | Choose | plan switch, automation toggle, quantity |
| `/order/details` | Details | contact; delivery address only for the pendant |
| `/order/pay` | Pay | billing, payment method, terms, provider handoff |
| `/order/confirmed` | Confirmation | "You're in." / "You're ready to begin." |
| `/privacy` | Privacy policy | plain text page in the paper theme; linked from the privacy section and footer |
| `/terms` | Terms and refunds | plain text page; linked from pay step and footer |
| `*` | Not found | one line, one link home |

Guards (already in `OrderContext`): `/order/pay` bounces to `/order/details` without a valid contact (and address, for the pendant); `/order/confirmed` bounces to `/order` without a placed order. Basket persists to `sessionStorage`.

Anchors on `/`: `#product` (hero), `#how` (Conversation → Action), `#privacy`, `#pricing`.

---

## 2. Landing page structure

Eight sections. Each one answers exactly one of the six questions from the brief. Ground colour alternates in a deliberate arc: dark for discovery, paper for trust and price, dark again for desire.

| # | Section | Answers | Ground | Height (desktop) | 3D state |
|---|---|---|---|---|---|
| 01 | Hero | What is this? | Ink | 100vh pinned, 120vh runway | A → B |
| 02 | What it does | What is this? (in four lines) | Ink | ~110vh | B → anchor |
| 03 | Conversation → Action | How does it work? | Ink | 100vh pinned, 400vh runway | Anchor |
| 04 | Worn | Why should I care? | Charcoal | ~120vh | hidden |
| 05 | It can act | Why should I care? (differentiator) | Deep black | 100vh pinned, 250vh runway | hidden |
| 06 | Privacy | Can I trust it? | Paper | ~90vh | hidden |
| 07 | Pricing | How much? | Paper | ~110vh | static render |
| 08 | Preorder | What happens if I buy? | Ink | 100vh | C |
| — | Footer | | Black | ~30vh | hidden |

Total scroll length on desktop is about 12 viewport heights. That is intentionally short.

### 2.1 Section 01: Hero

**Purpose.** The object, one sentence, one button. Nothing else.

**Composition (desktop ≥1024).**
- Fixed WebGL canvas behind everything (see section 6). Pendant at 3D state A: front three-quarter, centred at viewport x 62%, y 50%, roughly 60vh tall.
- Eyebrow, top-left below nav, mono label: `LYZN  ·  AI PENDANT  ·  PREORDER`
- Headline, bottom-left, Display XL, max 12ch: **You talk.** line break **It follows through.**
- Sub-line, Body L muted, max 34ch: *LYZN remembers what was said and turns it into what needs doing.*
- CTA row: primary button **Preorder LYZN · ₹5,999**, then a ghost text link **See how it works** (scrolls to `#how`).
- Scroll cue, bottom centre: a 1px, 40px vertical rule and the mono word `SCROLL`. Fades out after 2% progress.
- Headline block sits at left gutter, bottom offset 14vh, so the pendant and the type do not overlap at 1024 to 1920.

**Scroll behaviour.** The section is 220vh tall with a 100vh sticky inner. Progress p runs 0 → 1 over the 120vh runway:
- p 0.00 → 0.25: headline, sub, CTA fade to 0 and rise 24px. Eyebrow stays.
- p 0.10 → 0.85: camera dollies from state A to state B (macro on the top of the glass: the microphone opening, the glass edge, the lip).
- p 0.70 → 1.00: material caption fades in at bottom-left, mono, two lines: `ANODISED GRAPHITE  ·  GLASS FRONT` / `TWO MICROPHONES  ·  19 G`
- Nav: transparent at p 0; hairline and 60% ink backdrop after 80px of scroll (page-wide rule).

**Mobile (<640).** Pendant centred, top 52% of viewport, about 46vh tall. Headline below it, left-aligned, Display XL mobile size. CTA full-width. Runway reduced to 80vh; the dolly is gentler (state B mobile). Caption is one line: `GRAPHITE · GLASS · TWO MICS · 19 G`.

**Tablet (640 to 1023).** As desktop with the pendant at x 58% and headline max 10ch.

### 2.2 Section 02: What it does

**Purpose.** The product in four lines and four seconds.

**Composition.** Two columns on desktop, 5/12 and 7/12.
- Left: four lines of Display L, stacked with 0.9em leading, each preceded by a small 6px square marker:
  `Talk.` / `LYZN remembers.` / `LYZN understands.` / `LYZN acts.`
  The fourth line carries a mono suffix, muted: `OPTIONAL`.
- Right: the **Transformation panel**, 440 × 520 max, a single dark surface (Graphite) with a hairline border and 20px radius. It cycles through four states on a timer once the section is 40% in view, 1.1 s per state, then loops every 6 s until the section leaves:
  1. Waveform (12 bars, live)
  2. Transcript (three lines, mono timestamps)
  3. Summary (one title, two bullets)
  4. Task (one task row with checkbox and "Tonight")
  Each state change highlights the matching line on the left (marker fills, text goes from muted to primary). States crossfade and slide 12px; no morphing letters.

**3D.** During this section the pendant recedes from state B to the anchor position (the camera pulls back and the model scales 1.0 → 0.45 while moving to the left column's top) so that by the time section 03 pins, the object is already sitting where it will stay. It is dimmed to 55% opacity behind the type in the last third of this section's scroll.

**Mobile.** Lines stacked, then the panel below at full width, 320px tall. Same timed cycle. No 3D transition (model hides after the hero, reappears at the final CTA).

**Reduced motion.** Panel shows state 4 (task) statically with the other three states shown as small muted thumbnails in a row above it.

### 2.3 Section 03: Conversation → Action

**Purpose.** A real conversation becoming structured, step by step, under the user's scroll control. This is the section that earns belief.

**Composition (desktop).** Pinned 100vh stage with a 400vh runway (five steps at 80vh each).
- Far left: a **step rail**, five 24px ticks with mono numbers 01 to 05; the active one is primary, the rest faint.
- Left column (4/12): the pendant anchor (3D state Anchor, about 26vh tall, front-on, gentle 4° yaw drift) with a pulsing ring overlay in step 01 only; below it the step eyebrow, title and one line.
- Right column (7/12): the **Stage**, a 560 × 640 max surface, Graphite, 20px radius, hairline. Its content is the same panel language as section 02, but with real content that persists and transforms across steps rather than resetting.

**The five steps.**

| Step | Eyebrow | Title | Line | Stage content |
|---|---|---|---|---|
| 01 | CONVERSATION | You talk. | Two people, a normal conversation. | Two spoken lines appear word by word as large quotes with speaker initials; a waveform runs beneath. |
| 02 | TRANSCRIPT | Every word, kept. | Who said what, and when. | Quotes settle into a transcript list: mono timestamps, speaker names, plain text. A third line arrives. |
| 03 | SUMMARY | Understood. | The point, not the recording. | Transcript compresses upward and fades to 30%; a summary card slides in: title and two bullets. |
| 04 | TASKS | Turned into tasks. | The commitments, pulled out for you. | Two words in the summary get an underline sweep; two task rows extract downward with checkboxes and due labels. |
| 05 | ACTION | Optionally, done. | With automation on, LYZN carries it out on your computer. | Second task row gets a `RUN` chip; a three-line desktop status appears beneath: Received → Working… → Completed. Caption: `Automation is optional · ₹1,500/month`. |

**Demo content (final).**

Conversation (step 01):
- **Meera:** "Can you get the revised proposal to Arjun before his flight tonight?"
- **You:** "Yes. And let's lock the demo for Thursday, four o'clock."

Transcript (step 02):
```
00:04  Meera   Can you get the revised proposal to Arjun before his flight tonight?
00:09  You     Yes. And let's lock the demo for Thursday, four o'clock.
00:14  Meera   Perfect. I'll tell him it's coming.
```

Summary (step 03):
- Title: **Proposal to Arjun, demo on Thursday**
- Bullets: "Revised proposal goes to Arjun tonight, before his flight." / "Product demo confirmed for Thursday at 4 PM."

Tasks (step 04):
- ☐ Send revised proposal to Arjun · **Tonight**
- ☐ Book demo · **Thu, 4:00 PM**

Action (step 05), desktop status block (mono):
```
TASK RECEIVED     Send revised proposal to Arjun
WORKING…
COMPLETED         21:14
```
The first task's checkbox fills. The status block never names an app or shows a real command.

**Scroll mapping.** Step k is active for runway progress in [(k−1)/5, k/5). Transitions between steps happen over the first 25% of each step's range, damped; content is static for the remaining 75% so the user can read it.

**Mobile.** Not pinned. Five stacked blocks, each 100% width: eyebrow, title, line, then a 100%-wide stage panel showing that step's end state. Each panel plays its entrance once when 50% visible (400 ms). The pendant anchor appears once above step 01 as a static render, 28vh tall.

**Reduced motion.** Same as mobile at every width: five static panels, no pin, no word-by-word typing.

### 2.4 Section 04: Worn

**Purpose.** Human proof. The pendant on real people, in real conversations, without a gallery.

**Composition (desktop).** Charcoal ground.
- Headline, Display L, left: **Wear it. Forget it.**
- Sub, Body L muted, max 36ch: *Nineteen grams on a braided cord. It wakes when someone speaks and stands down when the room goes quiet.*
- A row of three photographs, total width 124vw, translated horizontally by scroll (see motion M8b): the row starts offset 0 and ends offset −24vw as the section passes through the viewport. Images 4:5, 20px radius, hairline. Each has a mono caption beneath, left-aligned:
  1. `use-cafe.webp` — `A CONVERSATION, NOT A RECORDING`
  2. `use-street.webp` — `BETWEEN MEETINGS`
  3. `use-founder.webp` — `THE STAND-UP NOBODY WROTE DOWN`
- Grade note for all three: reduce green saturation 15%, lift blacks to #101012, warm the highlights slightly, so they belong to the monochrome palette. Never crop the pendant out.

**Mobile.** Headline, sub, then two images stacked (cafe, street). Founder omitted. No horizontal travel; each image reveals with a clip-path wipe.

### 2.5 Section 05: It can act

**Purpose.** The differentiator. Information becomes action.

**Composition (desktop).** Deepest black ground (#050506). Pinned 100vh, 250vh runway, everything centred, max width 720px.
- Line 1, Display L muted: **Most assistants tell you what to do.**
- Line 2, Display L primary, appears at p 0.15: **LYZN can do it.**
- At p 0.35 the two lines shrink to Display M and rise to the top third; the **Action sequence** appears beneath, four stacked states connected by a 1px vertical rule that draws downward as each arrives:
  1. Quote, Body L, in quotation marks: *"Send the revised proposal to Arjun tonight."* (p 0.35)
  2. Task row: ☐ Send revised proposal to Arjun · Tonight (p 0.50)
  3. Desktop status block, mono, Graphite surface: `TASK RECEIVED` / `WORKING…` / `COMPLETED  21:14` (p 0.65 → 0.85, lines arrive one by one)
  4. **Done.** Display L, with the task's checkbox filling and the row striking through (p 0.90)
- Footer line, mono, muted, p 0.92: `OPTIONAL  ·  ₹1,500 / MONTH  ·  LYZN UNDERSTANDS YOUR CONVERSATIONS WITHOUT IT`

**Mobile.** Not pinned. Two headline lines, then the four states stacked, each entering once on view. Same copy.

**Reduced motion.** All four states visible; rule fully drawn; "Done." shown.

### 2.6 Section 06: Privacy

**Purpose.** Trust, in one screen, without fear.

**Composition.** Paper ground (the first tonal shift; it should feel like a page turning to the light).
- Headline, Display L: **Your conversations are yours.**
- A 2 × 2 grid of facts, each with a mono label and one or two short lines, hairline dividers, no cards:

| Label | Copy |
|---|---|
| CAPTURED | It records while people are talking and stops itself about ten seconds after they stop. |
| CHECKED | Anything with no speech in it is deleted on your phone before it goes anywhere. |
| PROCESSED | Audio is transcribed and summarised on LYZN's servers. You see every recording in the app, with its transcript. |
| YOURS | `[PRIVACY_DELETE]` `[PRIVACY_RETENTION]` |

- Below the grid, one link, Body, underlined: **Read the full privacy policy** → `/privacy`.
- The two slot lines in YOURS must be filled or the cell hidden before launch. Do not ship the placeholders. Do not add "100% private", "never stored", "end-to-end encrypted" or any wording not in section 0.3.

**Mobile.** Single column, four rows.

### 2.7 Section 07: Pricing

**Purpose.** Two ways in, one optional layer. No grid, no tiers.

**Composition (desktop).** Paper ground.
- Eyebrow, mono: `CORE INTELLIGENCE`
- Headline, Display L: **Two ways in.**
- Sub, Body L muted, max 40ch: *Both understand your conversations. Automation is the optional layer that lets LYZN act on them.*
- Two **Pricing cards** side by side, equal width, 24px radius, paper-2 surface, hairline:

| | Card A | Card B |
|---|---|---|
| Image | `pendant-paper.webp` flat-lay (or a static render from the 3D scene, state C, on paper) | none; a 1px rounded-rect phone outline glyph, faint |
| Title | LYZN Pendant | Software |
| Price | ₹5,999 (Display M, tabular) | ₹3,999 |
| Line | Pendant and app. | The LYZN app, without the pendant. |
| Includes | Pendant · Transcription · Summaries · Task creation | Transcription · Summaries · Task creation |
| Meta | mono: `FIRST WAVE · SHIPS [SHIP_MONTH]` | mono: `NO PENDANT · NOTHING TO SHIP` |
| CTA | primary **Preorder** → `/order?plan=pendant` | secondary **Get software** → `/order?plan=software` |

- Beneath both cards, full width, the **Automation strip**: a single row, Ink surface on paper (inverted, so it reads as a different layer), 20px radius:
  - left, mono eyebrow: `OPTIONAL ACTION LAYER`
  - middle: **Automation** · ₹1,500 / month · *Lets LYZN complete tasks on your computer. Add it to either plan. Cancel any time.*
  - right: a static toggle glyph drawn in the off position with the label `OFF BY DEFAULT`
  - a thin "+" glyph sits centred between the cards and the strip to say "adds to either".
- Footnote, mono, faint: `PRICES IN INR · [GST_NOTE] · [PAYMENT_TERMS]`

**Mobile.** Cards stacked (pendant first), strip below, footnote last.

### 2.8 Section 08: Preorder

**Purpose.** Return to the complete object, one last time, and ask.

**Composition.** Ink ground, 100vh, pendant at 3D state C centred at x 50%, y 42%, about 54vh tall, with cursor parallax on desktop.
- Headline, Display XL centred, below the pendant: **Join the first wave.**
- Sub, Body L muted: *Preorders are open. First units ship [SHIP_MONTH].*
- Primary **Preorder LYZN · ₹5,999**; ghost **Software only · ₹3,999**.

**Mobile.** Pendant 40vh, copy below, buttons stacked full width.

### 2.9 Footer

Black ground, one row on desktop, stacked on mobile: `LYZN` wordmark · Privacy · Terms · Contact `[CONTACT_EMAIL]` · `© 2026 LYZN`. Mono, faint. Nothing else. No newsletter box, no social grid; add social links only if the accounts exist at launch.

---

## 3. Navigation

Fixed, 64px tall (56px on mobile), full width, transparent on the hero, then a 1px bottom hairline and a 60% Ink backdrop blur after 80px of scroll.

- Left: `LYZN` wordmark, Display weight, 18px, letter-spacing −0.02em. Links home.
- Centre (desktop only): Product `#product` · How it works `#how` · Privacy `#privacy` · Pricing `#pricing`. Body size, muted, primary on hover, 2px underline offset 6px on the active section (IntersectionObserver).
- Right: primary button **Preorder**, compact size. On checkout pages the centre links are removed and the right side reads `SECURE CHECKOUT` in mono.
- Mobile: wordmark left, **Preorder** compact right, and a 40px menu button between them that opens a full-height sheet from the top with the four links in Display M and a close button. The sheet is Ink at 96% with the same hairline. Body scroll locks while open.
- On mobile the bar hides on scroll-down and returns on scroll-up (translateY −100%, 240 ms). The Preorder button is therefore always one upward flick away.

Skip link ("skip to content") remains, as in the current site.

---

## 4. Component inventory

Shared (`src/components`):

| Component | Role | Notes |
|---|---|---|
| `Nav` | fixed bar and mobile sheet | states: top / scrolled / hidden; checkout variant |
| `Button` | primary, secondary, ghost; sizes md, compact, full | see 5.7 for states |
| `Eyebrow` | mono uppercase label with optional square marker | |
| `Statement` | Display L/XL block with optional sub-line | used in 02, 04, 05, 06, 07, 08 |
| `Section` | ground colour, padding, anchor id, `data-ground` attribute | drives nav colour and the canvas visibility |
| `PendantCanvas` | the single fixed WebGL canvas | see 6 |
| `usePendantTimeline` | maps page scroll to model state | see 6.4 |
| `PosterFallback` | three static renders crossfaded by scroll | used when WebGL is unavailable or low-power |
| `Waveform` | 12-bar canvas indicator | already exists; restyle to monochrome |
| `TransformPanel` | the four-state timed panel | section 02 |
| `Stage` + `StageTranscript`, `StageSummary`, `StageTasks`, `StageStatus` | the pinned story surface | section 03; reused by 05 (`StageStatus`, `TaskRow`) |
| `StepRail` | five-tick vertical indicator | section 03 |
| `Figure` | image with clip-path reveal, caption, parallax hook | section 04 |
| `ActionSequence` | quote → task → status → done | section 05 |
| `FactGrid` | 2 × 2 labelled facts | section 06 |
| `PricingCard`, `AutomationStrip` | | section 07 |
| `Footer` | | |
| `Reveal` | one entrance for text blocks | already exists; keep |

Checkout (`src/components/checkout`, most already exist):

| Component | Role |
|---|---|
| `CheckoutShell` | two-column layout, sticky summary rail, mobile bottom bar |
| `Stepper` | Choose · Details · Pay, with done/active/todo states |
| `PlanSwitch` | segmented control: LYZN Pendant ₹5,999 / Software ₹3,999 |
| `PlanPanel` | image, includes, quantity |
| `AutomationToggle` | off/on with price and one line |
| `QuantityStepper` | 1 to 5, pendant only |
| `Field` | text, email, tel, select; label, hint, error |
| `AddressFields` | line 1, line 2, city, state (select), PIN (6 digits) |
| `PaymentMethod` | UPI / Card / Net banking radio cards, no logos |
| `OrderSummary` | line items, monthly line, total, always visible |
| `Confirmation` | headline, reference, what you bought, what happens next |

---

## 5. Visual system

### 5.1 Colour

Warm monochrome. Two grounds (Ink and Paper) and one signal colour that appears only at hairline and dot sizes.

```
/* grounds */
--ink:        #0B0B0C   /* hero, 02, 03, 08 */
--charcoal:   #131315   /* 04 */
--black:      #050506   /* 05, footer */
--graphite:   #1C1C1F   /* panels and cards on ink */
--graphite-2: #242428   /* hover lift on ink */

--paper:      #F3F1EC   /* 06, 07, checkout */
--paper-2:    #EAE7E0   /* cards on paper */
--paper-3:    #DDD9D0   /* pressed / dividers on paper */

/* text on dark */
--fg:         #EDEAE4
--fg-muted:   #A6A39D
--fg-faint:   #6E6C68

/* text on paper */
--ink-fg:     #141416
--ink-muted:  #5B5A57
--ink-faint:  #8C8A85

/* lines */
--line-dark:  rgba(237,234,228,0.10)
--line-dark-strong: rgba(237,234,228,0.22)
--line-paper: rgba(20,20,22,0.10)
--line-paper-strong: rgba(20,20,22,0.24)

/* signal: live, done, focus. Never a fill larger than 8px, never a gradient. */
--signal:     #C9A76A
--danger:     #B5483C   /* form errors only */
```

Rules: no gradients except the 3D scene's own lighting. No coloured cards. No blue. The pendant's graphite (#1A1A1C to #3A3A3E under light) must sit between `--ink` and `--graphite-2` so it belongs to the page.

### 5.2 Typography

Primary family: **Geist** (Google Fonts), weights 400, 500, 600. Fallback stack: `Inter Tight, Inter, ui-sans-serif, system-ui, sans-serif`. If Geist is unavailable at build time, use Inter Tight for Display and Inter for Body.
Mono: **Geist Mono** 400, 500. Fallback: `IBM Plex Mono, ui-monospace, SFMono-Regular, monospace`.

Remove Fraunces and Instrument Sans.

| Token | Size | Weight | Tracking | Leading | Use |
|---|---|---|---|---|---|
| Display XL | clamp(2.75rem, 7vw, 6.5rem) | 500 | −0.035em | 0.98 | hero, final CTA |
| Display L | clamp(2rem, 4.5vw, 4rem) | 500 | −0.03em | 1.02 | section statements |
| Display M | clamp(1.5rem, 2.6vw, 2.25rem) | 500 | −0.02em | 1.1 | step titles, prices, confirmation |
| Body L | clamp(1.125rem, 1.4vw, 1.25rem) | 400 | −0.005em | 1.5 | sub-lines |
| Body | 1rem | 400 | 0 | 1.55 | everything else |
| Small | 0.875rem | 400 | 0 | 1.5 | hints, captions |
| Label | 0.75rem mono | 500 | 0.12em, uppercase | 1.2 | eyebrows, meta, step numbers |
| Price | Display M, `font-variant-numeric: tabular-nums` | 500 | −0.02em | 1 | prices |

Rupee formatting: `₹5,999`, `₹1,500 / month`. Use the Indian grouping only for lakh-scale numbers (none on this site). Always a non-breaking space between `₹` amounts and `/ month`.

Measure: headlines max 12ch (XL) or 18ch (L); body max 40ch in the landing page, 60ch in policy pages.

### 5.3 Spacing and layout

- Base unit 4px. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160.
- Content max width 1200px; gutters 24px (mobile), 40px (tablet), 64px (desktop).
- Grid: 12 columns on desktop, 6 on tablet, 4 on mobile; gap 24/32.
- Section vertical padding: clamp(96px, 14vh, 160px). Pinned sections have none.
- Breakpoints: mobile <640, tablet 640 to 1023, desktop ≥1024, wide ≥1440 (content stays 1200px, canvas fills).

### 5.4 Radii

Echo the pendant's silhouette: soft rounded squares, never pills.

- Cards, panels, images: 20px (24px for pricing cards)
- Buttons: 12px
- Inputs: 10px
- Chips, checkboxes: 6px
- Step ticks, markers: 2px

### 5.5 Borders and shadows

- Hairlines only: 1px with the `--line-*` tokens. Strong variant on focus and active.
- No drop shadows on UI. The only shadow on the site is the 3D contact shadow under the pendant (6.5).
- Backdrop blur only on the nav (12px) and the mobile sheet.

### 5.6 Iconography

Lucide, 1.5px stroke, 20px: `check`, `arrow-right`, `arrow-down`, `x`, `menu`, `plus`, `minus`, `chevron-down`, `lock`. No illustrations, no AI sparkles.

### 5.7 UI states

| Element | Rest | Hover | Active/pressed | Focus-visible | Disabled |
|---|---|---|---|---|---|
| Primary button (on ink) | fg bg, ink text | bg #FFFFFF | scale 0.985, 120 ms | 2px `--signal` ring, 3px offset | 40% opacity |
| Primary button (on paper) | ink-fg bg, paper text | bg #000 | same | same | same |
| Secondary | transparent, 1px strong line | line to fg, bg 4% | same | same | same |
| Ghost | text only, underline offset 6px | underline to fg | | same | |
| Input | panel bg, hairline | line strong | | line `--signal` 1px + ring | 40% |
| Input error | `--danger` 1px line, message below in `--danger` Small | | | | |
| Nav link | muted | fg | | ring | |
| Checkbox / task | 6px radius box | | filled ink with check | ring | |
| Toggle | 44 × 24 track, hairline; knob 20px | | knob slides 20px, 200 ms | ring | |
| Segmented (PlanSwitch) | hairline track; active pill has fg bg | | | ring | |

Transitions on UI: 160 ms, `--ease-out` for colour and border; 120 ms for scale.

---

## 6. 3D model behaviour

### 6.1 Asset and scene

- Use `mobile/assets/pendant.glb` (the untextured PBR export, 1.4 MB, 74k triangles). The baked file adds 4 MB and no visible detail. Compress with `gltf-transform` (meshopt or draco) and quantise; target under 400 KB.
- **+Z is the front** (the glass panel with the two pinholes; `Pendant_Glass` occupies the highest Z). The dished side is the back. Keep the existing `FACE_YAW = 0` convention from the old `Pendant.tsx` described in `web/README.md`.
- Normalise at load: measure bounds, scale so the longest edge is 1.9 world units, centre on the bounds. Never hard-code the export scale.
- **Clone materials per instance** (see `web/README.md`, "Every instance clones its materials"). There is only one instance in this design, but keep the rule.
- Camera: perspective, FOV 26° on desktop (a long lens; product photography, not a game), 32° on mobile. Near 0.1, far 50.
- Renderer: `alpha: true`, ACES filmic tone mapping, exposure 1.0, sRGB output. DPR clamp [1, 2] on desktop, [1, 1.5] on mobile.
- Materials from the GLB as exported (Graphite 0.92 metallic / 0.34 rough, Edge 0.20 rough, Glass 0.05 rough, clearcoat). Tune only if the shell reads as pure black: lift Graphite roughness to 0.40, not lower.

### 6.2 Lighting

No HDRI (avoids a network fetch). Lightformer rig as in the previous implementation, tuned for a dark page:

- Key: broad softbox, camera-left, above, 2.0 intensity, warm white #FFF6EA.
- Rim A: narrow vertical strip behind-right, 3.0, cool white #E8ECF2. It draws the right chamfer.
- Rim B: narrow horizontal strip above-behind, 2.0. It draws the top lip.
- Fill: very weak wide panel on the camera side, 0.35, so the flat glass face is not a hole.
- Ground: none. Contact shadow only (6.5).

The pendant must read as graphite metal on a near-black ground: lit faces around #3A3A3E, glass reflecting one soft highlight, chamfers as thin bright lines. If any face renders as a flat white slab, a panel is too wide; narrow it.

### 6.3 States

All positions in world units, camera looks at the model's centre unless a target is given. Model rotation is yaw (about Y), pitch (about X) in radians. Positive yaw turns the model's −X side (the button edge) toward the camera. `screen` is where the model's centre should land in the viewport, as fractions.

| State | Camera position | Camera target | Model yaw | Model pitch | Model scale | Screen anchor | Notes |
|---|---|---|---|---|---|---|---|
| **Load** | as A | as A | as A | as A | 0.92 | as A | opacity 0; fades to A over 900 ms after the model is ready |
| **A Hero** | (0.35, 0.20, 6.4) | (0, 0, 0) | +0.28 | −0.10 | 1.00 | (0.62, 0.50) | front three-quarter; the button edge (−X) turned toward the camera on the left, chamfer catching Rim A |
| **B Material** | (0.40, 0.90, 3.1) | (0.05, 0.60, 0.35) | +0.30 | −0.30 | 1.00 | (0.58, 0.46) | macro on the top of the glass: the microphone opening (at y ≈ +0.63 units in the normalised model), the glass edge, the lip; the pendant overflows the viewport by design |
| **Anchor** | (0, 0, 6.4) | (0, 0, 0) | 0.00 ± 0.07 drift | −0.06 | 0.45 | (0.17, 0.36) | front-on, small, left column of section 03 |
| **Hidden** | | | | | 0.45 | off-screen (−0.4, 0.5) | opacity 0; renderer paused |
| **C Product** | (−0.35, 0.15, 6.2) | (0, 0, 0) | −0.30 | −0.08 | 1.00 | (0.50, 0.42) | mirror of A so the clean right edge (+X) is seen; cursor parallax on desktop |

Idle motion in A, Anchor and C: vertical float ±0.02 units on a 6 s sine; yaw drift ±0.03 rad on a 9 s sine. Never a continuous spin.

Cursor parallax (state C, desktop only, `pointer: fine`): yaw += pointerX × 0.10 rad, pitch += pointerY × 0.06 rad, damped with lerp 0.06 per frame. Returns to rest when the pointer leaves the section.

Screen anchoring: implement by offsetting the camera (or a parent group) in screen space so the model's centre lands at the given fraction; recompute on resize.

### 6.4 Scroll mapping (desktop)

A single global timeline, driven by page scroll, with a damped follower (lerp 0.10 per frame at 60 fps; scale by delta time) so scroll jumps never snap.

| Page region | Progress source | From | To | Easing on the segment |
|---|---|---|---|---|
| Hero runway (120vh) | hero sticky progress 0.10 → 0.85 | A | B | ease-in-out (0.65, 0, 0.35, 1) |
| Section 02, as it scrolls through | section progress 0.15 → 0.90 | B | Anchor | ease-out (0.16, 1, 0.3, 1) |
| Section 03 pin | held | Anchor | Anchor | ring pulse only in step 01 |
| Section 03 unpin → section 04 | last 30vh of section 03 | Anchor | Hidden | ease-in (0.4, 0, 1, 1), opacity to 0 over the same range; renderer pauses at 0 |
| Sections 04 to 07 | | Hidden | Hidden | canvas `display: none` |
| Section 08 entrance | section 08 progress 0.00 → 0.45 | Hidden (start at scale 0.85 at (0.5, 0.60)) | C | ease-out; opacity 0 → 1 over first half |
| Footer | | C | C | pointer parallax off; idle only |

Interpolate camera position, target, yaw, pitch, scale and screen anchor linearly in the segment's eased progress. Interpolate yaw along the short way round.

### 6.5 Contact shadow

Soft ground shadow (drei `ContactShadows` or a baked radial blob) 0.9 units below the model's centre, opacity 0.35, blur 2.5, only in states A and C. Fades out with the transition to B and to Hidden.

### 6.6 Mobile and low-power

- Same single canvas, same states, with: FOV 32°, B camera at (0.30, 0.75, 3.7) (a gentler macro so the microphone opening stays in frame on a 390px width), Anchor replaced by a **static render** above step 01, no parallax, DPR max 1.5, contact shadow off, no antialiasing above DPR 1.
- Low-power detection: WebGL context creation fails, or `navigator.hardwareConcurrency <= 4`, or `navigator.deviceMemory <= 4`, or `prefers-reduced-motion`. Any one of these switches to `PosterFallback`.

### 6.7 Poster fallback (also the OG image and the pricing image)

Export three PNG/WebP renders from the same three.js scene at build time (a hidden route or a script): `poster-a.webp` (state A, 1600 × 1600, transparent), `poster-b.webp` (state B crop, 1600 × 1000), `poster-c.webp` (state C, 1600 × 1600). `PosterFallback` positions them exactly where the canvas would place the model and crossfades A → B over the hero runway and shows C in section 08. The OG image is poster A on `--ink` with the headline. The pricing card image is poster C composited on `--paper-2` (or `pendant-paper.webp` if it reads better).

### 6.8 Reduced motion

`prefers-reduced-motion: reduce` → `PosterFallback`, no crossfade (A in the hero, C in the final section), no float, no parallax.

### 6.9 Loading

- HTML paints with the poster (A) in place; the three.js chunk is lazy and split; the GLB preloads after first paint.
- When the model is ready, fade the canvas in and the poster out over 600 ms. If the model is not ready within 4 s on the hero, keep the poster and retry silently; the page must feel complete either way.
- A `data-3d="ready|poster"` attribute on `<html>` lets sections adjust (for example, section 03 shows the static anchor when in poster mode).

---

## 7. Motion system

Tokens:

```
--ease-out:     cubic-bezier(0.16, 1, 0.3, 1)
--ease-in-out:  cubic-bezier(0.65, 0, 0.35, 1)
--ease-in:      cubic-bezier(0.4, 0, 1, 1)
--dur-micro:    120ms
--dur-ui:       160ms
--dur-reveal:   700ms
--dur-slow:     900ms
```

Scroll-scrubbed motion has no duration; it follows a damped scroll value (lerp 0.10). Scroll-triggered entrances use `--dur-reveal` and fire once, when 20% of the element is in view. Nothing bounces. Nothing loops except the two indicators (waveform, section 02 panel) and the idle float.

| ID | Animation | Trigger | Start | End | Duration / easing | Scroll relation | Mobile | Reduced motion |
|---|---|---|---|---|---|---|---|---|
| M1 | Hero entrance | model ready (or 300 ms after paint in poster mode) | canvas opacity 0, scale 0.92; text opacity 0, y +16 | opacity 1, scale 1; y 0 | 900 ms / ease-out; text staggers 80 ms | none | same | text appears at once, no scale |
| M2 | Hero text exit | hero progress | opacity 1, y 0 | opacity 0, y −24 | scrub, p 0.00 → 0.25 | sticky hero | same, p 0 → 0.3 | text fades only |
| M3 | Hero camera A → B | hero progress | state A | state B | scrub, p 0.10 → 0.85, ease-in-out | sticky hero | gentler B | poster A held |
| M4 | Material caption | hero progress | opacity 0, y +8 | opacity 1, y 0 | scrub, p 0.70 → 1.00 | sticky hero | same | visible under poster |
| M5 | Four lines (02) | timer, section 40% in view | line muted, marker empty | active line fg, marker filled | 1.1 s per state, 6 s loop | timed, not scrub | same | state 4 static |
| M5b | Transformation panel states | same timer | previous state | next state: crossfade + 12px slide | 320 ms / ease-out | timed | same | static |
| M6 | Pendant recede B → Anchor | section 02 progress | B, opacity 1 | Anchor, opacity 0.55 → 1 as 03 pins | scrub, 0.15 → 0.90 | section 02 | hidden (canvas off after hero) | none |
| M7 | Story steps (03) | pinned progress | step k content | step k+1 content | scrub; each transition spans the first 25% of the step's range | pinned 400vh | not pinned; each panel enters once 400 ms | static panels |
| M7a | Word-by-word quotes | step 01 range | 0 words | all words | scrub across the step's static 75% | | typed once over 1.2 s on view | full text |
| M7b | Listening ring | step 01 | ring at 1.0, opacity 0.5 | ring at 1.35, opacity 0 | 1.8 s loop / ease-out | only while step 01 | omitted | omitted |
| M7c | Underline sweep and task extraction | step 04 transition | underline width 0; tasks y −12, opacity 0 | width 100%; y 0, opacity 1 | scrub | | on view once | static |
| M7d | Status lines (03 step 05 and 05) | range | each line opacity 0, x −6 | opacity 1, x 0 | scrub, staggered thirds | | on view once, 200 ms apart | static |
| M8 | Photo reveal (04) | 20% in view | clip-path inset(100% 0 0 0), scale 1.04 | inset(0), scale 1 | 900 ms / ease-out, 120 ms stagger | once | same | opacity only |
| M8b | Photo row travel (04) | section progress | translateX(0) | translateX(−24vw) | scrub, section 0 → 1, linear | section 04 | omitted | omitted |
| M9 | Differentiator (05) | pinned progress | see 2.5 | see 2.5 | scrub; vertical rule uses `stroke-dashoffset` | pinned 250vh | stacked, once | static, "Done." shown |
| M10 | Paper turn (06) | section 06 enters | ground `--ink` | ground `--paper` | the section itself is paper; the boundary is a hard edge, no wipe | none | same | same |
| M11 | Pricing cards | 20% in view | opacity 0, y +16 | opacity 1, y 0 | 700 ms, 80 ms stagger | once | same | opacity |
| M12 | Final pendant (08) | section progress | Hidden | C | scrub, 0 → 0.45 | section 08 | same | poster C static |
| M12b | Cursor parallax | pointer move over section 08 | rest | ±0.10 / ±0.06 rad | damped, lerp 0.06 | none | omitted | omitted |
| M13 | Nav state | scroll > 80px | transparent | hairline + backdrop | 200 ms | | also hide on scroll-down | same, no hide |
| M14 | Mobile sheet | menu tap | y −100% | y 0 | 320 ms / ease-out | | | opacity |
| M15 | Checkout step change | route change | opacity 0, x +24 (forward) or −24 (back) | opacity 1, x 0 | 320 ms / ease-out | | same | opacity |
| M16 | Total change | any price change | old total | new total | number rolls per digit, 240 ms | | same | instant |
| M17 | Confirmation | route enters | "You're in." opacity 0, y +12; rest hidden | headline, then details stagger 120 ms | 700 ms / ease-out | | same | instant |

Do not add: floating cards, spinning text, hover tilt on cards, infinite parallax on type, scroll-jacking (native scroll always wins; pins are `position: sticky`).

---

## 8. Responsive behaviour

| Section | Desktop ≥1024 | Tablet 640 to 1023 | Mobile <640 |
|---|---|---|---|
| Nav | wordmark, four links, Preorder | wordmark, Preorder, menu | wordmark, Preorder, menu; hides on scroll-down |
| 01 Hero | pendant right, type bottom-left, 120vh runway | pendant x 58%, headline 10ch | pendant top centre 46vh, type below, 80vh runway, full-width CTA |
| 02 What it does | 5/12 lines, 7/12 panel | 6/6 | stacked; panel 320px |
| 03 Story | pinned, rail + 4/12 + 7/12 | pinned, rail hidden, 5/7 columns | not pinned; five stacked panels; static anchor above |
| 04 Worn | three photos travelling | three photos, travel −16vw | two photos stacked, no travel |
| 05 It can act | pinned, centred 720px | pinned | not pinned, stacked, once |
| 06 Privacy | 2 × 2 grid | 2 × 2 | single column |
| 07 Pricing | two cards + strip | two cards + strip | stacked cards, strip |
| 08 Preorder | pendant 54vh, parallax | pendant 50vh | pendant 40vh, stacked buttons |
| Checkout | two columns, sticky rail right | two columns, rail narrower | single column; sticky bottom bar with total and the step button |

Type scales are fluid (5.2). Touch targets 44px minimum. Pinned sections on tablet keep the pin only in landscape or when height ≥ 700px; otherwise they use the mobile stacked layout.

---

## 9. Checkout flow

**Landing → Choose → Details → Pay → Confirmed.**

The brief lists billing before delivery. This spec collects delivery before payment, because the payment handoff to the provider is the terminal action and must be last; collecting an address after money is taken is where preorders get abandoned or arrive with no address. Steps are otherwise as briefed.

Visual: the checkout is the paper theme, with an Ink summary rail on the right (desktop) that keeps the total permanently visible. Same type, same buttons, same radii as the landing page. Nav switches to the checkout variant. No progress bars, no trust badges, no countdowns.

### 9.1 `/order` Choose

- Stepper: **1 Choose** · 2 Details · 3 Pay
- Eyebrow `CHOOSE YOUR PLAN`, headline Display M: **Two ways in.**
- `PlanSwitch` segmented control: **LYZN Pendant ₹5,999** | **Software ₹3,999**. Pre-selected from `?plan=`; default pendant. Switching keeps the automation toggle, quantity (reset to 1 for software) and any contact data already entered.
- `PlanPanel`:
  - Pendant: poster C on paper-2, "Pendant and app.", includes list (Pendant · Transcription · Summaries · Task creation), `QuantityStepper` 1 to 5, meta `FIRST WAVE · SHIPS [SHIP_MONTH]`.
  - Software: phone outline glyph, "The LYZN app, without the pendant.", includes list (Transcription · Summaries · Task creation), meta `NOTHING TO SHIP · ACCESS BY EMAIL`.
- `AutomationToggle`, its own panel, Ink surface on paper:
  - eyebrow `OPTIONAL ACTION LAYER`
  - **Automation** · ₹1,500 / month
  - *Lets LYZN complete tasks on your computer. Billed monthly from the day you activate it. Cancel any time.*
  - toggle, default off. When on, the summary rail adds a separate line under a divider: `Automation · ₹1,500 / month · from activation`, and the total line reads `Due today` with the monthly line kept visually separate so the two are never summed.
- Summary rail: line items (plan × quantity), the monthly line if on, `Due today ₹X`, footnote `[GST_NOTE]`, primary **Continue**.

### 9.2 `/order/details` Details

- Stepper: 1 Choose · **2 Details** · 3 Pay
- **Contact** (both plans): Full name, Email, Phone (`+91` prefix, `inputmode="tel"`, 10 digits).
- **Delivery** (pendant only): Address line 1, Address line 2 (optional), City, State (select of Indian states and union territories), PIN code (`inputmode="numeric"`, 6 digits, validated). Country fixed to India, shown as text.
- Software only: no delivery block. One line under Contact: *Nothing to ship. Your access details go to this email.*
- Validation on blur and on submit; errors in `--danger` Small under the field; the first invalid field receives focus on submit.
- Rail unchanged. Primary **Continue to payment**. Ghost **Back**.

### 9.3 `/order/pay` Pay

- Stepper: 1 Choose · 2 Details · **3 Pay**
- **Billing**: Name on invoice (prefilled), checkbox *Billing address same as delivery* (pendant, default on; unchecking reveals the address fields), and for software-only just State and PIN (needed for tax; `[GST_NOTE]`). Optional GSTIN field, collapsed behind a ghost link *Add GSTIN*.
- **Payment method**: three radio cards, no logos: **UPI**, **Card**, **Net banking**. Selecting one changes nothing on this page; the provider's own sheet handles the details after the button. If `RAZORPAY_LINK` or the order endpoint is not configured, show the existing rehearsal-mode notice (`payment.ts`) plainly.
- **Terms**: one checkbox: *I agree to the [Terms and refund policy](/terms).*
- Rail: everything from Choose plus the delivery address (pendant) or email (software) in mono. Primary button reads the exact amount: **Pay ₹5,999**. A `lock` icon precedes the label. Ghost **Back**.
- On success the provider returns to `/order/confirmed` with the reference.

### 9.4 `/order/confirmed` Confirmation

No stepper. Centred, max width 640px, generous top padding.

Pendant:
- Display XL: **You're in.**
- Display M muted: **Your LYZN is being prepared.**
- mono: `ORDER [REF]  ·  [DATE]`
- Summary block: plan, quantity, automation on/off, amount paid, delivery address.
- **What happens next** (three short rows, hairline dividers): *A confirmation is on its way to [email].* / *We'll email you before your pendant ships, [SHIP_MONTH].* / *Your app invite arrives before dispatch.*
- If automation is on, a fourth row: *Automation activates when you're ready. Setup steps come by email.*
- Ghost link **Back to LYZN**.

Software only:
- Display XL: **You're ready to begin.**
- Display M muted: **Check your email for access.**
- reference, summary (plan, automation, amount), one next-step row: *Your access details are on their way to [email].*

Poster C, 160px, sits above the headline on the pendant confirmation only.

### 9.5 Conditional behaviour

| Condition | Choose | Details | Pay | Confirmed |
|---|---|---|---|---|
| Pendant | quantity 1 to 5 | contact + delivery | billing same-as-delivery checkbox | "You're in." + address + ship row |
| Software | quantity fixed 1, stepper hidden | contact only + "nothing to ship" | state + PIN only | "You're ready to begin." |
| Automation on | monthly line in rail, kept separate from "Due today" | no change | no change | extra "activates when you're ready" row |
| Plan switched after details entered | contact kept; delivery kept but hidden for software | | | |
| Reduced motion | step transitions become opacity only; total updates instantly | | | |

### 9.6 Error and edge states

- Provider failure or cancel: return to `/order/pay` with a one-line notice above the button: *Payment didn't go through. Nothing was charged.* Keep every field filled.
- Network failure on submit: inline notice, button re-enabled, no page reload.
- Refresh on any step: basket restored from `sessionStorage`; guards redirect as described in section 1.

---

## 10. Asset list

| Asset | Source | Action for Opus |
|---|---|---|
| `pendant.glb` | `mobile/assets/pendant.glb` | compress (meshopt/draco + quantise) to `web/public/models/pendant.glb`, target < 400 KB |
| Poster renders A, B, C | rendered from the three.js scene | export once at 1600px, WebP q82 + AVIF; used for fallback, OG, pricing, confirmation |
| OG image | poster A on `--ink` with headline | 1200 × 630 |
| Lifestyle photos | `web/public/img/use-cafe.webp`, `use-street.webp`, `use-founder.webp` | regrade per 2.4; export 1600/1200/800 widths, WebP and AVIF, 4:5 crops that keep the pendant |
| Flat-lay | `web/public/img/pendant-paper.webp` | pricing card A (alternative to poster C) |
| Unused imagery | the other nine `use-*.webp`, `hero-pendant.webp`, `pendant-macro.webp`, `pendant-detail.webp` | remove from `public/img` |
| Product video | `pendant-vid.mp4`, `mobile/assets/pendant.mp4` | not used on the site (green-screen turntable); keep as reference for lighting |
| Fonts | Geist, Geist Mono via Google Fonts (or self-hosted subset) | `display=swap`, preconnect; Latin subset only |
| Icons | Lucide | nine icons listed in 5.6 |
| Favicon | a 32px rounded square, `--fg` on `--ink`, with two 2px dots at upper-left (the pinholes) | SVG |

New imagery is not required. If the founder photo is regenerated, use the front-facing frame of the video as the object reference (flat glass face, two pinholes, no dish), as `web/README.md` warns.

---

## 11. Copy

Final copy. Tokens in square brackets are slots from section 0.

### Nav
`LYZN` · Product · How it works · Privacy · Pricing · **Preorder**

### 01 Hero
- eyebrow: `LYZN · AI PENDANT · PREORDER`
- H1: **You talk.** / **It follows through.**
- sub: LYZN remembers what was said and turns it into what needs doing.
- primary: **Preorder LYZN · ₹5,999**
- ghost: See how it works
- scroll cue: `SCROLL`
- material caption: `ANODISED GRAPHITE · GLASS FRONT` / `TWO MICROPHONES · 19 G`

Alternate H1, if the client prefers the brief's own line: **Your conversations,** / **turned into action.**

### 02 What it does
- Talk.
- LYZN remembers.
- LYZN understands.
- LYZN acts. `OPTIONAL`
- panel state labels (mono): `LISTENING` · `TRANSCRIPT` · `SUMMARY` · `TASK`

### 03 Conversation → Action
- eyebrow above the rail: `HOW IT WORKS`
- steps and demo content: as in 2.3
- step 05 caption: `AUTOMATION IS OPTIONAL · ₹1,500 / MONTH`

### 04 Worn
- H2: **Wear it. Forget it.**
- sub: Nineteen grams on a braided cord. It wakes when someone speaks and stands down when the room goes quiet.
- captions: `A CONVERSATION, NOT A RECORDING` · `BETWEEN MEETINGS` · `THE STAND-UP NOBODY WROTE DOWN`

### 05 It can act
- line 1: Most assistants tell you what to do.
- line 2: **LYZN can do it.**
- quote: "Send the revised proposal to Arjun tonight."
- task: Send revised proposal to Arjun · Tonight
- status: `TASK RECEIVED` / `WORKING…` / `COMPLETED 21:14`
- result: **Done.**
- footer: `OPTIONAL · ₹1,500 / MONTH · LYZN UNDERSTANDS YOUR CONVERSATIONS WITHOUT IT`

### 06 Privacy
- H2: **Your conversations are yours.**
- CAPTURED: It records while people are talking and stops itself about ten seconds after they stop.
- CHECKED: Anything with no speech in it is deleted on your phone before it goes anywhere.
- PROCESSED: Audio is transcribed and summarised on LYZN's servers. You see every recording in the app, with its transcript.
- YOURS: `[PRIVACY_DELETE]` `[PRIVACY_RETENTION]`
- link: Read the full privacy policy

### 07 Pricing
- eyebrow: `CORE INTELLIGENCE`
- H2: **Two ways in.**
- sub: Both understand your conversations. Automation is the optional layer that lets LYZN act on them.
- Card A: **LYZN Pendant** · ₹5,999 · Pendant and app. · Pendant / Transcription / Summaries / Task creation · `FIRST WAVE · SHIPS [SHIP_MONTH]` · **Preorder**
- Card B: **Software** · ₹3,999 · The LYZN app, without the pendant. · Transcription / Summaries / Task creation · `NO PENDANT · NOTHING TO SHIP` · **Get software**
- strip: `OPTIONAL ACTION LAYER` · **Automation** · ₹1,500 / month · Lets LYZN complete tasks on your computer. Add it to either plan. Cancel any time. · `OFF BY DEFAULT`
- footnote: `PRICES IN INR · [GST_NOTE] · [PAYMENT_TERMS]`

### 08 Preorder
- H2: **Join the first wave.**
- sub: Preorders are open. First units ship [SHIP_MONTH].
- primary: **Preorder LYZN · ₹5,999**
- ghost: Software only · ₹3,999

### Footer
`LYZN` · Privacy · Terms · Contact · `© 2026 LYZN`

### Checkout
- Choose: `CHOOSE YOUR PLAN` · **Two ways in.** · switch labels as above · automation panel copy as in 9.1 · rail: Due today · **Continue**
- Details: `YOUR DETAILS` · **Where should it go?** (pendant) / **Where should we send access?** (software) · field labels: Full name, Email, Phone, Address line 1, Address line 2 (optional), City, State, PIN code · software line: Nothing to ship. Your access details go to this email. · **Continue to payment** · Back
- Pay: `PAYMENT` · **Almost there.** · Billing address same as delivery · Add GSTIN · UPI / Card / Net banking · I agree to the Terms and refund policy · **Pay ₹[TOTAL]** · Back · failure notice: Payment didn't go through. Nothing was charged.
- Confirmed (pendant): **You're in.** · Your LYZN is being prepared. · `ORDER [REF] · [DATE]` · A confirmation is on its way to [email]. · We'll email you before your pendant ships, [SHIP_MONTH]. · Your app invite arrives before dispatch. · Automation activates when you're ready. Setup steps come by email. · Back to LYZN
- Confirmed (software): **You're ready to begin.** · Check your email for access. · Your access details are on their way to [email]. · Back to LYZN

### Meta
- `<title>`: LYZN — the pendant that follows through
- description: An AI pendant that remembers your conversations, turns them into tasks, and, if you let it, gets them done. Preorder the first wave. ₹5,999.

### Words that must not appear
revolutionary, game-changing, next-generation, AI-powered, seamless, ecosystem, unlock, supercharge, 100% private, never stored, end-to-end encrypted, zero data, learn more, discover, explore.

---

## 12. Implementation notes for Opus

**Keep.** Vite + React + TypeScript + Tailwind v4, `react-router`, `@react-three/fiber` + `drei`, `motion`. `OrderContext`, `CheckoutShell`, `Stepper`, `Field`, `OrderSummary`, `Choice` (rename to `PlanSwitch`/`AutomationToggle` as fits), `payment.ts`, `Reveal`, `Waveform`, `_redirects`, the route guards. `web/README.md` stays the operations manual; update its layout and content sections.

**Remove.** Fraunces and Instrument Sans; the green accent (`--color-mark`); `Blueprint.tsx` (the hidden-line drawing) and `Annotation.tsx`; the timestamp `Rail`; `Statement`, `Steps`, `Turn`, `Listening`, `Questions` sections; `FEATURES`, `SPECS`, `FAQ`, `USE_CASES`, `CAPTURE_TICKER` from `content.ts`; the colourway/carry/extras/plan/shipping catalogue in `catalog.ts` (replace with the two plans, the automation add-on and quantity); USD.

**Data.** Put every word in section 11 and every number in section 0.2 into `src/data/content.ts` and `src/data/pricing.ts`. Slots are exported constants named exactly as the tokens (`SHIP_MONTH`, `GST_NOTE`, `PAYMENT_TERMS`, `PRIVACY_DELETE`, `PRIVACY_RETENTION`, `CONTACT_EMAIL`). A slot that is still empty at build time should render nothing, not the token.

**Scroll.** Pins are `position: sticky` inside tall wrappers; never lock or hijack scroll. One scroll listener feeds a damped store (`lerp 0.10 × dt/16.7`) that the canvas and the pinned sections read from `requestAnimationFrame`. `motion`'s `useScroll` or GSAP ScrollTrigger are both fine; the mapping in 6.4 and 7 is in terms of progress, not library calls.

**Canvas.** One `<Canvas>` for the whole landing page, `position: fixed; inset: 0; pointer-events: none; z-index: 0`, with sections above it at `z-index: 1` and transparent backgrounds only where the model must show (01, 02, 03, 08). Give it `aria-hidden="true"` and put a visually hidden paragraph in the hero describing the pendant. Pause the render loop (`frameloop="demand"` or a flag) whenever the state is Hidden. Dispose nothing on route change; the checkout routes simply do not mount the canvas.

**Lighting gotchas** (from the previous build): drei lightformers point at the origin, so position places them and rotation is ignored; the 0.92-metallic shell has almost no diffuse term, so a wide bright panel becomes a white slab across the face; keep rims narrow and the fill weak.

**Images.** `<picture>` with AVIF then WebP, `srcset` 800/1200/1600, `loading="lazy"` everywhere except the hero poster, `decoding="async"`, explicit `width`/`height` to avoid layout shift, `object-position` set per image so the pendant stays in the 4:5 crop.

**Performance budget.** First paint under 1.5 s on a mid-range Android over 4G with the poster; JS under 250 KB gzipped before the three.js chunk; three.js chunk lazy; GLB under 400 KB; images under 900 KB total on the landing page; no layout shift when the canvas replaces the poster (they share the same box).

**Accessibility.** One `<h1>`; sections are `<section aria-labelledby>`; the story steps are an `<ol>`; the pricing cards are not tables; every button and link has visible text; focus order follows the visual order; `:focus-visible` rings on everything interactive; contrast at or above 4.5:1 for Body on both grounds (`--fg-muted` on `--ink` is 7.8:1; `--ink-muted` on `--paper` is 6.1:1; `--fg-faint` is decorative only and never carries required information); all animation honours `prefers-reduced-motion` per section 7; the mobile sheet traps focus and closes on Escape; form fields have `<label>`s, `autocomplete` tokens (`name`, `email`, `tel`, `address-line1`, `address-level2`, `address-level1`, `postal-code`) and `aria-describedby` for errors.

**Definition of done.** The landing page reads completely with WebGL disabled and with reduced motion on; every slot from section 0 is either filled or renders nothing; the rehearsal-mode notice is visible until a provider is configured; the site passes Lighthouse accessibility 100 and performance ≥ 85 on mobile with the 3D enabled.

---

## 13. Final design test, applied

| Section | 3-second read? | More desirable? | Needs explaining? | Removable? |
|---|---|---|---|---|
| Hero | yes | yes | no | no |
| What it does | yes | yes | yes, in four lines | no: it is the "what is this" answer |
| Conversation → Action | per step, yes | yes | yes | no: it is the proof |
| Worn | yes | yes | no | could be, kept at three images because the brief asks for human proof and it is the only warmth on the page |
| It can act | yes | strongly | yes | no |
| Privacy | yes | indirectly | yes | no |
| Pricing | yes | yes | yes | no |
| Preorder | yes | yes | no | no |

Removed relative to the previous site: FAQ, specifications table, eight use cases, feature readouts, capture ticker, timestamp rail, finish and accessory configurator, stock counter, three-year plan.
