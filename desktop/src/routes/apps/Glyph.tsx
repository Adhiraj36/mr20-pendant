// An app's mark.
//
// A real logo where one is available under a licence that allows shipping it
// (simple-icons, CC0), and a generated tile in the brand's own colour where it
// is not — Slack, LinkedIn and YouTrack asked to be removed from that set, so
// there is no honest way to draw them here.
//
// Both forms sit on a tinted square of the brand colour rather than a filled
// one. A grid of saturated logos fights the interface; a grid of tints reads as
// part of it and still lets the eye find WhatsApp at a glance.
import { BRAND_COLOURS, BRANDS } from './brands'
import { canonical } from './catalogue'

/** Relative luminance, for deciding whether a mark can be drawn in its own
 *  colour on a dark ground. GitHub, Notion and X are all near-black, and drawn
 *  faithfully they disappear. */
function luminance(hex: string): number {
  const v = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number]
}

/** Pull a colour toward white until it reads on a dark ground. */
function lift(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

/** Push a colour toward black until it reads on a light ground. */
function deepen(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const mix = (c: number) => Math.round(c * (1 - amount))
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

function tint(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** The two colours a mark needs, one per theme. CSS picks between them, so a
 *  theme switch does not have to re-render anything. */
function readable(hex: string): { onDark: string; onLight: string } {
  const l = luminance(hex)
  return {
    // Near-black marks get lifted a long way; mid-tone brands only a little.
    onDark: l < 0.06 ? 'rgb(236, 233, 245)' : l < 0.22 ? lift(hex, 0.55) : lift(hex, 0.12),
    onLight: l > 0.7 ? deepen(hex, 0.35) : hex,
  }
}

export function Glyph({ id, label, size = 40 }: { id: string; label: string; size?: number }) {
  const key = canonical(id)
  const brand = BRANDS[key] ?? BRANDS[id]
  const hex = brand?.hex ?? BRAND_COLOURS[key] ?? BRAND_COLOURS[id]

  if (brand) {
    const { onDark, onLight } = readable(hex!)
    return (
      <span
        aria-hidden
        className="brand-tile grid shrink-0 place-items-center"
        style={
          {
            width: size,
            height: size,
            background: tint(hex!, 0.16),
            boxShadow: `inset 0 0 0 1px ${tint(hex!, 0.22)}`,
            '--mark-dark': onDark,
            '--mark-light': onLight,
          } as React.CSSProperties
        }
      >
        <svg
          role="img"
          aria-label={brand.title}
          viewBox="0 0 24 24"
          width={size * 0.52}
          height={size * 0.52}
          fill="currentColor"
        >
          <path d={brand.path} />
        </svg>
      </span>
    )
  }

  // No mark: an initial, in the brand's colour when it is known and in a hue
  // derived from the id when it is not, so an unfamiliar service still looks
  // deliberate rather than unfinished.
  const initial = label.trim().charAt(0).toUpperCase() || '?'
  if (hex) {
    const { onDark, onLight } = readable(hex)
    return (
      <span
        aria-hidden
        className="brand-tile grid shrink-0 place-items-center font-semibold"
        style={
          {
            width: size,
            height: size,
            fontSize: size * 0.42,
            background: tint(hex, 0.16),
            boxShadow: `inset 0 0 0 1px ${tint(hex, 0.22)}`,
            '--mark-dark': onDark,
            '--mark-light': onLight,
          } as React.CSSProperties
        }
      >
        {initial}
      </span>
    )
  }

  const hue = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color: `hsl(${hue} 80% 82%)`,
        background: `hsl(${hue} 55% 30% / 0.28)`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 60% 60% / 0.22)`,
      }}
    >
      {initial}
    </span>
  )
}
