// karmax.yaml, read and written without losing what a human put in it.
//
// Every edit goes through the YAML *document* rather than a parse-and-dump
// round trip. That is the difference between an app you can also edit by hand
// and one that silently eats your comments the first time you touch a toggle.
import { addAgentTools } from './agentTools.js'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import type { Channel, HarnessKind, Settings, SettingsPatch } from './shared/types.js'
import {
  allocatePorts,
  configPath,
  ensureProfile,
  patchEnvFile,
  profileDir,
  readEnvFile,
} from './profile.js'

export const AGENT_ID = 'karmax'

/** The persona a fresh install starts with. Written into the config rather
 *  than compiled in, because it is the first thing anyone will want to change
 *  and the app's own settings screen edits it in place. */
const DEFAULT_PERSONA = `You are KARMAX, a personal AI assistant that runs on its owner's own machine.

You are not a chatbot behind a form. You have real tools: a shell, the file
system, the web, and whatever apps have been connected. Use them. When someone
asks what is on their calendar, look; do not describe how one might look.

How to decide:
- Reading, searching, summarising, answering: just do it.
- Writing files, sending a message, making a change: do it, then say what you did.
- Deleting, spending money, anything that touches other people: ask first.
- Unsure whether something is reversible: treat it as though it is not.

Speak plainly. The person reading this is not an engineer, and does not want a
transcript of your reasoning - they want the answer, and the truth about what
you could not do.`

/** A new profile's config. Harness-first: the coding harness is the brain, and
 *  the metered API path is only ever the fallback. */
export async function writeDefaultConfig(opts: {
  name: string
  orchestrator: 'claude' | 'codex'
  anthropicKey: string
  anthropicBaseUrl: string
}): Promise<void> {
  ensureProfile()
  const ports = await allocatePorts()
  const dir = profileDir()

  const doc = `# KARMAX - written by the desktop app.
#
# Safe to edit by hand: the app reads this file back and preserves anything it
# does not understand, including these comments.

karmax:
  version: "2"
  data_dir: "${dir}"
  log_level: "info"
  log_format: "json"
  budget_usd_per_month: 0
  oauth_callback_port: ${ports.oauthCallback}
  oauth_callback_host: "127.0.0.1"

# The brain. A coding harness runs as a long-lived conversation and does the
# thinking; it has a real shell and real web access, and a warm session answers
# in about a second and a half. The API models below are the fallback for when
# the harness is rate-limited or signed out - never removed, never primary.
harness:
  enabled: true
  binary: "${opts.orchestrator}"
  window_share: 0.4
  max_live: 6
  workdir_root: "${path.join(dir, 'sessions')}"
  kinds:
    chat:
      model: "sonnet"
      idle: "20m"
      max_turns: 200
      turn_timeout: "4m"
    agent:
      model: "sonnet"
      idle: "30m"
      max_turns: 500
      turn_timeout: "12m"
    task:
      model: "opus"
      idle: "5m"
      max_turns: 20
      turn_timeout: "20m"

ai:
  default_provider: "anthropic"
  default_model: "claude-sonnet-4.6"
  providers:
    anthropic:
      api_key: "${opts.anthropicKey}"
      base_url: "${opts.anthropicBaseUrl}"
      auth_token: ""

api:
  enabled: true
  host: "127.0.0.1"
  port: ${ports.api}

console:
  enabled: true
  host: "127.0.0.1"
  port: ${ports.console}
  session_hours: 720

webhooks:
  enabled: false
  host: "127.0.0.1"
  port: ${ports.webhooks}
  routes: []

mcps: []

# Connected apps. The app writes these when you connect something; there is
# nothing to fill in by hand.
comms:
  channels: []

agents:
  - id: "${AGENT_ID}"
    name: "${escapeYaml(opts.name || 'KARMAX')}"
    description: "A personal assistant with real tools."
    model: "claude-sonnet-4.6"
    provider: "anthropic"
    temperature: 0.7
    max_tokens: 8192
    system_prompt: |
${indent(DEFAULT_PERSONA, 6)}
    memory_model:
      model: "claude-sonnet-4.6"
      provider: "anthropic"
    summary_model:
      model: "claude-haiku-4.5"
      provider: "anthropic"
    fallback_models:
      - provider: "anthropic"
        model: "claude-haiku-4.5"
    compaction_threshold: 128000
    compaction_keep_recent: 20
    # The tool list is an allowlist: a name that is not here cannot be called,
    # and a name the build does not have is warned about and skipped. So it is
    # safe to list something you have not connected yet.
    tools:
      # The harness tools are what make a coding assistant the orchestrator.
      # Without them the daemon still runs one, but nothing can drive it.
      - harness.send
      - harness.list
      - harness.close
      - shell.exec
      - file.read
      - file.write
      - file.list
      - http.request
      - notify.send
      - memory.ingest
      - memory.retrieve
      - memory.forget
      - claude_code.call
      - subagent
      - comms.send
      - comms.escalate
      - app.push
      - google
      - google.schema
      - browser
      # Interactive dashboards any agent can build and keep current.
      - dashboard
    memory:
      enabled: true
      namespace: "${AGENT_ID}"
      max_entries: 5000
    restart_policy: "always"
    max_restarts: 10
    triggers:
      run_on_start: true

# Automations. Each one wakes the assistant on a schedule.
loops: []
`
  fs.writeFileSync(configPath(), doc, { mode: 0o600 })
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n)
  return s
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : pad + l))
    .join('\n')
}

export function configExists(): boolean {
  return fs.existsSync(configPath())
}

/** Gives every agent's allowlist the tools a newer build needs, before the
 *  engine reads it. Returns what was added, so the log can say so. */
export function ensureAgentTools(): string[] {
  if (!configExists()) return []
  const { text, added } = addAgentTools(readRaw())
  if (added.length) fs.writeFileSync(configPath(), text, { mode: 0o600 })
  return added
}

export function readRaw(): string {
  return fs.readFileSync(configPath(), 'utf8')
}

function doc(): YAML.Document.Parsed {
  return YAML.parseDocument(readRaw())
}

function save(d: YAML.Document.Parsed): void {
  fs.writeFileSync(configPath(), String(d), { mode: 0o600 })
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? (n as number) : fallback
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/** The settings screens' view of the file. Anything missing resolves to the
 *  same default the daemon would apply, so the UI never shows a blank where
 *  the running system has a value. */
export function readSettings(): Settings {
  const d = doc()
  const agentsNode = d.getIn(['agents']) as { toJSON?: () => unknown } | undefined
  const agentsJson = agentsNode?.toJSON?.() ?? []
  const agent = (Array.isArray(agentsJson) ? (agentsJson[0] ?? {}) : {}) as Record<string, unknown>
  const harnessNode = d.getIn(['harness']) as { toJSON?: () => unknown } | undefined
  const harness = (harnessNode?.toJSON?.() ?? {}) as Record<string, unknown>
  const chNode = d.getIn(['comms', 'channels']) as { toJSON?: () => unknown } | undefined
  const channels = (chNode?.toJSON?.() ?? []) as Channel[]

  return {
    identity: {
      name: str(agent.name, 'KARMAX'),
      persona: str(agent.system_prompt),
    },
    brain: {
      harnessEnabled: harness.enabled !== false,
      binary: str(harness.binary, 'claude'),
      windowShare: num(harness.window_share, 0.4),
      maxLive: num(harness.max_live, 6),
      kinds: (harness.kinds ?? {}) as Record<string, HarnessKind>,
      fallbackProvider: str(agent.provider, 'anthropic'),
      fallbackModel: str(agent.model, 'claude-sonnet-4.6'),
    },
    budget: { usdPerMonth: num(d.getIn(['karmax', 'budget_usd_per_month']), 0) },
    ports: {
      api: num(d.getIn(['api', 'port']), 9191),
      console: num(d.getIn(['console', 'port']), 8181),
      webhooks: num(d.getIn(['webhooks', 'port']), 9190),
      oauthCallback: num(d.getIn(['karmax', 'oauth_callback_port']), 9195),
    },
    paths: { dataDir: str(d.getIn(['karmax', 'data_dir']), profileDir()) },
    logging: {
      level: str(d.getIn(['karmax', 'log_level']), 'info'),
      format: str(d.getIn(['karmax', 'log_format']), 'json'),
    },
    channels,
    memory: readMemorySettings(),
  }
}

/** GitLoom's settings, from the profile's .env. */
function readMemorySettings() {
  const env = readEnvFile()
  const key = (env.GITLOOM_API_KEY ?? '').trim()
  return {
    gitloomEnabled: key !== '',
    gitloomKeySet: key !== '',
    namespace: (env.GITLOOM_NAMESPACE ?? '').trim(),
    baseUrl: (env.GITLOOM_BASE_URL ?? '').trim(),
  }
}

/** Store GitLoom's settings. An empty apiKey is left alone rather than
 *  cleared, so saving the namespace does not sign you out; clearing is a
 *  separate, explicit action. */
export function setMemorySettings(m: {
  apiKey?: string
  namespace?: string
  baseUrl?: string
  clearKey?: boolean
}): Settings {
  const patch: Record<string, string> = {}
  if (m.clearKey) patch.GITLOOM_API_KEY = ''
  else if (m.apiKey !== undefined && m.apiKey.trim() !== '') patch.GITLOOM_API_KEY = m.apiKey
  if (m.namespace !== undefined) patch.GITLOOM_NAMESPACE = m.namespace
  if (m.baseUrl !== undefined) patch.GITLOOM_BASE_URL = m.baseUrl
  patchEnvFile(patch)
  return readSettings()
}

/** Apply a patch in place. Only the keys present are touched - which is what
 *  lets one toggle save without rewriting a file it never read. */
export function patchSettings(patch: SettingsPatch): Settings {
  const d = doc()

  if (patch.identity) {
    if (patch.identity.name !== undefined) d.setIn(['agents', 0, 'name'], patch.identity.name)
    if (patch.identity.persona !== undefined) {
      // Block scalar, so a multi-paragraph persona stays readable in the file.
      const scalar = d.createNode(patch.identity.persona) as YAML.Scalar
      scalar.type = YAML.Scalar.BLOCK_LITERAL
      d.setIn(['agents', 0, 'system_prompt'], scalar)
    }
  }

  if (patch.brain) {
    const b = patch.brain
    if (b.harnessEnabled !== undefined) d.setIn(['harness', 'enabled'], b.harnessEnabled)
    if (b.binary !== undefined) d.setIn(['harness', 'binary'], b.binary)
    if (b.windowShare !== undefined) d.setIn(['harness', 'window_share'], b.windowShare)
    if (b.maxLive !== undefined) d.setIn(['harness', 'max_live'], b.maxLive)
    if (b.fallbackModel !== undefined) d.setIn(['agents', 0, 'model'], b.fallbackModel)
    if (b.fallbackProvider !== undefined) d.setIn(['agents', 0, 'provider'], b.fallbackProvider)
    if (b.kinds !== undefined) {
      for (const [kind, cfg] of Object.entries(b.kinds)) {
        for (const [k, v] of Object.entries(cfg as unknown as Record<string, unknown>)) {
          if (v !== undefined) d.setIn(['harness', 'kinds', kind, k], v)
        }
      }
    }
  }

  if (patch.budget?.usdPerMonth !== undefined) {
    d.setIn(['karmax', 'budget_usd_per_month'], patch.budget.usdPerMonth)
  }

  if (patch.logging) {
    if (patch.logging.level !== undefined) d.setIn(['karmax', 'log_level'], patch.logging.level)
    if (patch.logging.format !== undefined) d.setIn(['karmax', 'log_format'], patch.logging.format)
  }

  if (patch.ports) {
    const p = patch.ports
    if (p.api !== undefined) d.setIn(['api', 'port'], p.api)
    if (p.console !== undefined) d.setIn(['console', 'port'], p.console)
    if (p.webhooks !== undefined) d.setIn(['webhooks', 'port'], p.webhooks)
    if (p.oauthCallback !== undefined) d.setIn(['karmax', 'oauth_callback_port'], p.oauthCallback)
  }

  save(d)
  return readSettings()
}

/** Replace a whole channel list - used when connecting or removing an app. */
export function setChannels(channels: Channel[]): void {
  const d = doc()
  d.setIn(['comms', 'channels'], d.createNode(channels))
  save(d)
}

export function upsertChannel(ch: Channel): void {
  const existing = readSettings().channels.filter((c) => c.id !== ch.id)
  setChannels([...existing, ch])
}

export function removeChannel(id: string): void {
  setChannels(readSettings().channels.filter((c) => c.id !== id))
}

/** Automations, read and written whole - there is no partial edit of one that
 *  means anything to a person. */
export function readLoops(): Record<string, unknown>[] {
  const d = doc()
  const node = d.getIn(['loops']) as { toJSON?: () => unknown } | undefined
  const loops = node?.toJSON?.() ?? []
  return (Array.isArray(loops) ? loops : []) as Record<string, unknown>[]
}

export function writeLoops(loops: Record<string, unknown>[]): void {
  const d = doc()
  d.setIn(['loops'], d.createNode(loops))
  save(d)
}

/** Validate before writing, so a bad paste in the advanced editor is rejected
 *  rather than left for the daemon to fail on at next start. */
export function writeRaw(text: string): { ok: boolean; error: string | null } {
  try {
    const parsed = YAML.parseDocument(text)
    if (parsed.errors.length) return { ok: false, error: parsed.errors[0].message }
    const json = parsed.toJSON() as Record<string, unknown> | null
    if (!json || typeof json !== 'object') return { ok: false, error: 'not a YAML mapping' }
    if (!Array.isArray(json.agents) || json.agents.length === 0) {
      return { ok: false, error: 'agents: at least one agent is required' }
    }
    fs.writeFileSync(configPath(), text, { mode: 0o600 })
    return { ok: true, error: null }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
