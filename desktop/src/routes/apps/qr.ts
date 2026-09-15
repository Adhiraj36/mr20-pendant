// Reading the QR code wacli draws in the terminal.
//
// wacli writes a PNG only when `qrencode` happens to be installed; otherwise it
// prints the code as half-block characters and that is all the app has. Shown
// in a log pane, that is a smear — the glyphs are proportional to whatever the
// font does with them, line spacing pulls the rows apart, and the result is a
// picture of a QR code rather than one a phone will read.
//
// So it is read back instead. Half-block encoding is loss-free and trivially
// reversible: each text row carries two module rows, ▀ is the upper one, ▄ the
// lower, █ both, a space neither. That gives the module matrix back exactly,
// and drawing it as squares produces a QR that scans at any size in any theme.
//
// Polarity is worked out rather than assumed. Terminal renderers disagree about
// whether a set bit means ink or paper, and a QR inverted is a QR that will not
// scan — but every QR has a light quiet zone around it, so whichever value fills
// the border is the light one.

const BLOCKS = new Set([' ', '█', '▀', '▄'])

/** The rows of a half-block QR inside a stream of other output, or null. */
export function findQrBlock(text: string): string[] | null {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
  let best: string[] | null = null
  let run: string[] = []
  const keep = () => {
    // A QR is at least 21 modules across; at two module rows per text row that
    // is eleven lines, and the quiet zone adds more. Twelve is a safe floor
    // that no ordinary log line will reach by accident.
    if (run.length >= 12 && (!best || run.length > best.length)) best = run.slice()
  }
  for (const line of lines) {
    const body = line.trimEnd()
    const isBlocks = body.length >= 12 && [...body].every((c) => BLOCKS.has(c))
    if (isBlocks) run.push(body)
    else {
      keep()
      run = []
    }
  }
  keep()
  return best
}

/** The module matrix, as booleans where true means a dark module. */
export function toMatrix(rows: string[]): boolean[][] {
  const width = Math.max(...rows.map((r) => [...r].length))
  const set: boolean[][] = []
  for (const row of rows) {
    const chars = [...row]
    const upper: boolean[] = []
    const lower: boolean[] = []
    for (let i = 0; i < width; i++) {
      const c = chars[i] ?? ' '
      upper.push(c === '█' || c === '▀')
      lower.push(c === '█' || c === '▄')
    }
    set.push(upper, lower)
  }

  // The quiet zone decides which way round this is: the border of a QR is
  // always light, so if the border is mostly "set", set means light.
  let border = 0
  let borderSet = 0
  const h = set.length
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      if (y > 1 && y < h - 2 && x > 1 && x < width - 2) continue
      border++
      if (set[y][x]) borderSet++
    }
  }
  const setMeansLight = border > 0 && borderSet > border / 2
  return setMeansLight ? set.map((row) => row.map((v) => !v)) : set
}
