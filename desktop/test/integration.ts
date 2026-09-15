// Exercises the real main-process modules against the real bundled daemon.
//
// Not a unit test: it writes a config, starts KARMAX, asks it questions over
// both of its HTTP surfaces, and stops it. Everything this app does that could
// silently be wrong — the generated config, the token handshake, the console
// auto-login, the supervisor's state machine — is wrong here first.
//
// Run with `npm run test:core`. It uses a throwaway profile, so it never
// touches a real install.
import {
  configExists,
  patchSettings,
  readLoops,
  readRaw,
  readSettings,
  writeDefaultConfig,
  writeLoops,
} from '../electron/config.js'
import { setMemorySettings } from '../electron/config.js'
import { daemon } from '../electron/daemon.js'
import { configPath, daemonBinary, profileDir, readEnvFile, readState, writeEnvFile } from '../electron/profile.js'
import { api, consoleApi } from '../electron/api.js'
import fs from 'node:fs'
import YAML from 'yaml'

let failures = 0
function ok(label: string, cond: boolean, extra = ''): void {
  if (!cond) failures++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`)
}

const t0 = Date.now()
const since = () => ((Date.now() - t0) / 1000).toFixed(1)

console.log(`profile: ${profileDir()}\n`)

ok('a daemon binary is bundled', !!daemonBinary(), daemonBinary() ?? 'none found')

readState()
await writeDefaultConfig({
  name: 'Test Assistant',
  orchestrator: 'claude',
  anthropicKey: '',
  anthropicBaseUrl: '',
})
ok('a config was written', configExists())

const s = readSettings()
ok('the harness is on by default', s.brain.harnessEnabled)
ok('the harness binary is the coding assistant', s.brain.binary === 'claude', s.brain.binary)
ok('three conversation policies exist', Object.keys(s.brain.kinds).length === 3, Object.keys(s.brain.kinds).join(', '))
ok('the name round-tripped', s.identity.name === 'Test Assistant', s.identity.name)
ok('a persona was written', s.identity.persona.length > 100, `${s.identity.persona.length} chars`)
ok('ports were allocated', s.ports.api > 1024 && s.ports.console > 1024, `api ${s.ports.api}, console ${s.ports.console}`)

// A patch must change one key and leave everything else — comments included.
patchSettings({
  brain: { windowShare: 0.75 },
  identity: { persona: s.identity.persona + '\n\nExtra line.' },
})
const after = readSettings()
ok('a patch changed its value', after.brain.windowShare === 0.75, String(after.brain.windowShare))
ok('a patch left the rest alone', after.brain.binary === 'claude' && after.identity.name === 'Test Assistant')
ok('a multi-line persona stayed a block scalar', after.identity.persona.includes('Extra line.'))
ok('comments survived the patch', readRaw().includes('# The brain.'))

writeLoops([{ name: 'test-loop', every: '2h', prompt: 'do a thing', enabled: true }])
ok('an automation round-tripped', readLoops()[0]?.name === 'test-loop')

// Memory settings live in the profile's .env, which the daemon rewrites on
// every start. That rewrite used to truncate the file, which would have made
// GitLoom credentials vanish on the next restart — silently, and only for
// people who had set them.
const mem = setMemorySettings({ apiKey: 'gl_test_key', namespace: 'itest-ns', baseUrl: '' })
ok('GitLoom reads back as connected', mem.memory.gitloomEnabled)
ok('the namespace round-tripped', mem.memory.namespace === 'itest-ns', mem.memory.namespace)
ok('the key itself is never returned', !JSON.stringify(mem.memory).includes('gl_test_key'))

writeEnvFile(readState())
const env = readEnvFile()
ok('a daemon start keeps the GitLoom key', env.GITLOOM_API_KEY === 'gl_test_key')
ok('a daemon start keeps the namespace', env.GITLOOM_NAMESPACE === 'itest-ns')
ok('a daemon start still writes its own token', !!env.KARMAX_API_TOKEN)

// Clearing has to actually remove the key, not blank it: karmax trims the
// value, but a person reading the file should not see a setting that looks
// present and broken.
const cleared = setMemorySettings({ clearKey: true })
ok('disconnecting removes the key', !cleared.memory.gitloomEnabled && !readEnvFile().GITLOOM_API_KEY)
setMemorySettings({ namespace: '', baseUrl: '' })

// An install from before dashboards has agent tool lists without the tool, and
// the engine reads those lists once, at start — so the start has to add it.
fs.writeFileSync(configPath(), readRaw().replace(/^[ \t]*- dashboard\n/gm, ''))
const withoutTool = () =>
  ((YAML.parse(readRaw())?.agents ?? []) as { id?: string; tools?: string[] }[])
    .filter((a) => Array.isArray(a.tools) && !a.tools.includes('dashboard'))
    .map((a) => a.id ?? '?')
ok('an old config lacks the dashboard tool', withoutTool().length > 0, withoutTool().join(', '))

// The real thing.
daemon.on('change', (st: { state: string; detail: string }) =>
  console.log(`        [${since()}s] ${st.state} — ${st.detail}`),
)

await daemon.start(true)
const st = daemon.status()
ok('the daemon reached running', st.state === 'running', `${st.state}: ${st.detail}`)
ok('it reported its version', !!st.version, st.version ?? 'none')

if (st.state === 'running') {
  const ping = await api('GET', '/api/ping')
  ok('the assistant API accepts the app token', ping.ok, ping.error ?? '')

  const integrations = await api<{ integrations: unknown[] }>('GET', '/api/integrations')
  ok(
    'integrations are listed',
    integrations.ok && Array.isArray(integrations.data?.integrations),
    integrations.ok ? `${integrations.data?.integrations.length} entries` : (integrations.error ?? ''),
  )

  const tool = await api<{ ok: boolean }>('POST', '/api/tools/harness.list', {})
  ok('harness.list runs', tool.ok, tool.error ?? '')

  ok('the start gave every agent the dashboard tool', withoutTool().length === 0, withoutTool().join(', '))

  // Agents build dashboards through the tool; the Dashboard screen lists, pins,
  // archives and deletes them over REST. An engine missing either half leaves
  // the screen showing only the Overview, with no error to say why.
  const saved = await api('POST', '/api/tools/dashboard', {
    action: 'save',
    id: 'itest-board',
    title: 'Integration',
    html: '<lz-page title="Integration"><lz-stat label="Runs" source="runs.total"></lz-stat></lz-page>',
    data: { runs: { total: 1 } },
  })
  const boards = await api<{ dashboards: { id: string; archived?: boolean }[] }>('GET', '/api/dashboards')
  ok(
    'a dashboard saved through the tool is listed',
    saved.ok && !!boards.data?.dashboards?.some((d) => d.id === 'itest-board'),
    saved.error ?? boards.error ?? '',
  )
  const archived = await api<{ dashboard: { archived?: boolean } }>('PATCH', '/api/dashboards/itest-board', { archived: true })
  ok('a dashboard can be archived', archived.ok && archived.data?.dashboard?.archived === true, archived.error ?? '')
  const removed = await api('DELETE', '/api/dashboards/itest-board')
  ok('a dashboard can be deleted', removed.ok, removed.error ?? '')

  // The three surfaces the app added screens for. A shipped engine that
  // predates any of them turns those screens into a spinner that never
  // resolves, which is a worse failure than a missing button.
  const browser = await api<{ available: boolean; profile: string }>('GET', '/api/browser')
  ok(
    'the shared browser answers',
    browser.ok && typeof browser.data?.profile === 'string',
    browser.ok ? `available: ${browser.data?.available}` : (browser.error ?? ''),
  )

  const access = await api<{ standard: string[] }>('GET', '/api/access')
  ok(
    'the access policy answers, with its standard denials',
    access.ok && (access.data?.standard?.length ?? 0) > 0,
    access.ok ? `${access.data?.standard.length} always out of reach` : (access.error ?? ''),
  )

  const connectable = await api<{ connectable: { id: string }[] }>('GET', '/api/connect')
  ok(
    'the engine says what an agent can connect',
    connectable.ok && (connectable.data?.connectable?.length ?? 0) > 0,
    connectable.ok
      ? (connectable.data?.connectable.map((c) => c.id).join(', ') ?? '')
      : (connectable.error ?? ''),
  )

  // The chat screen asks for this list before it draws anything. An engine
  // that predates it answers 404, and the window would open on a spinner.
  const convs = await api<{ conversations: unknown[]; brain: string }>('GET', '/api/chat/conversations')
  ok(
    'the engine lists chat conversations',
    convs.ok && Array.isArray(convs.data?.conversations),
    convs.ok
      ? `${convs.data?.conversations.length} conversations, brain ${convs.data?.brain}`
      : (convs.error ?? ''),
  )

  const conns = await consoleApi<{ connectors: unknown[] }>('GET', '/api/console/connectors')
  ok(
    'the console signs itself in and lists connectors',
    conns.ok,
    conns.ok ? `${conns.data?.connectors.length} connectors` : (conns.error ?? ''),
  )

  const loops = await api<{ loops: unknown[] }>('GET', '/api/loops/health')
  ok('automation health is readable', loops.ok, loops.error ?? '')
}

await daemon.stop()
ok('the daemon stopped cleanly', daemon.status().state === 'stopped', daemon.status().detail)

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`} in ${since()}s`)
process.exit(failures === 0 ? 0 : 1)
