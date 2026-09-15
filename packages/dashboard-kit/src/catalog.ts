// Every element the kit defines, as agents are told about it.
//
// This is the single source for REFERENCE.md, and the tests hold it to the
// code: a tag defined but not listed here, or an attribute an element reacts to
// but that is not documented, fails the build instead of confusing an agent.
export type Attr = { name: string; about: string }
export type ElementDoc = {
  tag: string
  group: 'Layout' | 'Numbers' | 'Charts' | 'Lists' | 'Text'
  about: string
  attrs: Attr[]
  data?: string
  example: string
}

const src: Attr = { name: 'source', about: 'data to show: a file (`orders`), a path (`orders.total`) or `live:name`' }
const value: Attr = { name: 'value', about: 'a literal value instead of a source (JSON or text)' }
const fmt: Attr = { name: 'format', about: 'how values print (see Formats)' }
const empty: Attr = { name: 'empty', about: 'text shown when the data is empty' }

export const ELEMENTS: ElementDoc[] = [
  {
    tag: 'lz-page',
    group: 'Layout',
    about: 'The whole page: a title, and when it was last updated. Put everything inside one.',
    attrs: [
      { name: 'title', about: 'the page heading' },
      { name: 'subtitle', about: 'one line under it' },
    ],
    example: '<lz-page title="Preorders" subtitle="Since the reel went live">…</lz-page>',
  },
  {
    tag: 'lz-grid',
    group: 'Layout',
    about: 'Columns that collapse on narrow windows. Give a child `style="grid-column: span 2"` to widen it.',
    attrs: [{ name: 'cols', about: 'columns at full width, 1–6 (default 2)' }],
    example: '<lz-grid cols="3">…</lz-grid>',
  },
  {
    tag: 'lz-section',
    group: 'Layout',
    about: 'A titled group of content with a rule above it.',
    attrs: [
      { name: 'title', about: 'the section heading' },
      { name: 'subtitle', about: 'one line under it' },
    ],
    example: '<lz-section title="Outreach">…</lz-section>',
  },
  {
    tag: 'lz-card',
    group: 'Layout',
    about: 'A sheet that holds one chart, table or list, with an optional heading.',
    attrs: [
      { name: 'title', about: 'the card heading' },
      { name: 'subtitle', about: 'one line under it' },
    ],
    example: '<lz-card title="Orders by day">…</lz-card>',
  },
  {
    tag: 'lz-tabs',
    group: 'Layout',
    about: 'Tabs; each child `lz-tab` is one panel.',
    attrs: [],
    example: '<lz-tabs><lz-tab label="Today">…</lz-tab><lz-tab label="This week">…</lz-tab></lz-tabs>',
  },
  {
    tag: 'lz-tab',
    group: 'Layout',
    about: 'One panel inside `lz-tabs`.',
    attrs: [
      { name: 'label', about: 'the tab’s name' },
      { name: 'selected', about: 'present on the tab to open first' },
    ],
    example: '<lz-tab label="This week" selected>…</lz-tab>',
  },
  {
    tag: 'lz-stat',
    group: 'Numbers',
    about: 'One headline number with an optional change and trend.',
    attrs: [
      src,
      value,
      { name: 'label', about: 'what the number is, in sentence case' },
      fmt,
      { name: 'unit', about: 'text after the number, e.g. `units`' },
      { name: 'delta', about: 'the change, as a number or a source' },
      { name: 'delta-format', about: 'format for the change (defaults to `format`)' },
      { name: 'delta-label', about: 'what it is compared with, e.g. `vs last week`' },
      { name: 'good', about: '`up` (default) or `down`: which direction is good' },
      { name: 'trend', about: 'a source of numbers (or rows) for a small sparkline' },
      { name: 'trend-y', about: 'the key to plot when `trend` is rows' },
    ],
    data: 'a number or string',
    example: '<lz-stat label="Units sold" source="orders.total" delta="orders.change" delta-label="vs last week" trend="orders.by_day" trend-y="units"></lz-stat>',
  },
  {
    tag: 'lz-value',
    group: 'Numbers',
    about: 'A formatted value inline inside text.',
    attrs: [src, value, fmt],
    data: 'a number or string',
    example: '<p>Sold <lz-value source="orders.total" format="number"></lz-value> so far.</p>',
  },
  {
    tag: 'lz-progress',
    group: 'Numbers',
    about: 'A meter toward a goal.',
    attrs: [
      src,
      value,
      { name: 'max', about: 'the goal (default 100)' },
      { name: 'label', about: 'what it measures' },
      fmt,
      { name: 'warn-at', about: 'percent at which it turns to waiting colour' },
      { name: 'bad-at', about: 'percent at which it turns red' },
    ],
    data: 'a number, or `{ value, max, label? }`',
    example: '<lz-progress label="Goal: 100 preorders" source="orders.total" max="100" format="number"></lz-progress>',
  },
  {
    tag: 'lz-status',
    group: 'Numbers',
    about: 'A state as a glyph, colour and word. Words like done, running, waiting, failed pick the colour.',
    attrs: [src, value, { name: 'label', about: 'text to show instead of the value' }],
    data: 'a string, or `{ status, label? }`',
    example: '<lz-status source="sync.state"></lz-status>',
  },
  {
    tag: 'lz-chart',
    group: 'Charts',
    about: 'Line, area, bar, stacked bar, horizontal bar or donut, with tooltips, a legend and a table view.',
    attrs: [
      src,
      value,
      { name: 'kind', about: '`line` (default), `area`, `bar`, `stacked`, `hbar`, `donut`' },
      { name: 'x', about: 'the key for categories or dates (guessed when absent)' },
      { name: 'y', about: 'comma-separated keys to plot, one series each (all numeric keys when absent)' },
      { name: 'series', about: 'for long data: the key naming each row’s series, with one key in `y`' },
      { name: 'labels', about: 'comma-separated display names for the `y` keys' },
      { name: 'height', about: 'plot height in px (default 220)' },
      fmt,
      { name: 'x-format', about: 'format for the category labels, e.g. `date`' },
      { name: 'total-label', about: 'donut: the word under the total' },
      empty,
    ],
    data: 'rows like `[{ "day": "2026-09-14", "units": 3, "returns": 1 }]`; or `{ "Mon": 3, "Tue": 5 }` for one series',
    example: '<lz-chart kind="bar" source="orders.by_day" x="day" y="units,returns" x-format="date"></lz-chart>',
  },
  {
    tag: 'lz-sparkline',
    group: 'Charts',
    about: 'A tiny trend line with no axes, for beside text.',
    attrs: [src, value, { name: 'y', about: 'the key to plot when the data is rows' }, { name: 'height', about: 'px (default 28)' }],
    data: 'numbers, or rows',
    example: '<lz-sparkline source="orders.by_day" y="units"></lz-sparkline>',
  },
  {
    tag: 'lz-table',
    group: 'Lists',
    about: 'Rows and columns with sorting, optional search and a row limit.',
    attrs: [
      src,
      value,
      { name: 'columns', about: '`key:Label:format`, comma-separated; label and format optional' },
      { name: 'sort', about: 'a key to sort by first; `-key` sorts descending' },
      { name: 'limit', about: 'rows before "Show all" (default 50)' },
      { name: 'searchable', about: 'present to add a search box' },
      { name: 'status', about: 'a column key to show as a status' },
      empty,
    ],
    data: 'rows (objects)',
    example: '<lz-table source="dms.recent" columns="user:Who,sent_at:Sent:ago,replied:Replied" status="replied" sort="-sent_at" searchable></lz-table>',
  },
  {
    tag: 'lz-list',
    group: 'Lists',
    about: 'A simple list: a main line, a second line and a value on the right.',
    attrs: [
      src,
      value,
      { name: 'primary', about: 'key for the main line (guessed: title, name, text)' },
      { name: 'secondary', about: 'key for the second line' },
      { name: 'meta', about: 'key for the right-hand value' },
      { name: 'meta-format', about: 'format for that value' },
      { name: 'status', about: 'key whose value colours a dot' },
      { name: 'limit', about: 'rows shown (default 50)' },
      empty,
    ],
    data: 'rows (objects)',
    example: '<lz-list source="leads" primary="name" secondary="company" meta="value" meta-format="currency:INR"></lz-list>',
  },
  {
    tag: 'lz-feed',
    group: 'Lists',
    about: 'A timeline of events, newest first as given.',
    attrs: [
      src,
      value,
      { name: 'time', about: 'key for the time (guessed: time, at, timestamp)' },
      { name: 'text', about: 'key for the text (guessed: text, message, summary)' },
      { name: 'kind', about: 'key whose value colours the dot (guessed: kind, status)' },
      { name: 'time-format', about: 'format for the time (default `ago`)' },
      { name: 'limit', about: 'events shown (default 20)' },
      { name: 'reverse', about: 'present when the data is oldest first, to show newest first' },
      empty,
    ],
    data: 'rows (objects)',
    example: '<lz-feed source="live:activity" limit="8"></lz-feed>',
  },
  {
    tag: 'lz-kv',
    group: 'Lists',
    about: 'Label and value pairs on dotted leaders, like a receipt.',
    attrs: [src, value, { name: 'format', about: 'format for numeric values' }, empty],
    data: 'an object, or rows `[{ k, v, ok? }]`',
    example: '<lz-kv source="campaign.summary"></lz-kv>',
  },
  {
    tag: 'lz-receipt',
    group: 'Lists',
    about: 'A LYZN receipt slip: proof that something was done.',
    attrs: [src, value],
    data: '`{ title, stamp?, quote?, meta?, rows: [{ k, v, ok? }], total?: { k, v }, id? }`',
    example: '<lz-receipt source="last_receipt"></lz-receipt>',
  },
  {
    tag: 'lz-text',
    group: 'Text',
    about: 'Prose: paragraphs, **bold**, `code`, "- " lists and "## " headings.',
    attrs: [src, value, empty],
    data: 'a string',
    example: '<lz-text source="summary"></lz-text>',
  },
  {
    tag: 'lz-empty',
    group: 'Text',
    about: 'A quiet message for when there is nothing to show.',
    attrs: [{ name: 'message', about: 'the text' }],
    example: '<lz-empty message="No DMs sent yet."></lz-empty>',
  },
]

export const FORMATS: [string, string][] = [
  ['number', '1,284 (`number:2` keeps two decimals)'],
  ['compact', '12.9K, 4.2M (default for numbers)'],
  ['percent', '42% from 0.42 or 42'],
  ['currency:INR', '₹5,999 (any currency code)'],
  ['duration', 'seconds as 4m 21s'],
  ['bytes', '1.5 MB'],
  ['date', '14 Sep'],
  ['time', '16:32'],
  ['datetime', '14 Sep, 16:32'],
  ['ago', '3 min ago'],
]

export const LIVE_SOURCES: [string, string][] = [
  ['engine', 'whether the engine is running, its version and ports'],
  ['tasks', 'LYZN tasks: `waiting`, `running`, `blocked`, `finished` (with receipts)'],
  ['brain', 'the coding assistant: `sessions`, `rate_limits`, `paused`'],
  ['activity', 'what the assistant did recently'],
  ['loops', 'loops and what wakes them'],
  ['loop-health', 'each loop’s last success, failure and error'],
  ['notifications', 'notifications sent to the phone'],
  ['memory', 'recent memories'],
  ['logs', 'the last engine log lines: `{ at, stream, text }`'],
]
