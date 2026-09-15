// Builds what the desktop serves to a dashboard frame:
//   dist/lz-kit.js     the elements and window.lz
//   dist/lz-kit.css    the tokens (from @lyzn/design), then src/styles.css
//   dist/fonts/*       Archivo and Martian Mono, since the frame has no network
//   dist/REFERENCE.md  what an agent reads before writing a page
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chart, colors, fonts, tones } from '@lyzn/design'
import { buildReference } from '../src/reference.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const require = createRequire(import.meta.url)

rmSync(dist, { recursive: true, force: true })
mkdirSync(path.join(dist, 'fonts'), { recursive: true })

await build({
  entryPoints: [path.join(root, 'src/index.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
  outfile: path.join(dist, 'lz-kit.js'),
})

/* Two grounds, one set of names. The kit only ever reads --lz-*, so a page an
   agent wrote switches theme without knowing there is one. */
const block = (selector, t, mode) => `${selector} {
  color-scheme: ${mode === 'night' ? 'dark' : 'light'};
  --lz-desk: ${t.bg};
  --lz-sheet: ${t.panel};
  --lz-sheet-2: ${mode === 'night' ? '#26261e' : t.panel2};
  --lz-ink: ${t.fg};
  --lz-ink-2: ${t.muted};
  --lz-ink-3: ${t.faint};
  --lz-rule: ${chart.rule[mode]};
  --lz-rule-2: ${chart.rule2[mode]};
  --lz-live: ${t.stamp};
  --lz-good: ${t.settled};
  --lz-bad: ${t.danger};
  --lz-wait: ${chart.wait[mode]};
  --lz-wait-ground: ${t.carbon};
  --lz-wait-line: ${t.carbonLine};
  --lz-on-series: ${colors.sheet};
${chart.series[mode].map((c, i) => `  --lz-series-${i + 1}: ${c};`).join('\n')}
}
`
const tokens = `/* Generated from @lyzn/design by scripts/build.mjs — do not edit. */
:root {
  --lz-sans: 'Archivo', ${fonts.web.sans.replace(/^'Archivo',\s*/, '')};
  --lz-mono: 'Martian Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --lz-paper: ${colors.receiptPaper};
  --lz-paper-ink: ${colors.receiptInk};
  --lz-paper-faint: ${colors.receiptFaint};
}
${block(':root, :root[data-theme="light"]', tones.desk, 'desk')}
${block(':root[data-theme="dark"]', tones.night, 'night')}
`
writeFileSync(path.join(dist, 'lz-kit.css'), tokens + '\n' + readFileSync(path.join(root, 'src/styles.css'), 'utf8'))

const faces = [
  ['@fontsource/archivo', ['archivo-latin-400-normal', 'archivo-latin-500-normal', 'archivo-latin-600-normal', 'archivo-latin-700-normal', 'archivo-latin-800-normal']],
  ['@fontsource/martian-mono', ['martian-mono-latin-400-normal', 'martian-mono-latin-500-normal', 'martian-mono-latin-700-normal']],
]
for (const [pkg, files] of faces) {
  const dir = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files')
  for (const f of files) copyFileSync(path.join(dir, `${f}.woff2`), path.join(dist, 'fonts', `${f}.woff2`))
}

writeFileSync(path.join(dist, 'REFERENCE.md'), buildReference())
console.log('built dist/lz-kit.js, lz-kit.css, fonts and REFERENCE.md')
