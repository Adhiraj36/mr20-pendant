// Loops: the standing work this machine does without being asked.
//
// Two halves. What is running is a timetable — a ruled row per loop across the
// hours of today, with a line for now — because what a person wants to know
// about a loop is when it last went and when it goes next. Under it, the
// registry: loops somebody has already written, to read before installing and
// to install in one step.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, Check, ExternalLink, FileText, Plus, RefreshCw, Search } from 'lucide-react'
import type { ActiveLoop, Automation, DaemonStatus, LoopHealth, RegistryDetail, RegistryEntry } from '@shared/types'
import { Spinner } from '@/components/ui'
import { Modal, useToast } from '@/components/Overlays'
import { ago, cn, cronForDaily } from '@/lib/util'
import { CodeBlock } from '@/routes/chat/Markdown'
import { DayRail, HourRuler } from '@/routes/loops/DayRail'
import { Editor } from '@/routes/loops/Editor'
import { serviceOf, titleOf } from '@/routes/loops/names'
import { describe, nextIn, parseTrigger, scheduleOf, type Schedule } from '@/routes/loops/schedule'

type Row = {
  name: string
  kind: string
  description: string
  schedule: Schedule
  enabled: boolean
  running: boolean
  dark: boolean
  lastRun: string | null
  lastError: string
  /** Written in the settings file, so editable here. */
  own?: Automation
}

const KIND: Record<string, string> = { recipe: 'Recipe', workflow: 'Workflow', compiled: 'Built in', prompt: 'Yours' }
const kindLabel = (k?: string) => (k ? (KIND[k] ?? k.charAt(0).toUpperCase() + k.slice(1)) : 'Built in')
const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? ''

const EVENTS: Record<string, string> = {
  'comms.message': 'each new message',
  'whatsapp.message': 'each WhatsApp message',
}

/** What wakes a loop: its schedule, or the events it listens for. */
function wakeOf(l: ActiveLoop | undefined, now: Date): Schedule {
  if (l?.schedule?.trim()) return parseTrigger(l.schedule, now)
  if (l?.events?.length) return { kind: 'event', text: l.events.map((e) => EVENTS[e] ?? e).join(', ') }
  if (l?.webhook) return { kind: 'event', text: 'a webhook call' }
  return { kind: 'unknown', text: '' }
}

const stamp = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** The later of its last success and last failure — the health report keeps
 *  the two apart, and "last ran" is whichever happened most recently. */
function lastRunOf(h: LoopHealth | null | undefined): string | null {
  const ok = stamp(h?.last_success)
  const bad = stamp(h?.last_failure)
  if (!ok || !bad) return ok ?? bad ?? stamp(h?.last_run)
  return Date.parse(ok) >= Date.parse(bad) ? ok : bad
}

/** Failing now, not merely failed once: a later success clears it. */
const failingOf = (h: LoopHealth | null | undefined) =>
  (h?.consecutive_failures ?? 0) > 0 && typeof h?.last_error === 'string' ? h.last_error : ''

function useNow(every: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), every)
    return () => clearInterval(t)
  }, [every])
  return now
}

/** One row per loop, from the file that defines some of them and the engine
 *  that runs all of them — neither alone is the whole list. */
function rowsOf(automations: Automation[], active: ActiveLoop[] | null, entries: RegistryEntry[], now: Date): Row[] {
  const live = new Map((active ?? []).map((l) => [l.name, l]))
  const about = new Map(entries.map((e) => [e.name, e.description]))
  const rows: Row[] = []
  const seen = new Set<string>()

  for (const a of automations) {
    const l = live.get(a.name)
    const h = a.health
    seen.add(a.name)
    rows.push({
      name: a.name,
      kind: a.builtin ? kindLabel(l?.kind) : 'Yours',
      description: l?.description || about.get(a.name) || (a.builtin ? '' : firstLine(a.prompt)),
      schedule: a.builtin ? wakeOf(l, now) : scheduleOf(a.cron, a.every, now),
      enabled: l?.enabled ?? a.enabled,
      running: Boolean(h?.running),
      dark: Boolean(h?.dark),
      lastRun: lastRunOf(h),
      lastError: failingOf(h),
      own: a.builtin ? undefined : a,
    })
  }
  for (const l of active ?? []) {
    if (seen.has(l.name)) continue
    rows.push({
      name: l.name,
      kind: kindLabel(l.kind),
      description: l.description || about.get(l.name) || '',
      schedule: wakeOf(l, now),
      enabled: l.enabled ?? true,
      running: false,
      dark: false,
      lastRun: null,
      lastError: '',
    })
  }

  // Soonest first; a loop that is paused or waiting on something sinks.
  const minute = now.getHours() * 60 + now.getMinutes()
  const rank = (r: Row) => (!r.enabled ? 2e6 : r.dark ? 1e6 : 0) + Math.min(nextIn(r.schedule, minute), 5e5)
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

function statusOf(r: Row): { text: string; tone: 'live' | 'ok' | 'bad' | 'idle' } {
  if (!r.enabled) return { text: 'Paused', tone: 'idle' }
  if (r.running) return { text: 'Running now', tone: 'live' }
  if (r.dark) return { text: 'Has not worked in a while', tone: 'bad' }
  if (r.lastError) return { text: 'Last run failed', tone: 'bad' }
  if (r.lastRun) return { text: `Ran ${ago(r.lastRun)}`, tone: 'ok' }
  return { text: 'Not run yet', tone: 'idle' }
}

function Dot({ tone }: { tone: 'live' | 'ok' | 'bad' | 'idle' }) {
  if (tone === 'live') {
    return (
      <span className="relative flex size-[6px] shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-60" />
        <span className="relative size-[6px] rounded-full bg-[var(--accent)]" />
      </span>
    )
  }
  const colour = tone === 'ok' ? 'var(--ok)' : tone === 'bad' ? 'var(--bad)' : 'var(--fg-faint)'
  return <span className="size-[6px] shrink-0 rounded-full" style={{ background: colour }} />
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="flex items-baseline gap-2.5 text-[22px] font-extrabold tracking-[-0.02em]">
      {title}
      {count !== undefined && count > 0 && (
        <span className="font-mono text-[11px] font-normal tracking-normal text-[var(--fg-faint)]">{count}</span>
      )}
    </h2>
  )
}

function TimetableRow({
  row,
  now,
  engineUp,
  busy,
  onRun,
  onToggle,
  onEdit,
  onRemove,
  onAbout,
}: {
  row: Row
  now: Date
  engineUp: boolean
  busy: boolean
  onRun: () => void
  onToggle: () => void
  onEdit?: () => void
  onRemove?: () => void
  onAbout?: () => void
}) {
  const status = statusOf(row)
  return (
    <div className={cn('lz-table-row group', !row.enabled && 'lz-row-paused')}>
      <div className="min-w-0 py-3.5 pr-4 pl-5">
        <div className="flex items-baseline gap-2.5">
          {onAbout ? (
            <button
              type="button"
              onClick={onAbout}
              className="truncate text-left text-[15px] font-bold tracking-[-0.01em] underline-offset-4 hover:underline"
            >
              {row.name}
            </button>
          ) : (
            <span className="truncate text-[15px] font-bold tracking-[-0.01em]">{row.name}</span>
          )}
          <span className="shrink-0 font-mono text-[9.5px] text-[var(--fg-faint)]">{row.kind}</span>
        </div>
        {row.description && (
          <p className="mt-0.5 truncate text-[12.5px] text-[var(--fg-dim)]" title={row.description}>
            {row.description}
          </p>
        )}
        <p className="mt-2 flex min-w-0 items-center gap-2 font-mono text-[10px] text-[var(--fg-faint)]">
          <Dot tone={status.tone} />
          <span
            className={cn('shrink-0', status.tone === 'bad' && 'text-[var(--bad)]', status.tone === 'live' && 'text-[var(--accent)]')}
            title={row.lastError || undefined}
          >
            {status.text}
          </span>
          <span className="truncate">{describe(row.schedule)}</span>
        </p>
      </div>

      <DayRail schedule={row.schedule} now={now} paused={!row.enabled} />

      <div className="flex items-center justify-end gap-0.5 pr-3 pl-2">
        <button
          type="button"
          className="lz-text-btn"
          disabled={!engineUp || busy || !row.enabled}
          onClick={onRun}
          title={engineUp ? 'Run it once, now' : 'Start the engine first'}
        >
          {busy ? 'Running' : 'Run'}
        </button>
        <button type="button" className="lz-text-btn" onClick={onToggle}>
          {row.enabled ? 'Pause' : 'Resume'}
        </button>
        {onEdit && (
          <button type="button" className="lz-text-btn" onClick={onEdit}>
            Edit
          </button>
        )}
        {onRemove && (
          <button type="button" className="lz-text-btn lz-text-btn-bad" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function LoopCard({ entry, onOpen }: { entry: RegistryEntry; onOpen: () => void }) {
  const workflow = entry.kind === 'workflow'
  const needs = [...new Set(entry.requires.map(serviceOf))]
  const update = entry.installed && entry.installedVersion && entry.installedVersion !== entry.version
  return (
    <article className={cn('lz-loop-card', workflow && 'lz-loop-card-workflow')}>
      <button type="button" className="lz-loop-card-hit" onClick={onOpen} aria-label={`About ${titleOf(entry.name)}`} />
      <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--fg-faint)]">
        {workflow ? <Boxes size={12} /> : <FileText size={12} />}
        <span>{workflow ? 'Workflow' : 'Recipe'}</span>
        <span className="ml-auto">v{entry.version}</span>
      </div>
      <h3 className="mt-5 text-[23px] leading-[1.04] font-extrabold tracking-[-0.03em]">{titleOf(entry.name)}</h3>
      <p className="mt-1.5 font-mono text-[10px] text-[var(--fg-faint)]">{entry.name}</p>
      <p className="mt-3.5 line-clamp-3 text-[13.5px] leading-[1.55] text-[var(--fg-dim)]">{entry.description}</p>
      {needs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {needs.map((n) => (
            <span key={n} className="lz-need">
              {n}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center gap-3 border-t border-dashed border-[var(--edge)] pt-3.5">
        <span className="font-mono text-[10px] text-[var(--fg-faint)]">by {entry.author}</span>
        <span className="ml-auto" />
        {update ? (
          <span className="font-mono text-[10.5px] text-[var(--accent)]">Update to {entry.version}</span>
        ) : entry.installed ? (
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-[var(--ok)]">
            <Check size={12} strokeWidth={2.5} />
            {entry.active ? 'Running' : 'Installed'}
          </span>
        ) : (
          <span className="lz-btn lz-btn-small">Install</span>
        )}
      </div>
    </article>
  )
}

function LoopDetail({
  entry,
  engineUp,
  onClose,
  onChanged,
}: {
  entry: RegistryEntry
  engineUp: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const now = useNow(60_000)
  const [detail, setDetail] = useState<RegistryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'install' | 'remove' | 'restart' | null>(null)
  const [untrusted, setUntrusted] = useState(false)
  const [typed, setTyped] = useState('')
  const [restart, setRestart] = useState(false)

  useEffect(() => {
    let alive = true
    void window.karmax.loops.detail(entry.name).then((res) => {
      if (!alive) return
      if (res.ok && res.data) setDetail(res.data)
      else setError(res.status === 404 ? 'This engine cannot read the registry yet.' : (res.error ?? 'The registry could not be read just now.'))
    })
    return () => {
      alive = false
    }
  }, [entry.name])

  const current = detail?.entry ?? entry
  const workflow = current.kind === 'workflow'
  const schedule = parseTrigger(detail?.trigger ?? '', now)
  const reach = [...new Set([...current.requires, ...(detail?.tools ?? [])].map(serviceOf))]
  const update = current.installed && current.installedVersion && current.installedVersion !== current.version

  const install = async (allowUntrusted: boolean) => {
    setBusy('install')
    try {
      const res = await window.karmax.loops.install(current.name, allowUntrusted)
      if (res.ok) {
        toast(res.data?.message || `Installed ${titleOf(current.name)}.`, 'ok')
        setUntrusted(false)
        onChanged()
        if (res.data?.restartRequired) setRestart(true)
        else onClose()
      } else if (res.data?.untrusted) {
        setUntrusted(true)
      } else {
        toast(
          res.status === 404 ? 'This engine cannot install from the registry yet. Update LYZN Daemon.' : (res.error ?? 'It did not install.'),
          'bad',
        )
      }
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('remove')
    try {
      const res = await window.karmax.loops.uninstall(current.name)
      if (res.ok) {
        toast(`Removed ${titleOf(current.name)}.`, 'ok')
        onChanged()
        if (res.data?.restartRequired) setRestart(true)
        else onClose()
      } else {
        toast(res.error ?? 'It could not be removed.', 'bad')
      }
    } finally {
      setBusy(null)
    }
  }

  const restartEngine = async () => {
    setBusy('restart')
    try {
      await window.karmax.daemon.restart()
      toast('The engine restarted.', 'ok')
      onChanged()
      onClose()
    } finally {
      setBusy(null)
    }
  }

  const footer = (
    <div className="flex w-full items-center gap-2">
      {current.installed && !current.shipsWithEngine && !restart && (
        <button type="button" className="lz-btn lz-btn-outline" disabled={busy !== null} onClick={() => void remove()}>
          {busy === 'remove' ? 'Removing' : 'Uninstall'}
        </button>
      )}
      {current.shipsWithEngine && (
        <span className="font-mono text-[10.5px] text-[var(--fg-faint)]">Comes with the engine</span>
      )}
      <span className="ml-auto" />
      <button type="button" className="lz-btn lz-btn-outline" onClick={onClose}>
        Close
      </button>
      {restart ? (
        <button type="button" className="lz-btn" disabled={busy !== null || !engineUp} onClick={() => void restartEngine()}>
          {busy === 'restart' ? 'Restarting' : 'Restart the engine'}
        </button>
      ) : untrusted ? (
        <button
          type="button"
          className="lz-btn"
          disabled={typed.trim() !== current.name || busy !== null}
          onClick={() => void install(true)}
        >
          {busy === 'install' ? 'Installing' : 'Install anyway'}
        </button>
      ) : !current.installed || update ? (
        <button
          type="button"
          className="lz-btn"
          disabled={busy !== null || !engineUp || !detail}
          title={engineUp ? undefined : 'Start the engine first'}
          onClick={() => void install(false)}
        >
          {busy === 'install' ? 'Installing' : update ? `Update to ${current.version}` : 'Install'}
        </button>
      ) : (
        <span className="flex items-center gap-1.5 px-2 font-mono text-[10.5px] text-[var(--ok)]">
          <Check size={12} strokeWidth={2.5} />
          {current.active ? 'Installed and running' : 'Installed'}
        </span>
      )}
    </div>
  )

  return (
    <Modal open xl onClose={onClose} title={titleOf(current.name)} footer={footer}>
      {untrusted && (
        <div className="lz-warn mb-7">
          <p className="text-[14px] font-semibold">Nobody you trust has reviewed this workflow.</p>
          <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed">
            Install it only if you know who wrote it. To go ahead, type its name.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={current.name}
            spellCheck={false}
            aria-label="Type the loop's name to install it"
            className="lz-field mt-3 w-[260px]"
          />
        </div>
      )}
      <div className="grid gap-9 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-7">
          <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono text-[10.5px] text-[var(--fg-faint)]">
            <span className="text-[var(--fg-dim)]">{current.name}</span>
            <span>v{current.version}</span>
            <span>{workflow ? 'Workflow' : 'Recipe'}</span>
            <span>by {current.author}</span>
          </p>
          <p className="text-[15px] leading-relaxed">{current.description}</p>

          <section>
            <h4 className="lz-h4">When it runs</h4>
            {detail ? (
              <>
                {(schedule.kind === 'times' || schedule.kind === 'every' || schedule.kind === 'event') && (
                  <div className="lz-mini-rail">
                    <HourRuler now={now} compact />
                    <DayRail schedule={schedule} now={now} />
                  </div>
                )}
                <p className="mt-2.5 text-[13.5px] text-[var(--fg-dim)]">
                  {schedule.kind === 'unknown' ? detail.trigger || 'When something asks it to run' : describe(schedule)}
                </p>
              </>
            ) : error ? (
              <p className="text-[13px] text-[var(--fg-faint)]">Not known until the registry answers.</p>
            ) : (
              <Spinner />
            )}
          </section>

          {reach.length > 0 && (
            <section>
              <h4 className="lz-h4">What it can reach</h4>
              <div className="flex flex-wrap gap-1.5">
                {reach.map((r) => (
                  <span key={r} className="lz-need">
                    {r}
                  </span>
                ))}
              </div>
              {detail && detail.tools.length > 0 && (
                <p className="selectable mt-3 font-mono text-[10.5px] leading-[1.9] break-words text-[var(--fg-faint)]">
                  {detail.tools.join('   ')}
                </p>
              )}
            </section>
          )}

          <section>
            <h4 className="lz-h4">How it installs</h4>
            <p className="text-[13.5px] leading-relaxed text-[var(--fg-dim)]">
              {workflow
                ? 'Sandboxed code that can use only what it lists. It starts after the engine restarts.'
                : 'One file the engine reads and follows. It starts straight away, with no restart.'}
            </p>
          </section>

          {current.sourceUrl && (
            <button
              type="button"
              onClick={() => void window.karmax.app.openExternal(current.sourceUrl!)}
              className="flex items-center gap-1.5 font-mono text-[10.5px] text-[var(--fg-dim)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
            >
              Read the source
              <ExternalLink size={11} />
            </button>
          )}
        </div>

        <div className="min-w-0">
          <h4 className="lz-h4">{workflow ? 'The manifest' : 'The recipe'}</h4>
          {detail ? (
            <CodeBlock code={detail.definition} lang="yaml" maxHeight={470} />
          ) : error ? (
            <p className="text-[13px] text-[var(--bad)]">{error}</p>
          ) : (
            <Spinner />
          )}
        </div>
      </div>

    </Modal>
  )
}

type KindFilter = 'all' | 'recipe' | 'workflow'

export default function Loops({ status }: { status: DaemonStatus | null }) {
  const toast = useToast()
  const engineUp = status?.state === 'running'
  const now = useNow(30_000)
  const [automations, setAutomations] = useState<Automation[] | null>(null)
  const [active, setActive] = useState<ActiveLoop[] | null>(null)
  const [entries, setEntries] = useState<RegistryEntry[]>([])
  const [registryState, setRegistryState] = useState<'loading' | 'ready' | 'old-engine' | 'failed'>('loading')
  const [registryError, setRegistryError] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<RegistryEntry | null>(null)
  const [editing, setEditing] = useState<{ draft: Automation; previousName?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const loadLocal = useCallback(async () => {
    const [a, l] = await Promise.all([
      window.karmax.automations.list().catch(() => [] as Automation[]),
      window.karmax.loops.active().catch(() => null),
    ])
    setAutomations(a)
    setActive(l)
  }, [])

  const loadRegistry = useCallback(async (refresh = false) => {
    setRegistryState((s) => (s === 'ready' ? s : 'loading'))
    const res = await window.karmax.loops.registry(refresh).catch(() => null)
    if (res?.ok && res.data) {
      setEntries(res.data.entries)
      setRegistryState('ready')
    } else if (res?.status === 404) {
      setRegistryState('old-engine')
    } else {
      setRegistryError(res?.error ?? '')
      setRegistryState('failed')
    }
  }, [])

  useEffect(() => {
    void loadLocal()
    const t = setInterval(() => void loadLocal(), 30_000)
    return () => clearInterval(t)
  }, [loadLocal, engineUp])

  useEffect(() => {
    void loadRegistry()
  }, [loadRegistry, engineUp])

  const rows = useMemo(() => rowsOf(automations ?? [], active, entries, now), [automations, active, entries, now])

  const shown = entries
    .filter((e) => kind === 'all' || e.kind === kind)
    .filter((e) => {
      const q = query.trim().toLowerCase()
      return !q || `${e.name} ${titleOf(e.name)} ${e.description} ${e.requires.join(' ')}`.toLowerCase().includes(q)
    })
    // What you do not have yet first: that is what exploring is for.
    .sort((a, b) => Number(a.installed) - Number(b.installed) || a.name.localeCompare(b.name))

  const run = async (name: string) => {
    setBusy(name)
    try {
      const res = await window.karmax.automations.runNow(name)
      toast(res.ok ? `${name} ran.` : (res.error ?? 'That did not run.'), res.ok ? 'ok' : 'bad')
      void loadLocal()
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (row: Row) => {
    if (row.own) {
      setAutomations(await window.karmax.automations.save({ ...row.own, enabled: !row.enabled }, row.name))
      toast(`${row.enabled ? 'Paused' : 'Resumed'} ${row.name}. Restart the engine to apply it.`, 'ok')
      return
    }
    const res = await window.karmax.loops.setEnabled(row.name, !row.enabled)
    if (res.ok) {
      const later = res.data?.restartRequired ? ' It takes effect when the engine restarts.' : ''
      toast(`${row.enabled ? 'Paused' : 'Resumed'} ${row.name}.${later}`, 'ok')
      void loadLocal()
    } else {
      toast(res.status === 404 ? 'This engine cannot pause loops yet.' : (res.error ?? 'That did not change.'), 'bad')
    }
  }

  const blank: Automation = { name: '', cron: cronForDaily(9, 0), every: '', prompt: '', harness: '', enabled: true }
  const counts = { recipe: entries.filter((e) => e.kind === 'recipe').length, workflow: entries.filter((e) => e.kind === 'workflow').length }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1120px] px-10 pt-5 pb-20">
          <header className="mb-11 flex items-end justify-between gap-6">
            <div>
              <h1 className="lz-title">Loops</h1>
              <p className="mt-2.5 max-w-[58ch] text-[14.5px] leading-relaxed text-[var(--fg-dim)]">
                Work this machine does without being asked, on a timetable or whenever something happens.
              </p>
            </div>
            <button type="button" className="lz-btn lz-btn-outline" onClick={() => setEditing({ draft: blank })}>
              <Plus size={12} />
              Write your own
            </button>
          </header>

          {!engineUp && (
            <p className="mb-8 border border-[var(--edge)] bg-[var(--skin-1)] px-4 py-3 text-[13px] text-[var(--fg-dim)]">
              The engine is stopped, so no loop runs until it starts. Start it from the Dashboard.
            </p>
          )}

          <section className="mb-16">
            <div className="mb-5 flex items-end justify-between gap-4">
              <SectionTitle title="Running" count={rows.filter((r) => r.enabled).length} />
              <span className="font-mono text-[10.5px] text-[var(--fg-faint)]">
                {now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
            </div>
            {automations === null ? (
              <Spinner />
            ) : rows.length === 0 ? (
              <p className="border-t border-[var(--edge)] pt-4 text-[14px] text-[var(--fg-faint)]">
                Nothing runs on its own yet. Install a loop below, or write your own.
              </p>
            ) : (
              <div className="lz-table">
                <div className="lz-table-row lz-table-head">
                  <span className="self-center pl-5 font-mono text-[10px] text-[var(--fg-faint)]">Today</span>
                  <HourRuler now={now} />
                  <span />
                </div>
                {rows.map((r) => {
                  const entry = entries.find((e) => e.name === r.name)
                  return (
                    <TimetableRow
                      key={r.name}
                      row={r}
                      now={now}
                      engineUp={engineUp}
                      busy={busy === r.name}
                      onRun={() => void run(r.name)}
                      onToggle={() => void toggle(r)}
                      onEdit={r.own ? () => setEditing({ draft: { ...r.own! }, previousName: r.name }) : undefined}
                      onRemove={
                        r.own
                          ? () =>
                              void window.karmax.automations.remove(r.name).then((next) => {
                                setAutomations(next)
                                toast(`Removed ${r.name}. Restart the engine to apply it.`, 'ok')
                              })
                          : undefined
                      }
                      onAbout={entry ? () => setOpen(entry) : undefined}
                    />
                  )
                })}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-end justify-between gap-4">
              <SectionTitle title="Explore" count={entries.length} />
              <button
                type="button"
                onClick={() => void loadRegistry(true)}
                aria-label="Check the registry again"
                title="Check the registry again"
                className="grid size-9 place-items-center border border-[var(--edge)] text-[var(--fg-faint)] transition-colors hover:border-[var(--fg)] hover:text-[var(--fg)]"
              >
                <RefreshCw size={14} className={cn(registryState === 'loading' && 'animate-spin')} />
              </button>
            </div>
            <p className="mb-7 max-w-[62ch] text-[14px] leading-relaxed text-[var(--fg-dim)]">
              Loops people have already written, from the open registry. Read what one does and what it can reach, then
              install it in one step.
            </p>

            {registryState === 'ready' && (
              <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                <div className="flex items-center gap-5" role="group" aria-label="Show loops">
                  {(
                    [
                      ['all', 'All'],
                      ['recipe', `Recipes ${counts.recipe}`],
                      ['workflow', `Workflows ${counts.workflow}`],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)} className="lz-filter">
                      {label}
                    </button>
                  ))}
                </div>
                <label className="lz-search ml-auto">
                  <Search size={13} className="shrink-0 text-[var(--fg-faint)]" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search loops"
                    aria-label="Search loops"
                    spellCheck={false}
                  />
                </label>
              </div>
            )}

            {registryState === 'loading' && entries.length === 0 ? (
              <Spinner />
            ) : registryState === 'old-engine' ? (
              <p className="border-t border-[var(--edge)] pt-4 text-[14px] text-[var(--fg-faint)]">
                This engine cannot browse the registry yet. Update LYZN Daemon to install loops from here.
              </p>
            ) : registryState === 'failed' ? (
              <p className="border-t border-[var(--edge)] pt-4 text-[14px] text-[var(--fg-faint)]">
                {engineUp
                  ? `The registry could not be reached${registryError ? `: ${registryError}` : ''}. Check this machine is online, then try again.`
                  : 'Start the engine to browse the registry.'}
              </p>
            ) : shown.length === 0 ? (
              <p className="border-t border-[var(--edge)] pt-4 text-[14px] text-[var(--fg-faint)]">
                No loop matches “{query.trim()}”.
              </p>
            ) : (
              <div className="lz-loop-grid">
                {shown.map((e) => (
                  <LoopCard key={e.name} entry={e} onOpen={() => setOpen(e)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {open && (
        <LoopDetail
          entry={open}
          engineUp={engineUp}
          onClose={() => setOpen(null)}
          onChanged={() => {
            void loadRegistry(true)
            void loadLocal()
          }}
        />
      )}

      {editing && (
        <Editor
          draft={editing.draft}
          previousName={editing.previousName}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setAutomations(next)
            setEditing(null)
            toast('Saved. Restart the engine on the Dashboard to apply it.', 'ok')
          }}
        />
      )}
    </div>
  )
}
