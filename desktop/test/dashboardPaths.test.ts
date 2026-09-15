// Kit and page path resolution, against real temp directories rather than
// mocks — the thing that matters here is actual fs behaviour: which root
// wins, and that a traversal attempt never reaches a file outside it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDefaultPage, resolveKitFile, safeJoin } from '../electron/dashboardPaths.js'

/** A fresh, isolated directory to act as an app's root — never a shared temp
 *  root, because kitRoots() looks at appPath's *parent* for the dev sibling
 *  package, and two tests sharing one parent would corrupt each other. */
function freshAppPath(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lyzn-dash-'))
  const appPath = path.join(base, 'app')
  fs.mkdirSync(appPath, { recursive: true })
  return appPath
}

test('a request that steps outside its root is refused, plain or percent-encoded', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lyzn-dash-'))
  const root = path.join(base, 'root')
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(base, 'secret.txt'), 'nope')

  assert.equal(safeJoin(root, '../secret.txt'), null)
  assert.equal(safeJoin(root, '..%2Fsecret.txt'), null)
  assert.equal(safeJoin(root, '/etc/passwd'), null)
  assert.equal(safeJoin(root, 'a/../../secret.txt'), null)
})

test('an ordinary request resolves inside the root', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lyzn-dash-'))
  const root = path.join(base, 'root')
  fs.mkdirSync(path.join(root, 'fonts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'fonts', 'a.woff2'), 'x')
  assert.equal(safeJoin(root, 'fonts/a.woff2'), path.join(root, 'fonts', 'a.woff2'))
})

test('the kit is tried packaged-and-built first, then the sibling dev package', () => {
  const appPath = freshAppPath()
  const builtRoot = path.join(appPath, 'dist', 'renderer', 'dashboard-kit')
  const devRoot = path.join(appPath, '..', 'packages', 'dashboard-kit', 'dist')
  fs.mkdirSync(builtRoot, { recursive: true })
  fs.mkdirSync(devRoot, { recursive: true })
  fs.writeFileSync(path.join(builtRoot, 'lz-kit.css'), 'built')
  fs.writeFileSync(path.join(devRoot, 'lz-kit.css'), 'dev')
  fs.writeFileSync(path.join(devRoot, 'lz-kit.js'), 'dev-js')

  // In both roots: the packaged-and-built one wins.
  const css = resolveKitFile(appPath, 'lz-kit.css')
  assert.ok(css)
  assert.equal(fs.readFileSync(css!.path, 'utf8'), 'built')
  assert.equal(css!.contentType, 'text/css')

  // Only in the dev sibling: falls back rather than 404ing.
  const js = resolveKitFile(appPath, 'lz-kit.js')
  assert.ok(js)
  assert.equal(fs.readFileSync(js!.path, 'utf8'), 'dev-js')
})

test('an unrecognised extension and a missing kit both come back null, not a throw', () => {
  const appPath = freshAppPath()
  fs.mkdirSync(path.join(appPath, 'dist', 'renderer', 'dashboard-kit'), { recursive: true })
  fs.writeFileSync(path.join(appPath, 'dist', 'renderer', 'dashboard-kit', 'run.exe'), 'x')

  assert.equal(resolveKitFile(appPath, 'run.exe'), null)
  assert.equal(resolveKitFile(appPath, 'missing.js'), null)
})

test('a traversal request never escapes the kit root even when the target exists', () => {
  const appPath = freshAppPath()
  fs.mkdirSync(path.join(appPath, 'dist', 'renderer', 'dashboard-kit'), { recursive: true })
  fs.writeFileSync(path.join(appPath, 'secret.js'), 'nope')

  assert.equal(resolveKitFile(appPath, '../../../secret.js'), null)
  assert.equal(resolveKitFile(appPath, '..%2F..%2F..%2Fsecret.js'), null)
})

test('the default page: shipped build first, the dev source file second, then nothing', () => {
  const appPath = freshAppPath()
  assert.equal(resolveDefaultPage(appPath), null)

  const devFile = path.join(appPath, 'src', 'dashboards', 'default.html')
  fs.mkdirSync(path.dirname(devFile), { recursive: true })
  fs.writeFileSync(devFile, 'dev')
  assert.equal(resolveDefaultPage(appPath), devFile)

  const builtFile = path.join(appPath, 'dist', 'renderer', 'dashboard-kit', 'pages', 'default.html')
  fs.mkdirSync(path.dirname(builtFile), { recursive: true })
  fs.writeFileSync(builtFile, 'built')
  assert.equal(resolveDefaultPage(appPath), builtFile)
})
