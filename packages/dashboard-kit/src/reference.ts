// REFERENCE.md: what an agent reads before writing a dashboard.
//
// Written for the reader who pays for every token of it, so it says each thing
// once and shows it rather than explaining it.
import { ELEMENTS, FORMATS, LIVE_SOURCES } from './catalog.ts'

const cell = (s: string) => s.replace(/\|/g, '\\|')

export function buildReference(): string {
  const out: string[] = []
  out.push(`# Dashboard components

Write the page **body** only. The app adds the document head, this kit's styles and
scripts, fonts, light and dark themes, and the refresh. Pages cannot reach the
network or take actions; they show data.

## A page

\`\`\`html
<lz-page title="Preorder campaign" subtitle="Since the reel went live">
  <lz-grid cols="3">
    <lz-stat label="Units sold" source="orders.total" delta="orders.change" delta-label="vs last week"></lz-stat>
    <lz-stat label="DMs sent" source="dms.sent"></lz-stat>
    <lz-stat label="Reply rate" source="dms.reply_rate" format="percent"></lz-stat>
  </lz-grid>
  <lz-card title="Orders by day">
    <lz-chart kind="bar" source="orders.by_day" x="day" y="units" x-format="date"></lz-chart>
  </lz-card>
  <lz-grid cols="2">
    <lz-card title="Recent DMs"><lz-table source="dms.recent" columns="user:Who,sent_at:Sent:ago" limit="8"></lz-table></lz-card>
    <lz-card title="What happened"><lz-feed source="live:activity" limit="8"></lz-feed></lz-card>
  </lz-grid>
</lz-page>
\`\`\`

Saved with \`dashboard save\`, \`data: { "orders": {...}, "dms": {...} }\`, \`live: ["activity"]\`.

## Data

- \`source="orders"\` is the data file \`orders\` you saved; \`orders.by_day\` is a path into it
  (dots, and numbers for list items: \`dms.recent.0.user\`).
- \`source="live:name"\` is kept current by the app. Declare every live name you use in \`live\`.
- Update numbers with \`dashboard set_data\`; the page redraws without reloading.
- Every element shows loading, empty and error states on its own. Do not add your own.

Live sources:

| name | contains |
|---|---|
${LIVE_SOURCES.map(([n, a]) => `| \`${n}\` | ${cell(a)} |`).join('\n')}

## Formats

${FORMATS.map(([n, a]) => `\`${n}\` ${a}`).join(' · ')}
`)

  for (const group of ['Layout', 'Numbers', 'Charts', 'Lists', 'Text'] as const) {
    out.push(`## ${group}\n`)
    for (const el of ELEMENTS.filter((e) => e.group === group)) {
      out.push(`### \`<${el.tag}>\`\n\n${el.about}${el.data ? ` Data: ${el.data}.` : ''}\n`)
      if (el.attrs.length) out.push(el.attrs.map((a) => `- \`${a.name}\`: ${a.about}`).join('\n') + '\n')
      out.push(`\`\`\`html\n${el.example}\n\`\`\`\n`)
    }
  }

  out.push(`## When nothing here fits

Write your own element in a \`<script>\` on the page, using the kit's helpers and
colours so it matches:

\`\`\`html
<reel-heat source="comments.by_hour"></reel-heat>
<script>
  customElements.define('reel-heat', class extends HTMLElement {
    connectedCallback() {
      lz.bind(this, this.getAttribute('source'), (rows, error) => {
        if (error) return (this.textContent = error.message)
        this.replaceChildren(...rows.map((r) => {
          const cell = document.createElement('span')
          cell.className = 'lz-chip'
          cell.style.opacity = 0.2 + 0.8 * (r.count / Math.max(...rows.map((x) => x.count)))
          cell.textContent = r.hour
          return cell
        }))
      })
    }
  })
</script>
\`\`\`

- \`lz.bind(el, source, (value, error) => …)\` calls back now and on every refresh.
- \`await lz.data(source)\` reads once. \`lz.format(value, 'compact')\` formats.
- \`lz.on('refresh', fn)\` runs after new data arrives. \`lz.open('https://…')\` opens a link.
- Build text with \`textContent\`, never \`innerHTML\` from data.
- Colours: \`--lz-ink\`, \`--lz-ink-2\`, \`--lz-ink-3\` (text), \`--lz-sheet\` (cards), \`--lz-rule\` (hairlines),
  \`--lz-series-1\` … \`--lz-series-5\` (data, in that order), \`--lz-on-series\` (text on a data colour), \`--lz-good\`, \`--lz-wait\`, \`--lz-bad\`, \`--lz-live\`
  (states only). Type: \`--lz-sans\`, \`--lz-mono\`. They switch with the theme on their own.
- Classes you can reuse: \`lz-chip\`, \`lz-note\`, \`lz-dot\` with \`data-tone="good|wait|bad|live|idle"\`.
`)
  return out.join('\n')
}
