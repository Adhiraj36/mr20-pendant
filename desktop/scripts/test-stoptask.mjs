// Bundles and runs test/stoptask.test.ts against a throwaway profile.
//
// lyzn.ts imports loops.js (for `electron`'s app object) and config.js, so
// this follows test-loops.mjs's approach: `electron` is swapped for
// test/electron-stub.js, and the test's KARMAX_DESKTOP_PROFILE points at a
// fresh mkdtemp directory — never the real ~/.karmax-desktop, which is where
// a live daemon token lives once someone has actually signed in.
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const out = path.join('dist', 'test', 'stoptask.mjs')
await build({
  entryPoints: ['test/stoptask.test.ts'],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: [],
  alias: { electron: path.resolve('test/electron-stub.js') },
  banner: {
    js: "import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
})

const profile = mkdtempSync(path.join(os.tmpdir(), 'karmax-stoptask-test-'))
const child = spawn(process.execPath, [out], {
  stdio: 'inherit',
  env: {
    ...process.env,
    KARMAX_DESKTOP_PROFILE: profile,
    ITEST_APP_ROOT: process.cwd(),
  },
})

child.on('exit', (code) => {
  // The profile holds only what this run wrote; nothing in it is worth
  // keeping past the run.
  rmSync(profile, { recursive: true, force: true })
  process.exit(code ?? 1)
})
