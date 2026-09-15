// Bundles and runs test/integration.ts against a throwaway profile.
//
// Bundled rather than run through a loader because the modules under test are
// the same TypeScript the app ships, and `electron` has to be swapped for a
// stub — both of which esbuild does in one pass.
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const out = path.join('dist', 'test', 'integration.mjs')
await build({
  entryPoints: ['test/integration.ts'],
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

const profile = mkdtempSync(path.join(os.tmpdir(), 'karmax-itest-'))
const child = spawn(process.execPath, [out], {
  stdio: 'inherit',
  env: {
    ...process.env,
    KARMAX_DESKTOP_PROFILE: profile,
    ITEST_APP_ROOT: process.cwd(),
  },
})

child.on('exit', (code) => {
  // The profile holds a database and a session directory; nothing in it is
  // worth keeping past the run.
  rmSync(profile, { recursive: true, force: true })
  process.exit(code ?? 1)
})
