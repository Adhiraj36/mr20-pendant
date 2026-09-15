// The QR reader, against a code the very library wacli prints with.
//
// `qrterminal.GenerateHalfBlock` produced the fixture, and `rsc.io/qr` produced
// the module matrix beside it — so this asserts that reading the blocks back
// recovers the real code exactly, polarity and quiet zone included. A QR that
// is one module wrong, or inverted, is a QR that does not scan, and neither is
// something you would notice by looking at it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findQrBlock, toMatrix } from '../src/routes/apps/qr.js'

// Bundled before it runs, so __dirname is the build output rather than this
// file's home. The fixtures are found from the project root instead.
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test')
const printed = fs.readFileSync(path.join(here, 'fixtures', 'wacli-qr.txt'), 'utf8')
const truth = fs
  .readFileSync(path.join(here, 'fixtures', 'wacli-qr-modules.txt'), 'utf8')
  .split('\n')
  .filter(Boolean)

const rows = findQrBlock(printed)
assert.ok(rows, 'no QR block was found in wacli output')
assert.equal(rows.length, 19, 'the whole block should be picked up')

const matrix = toMatrix(rows)
const size = truth.length

// The block carries a quiet zone, so the code sits somewhere inside it.
let found: { x: number; y: number } | null = null
for (let oy = 0; oy + size <= matrix.length && !found; oy++) {
  for (let ox = 0; ox + size <= matrix[0].length && !found; ox++) {
    let same = true
    for (let y = 0; y < size && same; y++) {
      for (let x = 0; x < size && same; x++) {
        if (matrix[oy + y][ox + x] !== (truth[y][x] === '1')) same = false
      }
    }
    if (same) found = { x: ox, y: oy }
  }
}
assert.ok(found, 'the recovered matrix does not contain the real code')

// Ordinary log lines must not be mistaken for a code.
assert.equal(findQrBlock('Syncing chats…\nStart the daemon with: wacli daemon\n'), null)

console.log(`qr: recovered the ${size}x${size} code exactly, at ${found.x},${found.y}`)
