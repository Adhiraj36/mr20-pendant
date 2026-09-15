/**
 * Put the desk under the still's transparent pixels.
 *
 *   node scripts/poster-desk-fill.mjs shot-a.png shot-b.png shot-c.png
 *   cwebp -resize 1600 1600 -q 90 -alpha_q 100 -exact -m 6 \
 *     shot-a.desk.png -o public/img/poster-a.webp
 *
 * A still rendered with the page background omitted is the object on
 * nothing, and "nothing" still has a colour: the encoder keeps whatever sits
 * under alpha 0, and a screenshot leaves that pure black. Any renderer that
 * flattens or drops the alpha then paints a black rectangle the exact shape
 * of the image box, which is a black card behind the pendant on the hero.
 * Filled with the desk, the same failure is invisible — the square is the
 * colour of the page it is lying on.
 *
 * Nothing visible changes: alpha is untouched and no pixel the reader can
 * see is rewritten. Only the colour beneath the transparency moves.
 *
 * No dependencies, because this runs about twice a year and a PNG with one
 * IDAT is a hundred lines.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

/** `--color-desk` in @lyzn/design. Change it there and change it here. */
const DESK = [0xe3, 0xe4, 0xde]

/**
 * How colourful a pixel is allowed to be.
 *
 * The site is monochrome and so is the object, so a saturated pixel in a
 * still is not a still, it is damage. The first version of this script
 * repainted each row inside the un-filtering loop, which left the next row
 * decoding against values that were never in the file — the pendant came
 * out full of rainbow bands, and it shipped, because the check afterwards
 * sampled five pixels and all five were in the corners. Hence a check that
 * looks at all of them.
 */
const SATURATION_LIMIT = 70

function chunks(buf) {
  const out = []
  let p = 8
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    out.push({ type: buf.toString('ascii', p + 4, p + 8), data: buf.subarray(p + 8, p + 8 + len) })
    p += 12 + len
  }
  return out
}

function crc32(buf) {
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = c ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** Undoes the per-row filters. Every row predicts from the one above it. */
function unfilter(raw, w, h, bpp) {
  const stride = w * bpp
  const px = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const f = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const row = px.subarray(y * stride, (y + 1) * stride)
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const guess = a + b - c
        const da = Math.abs(guess - a)
        const db = Math.abs(guess - b)
        const dc = Math.abs(guess - c)
        v += da <= db && da <= dc ? a : db <= dc ? b : c
      }
      row[i] = v & 0xff
    }
  }
  return px
}

function saturated(px, bpp) {
  let count = 0
  for (let i = 0; i < px.length; i += bpp) {
    const max = Math.max(px[i], px[i + 1], px[i + 2])
    const min = Math.min(px[i], px[i + 1], px[i + 2])
    if (max - min > SATURATION_LIMIT) count++
  }
  return count
}

for (const file of process.argv.slice(2)) {
  const src = readFileSync(file)
  const cs = chunks(src)
  const ihdr = cs.find((c) => c.type === 'IHDR').data
  const w = ihdr.readUInt32BE(0)
  const h = ihdr.readUInt32BE(4)
  if (ihdr[8] !== 8 || ihdr[9] !== 6) {
    throw new Error(`${file}: expected 8-bit RGBA, got depth ${ihdr[8]} colour type ${ihdr[9]}`)
  }

  const bpp = 4
  const stride = w * bpp
  const raw = inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)))
  const px = unfilter(raw, w, h, bpp)
  const before = saturated(px, bpp)

  // A second pass, and that is the whole point of it. Repainting inside the
  // loop above rewrites a row that the next row's filter is about to
  // predict from, and every row after it decodes against values that were
  // never in the file.
  let filled = 0
  for (let i = 3; i < px.length; i += bpp) {
    if (px[i] === 0) {
      px[i - 3] = DESK[0]
      px[i - 2] = DESK[1]
      px[i - 1] = DESK[2]
      filled++
    }
  }

  const after = saturated(px, bpp)
  if (after > before) {
    throw new Error(
      `${file}: ${after - before} pixels came out coloured that were not. ` +
        'The image is damaged; do not encode it.',
    )
  }

  // Written unfiltered: the rows go out as they are, and nothing downstream
  // depends on anything upstream.
  const out = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    out[y * (stride + 1)] = 0
    px.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const dest = file.replace(/\.png$/, '.desk.png')
  writeFileSync(
    dest,
    Buffer.concat([
      src.subarray(0, 8),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(out, { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
  console.log(`${file} → ${dest}: ${w}×${h}, ${filled} transparent pixels given the desk`)
}
