# Design system, round six: the package catches up, and both surfaces read it

Base: `main` at `a90569a`.

Since the package was written, the site changed under it — Archivo and Martian Mono, headings at 800, the reference's mono button, one desk ground with the reference's paper, stamp blue, the six heading inks, the `LYZN....` wordmark, square buttons — and each change landed as a literal in `web/src/index.css` or `web/src/styles/pricing.css`, or as a private map in `mobile/src/design/tokens.ts`. The package still describes the site as it was. This round makes `packages/design` the single description again and has both surfaces read it.

## Global constraints

- **Nothing changes on screen.** Every value below already ships somewhere; this round moves it, it does not redesign it. Web: `npm run lint && npx vite build`, then a headless screenshot diff of hero, story, pricing and footer at 1440 and 390 against the pre-change tree — zero pixels outside the WebGL model's box. App: `bun run test`, `npx tsc --noEmit` (three known `packages/design` TS5097 errors excepted), `npx expo export --platform ios`.
- Package: `cd packages/design && npm test && npm run gen:css`; `tokens.css` is committed regenerated.
- The Playwright MCP browser is shared; verify with your own headless Playwright.
- Commit trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019s83HMh3LRiqEkP4xX3Yg4
  ```
- Report to `.superpowers/sdd/2026-09-08-design-round-six/task-<n>-report.md` (copy to the main checkout).

## The contract (Task 1 implements; Tasks 2 and 3 consume — names are fixed)

In `packages/design/src/tokens.ts`:

```ts
export const colors = {
  ...existing,                       // ink, paper*, desk, fg*, inkFg*, signal, danger, stamp, receipt*
  sheet:   '#FBFBF8',                // the reference's paper: a sheet lying on the desk (panels, slips, tier cards)
  faded:   '#6E6F64',                // the reference's secondary text on a sheet
  rule:    '#D5D5CC',                // the reference's hairline on a sheet
  settled: '#1B6B45',                // "done" green on a receipt
}
// The reference's `--void` (#B03A2E) is not added: `danger` (#B5483C) is that colour's job.

export const typeScale = {
  displayXL: { size: 44, weight: 800, tracking: -0.038, leading: 0.97 },
  displayL:  { size: 32, weight: 800, tracking: -0.035, leading: 1.02 },
  displayM:  { size: 24, weight: 800, tracking: -0.02,  leading: 1.1  },
  bodyL, body, small, label — unchanged
}
// Web display sizes: the generator wraps XL/L/M in the clamps index.css uses today
// (XL clamp(2.5rem→2.75rem at ≥640px, 7vw, 6.5rem); L clamp(2rem, 4.5vw, 4rem); M clamp(1.5rem, 2.6vw, 2.25rem)).

export const button = {
  font: 'mono', size: 11, weight: 700, tracking: 0.1, uppercase: true,
  padding: { y: 12, x: 18 }, compact: { y: 11, x: 14 },
  fill: colors.inkFg, ink: colors.sheet, hover: colors.stamp, hoverInk: '#FFFFFF', radius: 0,
} as const

export const fonts = {
  web:    { sans: <the current CSS stack>, mono: <the current CSS stack> },
  native: {
    sans: { 400: 'Archivo_400Regular', 500: 'Archivo_500Medium', 600: 'Archivo_600SemiBold', 800: 'Archivo_800ExtraBold' },
    mono: { 400: 'MartianMono_400Regular', 500: 'MartianMono_500Medium', 600: 'MartianMono_600SemiBold', 700: 'MartianMono_700Bold' },
  },
  google: { sans: 'Archivo:wght@400;500;600;700;800', mono: 'Martian+Mono:wght@400;500;600;700' },  // the <link> the site requests
} as const
// `fonts.sans` / `fonts.mono` are removed; every reader moves to `fonts.web.*` or `fonts.native.*`.

export const inks = [
  { id: 'ink', hex: colors.inkFg, label: 'Ink', default: true },
  { id: 'red', hex: '#A30002', label: 'Red' }, { id: 'orange', hex: '#7D4600', label: 'Orange' },
  { id: 'green', hex: '#006826', label: 'Green' }, { id: 'blue', hex: '#0052A8', label: 'Blue' }, { id: 'purple', hex: '#8400A1', label: 'Purple' },
] as const
export const INK_STORAGE_KEY = 'lyzn.ink'

export const wordmark = { text: 'LYZN....', size: 15, weight: 700, tracking: 0.1 } as const
```

`radius.button` stays 0. The generator (`scripts/gen-css.mjs`) emits, in addition to today's `--color-*`, `--font-*`, `--ease-*`, `--dur-*`:
`--font-sans`/`--font-mono` from `fonts.web`; `--type-display-xl-size` (the clamp) / `-weight` / `-tracking` (em) / `-leading` for XL, L, M; `--btn-size` (px), `--btn-weight`, `--btn-tracking` (em), `--btn-pad-y`, `--btn-pad-x`, `--btn-pad-y-compact`, `--btn-pad-x-compact`, `--btn-fill`, `--btn-ink`, `--btn-hover`, `--btn-hover-ink`; and `[data-ink="<id>"]{--heading:<hex>}` for every non-default ink. Tests in `packages/design/test/` pin every name above.

## Task 1 — The package (branch `r6-package`)

Implement the contract exactly; update every comment that describes the old world (the "never 700" note, the "headings are the one exception" note, the `fonts` note); regenerate `tokens.css`; extend the tests. Commit `"design: the package describes the site as it is"`.

## Task 2 — The site reads it (branch `r6-web`, after Task 1 is on the branch)

- `web/src/index.css`: `.display-xl/l/m` and `h1,h2,h3` read the `--type-display-*` variables; `.btn` and `.btn-compact` read the `--btn-*` variables (the hover rule reads `--btn-hover`/`--btn-hover-ink`); the tone table's `#FBFBF8` literal becomes `var(--color-sheet)`; the `[data-ink]` rules leave `index.css` for the generated `tokens.css`.
- `web/src/styles/pricing.css`: the scoped `--desk/--paper/--ink/--faded/--rule/--stamp/--settled/--void` aliases point at `--color-desk/--color-sheet/--color-inkfg/--color-faded/--color-rule/--color-stamp/--color-settled/--color-danger`; no hex literal remains in the file.
- `web/src/lib/ink.ts` derives its list and key from `inks`/`INK_STORAGE_KEY`; `Nav.tsx`/`Footer.tsx` render `wordmark.text`; `web/index.html`'s Google Fonts URL is built from `fonts.google` at build time (a tiny Vite HTML transform) or, if that is disproportionate, asserted equal in a test.
- Prove zero visual change with the screenshot diff. Commit `"web: reads the package for type, buttons, colours, inks and the mark"`.

## Task 3 — The app reads it (branch `r6-app`, after Task 1 is on the branch)

- `mobile/src/design/tokens.ts`: `fontFamily` becomes `fonts.native` from the package (drop the private map); `mobile/app/_layout.tsx` registers `Archivo_800ExtraBold` and `MartianMono_700Bold` from `@expo-google-fonts/archivo` and `@expo-google-fonts/martian-mono`, so the display weight has a real file (Android synthesises otherwise).
- `Txt`'s display variants read `typeScale` (weight 800, the new tracking/leading); `Button` reads `button` (mono, 11/700, uppercase, the paddings, square, fill/ink); `colors.sheet/faded/rule/settled` are available through the re-export; the app's grounds stay ink/paper (the desk is the website's ground, not the app's — say so in a comment).
- Update `mobile/tests/design/tokens.test.ts` for the new shape; keep the R17b assertions. Gates as above. Commit `"app: reads the package for faces, weights and the button"`.

## Merge order

1, then 2 and 3 in parallel, then the controller's screenshot pass at 1440 and 390 and the mobile gates on the merged head.
