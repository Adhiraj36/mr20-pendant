// Two bundles, two module systems, on purpose.
//
// The main process is ESM because the package is; the preload is CJS with a
// .cjs extension because an ESM preload only loads with the sandbox off, and
// the sandbox is the one thing a preload should never trade away.
import { build } from 'esbuild'

const watch = process.argv.includes('--watch')
const dev = watch || process.argv.includes('--dev')

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: dev,
  minify: !dev,
  external: ['electron'],
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  logLevel: 'info',
}

// esbuild's ESM output turns any require() it cannot resolve statically into a
// shim that throws — and a bundled dependency (yaml) does exactly one of those.
// The shim checks for a real `require` first, so handing it one from
// createRequire is all that is needed.
const esmBanner = {
  js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
}

const targets = [
  {
    entryPoints: ['electron/main.ts'],
    outfile: 'dist/electron/main.js',
    format: 'esm',
    banner: esmBanner,
  },
  { entryPoints: ['electron/preload.ts'], outfile: 'dist/electron/preload.cjs', format: 'cjs' },
]

if (watch) {
  const { context } = await import('esbuild')
  for (const t of targets) {
    const ctx = await context({ ...shared, ...t })
    await ctx.watch()
  }
  console.log('[electron] watching')
} else {
  await Promise.all(targets.map((t) => build({ ...shared, ...t })))
}
