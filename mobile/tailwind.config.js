/**
 * The Tailwind theme is not a second design system — it is @lyzn/design's
 * tokens, generated. `tokens.json` is written by the design package's
 * scripts/gen-css.mjs alongside tokens.css and fonts.json; this file only
 * arranges them into Tailwind's namespaces. Nothing here holds a number.
 *
 * Tailwind's config is loaded by plain Node (tailwindcss/loadConfig), which
 * is why the tokens arrive as JSON rather than as an import of
 * ../packages/design/src/tokens.ts.
 */
const t = require('@lyzn/design/tokens.json');
const { hairlineWidth } = require('nativewind/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // `relative` pins these globs to this file rather than to the Tailwind
  // child process's cwd. @lyzn/design carries no JSX, so it is not scanned;
  // add it here the day a component moves into the package.
  content: {
    relative: true,
    files: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  },
  presets: [require('nativewind/preset')],

  // A tone is not an appearance: a paper receipt sits inside a night screen,
  // and `dark:` is one global switch that structurally cannot say that. The
  // tone system is CSS variables (see src/design/tone.tsx); `dark:` is
  // reserved for the app-wide light/dark choice, and `class` keeps that
  // under our own persisted setting rather than under the OS alone.
  darkMode: 'class',

  theme: {
    extend: {
      colors: {
        ...t.colors,
        // Resolved per subtree by <ToneProvider>, which is the only writer of
        // these variables. `bg-tone-bg`, `text-tone-fg`, `border-tone-line`,
        // `bg-tone-carbon`, `text-tone-stamp` — a screen names the role, and
        // the ground it stands on decides the colour.
        tone: {
          bg: 'var(--tone-bg)',
          fg: 'var(--tone-fg)',
          muted: 'var(--tone-muted)',
          faint: 'var(--tone-faint)',
          line: 'var(--tone-line)',
          line2: 'var(--tone-line2)',
          panel: 'var(--tone-panel)',
          panel2: 'var(--tone-panel2)',
          'inv-bg': 'var(--tone-inv-bg)',
          'inv-fg': 'var(--tone-inv-fg)',
          carbon: 'var(--tone-carbon)',
          'carbon-line': 'var(--tone-carbon-line)',
          stamp: 'var(--tone-stamp)',
          settled: 'var(--tone-settled)',
          danger: 'var(--tone-danger)',
        },
      },
      spacing: t.spacing,
      borderRadius: t.radius,
      borderWidth: { hairline: hairlineWidth() },
      fontFamily: t.fontFamily,
      fontSize: t.fontSize,
      letterSpacing: t.letterSpacing,
      transitionDuration: t.duration,
      transitionTimingFunction: t.ease,
    },
  },
  plugins: [],
};
