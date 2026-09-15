// Everything configurable, in four groups.
//
// The order is deliberate: what the assistant is, what it thinks with, what it
// the brain, and — last, behind its own warning — the file itself. A non-technical
// person should be able to stop reading after the first group and still have a
// working install.
import { useEffect, useState } from 'react'
import {
  Brain,
  Cloud,
  Cpu,
  FileCode2,
  FolderOpen,
  ReceiptText,
  Repeat2,
  RotateCw,
  Save,
  Server,
  Sparkles,
  ScrollText,
  ShieldCheck,
} from 'lucide-react'
import type { DaemonStatus, HarnessKind, RemoteEngine, SetupState } from '@shared/types'
import {
  Badge,
  Button,
  CopyButton,
  Field,
  Input,
  Mono,
  PageHeader,
  Panel,
  SectionHeader,
  Select,
  Slider,
  Spinner,
  Textarea,
  Toggle,
} from '@/components/ui'
import { useToast } from '@/components/Overlays'
import { AccessTab } from '@/routes/settings/AccessTab'
import { useSettings } from '@/lib/hooks'
import { cn, titleCase } from '@/lib/util'

type Tab = 'assistant' | 'lyzn' | 'brain' | 'memory' | 'access' | 'engine' | 'logs' | 'advanced'

const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: 'assistant', label: 'Assistant', icon: Sparkles },
  { id: 'lyzn', label: 'LYZN', icon: ReceiptText },
  { id: 'brain', label: 'Brain', icon: Cpu },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'access', label: 'Access', icon: ShieldCheck },
  { id: 'engine', label: 'Engine', icon: Server },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'advanced', label: 'Advanced', icon: FileCode2 },
]

export default function SettingsPage({
  status,
  setup,
}: {
  status: DaemonStatus | null
  setup: SetupState
}) {
  const [tab, setTab] = useState<Tab>('assistant')
  const { settings, save, reload, saving } = useSettings()
  const toast = useToast()

  const needsRestart = status?.state === 'running'

  return (
    <>
      <PageHeader
        title="Settings"
        lede="Everything here is written to a single file on this computer. Nothing leaves it."
        action={
          needsRestart ? (
            <Button
              variant="ghost"
              icon={<RotateCw size={14} />}
              onClick={() => {
                void window.karmax.daemon.restart()
                toast('Restarting the engine…', 'info')
              }}
            >
              Restart to apply
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 flex gap-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2  px-3.5 py-2 text-[13px] font-medium transition duration-200',
              tab === id
                ? 'bg-[var(--skin-3)] text-[var(--fg)]'
                : 'text-[var(--fg-dim)] hover:bg-[var(--skin-1)] hover:text-[var(--fg)]',
            )}
          >
            <Icon size={15} className={tab === id ? 'text-[var(--accent)]' : undefined} />
            {label}
          </button>
        ))}
      </div>

      {!settings ? (
        <Panel>
          <Spinner />
        </Panel>
      ) : (
        <>
          {tab === 'assistant' && <AssistantTab settings={settings} save={save} saving={saving} />}
          {tab === 'brain' && <BrainTab settings={settings} save={save} />}
          {tab === 'memory' && <MemoryTab settings={settings} onSaved={reload} />}
          {tab === 'access' && <AccessTab />}
          {tab === 'logs' && <LogsTab settings={settings} save={save} />}
          {tab === 'lyzn' && <LyznTab />}
          {tab === 'engine' && <EngineTab />}
          {tab === 'advanced' && (
            <AdvancedTab settings={settings} setup={setup} save={save} />
          )}
        </>
      )}
    </>
  )
}

/** Pairing this machine with LYZN.
 *
 *  Six characters from the phone, spent by being typed. What comes back is a
 *  token bound to this machine, and it stays in the main process — the page
 *  can ask whether there is one, never what it is.
 *
 *  This is the app's own pairing, not the engine's. The engine gets its work
 *  through a loop with a token of its own, and knows nothing about LYZN
 *  otherwise; this one exists so the window can show what is happening. */
function LyznTab() {
  const toast = useToast()
  const [state, setState] = useState<Awaited<
    ReturnType<typeof window.karmax.lyzn.pairing>
  > | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => void window.karmax.lyzn.pairing().then(setState)
  useEffect(load, [])

  if (!state) return <Spinner />

  return (
    <Panel>
      <SectionHeader
        title="LYZN"
        hint="The phone hears what you promise. This machine is what keeps it."
      />

      {state.paired ? (
        <>
          <p className="text-[13.5px] leading-relaxed text-[var(--fg-dim)]">
            Signed in as <strong className="font-medium text-[var(--fg)]">{state.name}</strong>
            {state.plan?.tier ? ` on ${state.plan.tier === 'act-pro' ? 'Act Pro' : titleCase(state.plan.tier)}` : ''}.
            Work you approve in the app appears under Tasks, and each finished one prints a
            receipt.
          </p>

          {/* The loop is the integration. Nothing about LYZN is built into the
              engine — signing in writes this file, and it is what beats, takes
              a task and posts the outcome back. Worth showing, because when
              nothing is happening this is the thing to look at. */}
          <div
            className={cn(
              'mt-4 flex items-center gap-3 border px-4 py-3.5',
              state.loop?.armed
                ? 'border-[var(--ok)]/30 bg-[var(--ok-skin)]'
                : 'border-[var(--warn)]/30 bg-[var(--warn-skin)]',
            )}
          >
            <Repeat2
              size={17}
              className="shrink-0"
              style={{ color: state.loop?.armed ? 'var(--ok)' : 'var(--warn)' }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">
                {state.loop?.armed ? 'The lyzn-tasks loop is running' : 'The lyzn-tasks loop is not set up'}
              </p>
              <p className="mt-0.5 text-[12.5px] text-[var(--fg-dim)]">
                {state.loop?.armed
                  ? 'Every two minutes it asks what you approved, takes one, and reports back. You can see it under Loops.'
                  : 'Without it this machine will not pick anything up. Signing in again installs it.'}
              </p>
            </div>
          </div>

          {state.plan && !state.plan.automation && (
            <p className="mt-3 border border-[var(--warn)]/30 bg-[var(--warn-skin)] px-3.5 py-3 text-[12.5px] leading-relaxed text-[var(--fg-dim)]">
              {state.plan.why} This machine will stay signed in and pick nothing up until that
              changes.
            </p>
          )}
          <Button
            variant="quiet"
            className="mt-4"
            onClick={async () => {
              await window.karmax.lyzn.unpair()
              toast('This machine has forgotten its pairing.', 'ok')
              load()
            }}
          >
            Forget this pairing
          </Button>
          <p className="mt-2 text-[12px] text-[var(--fg-faint)]">
            This only forgets it here. To stop the account handing it work, unpair it in the app —
            revocation belongs where the account is.
          </p>
        </>
      ) : (
        <>
          <p className="text-[13.5px] leading-relaxed text-[var(--fg-dim)]">
            In the LYZN app: <strong className="font-medium text-[var(--fg)]">Settings → Laptop
            daemon → Pair a laptop</strong>. It shows six characters, good for five minutes and one
            machine.
          </p>
          <Field label="The six characters">
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase())
                setError(null)
              }}
              placeholder="K7QD2M"
              spellCheck={false}
              className="font-mono uppercase tracking-[0.3em]"
            />
          </Field>
          {error && <p className="mb-3 text-[12.5px] text-[var(--bad)]">{error}</p>}
          <Button
            variant="primary"
            busy={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const r = await window.karmax.lyzn.pair(code)
                if (r.ok) {
                  toast(`Paired as ${r.name ?? 'this machine'}.`, 'ok')
                  setCode('')
                  load()
                } else {
                  setError(r.error ?? 'That code was not accepted.')
                }
              } finally {
                setBusy(false)
              }
            }}
          >
            Pair this machine
          </Button>
        </>
      )}
    </Panel>
  )
}

/** Which machine the engine runs on.
 *
 *  This app is a UI and nothing about it needs the engine to be underneath it.
 *  A laptop that closes at night and a machine that never sleeps are a
 *  reasonable pair to own, and this is where you say so.
 *
 *  What cannot travel is supervision: starting, stopping and reading the log
 *  file are local acts on local files. When the engine is elsewhere the window
 *  watches it instead, and says as much rather than drawing a Start button
 *  that would lie. */
function EngineTab() {
  const toast = useToast()
  const [form, setForm] = useState<RemoteEngine | null>(null)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.karmax.engine.get().then(setForm)
  }, [])

  if (!form) return <Spinner />
  const edit = (patch: Partial<RemoteEngine>) => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setResult(null)
  }

  return (
    <Panel>
      <SectionHeader
        title="Where the engine runs"
        hint="This window is the controls. The engine is the thing doing the work, and it does not have to be on this computer."
      />

      <Toggle
        checked={form.enabled}
        onChange={(v) => edit({ enabled: v })}
        label="The engine is on another machine"
        hint="With this off, LYZN runs and supervises its own engine here — starting it, stopping it, and keeping its log."
      />

      {!form.enabled && (
        <div className="border-t pt-4">
          <p className="text-[13px] leading-relaxed text-[var(--fg-dim)]">
            To drive this machine from LYZN on another computer, enter this machine's address
            there along with the key below.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={async () => {
              await window.karmax.engine.copyKey()
              toast("Copied. Paste it into the other machine's LYZN.", 'ok')
            }}
          >
            Copy this machine's key
          </Button>
        </div>
      )}

      {form.enabled && (
        <div className="border-t pt-4">
          <Field
            label="Address"
            hint="A hostname or an IP on your own network. The engine there must be reachable from this machine."
          >
            <Input
              value={form.host}
              onChange={(e) => edit({ host: e.target.value })}
              placeholder="192.168.1.20"
              spellCheck={false}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Engine port">
              <Input
                value={String(form.apiPort)}
                onChange={(e) => edit({ apiPort: Number(e.target.value) || 0 })}
                spellCheck={false}
              />
            </Field>
            <Field label="Console port">
              <Input
                value={String(form.consolePort)}
                onChange={(e) => edit({ consolePort: Number(e.target.value) || 0 })}
                spellCheck={false}
              />
            </Field>
          </div>

          <Field
            label="That engine's token"
            hint="It is in KARMAX_API_TOKEN, in the .env beside that machine's profile. This app cannot make one up: the token is the only thing between the network and a shell."
          >
            <Input
              type="password"
              value={form.token}
              onChange={(e) => edit({ token: e.target.value })}
              placeholder="kmx_…"
              spellCheck={false}
            />
          </Field>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              busy={testing}
              onClick={async () => {
                setTesting(true)
                setResult(null)
                try {
                  const r = await window.karmax.engine.test(form)
                  setResult({
                    ok: r.ok,
                    text: r.ok ? `Found it${r.version ? ` — ${r.version}` : ''}.` : (r.error ?? 'No answer.'),
                  })
                } finally {
                  setTesting(false)
                }
              }}
            >
              Test the connection
            </Button>
            {result && (
              <span
                className="text-[12.5px]"
                style={{ color: result.ok ? 'var(--ok)' : 'var(--bad)' }}
              >
                {result.text}
              </span>
            )}
          </div>

          <p className="mt-4 text-[12.5px] leading-relaxed text-[var(--fg-dim)]">
            While the engine is elsewhere, this window watches it rather than runs it. Starting and
            stopping it, and its log, belong to that machine.
          </p>
        </div>
      )}

      <div className="mt-5 border-t pt-4">
        <Button
          variant="primary"
          busy={saving}
          onClick={async () => {
            setSaving(true)
            try {
              const r = await window.karmax.engine.set(form)
              if (r.ok) {
                toast(
                  form.enabled ? 'Pointed at the other machine.' : 'Back to the engine on this machine.',
                  'ok',
                )
              } else {
                toast(r.error ?? 'That did not save.', 'bad')
              }
            } finally {
              setSaving(false)
            }
          }}
        >
          Save
        </Button>
      </div>
    </Panel>
  )
}

type Save = ReturnType<typeof useSettings>['save']

function AssistantTab({
  settings,
  save,
  saving,
}: {
  settings: NonNullable<ReturnType<typeof useSettings>['settings']>
  save: Save
  saving: boolean
}) {
  const toast = useToast()
  const [name, setName] = useState(settings.identity.name)
  const [persona, setPersona] = useState(settings.identity.persona)

  const dirty = name !== settings.identity.name || persona !== settings.identity.persona

  return (
    <Panel>
      <SectionHeader
        title="Who it is"
        hint="The name it answers to, and the instructions it carries into every conversation."
      />

      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field
        label="Standing instructions"
        hint="Written to the assistant before anything you ask. Say how you want it to behave, what to do on its own, and what to check with you first."
      >
        <Textarea
          rows={16}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          className="font-mono text-[12.5px] leading-relaxed"
        />
      </Field>

      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-[12.5px] text-[var(--fg-dim)]">
          {dirty ? 'Unsaved changes.' : 'Saved. Takes effect on the next restart.'}
        </p>
        <Button
          variant="primary"
          icon={<Save size={15} />}
          busy={saving}
          disabled={!dirty}
          onClick={() => {
            void save({ identity: { name, persona } }).then(() => toast('Saved.', 'ok'))
          }}
        >
          Save
        </Button>
      </div>
    </Panel>
  )
}

function BrainTab({
  settings,
  save,
}: {
  settings: NonNullable<ReturnType<typeof useSettings>['settings']>
  save: Save
}) {
  const toast = useToast()
  const b = settings.brain
  const [kinds, setKinds] = useState(b.kinds)

  useEffect(() => setKinds(b.kinds), [b.kinds])

  return (
    <>
      <Panel className="mb-4">
        <SectionHeader
          title="What does the thinking"
          hint="A coding assistant already installed on this machine, kept running as one long conversation. That is what makes replies fast."
        />

        <Toggle
          checked={b.harnessEnabled}
          onChange={(v) => {
            void save({ brain: { harnessEnabled: v } }).then(() =>
              toast(
                v
                  ? 'The coding assistant will do the thinking after the next restart.'
                  : 'Switched to the backup. Slower, and it keeps working.',
                'ok',
              ),
            )
          }}
          label="Use a coding assistant as the brain"
          hint="Strongly recommended. With this off, every reply comes from the backup instead — it works, but it is slower."
        />

        <div className={cn('border-t', !b.harnessEnabled && 'pointer-events-none opacity-45')}>
          <Field label="Which one" hint="Both speak the same protocol, so this is only a choice of which is installed and signed in.">
            <Select
              value={b.binary}
              onChange={(v) => void save({ brain: { binary: v } })}
              options={[
                { value: 'claude', label: 'Claude Code' },
                { value: 'codex', label: 'Codex' },
              ]}
            />
          </Field>

          <Field
            label="How much of your assistant LYZN may use"
            hint="A coding assistant allows so much work per account, and you use yours too. LYZN stands down at this share and carries on with its backup, so it can never be the reason your own work stops."
          >
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={b.windowShare}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => void save({ brain: { windowShare: v } })}
            />
          </Field>

          <Field
            label="How many conversations at once"
            hint="Each one is a real process. More means more can happen in parallel; too many will slow the machine down."
          >
            <Slider
              min={1}
              max={16}
              step={1}
              value={b.maxLive}
              onChange={(v) => void save({ brain: { maxLive: v } })}
            />
          </Field>
        </div>
      </Panel>

      <Panel className="mb-4">
        <SectionHeader
          title="Conversation policies"
          hint="Three kinds of work, each with its own model and patience. Sensible defaults are already set — these are here for when one of them is wrong for you."
        />
        <div className="space-y-3">
          {Object.entries(kinds).map(([kind, cfg]) => (
            <KindEditor
              key={kind}
              kind={kind}
              cfg={cfg}
              onChange={(next) => {
                setKinds((k) => ({ ...k, [kind]: next }))
                void save({ brain: { kinds: { [kind]: next } } })
              }}
            />
          ))}
        </div>
      </Panel>

      {/* No "backup" panel. The fallback brain is LYZN's to arrange — a model
          name and a provider are not a decision to hand somebody who came here
          to connect WhatsApp, and an API key least of all. An operator who
          runs their own gateway can still set it in the file, which is what
          the Advanced tab is for. */}
    </>
  )
}

const KIND_COPY: Record<string, string> = {
  chat: 'Answering a person. Latency matters most.',
  agent: 'The assistant thinking for itself. Long-lived; survives a restart.',
  task: 'One heavy piece of work, then gone.',
}

function KindEditor({
  kind,
  cfg,
  onChange,
}: {
  kind: string
  cfg: HarnessKind
  onChange: (next: HarnessKind) => void
}) {
  return (
    <div className="rounded-[var(--radius-tile)] border bg-[var(--skin-1)] p-4">
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] font-medium">{titleCase(kind)}</span>
        <Badge tone="idle">{cfg.model}</Badge>
      </div>
      <p className="mt-0.5 text-[12.5px] text-[var(--fg-dim)]">{KIND_COPY[kind] ?? ''}</p>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-[var(--fg-faint)]">Model</span>
          <Select
            value={cfg.model}
            onChange={(v) => onChange({ ...cfg, model: v })}
            options={[
              { value: 'haiku', label: 'Haiku — fastest' },
              { value: 'sonnet', label: 'Sonnet — balanced' },
              { value: 'opus', label: 'Opus — strongest' },
            ]}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-[var(--fg-faint)]">Closes after</span>
          <Select
            value={cfg.idle}
            onChange={(v) => onChange({ ...cfg, idle: v })}
            options={['5m', '10m', '20m', '30m', '1h', '2h'].map((v) => ({
              value: v,
              label: `${v} idle`,
            }))}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-[var(--fg-faint)]">Gives up after</span>
          <Select
            value={cfg.turn_timeout}
            onChange={(v) => onChange({ ...cfg, turn_timeout: v })}
            options={['45s', '2m', '4m', '8m', '12m', '20m'].map((v) => ({
              value: v,
              label: v,
            }))}
          />
        </label>
      </div>
    </div>
  )
}

/** Where memories are kept, which is not a question any more.
 *
 *  Always GitLoom, in the namespace that belongs to the account this machine
 *  signed in to, with a key scoped to it. A memory in a file on one laptop is
 *  a memory that disagrees with the phone, cannot be read by a second machine,
 *  and goes with the disk — and the product is that what you said is
 *  remembered. So there is no local option, no key to paste, and no
 *  disconnect: this screen reports, and offers the one repair that makes
 *  sense. */
function MemoryTab({
  settings,
  onSaved,
}: {
  settings: NonNullable<ReturnType<typeof useSettings>['settings']>
  onSaved: () => Promise<void>
}) {
  const toast = useToast()
  const m = settings.memory
  const [busy, setBusy] = useState(false)

  return (
    <Panel>
      <SectionHeader
        title="Memory"
        hint="Everything the pendant heard, and everything the assistant has learned. It lives with your account rather than on this machine, which is why the phone and this window agree about what you said."
      />

      <div
        className={cn(
          'flex items-center gap-3 border px-4 py-3.5',
          m.gitloomEnabled
            ? 'border-[var(--ok)]/30 bg-[var(--ok-skin)]'
            : 'border-[var(--warn)]/30 bg-[var(--warn-skin)]',
        )}
      >
        <Cloud
          size={17}
          className="shrink-0"
          style={{ color: m.gitloomEnabled ? 'var(--ok)' : 'var(--warn)' }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">
            {m.gitloomEnabled ? 'Connected' : 'Not connected'}
          </p>
          <p className="mt-0.5 text-[12.5px] text-[var(--fg-dim)]">
            {m.gitloomEnabled
              ? `Reading and writing ${m.namespace || 'your workspace'}.`
              : 'This machine has no memory credential. Nothing it does will be remembered until it has one.'}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t pt-4">
        <p className="text-[13px] leading-relaxed text-[var(--fg-dim)]">
          The key belongs to this machine alone and reaches only your own
          workspace. If it is ever lost — a reinstall, or a failure while the
          network was down — LYZN will issue another and retire the old one.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          busy={busy}
          icon={<RotateCw size={14} />}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await window.karmax.lyzn.refreshMemory()
              if (r.ok) {
                await onSaved()
                toast('This machine has a new memory key. Restart the engine to use it.', 'ok')
              } else {
                toast(r.error ?? 'LYZN could not issue one just now.', 'bad')
              }
            } finally {
              setBusy(false)
            }
          }}
        >
          Issue a new key
        </Button>
      </div>
    </Panel>
  )
}

/** What the engine writes about itself.
 *
 *  All that is left of what used to be "Limits". The monthly budget went with
 *  the rest of the money: cost belongs to the plan that meters it, and a
 *  person who bought Act did not buy a spreadsheet. */
function LogsTab({
  settings,
  save,
}: {
  settings: NonNullable<ReturnType<typeof useSettings>['settings']>
  save: Save
}) {
  return (
    <Panel>
      <SectionHeader
        title="Logging"
        hint="What the engine writes about itself. Turn it up only while chasing a problem."
      />
      <Field label="Detail">
        <Select
          value={settings.logging.level}
          onChange={(v) => void save({ logging: { level: v } })}
          options={[
            { value: 'error', label: 'Errors only' },
            { value: 'warn', label: 'Warnings and errors' },
            { value: 'info', label: 'Normal' },
            { value: 'debug', label: 'Everything (noisy)' },
          ]}
        />
      </Field>
    </Panel>
  )
}

function AdvancedTab({
  settings,
  setup,
  save,
}: {
  settings: NonNullable<ReturnType<typeof useSettings>['settings']>
  setup: SetupState
  save: Save
}) {
  const toast = useToast()

  return (
    <>
      <Panel className="mb-4">
        <SectionHeader title="Where things live" />
        <dl className="space-y-2.5 text-[13px]">
          <Row label="Data folder" value={setup.profileDir} copy />
          <Row label="Settings file" value={setup.configPath} copy />
          {[
            ['Assistant API', settings.ports.api],
            ['Admin API', settings.ports.console],
            ['Sign-in callback', settings.ports.oauthCallback],
          ].map(([label, port]) => (
            <Row key={String(label)} label={String(label)} value={`127.0.0.1:${port}`} />
          ))}
        </dl>
        <Button
          variant="ghost"
          className="mt-4"
          icon={<FolderOpen size={14} />}
          onClick={() => void window.karmax.app.revealProfile()}
        >
          Open the folder
        </Button>
      </Panel>

      <Panel className="mb-4">
        <SectionHeader
          title="Ports"
          hint="Change these only if something else on this machine already uses them."
        />
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ['api', 'Assistant API'],
              ['console', 'Admin API'],
              ['oauthCallback', 'Sign-in callback'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-[11.5px] text-[var(--fg-faint)]">{label}</span>
              <Input
                inputMode="numeric"
                defaultValue={settings.ports[key]}
                onBlur={(e) => {
                  const port = Number(e.target.value)
                  if (port >= 1024 && port <= 65535 && port !== settings.ports[key]) {
                    void save({ ports: { [key]: port } }).then(() =>
                      toast('Saved. Restart the engine to move it.', 'ok'),
                    )
                  }
                }}
              />
            </label>
          ))}
        </div>
      </Panel>

      {/* No settings-file editor. It was the one place left where somebody
          could paste an API key, and its own hint said so — "API keys, MCP
          servers, extra agents". This is a consumer app: the file is still
          there, still hand-editable by anybody who wants to, and the path to
          it is above. Putting a YAML textarea in front of everyone else is
          how a laptop ends up not starting. */}
    </>
  )
}

function Row({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-[var(--fg-dim)]">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2">
        {/* A path long enough to truncate is a path worth being able to copy. */}
        <span className="min-w-0 truncate" title={value}>
          <Mono>{value}</Mono>
        </span>
        {copy && <CopyButton value={value} label="" />}
      </dd>
    </div>
  )
}
