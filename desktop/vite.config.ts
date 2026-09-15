import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: './', // the packaged app loads over file://
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./electron/shared', import.meta.url)),
    },
    // @lyzn/chat-core is a symlinked local package (file:../packages/chat-core):
    // Vite resolves a symlinked module's own imports relative to its REAL path,
    // not the app's, so if that package ever gets its own node_modules/react —
    // an npm peer-dependency install does this by default — the app renders
    // with two React instances and every hook throws "Cannot read properties
    // of null (reading 'useState')". Dedupe forces both to the one copy here.
    dedupe: ['react', 'react-dom'],
  },
  build: { outDir: 'dist/renderer', emptyOutDir: true, sourcemap: false },
})
