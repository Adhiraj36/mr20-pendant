/**
 * The className pipeline, without a device. `node scripts/tailwind-smoke.cjs`
 *
 * Metro does exactly two things with the CSS: it runs the Tailwind CLI for
 * the platform, then hands the output to `cssToReactNativeRuntime`. This runs
 * the second half against the first half's real output, so a class that
 * resolves here is a class the app will render — and a theme that has drifted
 * out of @lyzn/design fails in two seconds rather than on a simulator.
 *
 * The `grouping` option is not optional: without it every `group-*:` rule is
 * dropped on the floor. It is the same value `withNativeWind` passes.
 *
 * `--content` repeats tailwind.config.js's globs and adds this file, so the
 * checked classes below are found in their own source and the app's globs are
 * still exercised. Nothing has to carry a probe class for the sake of a test.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { cssToReactNativeRuntime } = require('react-native-css-interop/css-to-rn');
const { cssToReactNativeRuntimeOptions } = require('nativewind/dist/metro/common');

const root = path.resolve(__dirname, '..');

/** One rule per feature the design system depends on. */
const CHECKS = [
  'bg-red-500',      // Tailwind's own palette still reaches the runtime
  'bg-desk',         // the light ground
  'bg-night',        // the dark one
  'text-inkfg',      // a colour whose name the generator special-cases
  'bg-tone-bg',      // the tone variables ToneProvider writes
  'text-tone-stamp',
  'border-tone-carbon-line',
  'rounded-card',    // radius from @lyzn/design
  'font-mono-500',   // one family per weight, the native rule
  'text-label',      // size + tracking in points, leading as an em multiple
  'border-hairline', // resolved at runtime, not baked
  'pt-safe',         // safe-area inset variables
];

const css = execFileSync('npx', [
  'tailwindcss', '-i', './global.css',
  '--content', './app/**/*.{js,jsx,ts,tsx},./src/**/*.{js,jsx,ts,tsx},./scripts/tailwind-smoke.cjs',
], {
  cwd: root,
  env: { ...process.env, NATIVEWIND_OS: 'ios', BROWSERSLIST_ENV: 'native' },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});

const out = cssToReactNativeRuntime(css, { ...cssToReactNativeRuntimeOptions, inlineRem: 14 });

if (!out.flags?.nativewind) throw new Error('nativewind/preset is not in tailwind.config.js');
console.log('flags:', out.flags, '| rem:', out.rem, '| rules:', Object.keys(out.rules).length);

for (const name of CHECKS) {
  const rule = out.rules[name];
  if (!rule) throw new Error(`missing rule: ${name} — is it in a file matched by content?`);
  console.log(name.padEnd(24), JSON.stringify(rule.n[0].d));
}
