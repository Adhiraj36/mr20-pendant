// First run.
//
// Five screens at most, and the order is the argument. Signing in to LYZN
// comes first because it decides whether the rest is worth doing at all: this
// app is the half of LYZN that carries out what you approved, and carrying it
// out is part of the Act plan. Somebody on Capture should find that out in
// twenty seconds, not after installing a coding assistant.
//
// Nobody is asked for an API key, a model, an endpoint or a budget anywhere on
// this path. That is a product decision rather than an oversight: the backup
// brain is LYZN's to arrange, and a person setting up a laptop is not going to
// paste a key into it.
//
// The engine step is here rather than buried in Settings because "run it on
// the machine that never sleeps" is a choice worth offering while somebody is
// still deciding what this app is, not a preference to discover later.
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  Download,
  ExternalLink,
  Laptop,
  RefreshCw,
  Server,
  Sparkles,
} from 'lucide-react'
import type { EnvCheck, PlanView, RemoteEngine, SetupState } from '@shared/types'
import { Button, Field, Input, Panel, Select, StatusDot } from '@/components/ui'
import { PairFlow } from '@/routes/apps/PairFlow'
import { cn } from '@/lib/util'

/** The tiers that carry automation. Named here so the copy can say which. */
const ACT_TIERS = 'Act or Act Pro'

type Step = 'signin' | 'name' | 'engine' | 'brain' | 'done'

export default function Setup({
  state,
  onDone,
  signInOnly,
}: {
  state: SetupState
  onDone: () => void
  /** Everything else is already configured and only the sign-in is missing —
   *  somebody who signed out, or whose pairing was revoked from the phone.
   *  Walking them through the name and the brain again would be asking
   *  questions they have already answered. */
  signInOnly?: boolean
}) {
  const [at, setAt] = useState<Step>('signin')
  const [name, setName] = useState('LYZN')
  const [orchestrator, setOrchestrator] = useState<'claude' | 'codex'>('claude')
  const [checks, setChecks] = useState<EnvCheck[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState<'claude' | 'codex' | null>(null)

  // -- LYZN --------------------------------------------------------------
  const [code, setCode] = useState('')
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)

  // -- where the engine runs ---------------------------------------------
  const [engine, setEngine] = useState<RemoteEngine | null>(null)
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void window.karmax.lyzn.pairing().then((p) => {
      if (!p.paired) return
      setSignedIn(true)
      setPlan(p.plan ?? null)
    })
    void window.karmax.engine.get().then(setEngine)
  }, [])

  const scan = () => {
    setChecks(null)
    void window.karmax.host.environment().then(setChecks)
  }

  const remote = Boolean(engine?.enabled)
  // The brain is this machine's business. When the engine is somewhere else,
  // so is its coding assistant, and asking about one here would be asking
  // about the wrong computer.
  const steps: Step[] = signInOnly
    ? ['signin']
    : remote
      ? ['signin', 'name', 'engine', 'done']
      : ['signin', 'name', 'engine', 'brain', 'done']
  const index = Math.max(0, steps.indexOf(at))
  const go = (delta: number) => {
    const next = steps[Math.min(steps.length - 1, Math.max(0, index + delta))]
    setAt(next)
    if (next === 'brain' && checks === null) scan()
  }

  const brain = checks?.find((c) => c.id === orchestrator)
  // Only an explicit no is a no. A LYZN that does not send a plan — an older
  // one, or one having a bad minute — has not refused anything, and treating
  // silence as a refusal would lock somebody out of an app they paid for. The
  // work endpoints enforce the real gate either way.
  const allowed = plan ? plan.automation : true

  async function signIn() {
    setBusy(true)
    setSignInError(null)
    try {
      const r = await window.karmax.lyzn.pair(code)
      if (!r.ok) {
        setSignInError(r.error ?? 'That code was not accepted.')
        return
      }
      setSignedIn(true)
      setPlan(r.plan ?? null)
      setCode('')
      // Nothing else to ask: back to the app.
      if (signInOnly && r.plan?.automation !== false) onDone()
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    setBusy(true)
    try {
      if (engine) await window.karmax.engine.set(engine)
      await window.karmax.setup.complete({ name, orchestrator })
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-8 pb-10">
      <div className="w-full max-w-[560px]">
        <div className="mb-6 flex items-center gap-2">
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn(
                'h-[3px] flex-1 transition-colors duration-300',
                i <= index ? 'bg-[var(--accent)]' : 'bg-[var(--skin-3)]',
              )}
            />
          ))}
        </div>

        {/* ── sign in ─────────────────────────────────────────────────── */}
        {at === 'signin' && (
          <Panel className="p-8">
            <Sparkles size={22} className="mb-4 text-[var(--accent)]" />
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em]">
              Sign in to LYZN.
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--fg-dim)]">
              LYZN hears what you promise and writes it down. This app is the half that keeps it —
              on this machine, with your files and the accounts you are already signed in to.
            </p>

            {!signedIn ? (
              <>
                <p className="mt-4 text-[13.5px] leading-relaxed text-[var(--fg-dim)]">
                  In the LYZN app on your phone:{' '}
                  <strong className="font-medium text-[var(--fg)]">
                    Settings → Laptop daemon → Pair a laptop
                  </strong>
                  . It shows six characters, good for five minutes.
                </p>
                <div className="mt-4">
                  <Field label="The six characters">
                    <Input
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value.toUpperCase())
                        setSignInError(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && code.trim()) void signIn()
                      }}
                      placeholder="K7QD2M"
                      spellCheck={false}
                      autoFocus
                      className="font-mono uppercase tracking-[0.3em]"
                    />
                  </Field>
                </div>
                {signInError && (
                  <p className="mb-3 text-[12.5px] text-[var(--bad)]">{signInError}</p>
                )}
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="primary"
                    size="lg"
                    busy={busy}
                    disabled={!code.trim()}
                    onClick={() => void signIn()}
                  >
                    Sign in
                  </Button>
                </div>
              </>
            ) : allowed ? (
              <>
                <p className="mt-4 flex items-center gap-2 text-[13px] text-[var(--ok)]">
                  <BadgeCheck size={15} />
                  Signed in{plan?.tier ? ` on ${plan.tier === 'act-pro' ? 'Act Pro' : 'Act'}` : ''}. This
                  machine can carry out what you approve.
                </p>
                <div className="mt-6 flex justify-end">
                  <Button variant="primary" size="lg" icon={<ArrowRight size={16} />} onClick={() => go(1)}>
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              // Signed in, and the plan does not carry automation. There is
              // nothing to set up: this whole app is the thing they have not
              // bought, and saying so plainly beats letting them install a
              // coding assistant first and find out at the end.
              <div className="mt-4 border border-[var(--warn)]/30 bg-[var(--warn-skin)] px-4 py-3.5">
                <p className="flex items-center gap-2 text-[13px] font-medium">
                  <CircleAlert size={15} style={{ color: 'var(--warn)' }} />
                  This account cannot use a laptop yet
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-dim)]">
                  {plan?.why ?? 'Your plan does not include automatic execution.'} Carrying work out
                  on your own machine comes with {ACT_TIERS}
                  {plan?.tier && plan.tier !== 'none' ? `, and this account is on ${plan.tier}` : ''}.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<ExternalLink size={13} />}
                    onClick={() => void window.karmax.app.openExternal('https://lyzn.ai/#pricing')}
                  >
                    See the plans
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RefreshCw size={13} />}
                    onClick={() => {
                      void window.karmax.lyzn.pairing().then((p) => setPlan(p.plan ?? null))
                    }}
                  >
                    Check again
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        )}

        {/* ── the name ────────────────────────────────────────────────── */}
        {at === 'name' && (
          <Panel className="p-8">
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
              What should it be called?
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--fg-dim)]">
              The name it answers to. You can change it later.
            </p>

            <div className="mt-5">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="LYZN" autoFocus />
              </Field>
            </div>

            {state.foreignDaemon && (
              <p className="mt-3 border border-[var(--warn)]/30 bg-[var(--warn-skin)] px-3.5 py-3 text-[12.5px] text-[var(--fg-dim)]">
                Heads up: {state.foreignDaemon.detail} If that is another copy of LYZN, this app
                will leave it alone — it keeps its own settings and its own data, in a separate
                folder.
              </p>
            )}

            <div className="mt-6 flex justify-between">
              <Button variant="ghost" onClick={() => go(-1)}>
                Back
              </Button>
              <Button variant="primary" icon={<ArrowRight size={16} />} onClick={() => go(1)}>
                Continue
              </Button>
            </div>
          </Panel>
        )}

        {/* ── where the engine runs ───────────────────────────────────── */}
        {at === 'engine' && engine && (
          <Panel className="p-8">
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
              Where should the work happen?
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--fg-dim)]">
              This window is the controls. The engine is what does the work, and it does not have
              to be on this computer.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Choice
                icon={<Laptop size={17} />}
                title="On this machine"
                body="LYZN runs the engine here and looks after it — starting it, keeping it alive, keeping its log."
                chosen={!engine.enabled}
                onClick={() => {
                  setEngine({ ...engine, enabled: false })
                  setTested(null)
                }}
              />
              <Choice
                icon={<Server size={17} />}
                title="On another machine"
                body="A computer that never sleeps, somewhere on your network. This window watches it."
                chosen={engine.enabled}
                onClick={() => {
                  setEngine({ ...engine, enabled: true })
                  setTested(null)
                }}
              />
            </div>

            {engine.enabled && (
              <div className="mt-5 border-t pt-4">
                <Field label="Address" hint="A hostname or an IP on your own network.">
                  <Input
                    value={engine.host}
                    onChange={(e) => {
                      setEngine({ ...engine, host: e.target.value })
                      setTested(null)
                    }}
                    placeholder="192.168.1.20"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="That machine's key"
                  hint="LYZN on that computer shows it under Settings → Engine. It is what stops anyone else on the network driving it."
                >
                  <Input
                    type="password"
                    value={engine.token}
                    onChange={(e) => {
                      setEngine({ ...engine, token: e.target.value })
                      setTested(null)
                    }}
                    placeholder="kmx_…"
                    spellCheck={false}
                  />
                </Field>
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw size={13} />}
                    onClick={async () => {
                      const r = await window.karmax.engine.test(engine)
                      setTested({
                        ok: r.ok,
                        text: r.ok ? `Found it${r.version ? ` — ${r.version}` : ''}.` : (r.error ?? 'No answer.'),
                      })
                    }}
                  >
                    Test it
                  </Button>
                  {tested && (
                    <span
                      className="text-[12.5px]"
                      style={{ color: tested.ok ? 'var(--ok)' : 'var(--bad)' }}
                    >
                      {tested.text}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <Button variant="ghost" onClick={() => go(-1)}>
                Back
              </Button>
              <Button
                variant="primary"
                icon={<ArrowRight size={16} />}
                disabled={engine.enabled && !engine.host.trim()}
                onClick={() => go(1)}
              >
                Continue
              </Button>
            </div>
          </Panel>
        )}

        {/* ── the brain ───────────────────────────────────────────────── */}
        {at === 'brain' && (
          <Panel className="p-8">
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
              Pick the brain.
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--fg-dim)]">
              The thinking happens inside a coding assistant on this machine. LYZN keeps one
              running as a long conversation, which is why it answers in about a second instead of
              fifteen.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {(['claude', 'codex'] as const).map((id) => {
                const check = checks?.find((c) => c.id === id)
                return (
                  <button
                    key={id}
                    onClick={() => setOrchestrator(id)}
                    className={cn(
                      'border p-4 text-left transition duration-200',
                      orchestrator === id
                        ? 'border-[var(--accent)] bg-[var(--skin-2)]'
                        : 'bg-[var(--skin-1)] hover:border-[var(--edge-strong)]',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <StatusDot tone={check ? (check.ok ? 'ok' : 'bad') : 'idle'} />
                      <span className="text-[13.5px] font-medium">
                        {id === 'claude' ? 'Claude Code' : 'Codex'}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-[12px] text-[var(--fg-dim)]">
                      {check ? (check.ok ? check.detail : 'Not installed') : 'Checking…'}
                    </span>
                  </button>
                )
              })}
            </div>

            {brain && !brain.ok && (
              <div className="mt-4 border border-[var(--warn)]/30 bg-[var(--warn-skin)] px-4 py-3.5">
                <p className="flex items-center gap-2 text-[13px] font-medium">
                  <CircleAlert size={15} style={{ color: 'var(--warn)' }} />
                  {brain.name} is not installed yet
                </p>
                {brain.installable ? (
                  <>
                    <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">
                      LYZN can put it there for you. It takes a minute, and you will be asked to
                      sign in to it afterwards.
                    </p>
                    <Button
                      size="sm"
                      variant="primary"
                      className="mt-3"
                      icon={<Download size={13} />}
                      onClick={() => setInstalling(orchestrator)}
                    >
                      Install {brain.name}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">
                      {brain.needs
                        ? `Installing it here needs ${brain.needs} on this machine first. You can finish now and install it afterwards — LYZN will start using it the moment it appears.`
                        : 'You can finish now and install it afterwards — LYZN will start using it the moment it appears.'}
                    </p>
                    {brain.installUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-3"
                        icon={<ExternalLink size={13} />}
                        onClick={() => void window.karmax.app.openExternal(brain.installUrl!)}
                      >
                        Installation guide
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}

            {brain?.ok && (
              <p className="mt-4 flex items-center gap-2 text-[13px] text-[var(--ok)]">
                <BadgeCheck size={15} />
                Found it. This is what will do the thinking.
              </p>
            )}

            <div className="mt-6 flex items-center justify-between">
              <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={scan}>
                Check again
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => go(-1)}>
                  Back
                </Button>
                <Button variant="primary" icon={<ArrowRight size={16} />} onClick={() => go(1)}>
                  Continue
                </Button>
              </div>
            </div>
          </Panel>
        )}

        {/* ── done ────────────────────────────────────────────────────── */}
        {at === 'done' && (
          <Panel className="p-8">
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
              That is everything.
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--fg-dim)]">
              {remote
                ? 'This window will watch the engine on the other machine. Work you approve in the LYZN app appears under Tasks, and each one that finishes prints a receipt.'
                : 'LYZN keeps its own folder on this machine and starts when you do. Work you approve in the app appears under Tasks, and each one that finishes prints a receipt.'}
            </p>

            <Field label="Where it keeps its data" hint="Its own folder, kept apart from anything else on this machine.">
              <Select
                value="profile"
                onChange={() => {}}
                options={[{ value: 'profile', label: state.profileDir }]}
              />
            </Field>

            <div className="mt-6 flex justify-between">
              <Button variant="ghost" onClick={() => go(-1)}>
                Back
              </Button>
              <Button variant="primary" size="lg" busy={busy} onClick={() => void finish()}>
                Finish and start
              </Button>
            </div>
          </Panel>
        )}
      </div>

      {installing && (
        <PairFlow
          open
          onClose={() => {
            setInstalling(null)
            scan()
          }}
          action={installing === 'claude' ? 'install.claude' : 'install.codex'}
          title={`Install ${installing === 'claude' ? 'Claude Code' : 'Codex'}`}
          lede="LYZN is putting it on this machine so you do not have to."
          instructions="This runs the official installer. When it finishes, sign in to it once and LYZN will use it from then on."
          onFinished={() => scan()}
        />
      )}
    </div>
  )
}

/** One of two big choices, picked by clicking the whole thing. */
function Choice({
  icon,
  title,
  body,
  chosen,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  body: string
  chosen: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'border p-4 text-left transition duration-200',
        chosen
          ? 'border-[var(--accent)] bg-[var(--skin-2)]'
          : 'bg-[var(--skin-1)] hover:border-[var(--edge-strong)]',
      )}
    >
      <span className={cn('block', chosen ? 'text-[var(--accent)]' : 'text-[var(--fg-faint)]')}>
        {icon}
      </span>
      <span className="mt-2 block text-[13.5px] font-medium">{title}</span>
      <span className="mt-1 block text-[12px] leading-relaxed text-[var(--fg-dim)]">{body}</span>
    </button>
  )
}
