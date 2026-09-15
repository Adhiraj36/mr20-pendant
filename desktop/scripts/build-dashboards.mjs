// Copies the dashboard kit's build output, and the pages this app ships of
// its own, into dist/renderer so lyzn-dash:// can serve them from one place
// whether the app is packaged or just built locally.
//
// Runs after `vite build`, not before: vite empties dist/renderer on every
// build, which would otherwise erase whatever this script just wrote. Both
// sources are optional — the kit is a sibling package someone else is still
// building, and a build with neither must still succeed, because this runs on
// every `npm run build`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..') // desktop/
const outKit = path.join(root, 'dist', 'renderer', 'dashboard-kit')
const kitDist = path.join(root, '..', 'packages', 'dashboard-kit', 'dist')
const pagesSrc = path.join(root, 'src', 'dashboards')
const outPages = path.join(outKit, 'pages')

function rel(p) {
  return path.relative(root, p)
}

if (fs.existsSync(kitDist)) {
  fs.mkdirSync(path.dirname(outKit), { recursive: true })
  fs.cpSync(kitDist, outKit, { recursive: true })
  console.log(`[dashboards] copied ${rel(kitDist)} -> ${rel(outKit)}`)
} else {
  console.log(`[dashboards] skipping ${rel(kitDist)} (not built yet)`)
}

if (fs.existsSync(pagesSrc)) {
  const pages = fs.readdirSync(pagesSrc).filter((name) => name.endsWith('.html'))
  if (pages.length) {
    fs.mkdirSync(outPages, { recursive: true })
    for (const name of pages) fs.copyFileSync(path.join(pagesSrc, name), path.join(outPages, name))
    console.log(`[dashboards] copied ${pages.length} page(s) from ${rel(pagesSrc)} -> ${rel(outPages)}`)
  }
} else {
  console.log(`[dashboards] skipping ${rel(pagesSrc)} (not written yet)`)
}
