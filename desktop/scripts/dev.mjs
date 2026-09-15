// One command for the whole dev loop: Vite for the UI, esbuild watching the
// Electron bundles, and Electron restarted whenever those change.
import { spawn } from 'node:child_process'
import { watch as watchFs } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import net from 'node:net'

const PORT = Number(process.env.KARMAX_DEV_PORT || 5273)

const procs = []
function run(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })
  procs.push(p)
  return p
}
function killAll() {
  for (const p of procs) { try { p.kill() } catch {} }
}
process.on('SIGINT', () => { killAll(); process.exit(0) })
process.on('SIGTERM', () => { killAll(); process.exit(0) })

// --host 127.0.0.1 is not optional. Vite's default binds `localhost`, which on
// this machine resolves to ::1, and the window asks for http://127.0.0.1 — so
// the dev server is up and every navigation is refused.
run('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'])
run('node', ['scripts/build-electron.mjs', '--watch'])

async function portReady(port, tries = 200) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1')
      s.on('connect', () => { s.destroy(); resolve(true) })
      s.on('error', () => resolve(false))
    })
    if (ok) return true
    await delay(150)
  }
  return false
}

if (!(await portReady(PORT))) {
  console.warn(`[dev] vite is not answering on ${PORT} yet; the window will retry`)
}
await delay(400) // let the first esbuild pass land

let electron = null
let restarting = false
function startElectron() {
  electron = run('npx', ['electron', '.'], {
    env: { ...process.env, KARMAX_DEV_SERVER: `http://127.0.0.1:${PORT}` },
  })
  electron.on('exit', () => { if (!restarting) { killAll(); process.exit(0) } })
}
startElectron()

let timer = null
watchFs('dist/electron', { recursive: true }, () => {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    restarting = true
    try { electron.kill() } catch {}
    await delay(200)
    restarting = false
    startElectron()
  }, 250)
})
