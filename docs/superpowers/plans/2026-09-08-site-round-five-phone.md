# Site, round five: the phone is not a fallback

Base: `main` at `5bc98cb`.

On a phone the site currently degrades rather than adapts. Measured at 390×844 on the live code:

1. **Hero** — the pendant (`A_HERO_MOBILE`: scale 0.56, anchor y 0.305) is drawn over the headline: "Other AI" sits under the object. Archivo 800 made the headline five lines, and the mobile state was tuned for the old weight.
2. **How it works** — `Story` switches to `StackedStory` at ≤1023px: six static `Stage` cards (386–668px each), no person, no drawn devices, no slips in flight, no pendant. The scene the site is built around simply does not exist on a phone.
3. **The pay bar** — the pricing section's fixed bottom `<details>` bar is on screen from the hero down (it covers "See how it works"), because the reference fixed it for the whole page and our page is far longer.
4. **iOS viewport** — the pinned frames use `h-screen` (`100vh`) and `pinProgress` reads `viewport().h`; on iOS Safari the toolbar collapse changes the visual height mid-scroll, so a pinned scene jumps. Inputs in the pay sheet are set at 14px, which makes iOS zoom on focus.

## Global constraints

- Desktop is finished; nothing at ≥1024px changes in look or timing except where a shared value has to move. Verify desktop is unchanged after your work.
- Gates: `cd web && npm run lint && npx vite build`. Verify with your **own headless Playwright** at 390×844 and 430×932, *and* emulate iOS Safari's dynamic viewport (test with `100svh` vs `100lvh` sizes) — the MCP browser is shared with the controller; do not use it.
- Commit trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019s83HMh3LRiqEkP4xX3Yg4
  ```
- Report to `.superpowers/sdd/2026-09-08-site-round-five/task-1-report.md` (copy to the main checkout): COMPLETE/BLOCKED, sha, gate output verbatim, every measurement you took, deviations with reasons.

## Task 1 — The portrait scene (branch `r5-phone`)

Build the how-it-works scene for phones as a **portrait rig** with the same choreography as the desktop strip, not a stack of cards.

- In `web/src/sections/Story.tsx`, the ≤1023px (and short-screen) path becomes `PortraitStory`: the same sticky frame and `pinProgress('story')` scrub, the same six steps, captions and rail, the same slips and beats (`speak → slip → phone → slip → laptop → slip → WhatsApp → receipt → payoff`, same `seg()` windows so the two rigs stay in sync), but the scene is a **vertical strip** — stations stacked top to bottom in phone-native units (strip width ~360, stations ~320 wide: the person with the pendant on the chest and the spoken line beneath the head; the drawn `PhoneFrame`; the drawn `LaptopFrame` scaled to width; the WhatsApp `PhoneFrame`; the `Receipt`) — and the **camera pans vertically** (`translateY`) with `camY(p)` keyframes held at each station. Slips fly *down* the strip. The fit scale is `min(vw × 0.92 / STRIP_W, 1.15)`.
- The pendant rides with the person on phones too: the rig's mobile branch in `web/src/three/rig.ts` must honour `storyAnchor` instead of going `HIDDEN` after the hero (keep `simple` for the poster fallback), and the mobile hero → anchor travel uses the same `handoff` window. `setStoryAnchor` is published from the portrait scene with the portrait fit. Where WebGL is unavailable (`useCanRender3D` false — most real phones today), the `still` poster at `PENDANT` stands in exactly as on desktop; make sure it is sized for the portrait scale.
- `StackedStory` remains only for `prefers-reduced-motion`.
- The `Person` drawing is reused as is; the spoken line on the portrait strip is set at ~30px across the strip width.
- Sticky frames use `100svh` (with `100vh` fallback) — the hero's and the story's — and `viewport().h` in `web/src/lib/scroll.ts` must track the *small* viewport height consistently, so `pinProgress` and the frame agree on iOS. Test a simulated toolbar collapse (change the viewport height by ~60px mid-scroll) and confirm the scene does not jump.

## Task 1 also fixes the rest of the phone

- **Hero**: the object clears the headline at 390 and 430. Retune `A_HERO_MOBILE` (scale/anchor) and, if needed, `.display-xl`'s clamp floor for ≤639px; the eyebrow, headline, sub-line and buttons must all be readable with the object above them. Screenshot it.
- **Pay bar**: the fixed pricing `<details>` bar appears only once the pricing section has entered the viewport (an `IntersectionObserver` on the section; once shown it stays until the section is scrolled well past, then hides). It must never cover the hero or the story.
- **Pay sheet on iOS**: inputs ≥16px at ≤900px so Safari does not zoom on focus; the open sheet's `max-height` uses `svh`; the code stage and the pay stage fit without the page behind scrolling (`overscroll-behavior: contain`).
- **Receipts section and pricing cards** at 390: no horizontal overflow anywhere (`document.documentElement.scrollWidth === innerWidth` at every scroll position).

Commit: `"site: the phone gets the scene — a portrait rig, the pendant on the chest, and nothing over the headline"`.
