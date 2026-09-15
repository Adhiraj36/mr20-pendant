# LYZN app: UI design specification and implementation handoff

**Date:** 2026-09-06
**Author:** creative direction pass (Fable)
**Implementer:** Opus, in `mobile/`
**Reference:** the shipped website in `web/` — its code, not its spec; the two differ (0.2)
**Status:** ready for implementation, pending the confirmations in section 0

This document replaces the app's current visual language (green-tinted near-black, acid-lime `GradientCard`s and `AmbientWash`, gradient bento tiles, LED dot-matrix numerals, a tick dial, glow shadows, a six-hue speaker ramp, three coexisting surface systems) with the website's: warm monochrome, ink and paper, Geist, hairlines, one gold signal at dot and hairline scale, and receipts as proof. Every screen is restyled. The navigation is corrected, not restructured. No feature is added or removed except where 0.4 says so.

The rule the whole app follows:

**Ink is where things are happening. Paper is where they are kept. LYZN is the product. Mira is its voice.**

---

## 0. Read this first

### 0.1 Decisions already made (do not reopen)

| # | Decision | Made |
|---|---|---|
| D1 | Full adoption of the website palette. Lyzn green is retired everywhere, including the notification light and the Android adaptive-icon background. | with the user, 2026-09-06 |
| D2 | The assistant remains **Mira**. LYZN names the product, the pendant, the app and the receipts; Mira is who you talk to. | with the user |
| D3 | Direction "ink and paper": the live layer on ink, the record on paper; the site's Stage components become the app's; receipts only as proof; the pendant never spins. | with the user |
| D4 | The Library groups by day. Action-item checkboxes persist on the phone until the API has a field for them (0.3). | proposed, approved |

### 0.2 The website moved past its own spec — follow the code

`web/docs/design-spec.md` describes a timed "four lines" panel and a "differentiator" section. The shipped site replaced both with the **receipt**; its thesis is *"Other AI hands you notes. We hand you receipts."* Tokens drifted too: `fg-faint` is `#8D8C87` (not `#6E6C68`), `inkfaint` is `#66655F`, scroll damping is 0.2, nav blur is 24 px. This document uses the shipped values. When in doubt, `web/src/index.css`, `web/src/components/Receipt.tsx` and `web/src/components/Stage.tsx` win.

### 0.3 Slots (never ship the token; render nothing, or the fallback given)

| Token | What is missing | Fallback in this spec |
|---|---|---|
| `[ACTION_DONE_API]` | `PATCH /recordings/{id}` accepts title, tags, speakers, categoryId — no `actionItems[].done`. | Checkbox state kept in AsyncStorage keyed `${recordingId}:${index}`; a `label-sm` line `SAVED ON THIS PHONE` under the list. Remove the line when the field exists. |
| `[MIRA_RECEIPTS]` | The chat stream emits `delta`, `tool`, `done`, `error` — no structured action result. | No receipts in chat. When a `{type:'receipt', …}` event exists, render `Receipt` inline in Mira's run (2.10). |
| `[ACTION_SOURCE]` | Action items carry no reference to the utterance they came from. | Client-side best-effort match (2.7 step 5). No match → no sweep. |
| `[VOICE_END]` | `VoiceSession` has no mute; ending is closing. | **End call** = close the session and go back. No mute control. |

### 0.4 Behaviour touched

Fixed in passing: the tab labelled "Chats" that opens the Library; `Layout` imported from Reanimated 4.5 in `src/design/Toast.tsx` and `src/components/LinkStrip.tsx` (it is `LinearTransition` now); splash background `#0B0D12`; notification colour and adaptive-icon background. Moved: the categories entry point leaves the Mira home and lives in the Library (2.6) and the recording detail (2.7). Hidden: the voice screen's always-visible diagnostics line (2.11). Nothing else changes in behaviour — every store action, Alert, toast, poll and reconnect path stays as it is.

### 0.5 Verified facts used in copy

19 g, one button, two microphones, glass front, graphite shell, wakes on speech, stops after about ten seconds of quiet, records to its own 7.6 GB storage with the phone away, about 35 kB/s over Bluetooth, silent files deleted on the phone before anything is uploaded. Sources: `README.md`, `docs/hardware-handoff/01-product-features.md`, `mobile/README.md`.

---

## 1. Structure

### 1.1 Routes

The files do not move. Each route declares its ground.

| Route | Ground | Notes |
|---|---|---|
| `index` | ink | gate; the mark pulses (2.1) |
| `onboarding/welcome` | ink | |
| `onboarding/sign-in` | ink | |
| `onboarding/pair` | ink | also pushed from the tabs |
| `onboarding/ready` | ink | the pairing receipt |
| `oauth-native-callback` | ink | mark pulse |
| `(tabs)/index` | **paper** | **Library** |
| `(tabs)/chat` | ink | **Mira** |
| `(tabs)/device` | ink | **Pendant** |
| `recording/[id]` | **paper** | |
| `categories` | **paper** | |
| `chat/[id]` | ink | |
| `live` | ink | |
| `voice` | ink | |
| `profile` | ink | |

Gate logic, guards, deep links, `dismissTo` flows and the Clerk bridge stay exactly as they are.

### 1.2 Tab bar

Native (`NativeTabs`), always ink — the site's nav is ink even over paper sections. Order: **Library · Mira · Pendant**.

- Library: SF `square.stack` / `square.stack.fill`; MD `layers`.
- Mira: SF `bubble.left` / `bubble.left.fill`; MD `chat_bubble_outline` / `chat_bubble`.
- Pendant: the LYZN mark (4.6), as a 24 pt single-colour template bitmap @1x/2x/3x replacing `assets/pendant-tab*.png`.
- Colours: tint `fg`, unselected icon `fgFaint`, labels 11/12 pt weight 500. iOS: background ink with the system dark blur (one of the two blurs in the app). Android: background `graphite`, indicator `line2`, ripple `line`, labels on the selected tab only (as today). Through the props already used in `(tabs)/_layout.tsx`.
- Screens keep `useTabBarPadding()`.

### 1.3 Screen chrome

No navigation headers (as today). Every pushed screen draws a **TopRow** (3) inside the safe area: the **Back** control at the left, an optional centred `label-sm` title, an optional right action. Height 56. No circles.

Status bar: `light` on ink, `dark` on paper, set by `Screen` (3); the flip happens on the same frame as a tab switch. `SystemUI.setBackgroundColorAsync` stays ink.

### 1.4 Ground transitions

Stack pushes keep the platform's `slide_from_right`. Paper→paper (Library → detail) and ink→ink pushes carry nothing extra. The only ink↔paper crossings are tab switches: a hard edge, no wipe, no crossfade — the site's paper turn.

### 1.5 Where receipts appear

Three places, all proof, and nowhere else:

1. **Ready** (2.5): the pairing receipt.
2. **Library** (2.6): a conversation that is still being made is a short slip; when it turns `ready` it prints its title, its facts and its tasks band by band, the stamp lands, and then its torn edges fade and it files itself as a plain row. Proof delivered, then filed.
3. **Mira** (2.10): action reports — a slot until the chat API emits structured events.

The sync completion is *not* a receipt. It is the last row of a `StatusBlock` in gold — the site's `COMPLETED 21:14` (2.13). A receipt after every five-minute pass would be noise.

### 1.6 Where the other ground shows through

Live things that sit on a paper page are **inverted ink panels** — the site's Automation strip, "a different layer of the product": the link panel and the selection bar in the Library. Toasts are ink chrome on every ground. Nothing on an ink screen is paper except a receipt, which carries its own paper wherever it is.

---

## 2. Screens

Conventions: sizes in pt; type tokens from 4.2; components from section 3; motion IDs from section 6; `·` in a mono label is a middle dot with a space either side; text in `CAPS` is a mono label; **bold** is a button or a display line; *italic* is body copy.

### 2.1 Gate — `app/index.tsx`

Ink. The **LYZN mark** (4.6) centred, 40 pt, `fg` stroke, pulsing (M0). Nothing else. Replaces the green square. `oauth-native-callback` shows the same.

### 2.2 Welcome — `onboarding/welcome.tsx`

Ink, full bleed.

- **Pendant stage**, top 54% of the screen: `Pendant` in state **Hero** (5.3). No gradient scrim.
- Below, in the 24 pt gutter (centred at `readableWidth` on tablets):
  - eyebrow `label` muted: `LYZN · AI PENDANT`
  - `display-xl`: **Talk.** / **LYZN remembers.**
  - `body-l` muted, max 34ch: *A record of the conversations you were actually in, kept by the pendant you wear.*
  - `Steps` rail: `01` **Wear it** *It wakes when someone speaks.* · `02` **Come back in range** *The phone pulls the audio off it.* · `03` **Read it back** *Every word, who said it, and what to do.*
  - primary **Get started**, full width.
- Motion: M1; the pendant fades in first, the text blocks follow with `enter(i)`.

### 2.3 Sign in — `onboarding/sign-in.tsx`

Ink. `Steps` row at the top: `1 SIGN IN — 2 PAIR — 3 READY`, step 1 active.

- eyebrow `YOUR ACCOUNT`; `display-l` **Sign in.**; `body-l` muted, max 40ch: *Your conversations follow you to any phone you sign in on.*
- Provider buttons, stacked, full width, 48 high, radius 12: **Continue with Apple** as primary (fg bg, ink text, `AppleMark` 18), **Continue with Google** as secondary (transparent, `line2`, `GoogleMark` 18). Apple first on iOS, Google first on Android. Busy: the pressed button's label becomes `OPENING…` (`label-sm`) and both disable at 40%. Error: `small` in `danger` under the buttons: *That did not work. Try again.*
- Footer `label-sm` faint, centred: `NO PASSWORDS · APPLE OR GOOGLE ONLY`.

### 2.4 Pair — `onboarding/pair.tsx`

Ink. `Steps` row, step 2 active.

- **Pendant stage**, 38% height: state **Pair** (front-on, floating). **It does not spin.** Scanning shows in the copy and the rows.
- eyebrow `PAIRING`; `display-l` **Find your pendant.**; `body-l` muted: *Switch it on and keep it within arm's reach.*
- **Status line** `label-sm` muted, one of: `ALLOW BLUETOOTH TO CONTINUE` (Android permissions) · `STARTING BLUETOOTH…` (iOS) · `SCANNING…` · `SCANNING · 2 FOUND · TAP YOURS` · `CONNECTING…`. Errors are `small` in `danger`, not mono.
- **Device rows** — a hairline list (no cards), each 64 high, hairline between:
  - left: `body` 500 the advertised name (`YLF20_D830`); under it `label-sm` faint `−62 DBM` and `LYZN` when `advertisedService` is present (replaces the `MR20` pill).
  - right: a **`TickRow`** of 4 ticks as the signal meter (thresholds −55 / −70 / −85 as today). While this row connects, the ticks become `label-sm` `CONNECTING…`.
  - Rows enter with M1. While one connects, the others fade out (160 ms).
  - After 4 s with nothing found, `small` faint under the list: *Still hidden? Unplug it from USB, then switch it off and on.*
- Footer: failed → primary **Try again**; otherwise ghost **Not now**.
- Pendant lights: **Dark** while failed; full otherwise. On success the lights are already up as the route replaces to Ready.

### 2.5 Ready — `onboarding/ready.tsx`

Ink. `Steps` row, step 3 active. The pendant in **Hero**, 30% height. Under it, the **pairing receipt**, centred, max width 360, printing on arrival (M2):

```
            LYZN · PAIRED
        YLF20_D830 · FW V1.2
- - - - - - - - - - - - - - - - - -
BATTERY ..................... 98% ✓
FREE ....................... 7.6 GB
RECORDING ..................... Yes
- - - - - - - - - - - - - - - - - -
▌▌ ▌ ▌▌▌ ▌ ▌▌ ▌▌▌ ▌ ▌ ▌▌ ▌▌ ▌ ▌▌▌
 RECORDS ON ITS OWN · SYNCS WHEN IN RANGE
```

Stamp `LINKED`, top right. `BATTERY` is an `ok` row (gold value with ✓) when ≥ 20%. `RECORDING` reads `Yes` / `Not yet`. Barcode seed: the MAC. Below the slip: `display-m` **Your pendant is linked.**; `body` muted: *It records to its own storage even when your phone is away.*; primary **Open my library**.

### 2.6 Library — `(tabs)/index.tsx` — paper

The record. A sectioned list on paper with sticky day headings.

**Header** (24 pt gutter):

1. eyebrow `label` muted: `LIBRARY · 42 CONVERSATIONS · 1H 04M TRANSCRIBED`; `· 3 TRANSCRIBING` appended while any are processing. Zero fragments are dropped.
2. **Link panel** — `PanelInverted` (ink on paper), radius 20, padding 16, min height 64. Only when a pendant is paired. Left: the mark 20 pt + a `label-sm` in the inverted fg. Right: a compact button. States:
   - linked, idle: `LINKED · UP TO DATE` (or `LINKED · PULLED 3 NEW`) · compact secondary **Sync**
   - syncing: `SYNCING · PULLING 2 / 5` (phase text from 7) with a 1 px gold progress rule along the panel's inside bottom edge (indeterminate phases: no rule) · compact ghost **Stop**
   - connecting: `CONNECTING…`
   - Bluetooth off: `BLUETOOTH IS OFF`
   - not connected: `NOT IN RANGE` · compact secondary **Connect**
   Taps and toasts as today's `LinkStrip`. This is the only ink surface on the page.
3. **Filter row**, present whenever there is at least one recording: horizontal `Chip`s — `ALL` · each category with ≥ 1 recording, uppercased · `ARCHIVE · 3` when any are archived · `EDIT` → `/categories`. Active chip inverted.
4. **Select** ghost `small`, right-aligned (when there are rows); **Done** while selecting.

**Day groups.** Rows group by the local date of `startedAt`. Sticky heading per group: `display-m` **Today** / **Yesterday** / **Thursday** (within 6 days) / **4 Sep** (older; **4 Sep 2025** across a year boundary); under it `label-sm` faint `3 CONVERSATIONS · 48M`. 32 pt between groups.

**Row — filed** (`ready`, `archived`, `failed`): no card; hairline under; 16 pt vertical padding; pressed → `panel` background (M8).

- `body` 500 title, 2 lines — *Untitled conversation* in muted when none.
- `label-sm` faint meta: `09:41 · 12M · 2 SPEAKERS` `· WORK` (category) `· 2 TASKS` (action-item count). Fragments drop when empty.
- `small` muted summary, 2 lines.
- archived: title muted; meta ends `· NO SPEECH · GONE IN 30 DAYS`; no summary.
- failed: meta ends `· FAILED` in `danger`; `small` `danger` error text; inline ghost **Try again**.
- selecting: an 18 pt `Checkbox` leads the row; selected rows sit on `panel`.

**Row — printing** (`pending`, `uploaded`, `processing`): a compact **`Receipt`**, max width 320, left-aligned, showing only its header and one open row:

```
        LYZN · 09:41
- - - - - - - - - - - - - -
TRANSCRIBING ..............
```

The open row's key is `ON PHONE` / `QUEUED` / `TRANSCRIBING` by status; its leader runs to the edge with no value — the slip is still printing. When the status becomes `ready` (poll or push) **M2** runs. The open row fades (160 ms) and the slip prints, band by band:

1. **Title** — the title as a Geist 15 / 500 line (the slip's quote slot, without quotation marks), then a cut.
2. **Facts** — rows `SPEAKERS … 2`, `LENGTH … 12M`, `FILED UNDER … WORK` (dropped when there is no category).
3. **Tasks** — only when there are action items: a cut, then one `plain` row per item (the item text in sentence case, one line, truncated; value the owner's name or `—`), at most four, then `+ 2 MORE` when there are more.
4. The stamp `DONE`; the barcode seeded by `recordingId`; the footer `TXN` + the last eight characters of the id, uppercased.

The summary is not on the slip — it belongs to the filed row. After a 1.2 s hold the scalloped edges and the shadow fade over 700 ms and the content re-lays as the filed row. If the row leaves the viewport mid-print, it completes off-screen and is simply filed. Rows already `ready` on first load render filed; a printed id is remembered so a refetch never re-prints.

**Empty states** — centred `Empty` (`display-m` + `body` muted, max 300, no glyph):

- all, paired: **Nothing captured yet.** *Wear the pendant. It records on its own and shows up here when it is back in range.*
- all, unpaired: **No pendant paired.** *Pair yours to start pulling conversations off it.* + primary **Pair a pendant**
- a category: **Nothing in this category.**
- archive: **Nothing archived.** *Conversations with no speech land here for 30 days.*

**Selection bar** (while selecting): `PanelInverted` pinned above the tab bar, radius 20 on the top corners, padding 16: `label-sm` `2 SELECTED` (or `TAP CONVERSATIONS TO SELECT`), right ghost **Select all** / **Select none**; when n > 0 a second row of `Chip`s: each category, `NO CATEGORY`, `DELETE` in `danger`. Alerts and toasts as today.

Unchanged behaviour: load on mount; focus reconnect and upload flush; 15 s poll while anything is processing; pull-to-refresh (tint `faint`) → `sync()` when linked else reload + flush; infinite scroll with a footer `label-sm` faint `LOADING…` (no spinner).

### 2.7 Recording detail — `recording/[id].tsx` — paper

`TopRow` with Back. Scroll, 24 pt gutter, 12 pt between blocks.

1. **Header**: `display-l` title (*Untitled conversation* muted if none); `label-sm` faint meta `THU 4 SEP · 09:41 · 12M · 2 SPEAKERS`; tags as `Chip`s; **category chips** — a `Chip` per category, the current one inverted, trailing `EDIT` → `/categories`. Optimistic move with rollback and toast as today. Hidden for archived.
2. **Pipeline** (when not `ready`): a `StatusBlock` with one labelled row and a `small` muted line:
   - pending: `ON PHONE` — *Waiting to upload.*
   - uploaded: `QUEUED` — *Transcription starts in a moment. You can already listen.*
   - processing: `TRANSCRIBING` — *Splitting by speaker. You can already listen.*
   - archived: `NO SPEECH` — *Nothing was said, so this moved to the archive. Playable for 30 days.*
   - failed: `FAILED` in `danger` — the error — secondary **Try transcribing again** (toast as today).
3. **Player** (when there is audio): `Panel` radius 20, padding 20.
   - `display-m` tabular `4:07` fg, `/ 12:30` muted, on one line.
   - **`Scrub`**: 32 pt hit height; track 1 px `line2`; played portion 1 px `signal`; knob 8 × 8 radius 2 `fg`. Follows the finger; seeks on release.
   - controls, centred, gap 16: compact secondary (Lucide `rotate-ccw` 16 + `label-sm` `15`), **play** as primary 48 × 48 radius 12 (Lucide `play` / `pause` 20), compact secondary (`rotate-cw` + `30`).
   - **`Segmented`** **Enhanced** · **Original**, with `label-sm` faint under it: `NOISE AND SILENCE REMOVED` / `EXACTLY AS THE PENDANT HEARD IT`. Hidden when there is no `cleanKey`; the line then reads `DRAG THE BAR, OR TAP ANY LINE TO JUMP`. Source priority unchanged.
4. **Summary** — `SummaryCard`: eyebrow `SUMMARY`; `body` text.
5. **Action items** — eyebrow `ACTION ITEMS`; a `TaskRow` per item: square `Checkbox`, `small` text, owner as `mono-11` muted at the right (`SPEAKER 2` or the name). The checkbox toggles locally (0.3). **Tapping the text** runs `[ACTION_SOURCE]`: tokenise the item (drop stop-words); take the utterance with the highest content-word overlap if it covers ≥ 0.5 of the item's content words; scroll the transcript so it sits in the top third; **draw the sweep** (M4) under the matched words and hold it until the next sweep. No match → a light haptic and nothing else. Under the list, `label-sm` faint `SAVED ON THIS PHONE` (0.3).
6. **Speakers** — eyebrow `SPEAKERS`; `small` faint *Diarization tells voices apart but cannot name them. Tap to label.*; a wrapping row of items: 28 pt **initial box** (radius 6, `line2`, `mono-11` initial) + `small` 500 name — named speakers fg, `Speaker N` muted. Tap → **Rename sheet** (M14): bottom sheet on paper, `line2` top edge, radius 20 top corners, padding 24: `display-m` **Name this speaker.**; `small` muted *Applies to every line this voice says here.*; `Control` (autofocus, placeholder = current label); row secondary **Cancel** / primary **Save**. Empty save reverts to the default.
7. **Transcript** — eyebrow `TRANSCRIPT`; `TranscriptLine`s. The first line of each speaker's run carries the 20 pt initial box and the `label-sm` muted name; every line carries its `mono-11` faint tabular time. Text `body`. **Follow-along** (M3): before playback every line is fg. During playback the line containing the playhead is *active* (fg, `panel` background radius 12, a 2 px `fg` rule at its left edge); lines already spoken *recede* to muted; lines to come stay fg. The list keeps the active line in the top third, damped. Tap → seek. Ready with no utterances: `small` faint *No speech was found in this recording.*
8. Footer: ghost **Delete conversation** in `danger`, 28 pt clear of the bottom inset. Alert as today.

Loading: the mark pulse (M0) centred on paper. Error: `display-m` **Could not open this conversation.** + `body` muted error.

### 2.8 Categories — `categories.tsx` — paper

`TopRow`: Back, title `CATEGORIES`. `body` muted intro (current copy). A hairline list of `Control`s (50 high), each with a trailing ghost Lucide `x` 20 → Alert (current copy). Add row: `Control` with placeholder *Add a category* + compact secondary **Add** (disabled when blank). **Bottom bar** (the site's mobile checkout bar, solid): fixed above the bottom inset, `paper` bg, `line` top edge, primary **Save changes** (disabled until dirty; `Saving…` while saving). Rows enter and leave with M1 and `LinearTransition` 220. Validation and toasts as today.

### 2.9 Mira home — `(tabs)/chat.tsx` — ink

Scroll, 24 pt gutter, top inset + 20.

1. **Top row**: the **avatar**, 40 pt rounded square (radius 9), image or `label-sm` initial on `panel` → `/profile`. No right control (the categories entry moved, 0.4).
2. eyebrow `label` muted `MIRA · REMEMBERS WHAT LYZN HEARD`; `display-l` **Hey, Meera.** (name resolution as today; **Hey.** when none).
3. **`Composer`**: `Panel` radius 20 with `line2`; placeholder *Ask a question…*; left doors Lucide `image` and `paperclip` 20 as ghost icons; right **send** 40 × 40 primary radius 10 with Lucide `arrow-up` 20 — not a disc. Staged tray above, thumbnails radius 10, document chips as `Chip`s. Limits and toasts as today.
4. **Quick asks**: a horizontal row of compact secondary buttons — *What did I do today?* · *Any action items for me?* · *Who did I talk to lately?* · *Summarise my week*. Tap → new thread already streaming, as today.
5. **Ways in** — a hairline list, no cards, three 64 pt rows: leading glyph 24, `body` 500 + `small` muted, trailing Lucide `arrow-right` 20 faint:
   - orb (static frame) — **Talk to Mira** — *A call. Talk over her to cut in.* → `/voice`
   - `Waveform` 24 wide (moving only while the pendant is linked and recording) — **Live transcript** — *Read what the pendant hears, as it hears it.* → `/live`
   - the mark — **New chat** — *Start from nothing.*
6. **Recent** — eyebrow `RECENT`; grouped by day like the Library, `display-m` headings; rows: `body` title (*New conversation* muted when untitled), `label-sm` faint `21:14`; a streaming row shows orb 16 `composing` + `REPLYING…`. Long-press → delete Alert (copy as today). Empty: `small` faint *Nothing yet. Ask Mira something and it will appear here.* Windowing, refresh, tombstones as today.

### 2.10 Mira thread — `chat/[id].tsx` — ink

`TopRow`: Back; centre `label-sm` `MIRA · PROPOSAL TO ARJUN` (title uppercased, one line; `MIRA` alone when untitled); right ghost Lucide `ellipsis` → delete Alert (copy as today, then toast **Conversation deleted**).

Messages, 24 pt gutter, 16 pt gaps:

- **You**: right-aligned, max 82%, `Panel` radius 12 (bottom-right radius 4), padding 12/16, `body`. Attachments above the text: images 148 × 111 radius 10 → viewer; documents as `Chip`s with Lucide `file`.
- **Mira**: no bubble. A 1 px rail in `line` down the left, 20 pt in from the gutter. At the top of the rail, while streaming, the **orb 16** (`composing`; `searching` while `memory.recall` runs; `weaving` while `memory.ingest` runs); when done, a 4 pt square in `faint`; when failed, in `danger`. `label-sm` faint `MIRA` above the first block of a run. Text `body` fg. Tool steps are **`StatusBlock` rows** (M5): `MEMORY · SEARCHING` → `MEMORY · 3 RECALLED` / `MEMORY · NOTHING RELEVANT` / `MEMORY · UNAVAILABLE`; `REMEMBERING` → `REMEMBERED` / `COULD NOT REMEMBER THIS`. A failed turn shows `danger` text *That did not go through. Tap to try again.*; the whole block retries on tap. `[MIRA_RECEIPTS]` would render a `Receipt` here, inside the rail.
- **Empty**: orb 160 `breathing`, centred; `display-m` **Hi, I'm Mira.**; `body` muted, max 300: *I remember what your pendant hears. Ask me about your days.*; three compact secondary suggestions: *What can you do?* · *What did I do today?* · *Any action items for me?*
- **Composer host**: `line` top edge; `BlurView` dark with ink at 55% over it (the second of the two blurs); `Composer`; bottom inset. Busy: input disabled, doors at 35%.
- Image viewer Modal: as today, ink at 94%.

### 2.11 Voice — `voice.tsx` — ink

`TopRow`: Back (ends the call); centre `label-sm` `MIRA · CALL`. Stage: orb 200, state-mapped as today. Under it a `label-sm` hint: `CONNECTING…` · `LISTENING · JUST TALK` · `THINKING…` · `SPEAKING · TALK OVER ME TO CUT IN` · `CALL ENDED` · `VOICE NEEDS THE UPDATED APP BUILD`; tool notes `REMEMBERING` / `SEARCHING MEMORY` take precedence while thinking; errors are `small` in `danger` (*The call dropped.*, *No audio from the microphone. Reopen this screen.*, `Audio: …`). A **`Waveform`** under the hint, driven by mic level while listening (live, not a loop), still otherwise. Words: what you said as a `SpokenLine` (your initial; text in curly quotes) muted; Mira's reply `body-l` fg, centred. Footer: secondary **End call** (`[VOICE_END]`). The diagnostics string (`48000 HZ · MIC 1240 · VOICE 82 KB`) appears as `label-sm` faint only while the hint is long-pressed.

### 2.12 Live transcript — `live.tsx` — ink

`TopRow`: Back; centre `label-sm` `LIVE · YLF20_D830`. Status row with a `line` under it: linked and recording → `Waveform` 24 + `label-sm` `LISTENING`; otherwise `label-sm` faint `WAITING FOR THE PENDANT TO RECORD · AUDIO STREAMS ONLY WHILE IT DOES`. Transcript `body-l`: finals fg; the trailing partial in `faint` — arriving text is the faint rung until it settles, the site's recede in reverse. `…` faint while recording with nothing yet. Failed: `display-m` **That did not work.**; `small` `danger`; secondary **Try again**.

### 2.13 Pendant — `(tabs)/device.tsx` — ink

**Paired.** A `ScrollView` whose offset drives the pendant (M7).

1. **Stage**, 46% of the screen height, full bleed, at the top of the scroll content: `Pendant` **Hero** → **Material** over the first 60% of the stage's height of scroll. Overlaid inside the safe area: top-left eyebrow `label` muted `YLF20_D830 · FW V1.2`; top-right the **link chip** — a `Chip`: `LINKED` (fg) · `LINKING…` · `NOT IN RANGE` (faint) · `BLUETOOTH OFF` (faint); tap toggles connect/disconnect (toasts as today). The **recording dot** (5.4) when `info.recording`.
2. **Unreachable row** (when `unavailable`), a hairline row: `body` 500 **Bluetooth is off** / **Pendant not reachable**; `small` muted copy as today; compact secondary **Try again now** (`Trying…`) when Bluetooth is on.
3. **Instrument list** — hairline rows, 72 high: `label-sm` muted key at the left; at the right a `TickRow` and a value:
   - `BATTERY` · `TickRow` 20 ticks · `display-m` tabular **98%** (M12)
   - `STORAGE` · `TickRow` 20 ticks (used fraction) · `display-m` tabular **1.2** + `small` muted `/ 7.6 GB`
   - `RECORDING` · `Switch` · `label-sm` `CAPTURING` / `PAUSED` / `OUT OF REACH` (disabled when not connected; toasts as today)
   - `AUTO-SYNC` · `Switch` · `label-sm` `ON ITS OWN` / `UNTIL YOU PRESS SYNC`
   - `LAST SYNC` · — · `label-sm` `2M AGO` / `NOT YET`
   - when used > 0.9, one more row, `label-sm` fg: `NEARLY FULL · IT STOPS RECORDING WHEN IT RUNS OUT · SYNC SOON`. No amber.
4. **Sync** — primary **Sync now**, full width (`Syncing…`, 60%, while running). While a pass runs, a `StatusBlock` above the button (M5): rows arrive as phases complete — `READING THE PENDANT` → `PAUSING RECORDING` → `PULLING · 2 / 5 · 1.1 MB OF 2.5 MB` (this row is `live` and updates in place; a 1 px gold progress rule runs along the block's inside bottom edge) → `UPLOADING` → `RESUMING RECORDING` → `UP TO DATE · 21:14` as an `ok` row in gold with ✓ (the sync completion, 1.5). Ghost **Stop** at the block's right while running. On completion the block holds 4 s, then collapses (`LinearTransition` 220); toasts as today.
5. Secondary **Live transcript**, full width (starts recording if needed, then `/live`; toast *Link the pendant first* when offline).
6. **Disclosure sections** — hairline rows, 56 high: `label` muted title, `label-sm` faint hint at the right, Lucide `chevron-down` rotating 180° (M17); body with `LinearTransition` 220:
   - `STORAGE`, hint `1.4 GB`: `Detail` rows `ON THIS PHONE` **1.1 GB** with `small` muted *Transcribed audio streams from your account, so the copy here is safe to clear.* and secondary **Clear transcribed audio**; then `ON THE PENDANT` **0.3 GB RECLAIMABLE** with *Already-transcribed recordings are safe to remove. Unsynced audio is never touched.* and secondary **Free up pendant space** (disabled offline or while syncing; `DELETING 2 / 5…` while running; *Link the pendant to free its space.* in `small` faint when offline). Alerts and toasts as today.
   - `DEVICE`, hint `FW V1.2`: `Detail` rows Bluetooth MAC (mono), Firmware, Wi-Fi firmware, Device clock (mono), Wi-Fi state (`WIFI_STATES` text), Record mode; `label-sm` faint `LAST PASS · 2.5 MB · 1 SILENT DISCARDED · 0 WILL RETRY`; `linkError` as `small` in `danger`.
   - `ACCOUNT`, hint the email: secondary **Edit profile**; ghost **Sign out**; then eyebrow `DANGER ZONE` in `danger`; danger buttons **Unpair this pendant**, **Erase everything on the pendant** (disabled offline), **Delete all audio on this phone**. Two-stage Alerts as today.

Pull-to-refresh → `refreshInfo` when connected.

**Unpaired.** Stage with the pendant in **Dark**; `display-m` **No pendant paired.**; `body` muted *Pair yours to start pulling conversations off it.*; primary **Pair a pendant**; then the `ACCOUNT` section.

### 2.14 Profile — `profile.tsx` — ink

`TopRow`: Back; centre `label-sm` `PROFILE`. Centred column: **avatar** 132 rounded square, radius 28 (image, or `display-l` initial on `panel`); a 36 pt badge at its bottom-right (radius 10, `fg` bg, Lucide `image` 16 in ink) → picker; `label-sm` faint `CHANGE PHOTO` / `UPLOADING…`. Name: a centred `display-m` `TextInput`, min width 200, over a 1 px underline in `line2` that turns `signal` and grows 120 → 160 on focus (M16); `label-sm` faint `THE NAME MIRA CALLS YOU`. Footer `label-sm` faint `SIGNED IN AS YOU@EXAMPLE.COM` (the account email). Picker, limits and toasts as today.

---

## 3. Component inventory

`src/design/` after this work:

| File | Exports | Status |
|---|---|---|
| `tokens.ts` | `colors`, `tones`, `space`, `radius`, `type`, formatters | rewritten (4) |
| `tone.tsx` | `ToneProvider`, `useTone`, `Screen` | new |
| `motion.ts` | `ease`, `dur`, `enter`, `useReducedMotionFlag` | rewritten (6) |
| `primitives.tsx` | `Txt`, `Label`, `Row`, `Divider`, `Panel`, `PanelInverted`, `Button`, `Chip`, `Checkbox`, `Switch`, `Control`, `Segmented`, `Detail`, `Steps`, `Empty`, `TopRow`, `Back`, `RollingNumber` | rewritten |
| `Touchable.tsx` | `Touchable` | scale 0.985, 120 ms, no dim, light haptic |
| `TickRow.tsx` | `TickRow` | new; replaces `TickDial`, `MiniArc`, `DotMatrix` |
| `Receipt.tsx` | `Receipt`, `ReceiptRow`, `ReceiptCut`, `ReceiptStamp`, `ReceiptBarcode` | new; Skia with a flat fallback |
| `stage/` | `Waveform`, `SpokenLine`, `TranscriptLine`, `SummaryCard`, `Sweep`, `TaskRow`, `StatusBlock` | new; ports of `web/src/components/Stage.tsx` |
| `Scrub.tsx` | `Scrub` | rewritten `ScrubBar` |
| `Toast.tsx` | `ToastProvider`, `useToast` | restyled; same API |
| `icons.tsx` | `Mark`, `AppleMark`, `GoogleMark` | Lucide replaces the rest |
| `useTabBarPadding.ts` | | unchanged |

Also: `src/components/LinkStrip.tsx` → `LinkPanel.tsx` (2.6); `MiraComposer.tsx` → `Composer.tsx`; `PendantVisual.tsx` / `PendantModel.tsx` re-rigged (5); `OrbVisual.tsx` retinted; `Orb.tsx` (static SVG) kept as the no-Skia fallback and retinted.

**Removed:** `Glass.tsx` (`Glass`, `Bloom`, `ScreenWash`, `GradientCard`, `AmbientWash`), `Tile.tsx`, `TickDial.tsx`, `DotMatrix.tsx`, `Gauge.tsx` (`Counter` moves into primitives as `RollingNumber`; `ArcGauge`, `Meter` go), `ProviderMarks.tsx` (merged into `icons.tsx`), the hand-drawn icon set, `speakerRamp`/`speakerColor`, `radius.pill`, `glow`, `lift`.

### 3.1 Foundations

**`Screen`** `{ tone: 'ink' | 'paper'; bg?: 'ink' | 'charcoal' | 'void'; edges?; children }` — `View flex: 1` on the tone's bg; provides the tone; renders `<StatusBar style>` from the tone; applies the top safe area unless told otherwise. The only place a ground is chosen.

**`useTone()`** → `{ bg, fg, muted, faint, line, line2, panel, panel2, invBg, invFg, statusBar }` (4.1).

**`Txt`** `{ variant; tone?: 'fg' | 'muted' | 'faint' | 'signal' | 'danger' | 'inv'; mono?; tabular?; center?; numberOfLines? }`.

**`Label`** `{ children: string | (string | undefined | false)[]; size?: 'md' | 'sm'; tone? }` — mono, uppercase; an array is joined with ` · ` and empty fragments are dropped (the site's slot rule, applied to every mono label in the app).

**`Panel`** — radius 20, `panel` bg, 1 px `line`. **`PanelInverted`** — wraps its children in the *other* tone's provider on that tone's bg, radius 20. The only way to put ink on paper or paper on ink.

### 3.2 Controls

**`Button`** `{ variant: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'compact'; full?; disabled?; loading?; icon?: LucideIcon }`
- md: min height 48, padding 0 20, radius 12, Geist 15 / 500 / −0.15. compact: 40 / 0 14 / radius 10 / Geist 14 / 500.
- primary: `invBg` bg, `invFg` text. secondary: transparent, 1 px `line2`, `fg`. ghost: transparent, `muted`, a 1 px `line2` rule 6 pt under the label (RN has no underline offset — draw it); pressed → `fg` with a `fg` rule. danger: secondary with `danger` text and `danger` at 40% for the line.
- Pressed: scale 0.985 (Touchable). Disabled: 40%. Loading: label → `…` mono, disabled. No spinner, no shadow.

**`Chip`** `{ active?; danger?; onPress }` — `label-sm`, height 32, padding 0 10, radius 6, 1 px `line2`; active → `invBg` / `invFg`; danger → `danger` text.

**`Checkbox`** — 18 × 18, radius 6, 1 px `line2`; checked → `invBg` fill and the tick path `M2.5 6.2 4.8 8.5 9.5 3.8` (12-unit box, stroke 1.6, round caps) in `invFg`; fill over 300 ms.

**`Switch`** — track 44 × 24 radius 6, 1 px `line2`, `panel` bg; knob 16 × 16 **square** radius 4, `faint` off → `fg` on, translateX 0 → 20 over 200 ms ease-out. Its `label-sm` state text is the caller's.

**`Control`** — height 48, padding 0 14, radius 10, 1 px `line2`, `panel` bg, Geist 15; placeholder `faint`; focus → border `signal`; invalid → border `danger`; message `small` beneath in `danger` or `faint`.

**`Segmented`** — track radius 14, padding 4, `panel` bg, 1 px `line`; options min height 44, radius 10, Geist 14 / 500; active → `invBg` / `invFg`; 160 ms.

**`Detail`** — rows of `label-sm` faint key over `body` fg value (mono when asked), 16 pt vertical, hairline between.

**`Steps`** `{ steps: string[]; active: number; layout: 'row' | 'rail' }` — row: `label-sm` numeral + label per step, active `fg`, done `muted`, upcoming `faint`, 24 pt 1 px `line2` separators; rail: a numerals column (`label-sm` faint) beside `body` 500 titles and `small` muted lines.

**`Empty`** — `display-m` title, `body` muted max 300, optional `Button`. No glyph.

**`TopRow`** `{ title?; right? }` — 56 high; **`Back`** at the left: 40 × 40 radius 10, Lucide `arrow-left` 20 in `fg`, pressed → `panel` bg, hit slop 8, `accessibilityLabel="Back"`.

**`RollingNumber`** — the current `Counter`: UI-thread number that rolls to its value over 240 ms (M12).

### 3.3 Instruments and proof

**`TickRow`** `{ ticks: number; value: number; width?: number | '100%'; height?: 14 }` — `ticks` bars, 2 wide, radius 1, spread across the width; lit (`i / ticks ≤ value`) `fg` at 0.85; unlit `fg` at 0.16; the last lit tick is `signal`. Per-tick opacity animates 240 ms on change (Reanimated, UI thread). Reduce motion: instant.

**`Receipt`** `{ title?: string; meta?: string; stamp?: string; quote?: string; rows?: ReceiptRowSpec[]; total?: { k, v }; barcodeSeed?: string; footer?: string; compact?: boolean; printing?: { bands: number } }`

Two layers. **Under**: a Skia `Canvas` sized to the content: a `Path` — a rect with semicircular bites of radius 8 along the top and bottom edges at a 16 pt pitch, centres *on* the edge (the site's mask: `circle at 50% 0` and `50% 100%`) — filled `receiptPaper #FBFAF6`, with `<Shadow dx={0} dy={10} blur={8} color="rgba(20,20,22,0.16)" />`. **Over**: RN content, padding 26 / 22 / 20, all colours fixed (`receiptInk #16181A`, `receiptFaint #8A8880`) — the slip ignores tone.

- header: `Geist Mono 12.5 / 600 / +2` uppercase, centred; default `LYZN · PROOF OF WORK`. meta: `Geist Mono 11 / 500 / +1.5` uppercase, `receiptFaint`, centred.
- `ReceiptCut`: 1 px dashed `receiptInk` at 26%, `margin 16 0 12`.
- `ReceiptStamp`: absolute, right 14, top −20; padding 5 10; 2 px `receiptInk` at 62%; radius 3; `Geist Mono 11 / 600 / +1.5` uppercase in `receiptInk` at 70%; `rotate(-7deg)`. Ink, never a colour.
- quote: Geist 15 / 500 in curly quotes, `paddingRight 96` when a stamp exists.
- `ReceiptRow { k, v?, ok?, plain? }`: `Geist Mono 12 / +0.7 / line-height 23`; key uppercase (`plain` keeps sentence case, for task text) in `receiptInk` at 72%; a dotted leader — a flex-1 `View` with `borderBottomWidth 1, borderStyle 'dotted'`, `receiptInk` at 30%, translated up 4 (Android needs `borderRadius: 0.01` for dotted to draw); value 500; `ok` → value in `signal` with ` ✓`; a missing value leaves the leader running to the edge.
- total: key as a row key; value `Geist Mono 20 / 600 / +0.4` tabular.
- `ReceiptBarcode`: 84 Skia `Rect`s, widths 1–3 from an LCG seeded by a string hash of `barcodeSeed`, height 44, `receiptInk` alternating with transparent. Deterministic.
- footer: `Geist Mono 10.5 / 500 / +1` uppercase `receiptFaint`, centred.
- `compact`: padding 18 / 16 / 14; max width 320.
- **Fallback** (no Skia module, per `OrbVisual`'s probe): a plain `View` with straight edges, 1 px `line2`, no shadow; same content.
- **Printing** (M2): with `printing = { bands }`, only the first `bands` content blocks (title/meta count as band 0; quote, rows, total, barcode, footer follow) are visible; a newly revealed block mounts inside an `overflow: hidden` `Animated.View` whose `maxHeight` goes 0 → its measured height over 700 ms (measure with a hidden twin render, or `measure` after mounting at opacity 0). The stamp: opacity 0 → 1 and scale 1.15 → 1 over 240 ms after the last band. The barcode after the stamp. **Filing**: a `filed` prop fades the Skia layer (edges and shadow) to 0 over 700 ms while the content re-lays as its host decides.

### 3.4 Stage family — `src/design/stage/`

Direct ports of `web/src/components/Stage.tsx`; every one reads tone.

- **`Waveform`** `{ bars?: 12; level?: SharedValue<number>; active: boolean; width? }` — bars 3 wide, gap 3, height 32, radius 1, `muted`, base heights `[0.35, 0.7, 0.45, 1, 0.6, 0.85, 0.3, 0.75, 0.5, 0.9, 0.4, 0.65]`, origin bottom. `active` without `level`: `scaleY` 0.22 → 1 → 0.22 over 1.1 s ease-in-out, delay `(i % 6) × 0.11 s` (the site's `level`). With `level` (0..1): `scaleY = base × (0.22 + 0.78 × level)` derived on the UI thread — live, not a loop. Inactive: static at 0.22. Reduce motion: static.
- **`SpokenLine`** `{ initial: string; children }` — 28 pt initial box (radius 6, 1 px `line2`, `mono-11` muted) + `body` 16/26.
- **`TranscriptLine`** `{ time: string; speaker?: string; initial?: string; state: 'spoken' | 'active' | 'upcoming'; onPress }` — columns `[time][speaker][text]`; `mono-11` faint tabular time; `label-sm` muted speaker when given; `body` text. State changes step the colour over 500 ms (recede, never a fade): spoken → `muted`; active → `fg` on `panel` (radius 12, padding 12/16) with a 2 px `fg` rule at the left; upcoming → `fg`.
- **`SummaryCard`** `{ eyebrow?: string; children }` — `Panel` radius 20, padding 20; `Label` eyebrow; `body`.
- **`Sweep`** `{ progress: SharedValue<number>; children }` — wraps an inline run of `Text` in a `View` and lays a 1 px `signal` line at `bottom: −2` whose width is `progress × 100%`. There is no `background-size` trick in RN: the matched words are their own `Text` inside the wrapper.
- **`TaskRow`** `{ text; meta?; done; onToggle; onPress }` — radius 12, 1 px `line`, `panel2` bg, padding 12/14; `Checkbox`; `small` text (done → `muted` with a strike in `faint`); `mono-11` muted meta at the right.
- **`StatusBlock`** `{ rows: { label: string; value?: string; ok?: boolean; live?: boolean; line?: string }[]; progress?: SharedValue<number>; right?: ReactNode }` — radius 12, 1 px `line`, `panel2` bg, padding 16, gap 10. Row: `label-sm` label + `mono-11` faint tabular value; `line` adds a `small` muted sentence under the row; `ok` → label and value in `signal`, value followed by ` ✓`; `live` → value in `fg` (the row that is updating). Rows enter with M5. `progress` draws a 1 px `signal` rule along the inside bottom edge at that width; hidden when undefined. `right` is an optional control (the ghost **Stop**).

### 3.5 Others

**`Scrub`** — see 2.7 step 3. RN responder as today; the knob and the played rule follow a `SharedValue`.

**`Composer`** — see 2.9 step 3; behaviour of `MiraComposer` unchanged.

**`Toast`** — `Panel` radius 12 with 1 px `line2`, **always in the ink tone**, padding 12/16; a leading 6 pt square: `fg` (neutral), `signal` (success), `danger` (error), `faint` (busy); `small` 500 message; `small` muted detail. Top-anchored at `insets.top + 8`; M15; queue, durations and haptics as today. No blur, no shadow.

**`LinkPanel`** — see 2.6 step 2.

**`Orb`** — geometry unchanged; dots in `fg`; the static SVG fallback's halo removed and its ring set to `line2`. Static frame (the reduce-motion frame at t = 0.6) whenever the rule in 6 says it may not move.

**`Pendant`** — section 5.

---

## 4. Visual system

### 4.1 Colour — `tokens.ts`

```ts
export const colors = {
  ink: '#0B0B0C', charcoal: '#131315', void: '#050506',
  graphite: '#1C1C1F', graphite2: '#242428',
  paper: '#F3F1EC', paper2: '#EAE7E0', paper3: '#DDD9D0',
  fg: '#EDEAE4', fgMuted: '#A6A39D', fgFaint: '#8D8C87',
  inkFg: '#141416', inkMuted: '#5B5A57', inkFaint: '#66655F',
  signal: '#C9A76A', danger: '#B5483C',
  receiptPaper: '#FBFAF6', receiptInk: '#16181A', receiptFaint: '#8A8880',
} as const;

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
} as const;
```

Rules. No gradients (the pendant's own lighting excepted). No coloured surfaces. No blue, no green, no amber, no red other than `danger`. `signal` never fills anything larger than 8 pt: it is dots, 1–2 px rules, the ✓ and value on a confirmed row, the last lit tick, a focus underline. `danger` is errors and destructive actions only. `faint` may carry mono labels, timestamps and captions — never body text. Contrast: `fgMuted` on ink 7.8:1; `fgFaint` on graphite ≥ 4.5:1; `inkMuted` on paper 6.1:1; `inkFaint` on paper-2 ≥ 4.5:1.

### 4.2 Typography

`@expo-google-fonts/geist` (`Geist_400Regular`, `Geist_500Medium`, `Geist_600SemiBold`) and `@expo-google-fonts/geist-mono` (`GeistMono_400Regular`, `GeistMono_500Medium`), loaded in the root layout; the splash is held until they are ready. Never 700. Never `fontWeight` without the matching family name.

| Token | Family | Size | Weight | Letter-spacing | Line-height | Use |
|---|---|---|---|---|---|---|
| display-xl | Geist | 40 | 500 | −1.4 | 40 | welcome headline |
| display-l | Geist | 32 | 500 | −0.96 | 34 | screen statements, detail title, greeting |
| display-m | Geist | 24 | 500 | −0.48 | 27 | day headings, player clock, sheet titles, instrument values (tabular) |
| body-l | Geist | 18 | 400 | −0.09 | 27 | sub-lines, live transcript, Mira's spoken reply |
| body | Geist | 16 | 400 | 0 | 25 | everything else; 500 for row titles |
| small | Geist | 14 | 400 | 0 | 21 | summaries, hints, task text, button compact |
| label | Geist Mono | 12 | 500 | +1.44 | 14 | eyebrows, section titles — uppercase |
| label-sm | Geist Mono | 11 | 500 | +1.32 | 13 | meta, chips, status, step numbers — uppercase |
| mono-11 | Geist Mono | 11 | 400 | 0 | 14 | timestamps, values — tabular |

Tabular numerals on anything that changes in place. Sentence case everywhere except mono labels. Measures: display-l max 16ch; body max 40ch; `readableWidth 560` now centres content on every screen, not only onboarding.

### 4.3 Spacing

4 pt base: 4, 8, 12, 16, 20, 24, 32, 40, 56. Screen gutter **24** (was 16). Top rows 56. Row padding 16 vertical. Section gaps 32. Hairlines run the full width inside the gutter.

### 4.4 Radii

Soft rounded squares, echoing the pendant. **No pill anywhere.**

| Radius | On |
|---|---|
| 20 | panels, inverted panels, summary card, sheets' top corners, avatars ≥ 96 |
| 12 | buttons, task rows, status blocks, message bubbles, Back, play button, toasts |
| 10 | inputs, compact buttons, segmented options, the send button, thumbnails, avatar badge |
| 6 | chips, checkboxes, initial boxes, switch tracks |
| 4 | switch knobs, the bubble's tucked corner |
| 2 | scrub knob |
| 1 | waveform bars, ticks |

Avatars: radius = size × 0.22 (40 → 9, 132 → 28).

### 4.5 Borders, shadows, blur

1 px hairlines in `line`; `line2` for controls, chips, secondary buttons, sheet edges, toasts. Dashed for receipt cuts. Dotted for receipt leaders. **No `shadow*` or `elevation` on any UI element.** The receipt's Skia shadow is the one shadow in the app. **Blur in two places:** the composer host and the iOS tab bar. Toasts, sheets, bars and panels are solid.

### 4.6 Iconography and the mark

`lucide-react-native`, 20 pt, stroke 1.5, `currentColor`: `arrow-left`, `arrow-right`, `arrow-up`, `x`, `check`, `plus`, `minus`, `chevron-down`, `play`, `pause`, `rotate-ccw`, `rotate-cw`, `image`, `paperclip`, `file`, `ellipsis`. No sparkles, no illustrations. Play, pause and ✕ stop being text glyphs.

**The LYZN mark** (`icons.tsx: Mark`) — the site's favicon as SVG: a rounded square (radius one third of its side; at 32 pt, a 21 × 21 square with rx 7) stroked `currentColor` 1.6, and two dots r 1.15 at the upper-left — the microphone pinholes. It is the app icon foreground, the Pendant tab icon, the gate pulse, the loading state, the link panel's glyph and the New chat glyph. App icon: mark in `fg` on `ink`. Android adaptive: foreground the mark, background `ink`, monochrome the mark.

### 4.7 UI states

| Element | Rest | Pressed | Focus | Disabled |
|---|---|---|---|---|
| Primary button | `invBg` / `invFg` | scale 0.985 | — | 40% |
| Secondary | transparent, `line2` | scale 0.985, bg `fg` at 4% | — | 40% |
| Ghost | `muted`, rule `line2` | `fg`, rule `fg` | — | 40% |
| Danger | `danger` text, `danger` 40% line | scale 0.985 | — | 40% |
| Chip | `line2` | scale 0.985 | — | — |
| Chip active | `invBg` / `invFg` | | | |
| Control | `panel`, `line2` | — | border `signal` | 40% |
| Control error | border `danger`, message `danger` | | | |
| Checkbox | `line2` square | fill `invBg`, 300 ms | | |
| Switch | track `line2`, knob `faint` | knob `fg`, +20, 200 ms | | 40% |
| Segmented | track `panel` | active `invBg` | | |
| List row | — | bg `panel`, 120 ms | | |
| Transcript line | per state (3.4) | bg `panel` | | |

Colour and border transitions 160 ms; transforms 120 ms; all ease-out.

---

## 5. The pendant

### 5.1 Asset and scene

Keep `src/components/PendantModel.tsx` (expo-gl + three r185) and `PendantVisual.tsx`'s GL-with-video-fallback shape.

**Do not use the site's meshopt GLB.** Hermes has no WebAssembly and the meshopt decoder requires it. In order: (a) re-export `mobile/assets/pendant.glb` through `gltf-transform` with `quantize` only — no meshopt, no draco — and confirm it loads (expect roughly 600 KB); (b) otherwise keep the current 1.4 MB `pendant.glb`. Delete `pendant_textured.glb` (5.4 MB, no visible gain). +Z is the front. Normalise so the longest edge is 1.9 units, centre on bounds. Clone materials per instance.

Materials, from `web/src/three/Pendant.tsx:41-47`: Graphite `#4C4C52` roughness 0.42 metalness 0.9; Edge `#6D6D75` 0.26 / 0.9; Glass `#191920` 0.3; Tongue `#5A5A60` 0.4; MicMesh `#6F6F76` 0.55. `MeshStandardMaterial` is fine, but **use these metalness values** — the current cap of 0.2 is why the shell reads as plastic.

Camera FOV 32, near 0.1, far 50. Renderer: alpha, ACES filmic, **exposure 1.1** (the current 5 compensates for a rig that is replaced), sRGB, DPR ≤ 1.5, no MSAA.

### 5.2 Lighting

Target: lit faces around `#3A3A3E`, chamfers as thin bright lines, one soft highlight on the glass, never a white slab.

Preferred: an environment map. Build a small room of emissive planes matching the site's five lightformers (`web/src/three/PendantScene.tsx:28-63` — warm key `#FFF6EA` 0.62 at `[2.4, 3.2, 5]` size 11; cool fill `#EAF0F8` 0.4 at `[−3.2, 2, 4.6]` size 7; right rim `#E8ECF2` 7 at `[3.6, 0.4, −1.8]` 0.5 × 6; top rim `#EEF1F6` 5 at `[0, 3.4, −1.8]` 6 × 0.5; low rim `#DFE4EC` 3 at `[−2, −3.2, 1.4]` 5 × 0.5) on a `#16161B` room, run it once through `PMREMGenerator` at 256, and set `scene.environment`. If PMREM fails on the device's GL, log it and fall back to the current four directionals + hemisphere with intensities re-tuned to hit the target at exposure 1.1. No contact shadow (the site's mobile rule).

### 5.3 States

World units; yaw about Y, pitch about X; `scale` relative to the normalised model; `anchor` is where the model's centre lands in its stage, as fractions.

| State | Camera | Target | Yaw | Pitch | Scale | Anchor | Lights | Where |
|---|---|---|---|---|---|---|---|---|
| **Hero** | (0.35, 0.20, 6.4) | origin | +0.28 | −0.10 | 0.72 | (0.5, 0.5) | 1.0 | Welcome, Ready, Pendant tab at rest |
| **Material** | (0.35, 0.60, 6.2) | (0, 0.15, 0.10) | +0.32 | −0.30 | 0.72 | (0.5, 0.42) | 1.0 | Pendant tab, scrolled |
| **Pair** | (0, 0, 6.4) | origin | 0 | −0.06 | 0.62 | (0.5, 0.5) | 1.0 | Pair |
| **Dark** | as the current state | | | | | | 0.55 | not reachable, unpaired, pairing failed |

"Lights" multiplies both `renderer.toneMappingExposure` (1.1 × lights) and the host view's opacity, so the object dims and recedes together. Transitions lerp every field through a damped follower, `k = 1 − 0.8^(dt / 16.7)`; yaw the short way round. Idle in every state: y float `sin(t · 2π / 6) × 0.02`, yaw `sin(t · 2π / 9) × 0.03`. **There is no spinning state.** Remove the `spinning` prop, the 0.55 rad/s yaw and every caller of it.

### 5.4 The recording dot

When `info.recording` is true and the model is visible: each frame, project the centre of the `MicMesh` node (or, failing that, `(0, 0.63, 0.5)` in normalised model space) with `Vector3.project(camera)` and write the stage position to a `SharedValue`. A 6 × 6 pt RN view, radius 3, `signal`, sits there; opacity 0.5 → 1 → 0.5 on a 1.8 s loop. Hidden when it would land outside the stage. In the video fallback it sits at a fixed 62% / 38% of the stage (measured on the front frame). `accessibilityLabel="Recording"`.

### 5.5 Scroll dolly (Pendant tab)

`ScrollView onScroll` (throttle 16) → `p = clamp(scrollY / (stageHeight × 0.6), 0, 1)` → `smoothstep(p)` → mix Hero → Material through the damped follower. The stage is absolutely positioned at the top of the scroll content, so it scrolls away naturally; the camera moves as it goes. No pinning.

### 5.6 Fallback, loading, reduced motion

The `expo-video` fallback keeps the keyed clip but **paused on its front-facing frame** — the spin is gone from the fallback too; "lights" apply as opacity. A new `pendant-poster.png`, rendered from the app scene in **Hero** on transparent at 1200², replaces the current one. The poster shows immediately; the GL view fades in over 600 ms once its first frame is ready; if that takes more than 4 s, the poster stays (no spinner). Reduce motion: poster only, no float, the dot static.

---

## 6. Motion system

```ts
export const ease = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.4, 0, 1, 1),
};
export const dur = { micro: 120, ui: 160, enter: 420, slow: 700 };
export const enter = (i: number) => Math.min(i, 8) * 60; // stagger, capped
```

Timing only; no springs — nothing bounces. Layout changes: `LinearTransition.duration(220)`. Press: scale 0.985 over 120 ms with a light haptic — no dim.

**The loop rule.** The only things that move without a cause: the waveform while audio is live; the pendant's idle float; the recording dot; the orb while Mira is present (the empty thread, the voice call) or working — including the small orb on a Recent row while she is replying — never at rest in a list. Nothing else loops, pulses or shimmers. Progress is rules and labels, not spinners; the one spinner-like element is the mark pulse (M0) on the gate and the detail's loading state.

| ID | Animation | Trigger | From → To | Duration / easing | Reduced motion |
|---|---|---|---|---|---|
| M0 | Mark pulse | gate, loading | opacity 0.4 → 1 → 0.4 | 1.4 s loop, inOut | static 1.0 |
| M1 | Screen entrance | mount | opacity 0, y +16 → 1, 0; per block `enter(i)` | 420 / out | instant |
| M2 | Receipt prints | recording → `ready`; Ready mounts | bands `maxHeight` 0 → measured, in order; stamp opacity 0 → 1, scale 1.15 → 1; barcode opacity | 700 per band / out; stamp 240; hold 1.2 s; then edges and shadow → 0 over 700 | slip complete; files after 400 ms |
| M3 | Transcript recede | playhead crosses a line | text colour by state; active gains `panel` and the rule | 500 / out; damped scroll keeps active in the top third | colour only |
| M4 | Sweep | action item tapped, match found | underline width 0 → 100% | 420 / out; holds | full width, instantly |
| M5 | Status rows | phase change / tool step | opacity 0, x −6 → 1, 0 | 300 / out, 100 ms apart | instant |
| M6 | Lights | link gained / lost | lights 0.55 ↔ 1.0 | 700 / out | instant |
| M7 | Dolly | Pendant tab scroll | Hero → Material | scrubbed, smoothstep, follower k 0.2 | Hero held |
| M8 | Row press | any list row | bg → `panel` | 120 | same |
| M9 | Page turn | tab switch ink ↔ paper | nothing — hard edge; status bar flips | 0 | same |
| M10 | Waveform | audio live | `scaleY` per bar | 1.1 s loop, or level-driven | static |
| M11 | Streaming text | Mira delta | append; the orb runs | none | same |
| M12 | Number roll | value change | old → new | 240 / out | instant |
| M13 | Switch / checkbox | toggle | knob x 0 → 20 / fill | 200 / 300 | same |
| M14 | Sheet | rename; categories bar | y +24, opacity 0 → 0, 1 | 320 / out | opacity |
| M15 | Toast | show / hide | y −8 → 0, opacity | 160 / out | opacity |
| M16 | Focus underline | name field | width 120 → 160, `line2` → `signal` | 160 / out | colour only |
| M17 | Disclosure | header tap | chevron 0 → 180°; body `LinearTransition` | 220 | instant |

Do not add: springs, bounces, hover-style tilts, glows, gradient sweeps, shimmer skeletons, spinners (beyond the platform's own inside native controls), a spinning pendant.

---

## 7. Copy

Voice: short declaratives with full stops; sentence case; concrete numbers over adjectives; mono labels uppercase, fragments joined by ` · `; "conversation", never "recording", in prose; the device is "the pendant" or "your pendant" — its Bluetooth name appears only in mono meta. LYZN names the product; Mira is who you talk to; "she" for Mira where a pronoun is unavoidable. Errors are plain: *That did not work.* Words that must not appear: *revolutionary, game-changing, next-generation, AI-powered, seamless, ecosystem, unlock, supercharge, 100% private, never stored, end-to-end encrypted, zero data, learn more, discover, explore, magic, smart.*

Sync phase text (used by the link panel, the Pendant tab and toasts): listing `READING THE PENDANT` · pausing `PAUSING RECORDING` · wifi `SWITCHING TO PENDANT WIFI` · pulling `PULLING · i / n` (with `· X OF Y` when bytes are known) · uploading `UPLOADING` · resuming `RESUMING RECORDING` · done `UP TO DATE · HH:MM`.

Screen copy is written into section 2 and is final. Put every string into a `src/design/copy.ts` (or per-screen constants) so that Opus does not retype it and so that a slot that is empty renders nothing rather than the token.

---

## 8. Asset list

| Asset | Action |
|---|---|
| Fonts | add `@expo-google-fonts/geist` and `@expo-google-fonts/geist-mono`; load Geist 400 / 500 / 600 and Geist Mono 400 / 500 |
| Icons | add `lucide-react-native`; delete `src/design/icons.tsx`'s hand-drawn set except `Mark`, `AppleMark`, `GoogleMark` |
| `pendant.glb` | quantize-only re-export if it loads; otherwise keep. Delete `pendant_textured.glb` |
| `pendant-poster.png` | re-render from the app scene in Hero, transparent, 1200² |
| `pendant.mp4` | keep as the fallback; paused on the front frame |
| `pendant-tab@{1,2,3}x.png` | re-render from `Mark`, single colour, 24 pt |
| `icon.png`, `android-icon-{foreground,background,monochrome}.png`, `splash-icon.png`, `favicon.png` | `Mark` in `fg` on `ink`; adaptive background `ink`; monochrome the mark; splash icon the mark |
| `icons8-*.png` | delete |
| `app.json` | splash `backgroundColor` → `#0B0B0C`; `expo-notifications` `color` → `#EDEAE4`; adaptive `backgroundColor` → `#0B0B0C`; keep `userInterfaceStyle: "dark"` — paper is a ground, not an OS theme |

---

## 9. Implementation notes for Opus

**Keep.** The Expo Router structure and every route file; `NativeTabs`; the zustand stores; all of `src/ble`, `src/sync`, `src/api`, `src/live`, `src/voice`, `src/audio`, `src/notifications`; the `ToastProvider` API; `OrbVisual`'s Skia probe and fallback; `PendantVisual`'s GL-with-video-fallback shape and lifecycle; `useTabBarPadding`; the Clerk bridge; the formatters; every Alert and its copy; the 15 s poll, focus flush and reconnect behaviour.

**Order of work.**
1. `tokens.ts`, `tone.tsx`, `motion.ts`, `primitives.tsx`, fonts — and a `Screen` on every route with its ground from 1.1, so the app runs end to end on the new palette before any screen is redesigned.
2. `stage/`, `TickRow`, `Receipt`, `Scrub`, `Toast`, `icons` (`Mark`).
3. Library and detail (paper).
4. Pendant tab and the rig (5).
5. Mira home, thread, voice, live.
6. Onboarding.
7. Profile, categories, tab bar, `app.json`, icons and poster.
8. Delete the removed files; grep for `GradientCard|AmbientWash|Tile|TickDial|DotMatrix|palette\.accent|speakerColor|radius\.pill|glow\(|lift` and leave nothing.

**Tone.** `Screen` is the only place a ground is chosen. `PanelInverted` is the only way to put ink on paper or paper on ink. A component that needs a colour not in `useTone()`, `colors.signal` or `colors.danger` is a sign the design is wrong — stop and check this document.

**Receipt.** Build the scalloped paper as one Skia `Path`: `addRect`, then subtract a circle of radius 8 every 16 pt along the top edge (centres on y = 0) and the bottom edge (centres on y = height) with `PathOp.Difference` — a path op rather than painted bites, because the ground behind differs per tone. `<Shadow>` inside the `<Path>`. Barcode as `<Rect>`s. Size the canvas from the content's `onLayout`. For the print animation, measure each band once with a hidden twin (position absolute, opacity 0) and drive `maxHeight` from a `SharedValue`; never animate `height: 'auto'`.

**Three.** Do not import the meshopt decoder. Set metalness from 5.1, not the 0.2 cap. Exposure 1.1. Try the PMREM room; catch and log failure; fall back to directionals. The render loop already runs on the JS thread: read the scroll `ref` there for M7 and write the dot position to a `SharedValue` for 5.4. Remove `spinning` everywhere. Guard `gl.endFrameEXP()` against a lost context, as today.

**Fonts.** `useFonts` in `app/_layout.tsx`; `SplashScreen.preventAutoHideAsync()` until both fonts and Clerk `ready` are true. `type` tokens carry `fontFamily`; never rely on `fontWeight` alone — Android will synthesise a fake bold.

**Reanimated.** `Layout` → `LinearTransition` in the two files. Prefer `useSharedValue` + `useAnimatedStyle` over `entering` presets for anything staggered, so reduce-motion can zero it in one place: `useReducedMotionFlag()` combines Reanimated's `useReducedMotion()` with `AccessibilityInfo.isReduceMotionEnabled()`; when true, `dur.*` are 0 and loops do not start.

**Native tabs.** Set colours through the props already in `(tabs)/_layout.tsx`; check the SDK 57 `NativeTabs` reference for the iOS background and blur props before assuming. If the iOS bar cannot be forced to ink over a paper screen, leave it translucent — it will pick up paper — and accept the platform's behaviour rather than drawing a fake bar.

**Status bar.** `expo-status-bar`'s `<StatusBar style>` from `Screen`; on Android keep it translucent. Test the flip on a tab switch on both platforms.

**Lists.** Day grouping is a pure function `recordings → { key, heading, meta, items }[]` rendered with `SectionList` (sticky headers), or a flattened `FlatList` with `stickyHeaderIndices`. Selection, filters and paging as today. The Mira home's Recent list reuses the same grouping.

**Printing rows.** A row prints when its `status` becomes `ready` *while mounted*. Keep a set of printed ids in component state so a refetch or re-render never re-prints. Rows already `ready` on first load render filed.

**Performance.** No `BlurView` beyond the two allowed; no shadows; `getItemLayout` where rows are fixed; one Skia canvas per visible slip; the GL view mounts only on Welcome, Pair, Ready and the Pendant tab and unmounts when that tab blurs (as today); the orb pauses in background (as today).

**Accessibility.** Every `Touchable` has a role and a label; mono uppercase labels carry a sentence-case `accessibilityLabel` (screen readers spell out capitals); the recording dot is labelled; contrast per 4.1; targets ≥ 44; reduce motion per 6; the sweep and the recede never carry meaning alone — the playhead time and the active row's rule do.

**Definition of done.** Every screen renders on the new palette in Geist; the grep in step 8 returns nothing; the Library prints a slip when a test recording turns `ready` and files it; the pendant never spins on any screen; Bluetooth off, out of range, syncing and recording each read correctly on the Pendant tab and in the Library's link panel; the app runs with reduce motion on and with the Skia module absent (poster, flat receipt, SVG orb); `npm test` passes; a dev client build installs on Android and iOS.

---

## 10. Final design test

| Screen | 3-second read? | Reads as the site? | Needs explaining? | Removable? |
|---|---|---|---|---|
| Welcome | yes | yes — the object, two lines, one button | no | no |
| Sign in | yes | yes | no | no |
| Pair | yes | yes — the copy carries the state, the object stays still | no | no |
| Ready | yes | strongly — the first receipt | no | could fold into Pair; kept for the slip |
| Library | yes | yes — a day in receipts, filed | the printing slip, once | no |
| Detail | per block | yes — the Stage on paper | the sweep, once | no |
| Categories | yes | yes | no | no |
| Mira home | yes | yes | no | no |
| Thread | yes | yes — the rail and the status rows | no | no |
| Voice | yes | yes | no | no |
| Live | yes | yes | no | no |
| Pendant | yes | yes — the instrument as hairlines and ticks | no | no |
| Profile | yes | yes | no | no |

Removed relative to the current app: gradient tiles and the bento, the ambient wash, glass cards, LED numerals, the dial, glows and lifts, speaker colours, status colours, circle back buttons, the spinning pendant, the always-visible diagnostics line, three surface systems.
