# Custom dashboards

Any agent the orchestrator runs can build an interactive dashboard: a standalone
HTML page using ready-made components, rendered in the desktop app. The default
Dashboard screen is rebuilt from the same kit.

Decisions (2026-09-15): desktop only; data from the dashboard's own files
(refreshed by the agent) plus a fixed list of live read-only sources; pages are
look-only (no actions); the default dashboard is a kit page; approach is HTML with
ready-made custom elements.

## Parts

| Part | Where | Job |
|---|---|---|
| Dashboard tool + API | KARMAX (generic, no LYZN names) | store pages and data, refresh on a schedule, serve to clients |
| `@lyzn/dashboard-kit` | `packages/dashboard-kit` | `lz-*` custom elements, stylesheet, data client, generated reference |
| Renderer | `desktop` | sealed frame, data channel, Dashboard screen, default page, Mira card |

## 1. Engine (KARMAX)

**Tool `dashboard`**, one tool with `action`:

- `components` → `{ reference }`: the text a client installed (below), or a short
  fallback saying to write plain HTML and CSS.
- `save` `{ id?, title, description?, html?, data?: {name: json}, live?: [string], refresh?: { every?|cron?, brief } }`
  → `{ id, saved: true, htmlVersion, dataVersion }`. `html` required on create.
  `id` defaults to a slug of the title. Omitted `refresh` leaves the schedule as it
  was; `refresh: null` removes it.
- `set_data` `{ id, name, value }` → `{ ok: true, dataVersion }`.
- `get` `{ id }` → `{ dashboard: meta, html }`. `list` → `{ dashboards: [meta] }`.
  `delete` `{ id }` → `{ deleted: true }`.

Limits: id `^[a-z0-9][a-z0-9-]{0,63}$` (ids starting `_` are reserved); data name
`^[a-z0-9][a-z0-9_-]{0,63}$`; html ≤ 512 KB; each data value ≤ 2 MB serialized;
≤ 32 data files; ≤ 16 live names, each `^[a-z0-9][a-z0-9-]{0,31}$`.

**Storage:** `<DataDir>/dashboards/<id>/index.html`, `data/<name>.json`,
`dashboard.json` = meta:
`{ id, title, description, agent, createdAt, updatedAt, htmlVersion, dataVersion, data: [names], live: [names], refresh: {every?, cron?, brief} | null, pinned, archived, archivedAt? }`.
`pinned` and `archived` are the person's, not the agent's: `save` and `set_data`
keep them, and the tool cannot change them.
Writes are atomic (temp file + rename).

**Refresh:** a schedule writes the recipe `dashboard-<id>.yaml` into the recipes
directory (hot reloaded), with one `ask` step telling the agent to recompute the
data and write each file with `dashboard set_data`, never changing the HTML.
Delete removes the recipe. Archiving removes it too, while `refresh` stays in the
meta, so restoring writes it back; a `save` with a schedule while archived records
the schedule without writing a recipe.

**API** (full token): `GET /api/dashboards`, `GET /api/dashboards/{id}`,
`GET /api/dashboards/{id}/data/{name}` (the raw JSON value), `DELETE /api/dashboards/{id}`,
`PATCH /api/dashboards/{id}` (`{pinned?, archived?}`, booleans only, unknown keys 400),
`PUT /api/dashboards/_kit/reference` (text body ≤ 256 KB). DELETE, PATCH and PUT
refuse the browser-scoped token.

**Harness access:** Claude Code sessions hold the browser-scoped token; add
`dashboard` to its allowed tools. The tool writes only under `dashboards/` and the
recipes it owns. Agents use an explicit tool allowlist in `karmax.yaml`, read once at
engine start: the desktop template lists `dashboard`, and the app adds it to every
existing agent's list (through the YAML document API) before it starts the engine.

## 2. Kit (`@lyzn/dashboard-kit`)

Output: `dist/lz-kit.js` (IIFE, defines the elements and `window.lz`),
`dist/lz-kit.css` (tokens for desk and night, base, components),
`dist/fonts/*`, `dist/REFERENCE.md` (generated from the catalog).

**Page:** the agent writes the page body (a fragment), with optional `<style>` and
`<script>`. The renderer supplies the document head, kit and fonts.

**Sources:** `source="orders"` is the data file; `source="orders.by_day"` is a path
into it (dot segments, numeric indexes); `source="live:activity.items"` is a live
source plus path. Elements show a loading state, then the value, an empty state,
or an error naming the source.

**Elements (first cut):** `lz-page`, `lz-grid`, `lz-section`, `lz-card`,
`lz-tabs`/`lz-tab`, `lz-stat`, `lz-chart` (line, area, bar, donut; SVG),
`lz-sparkline`, `lz-progress`, `lz-status`, `lz-table` (sort, search, limit),
`lz-list`, `lz-feed`, `lz-kv`, `lz-text`, `lz-receipt`, `lz-empty`.

**Custom elements:** `lz.data(source)`, `lz.bind(el, source, render)`,
`lz.format.*`, `lz.on('refresh', fn)`, and documented `--lz-*` CSS variables.

**Catalog:** `src/catalog.ts` lists every tag's attributes, data shape and example.
It generates `REFERENCE.md` and drives the tests, so docs cannot drift from code.

## 3. Renderer (desktop)

**Private scheme `lyzn-dash`** (registered privileged before ready):
- `lyzn-dash://kit/<file>` → kit dist.
- `lyzn-dash://page/<id>` → a document built from the engine's HTML: CSP
  `default-src 'none'; script-src lyzn-dash: 'unsafe-inline'; style-src lyzn-dash: 'unsafe-inline'; img-src lyzn-dash: data:; font-src lyzn-dash:; connect-src 'none'; frame-src 'none'; form-action 'none'`,
  the kit head, then the fragment. A full document from an agent is reduced to its
  head styles and body. `_default` is the page shipped with the app.

**Frame:** `<iframe sandbox="allow-scripts" src="lyzn-dash://page/<id>">`: an
opaque origin with no network, no app bridge and no navigation. The app page's CSP
gains `frame-src lyzn-dash:`.

**Channel** (`postMessage`, every message carries `lz: 1`; the app checks
`event.source === frame.contentWindow`, the kit checks `event.source === parent`):
- frame → app: `ready`; `data { rid, source }` (file or `live:name`, no path);
  `open { url }` (https only; opens the browser).
- app → frame: `data { rid, ok, value?, error? }`; `refresh { scope: 'data'|'live' }`;
  `theme { theme }`; `context { dashboard }`.

**Live sources** (resolved in the main process; nothing else is reachable):
`engine`, `tasks`, `brain`, `activity`, `loops`, `loop-health`, `notifications`,
`memory`, `logs`.

**Bridge** `window.karmax.dashboards`: `list()`, `data(id, source)`, `remove(id)`,
`update(id, {pinned?, archived?})`.
On engine start the app installs the kit's `REFERENCE.md` with
`PUT /api/dashboards/_kit/reference`.

**Dashboard screen:** tabs, with Default (Overview) first, then pinned dashboards,
then the rest by last update; archived dashboards have no tab. An agent dashboard's
header has Pin/Unpin and Archive; archiving the open tab selects Overview. An
"Archived N" control opens a list with Restore and Delete — delete lives only there,
behind a confirmation. The
Default tab keeps Start, Stop and Restart as native buttons outside the frame. The
list polls every 30 s: a new `htmlVersion` reloads the frame, a new `dataVersion`
sends `refresh`. The kit polls live sources itself (default 15 s).

**Mira:** a completed `dashboard` tool call with `action: save` shows a dashboard
card that opens that tab.

## Testing

- Engine: tool actions, limits, atomic writes, recipe written and removed, API
  routes, scoped-token allowlist.
- Kit: source parsing, formatting, chart scales, catalog → reference, element
  rendering in a DOM test environment.
- Desktop: document building (CSP, fragment extraction), live allowlist, channel
  validation; screenshots of sample dashboards in light and dark.
