import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Read as JSON rather than imported from the package: Vite loads this file
// under plain Node, which cannot import the package's .ts entry — CI's
// Node 20 fails the build on it. The generator writes fonts.json beside
// tokens.css from the same `fonts.google` value.
const fonts = JSON.parse(
  readFileSync(new URL('../packages/design/fonts.json', import.meta.url), 'utf8'),
) as { google: { sans: string; mono: string } }

/**
 * The Google Fonts request, written from the token rather than typed twice.
 *
 * index.html asks for exactly the weights the site sets, and until now the
 * only thing keeping those two lists equal was that somebody remembered.
 * `fonts.google` is the families-and-weights segment of that URL; this fills
 * the `%GOOGLE_FONTS%` placeholder in the document head with it, in dev and
 * in the build alike, so adding a weight to the package adds it to the
 * request.
 */
function googleFonts(): Plugin {
  const href =
    `https://fonts.googleapis.com/css2?family=${fonts.google.sans}` +
    `&family=${fonts.google.mono}&display=swap`
  return {
    name: 'lyzn-google-fonts',
    // Before Vite's own %VAR% pass, which would leave an unknown key alone.
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('%GOOGLE_FONTS%', href),
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), googleFonts()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    // `npm install ../packages/design` links it into node_modules as a
    // symlink; Vite otherwise resolves a symlinked import by its real path,
    // which drops it outside this project root and out of the module graph
    // Tailwind and HMR are watching.
    preserveSymlinks: true,
  },
  server: {
    // The symlink target lives outside web/, which Vite's dev server
    // refuses to serve from by default.
    fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, '../packages')] },
  },
  build: {
    // No manualChunks. Naming three.js as a manual chunk pulls React in
    // with it — react-three-fiber depends on React, so Rollup files the
    // shared modules into whichever chunk claimed them first — and the
    // entry then imports the whole 3D bundle just to boot. Letting Rollup
    // split on the dynamic import boundary keeps three.js genuinely async.
    chunkSizeWarningLimit: 1200,
  },
})
