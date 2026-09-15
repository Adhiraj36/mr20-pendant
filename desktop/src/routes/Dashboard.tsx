// Dashboards: the Overview of what this machine is doing, and every dashboard an
// agent has built, each in its own tab and drawn in a sealed frame.
//
// A page inside a frame was written by an agent, so it gets nothing from this
// window except what the channel below hands it: data it asks for by name, the
// theme, and which dashboard it is. It cannot reach the app, the network or the
// engine's token, and the frame cannot navigate. The Overview is a kit page
// too, but starting and stopping the engine stay out here, as real buttons,
// because no page is allowed to take an action.
//
// Pinned dashboards come first. Archived ones leave the tabs and stop
// refreshing, and wait in the archive until they are restored or deleted —
// which is also the only place a delete happens, so it is never one click
// away from a tab someone is using.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CircleStop, FolderOpen, Pin, PinOff, Play, RotateCw } from 'lucide-react'
import type { DaemonStatus, DashboardMeta } from '@shared/types'
import type { Route } from '@/components/Chrome'
import { daemonTone } from '@/components/Chrome'
import { Modal, useToast } from '@/components/Overlays'
import { StatusDot } from '@/components/ui'
import { ago, cn } from '@/lib/util'

const DEFAULT_ID = '_default'
const TAB_KEY = 'lyzn.dashboard.tab'
const OPEN_EVENT = 'lyzn:open-dashboard'

/** Opens a dashboard's tab from elsewhere in the app, such as a card in Mira. */
export function openDashboard(id: string) {
  try {
    localStorage.setItem(TAB_KEY, id)
  } catch {
    /* a remembered tab is a convenience */
  }
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
}

function storedTab(): string {
  try {
    return localStorage.getItem(TAB_KEY) || DEFAULT_ID
  } catch {
    return DEFAULT_ID
  }
}

type Theme = 'light' | 'dark'
const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  useEffect(() => {
    const watch = new MutationObserver(() => setTheme(currentTheme()))
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => watch.disconnect()
  }, [])
  return theme
}

const UNIT: Record<string, [string, string]> = { s: ['second', 'seconds'], m: ['minute', 'minutes'], h: ['hour', 'hours'], d: ['day', 'days'] }

function refreshWords(refresh: DashboardMeta['refresh']): string {
  if (!refresh) return ''
  const every = /^(\d+)\s*([smhd])$/i.exec(refresh.every?.trim() ?? '')
  if (every) {
    const n = Number(every[1])
    const [one, many] = UNIT[every[2].toLowerCase()]
    return `Refreshes every ${n === 1 ? one : `${n} ${many}`}`
  }
  return refresh.every || refresh.cron ? 'Refreshes on a schedule' : ''
}

/** Pinned first, then the most recently updated. */
export function tabOrder(list: DashboardMeta[]): DashboardMeta[] {
  return list
    .filter((d) => !d.archived)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt))
}

type FrameMessage = { lz?: number; type?: string; rid?: number; source?: unknown; url?: unknown }

function Frame({ id, meta, theme, title }: { id: string; meta: DashboardMeta | null; theme: Theme; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  // The theme the page is built in; later changes arrive as messages, so a
  // theme switch never reloads the page and loses its scroll or its tabs.
  const [startTheme] = useState(theme)

  const post = useCallback((msg: Record<string, unknown>) => {
    ref.current?.contentWindow?.postMessage({ lz: 1, ...msg }, '*')
  }, [])

  const context = useMemo(() => ({ id, title, updatedAt: meta?.updatedAt ?? null }), [id, title, meta?.updatedAt])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only this frame's own window is answered: another frame, or anything
      // else that can post a message, gets nothing.
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const msg = e.data as FrameMessage
      if (!msg || msg.lz !== 1) return
      if (msg.type === 'ready') {
        post({ type: 'theme', theme })
        post({ type: 'context', dashboard: context })
      } else if (msg.type === 'data' && typeof msg.source === 'string') {
        const rid = msg.rid
        window.karmax.dashboards
          .data(id, msg.source)
          .then((r) => post({ type: 'data', rid, ok: r.ok, value: r.value, error: r.error }))
          .catch(() => post({ type: 'data', rid, ok: false, error: 'The app could not read that.' }))
      } else if (msg.type === 'open' && typeof msg.url === 'string' && /^https:\/\//i.test(msg.url)) {
        void window.karmax.app.openExternal(msg.url)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [id, theme, context, post])

  useEffect(() => post({ type: 'theme', theme }), [theme, post])
  useEffect(() => post({ type: 'context', dashboard: context }), [context, post])

  // New data, same page: the elements redraw in place.
  const seenData = useRef(meta?.dataVersion)
  useEffect(() => {
    if (meta?.dataVersion === undefined || meta.dataVersion === seenData.current) return
    seenData.current = meta.dataVersion
    post({ type: 'refresh', scope: 'data' })
  }, [meta?.dataVersion, post])

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts"
      src={`lyzn-dash://page/${encodeURIComponent(id)}?theme=${startTheme}`}
      className="block h-full w-full border-0 bg-[var(--ink)]"
    />
  )
}

export default function Dashboard({ status, onRoute }: { status: DaemonStatus | null; onRoute: (r: Route) => void }) {
  const toast = useToast()
  const theme = useTheme()
  const [list, setList] = useState<DashboardMeta[] | null>(null)
  const [tab, setTab] = useState(storedTab)
  const [busy, setBusy] = useState<'start' | 'stop' | 'restart' | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [confirming, setConfirming] = useState<DashboardMeta | null>(null)
  const [removing, setRemoving] = useState(false)
  const running = status?.state === 'running'
  const state = daemonTone(status)

  const load = useCallback(async () => {
    setList(await window.karmax.dashboards.list().catch(() => null))
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [load, running])

  useEffect(() => {
    const onOpen = (e: Event) => {
      setTab((e as CustomEvent<string>).detail)
      void load()
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [load])

  const select = (id: string) => {
    setTab(id)
    try {
      localStorage.setItem(TAB_KEY, id)
    } catch {
      /* a remembered tab is a convenience */
    }
  }

  const all = list ?? []
  const tabs = tabOrder(all)
  const archived = all.filter((d) => d.archived).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
  const meta = tabs.find((d) => d.id === tab) ?? null
  const active = meta ? meta.id : DEFAULT_ID

  async function act(kind: 'start' | 'stop' | 'restart') {
    setBusy(kind)
    try {
      await window.karmax.daemon[kind]()
    } finally {
      setBusy(null)
    }
  }

  /** Shows the change at once and puts it back if the engine refuses it. */
  async function setFlags(d: DashboardMeta, patch: { pinned?: boolean; archived?: boolean }, done: string) {
    const before = list
    setList((cur) => cur?.map((x) => (x.id === d.id ? { ...x, ...patch } : x)) ?? cur)
    if (patch.archived && tab === d.id) select(DEFAULT_ID)
    const res = await window.karmax.dashboards.update(d.id, patch).catch(() => ({ ok: false, error: undefined }))
    if (res.ok) {
      toast(done, 'ok')
      void load()
    } else {
      setList(before)
      toast(res.error ?? 'That did not change. Try again.', 'bad')
    }
  }

  async function remove() {
    if (!confirming) return
    setRemoving(true)
    try {
      const res = await window.karmax.dashboards.remove(confirming.id)
      if (res.ok) {
        toast(`Deleted ${confirming.title}.`, 'ok')
        if (tab === confirming.id) select(DEFAULT_ID)
        void load()
      } else {
        toast(res.error ?? 'That dashboard could not be deleted.', 'bad')
      }
    } finally {
      setRemoving(false)
      setConfirming(null)
    }
  }

  const transitional = status?.state === 'starting' || status?.state === 'stopping' || status?.state === 'restarting'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 px-8">
        <div className="flex items-end gap-6 border-b border-[var(--edge)]">
          <nav role="tablist" aria-label="Dashboards" className="-mb-px flex min-w-0 items-end gap-6 overflow-x-auto">
            {[{ id: DEFAULT_ID, title: 'Overview', pinned: false }, ...tabs].map((d) => {
              const on = d.id === active
              return (
                <button
                  key={d.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => select(d.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 border-b-[1.5px] pt-1 pb-2.5 text-[13.5px] transition-colors duration-150',
                    on
                      ? 'border-[var(--fg)] font-semibold text-[var(--fg)]'
                      : 'border-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]',
                  )}
                >
                  {d.pinned && <Pin size={11} className="shrink-0" aria-label="Pinned" />}
                  {d.title}
                </button>
              )
            })}
          </nav>
          <span className="ml-auto" />
          {list !== null && all.length === 0 && (
            <button
              type="button"
              onClick={() => onRoute('mira')}
              className="shrink-0 pb-2.5 text-[12.5px] text-[var(--fg-faint)] transition-colors hover:text-[var(--fg)]"
            >
              Ask Mira to build a dashboard of anything, and it appears here
            </button>
          )}
          {archived.length > 0 && (
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="flex shrink-0 items-center gap-1.5 pb-2.5 text-[12.5px] text-[var(--fg-faint)] transition-colors hover:text-[var(--fg)]"
            >
              <Archive size={12} />
              Archived {archived.length}
            </button>
          )}
        </div>
      </div>

      <header
        className={cn(
          'flex shrink-0 justify-between gap-8 px-8',
          meta ? 'items-center py-2.5' : 'items-start pt-5 pb-4',
        )}
      >
        {meta ? (
          // The page names itself and stamps its own update time, so this line
          // adds only the schedule. An agent's id is a config name, not a word.
          <p className="min-w-0 truncate text-[12.5px] text-[var(--fg-faint)]" title={meta.description || undefined}>
            {refreshWords(meta.refresh)}
          </p>
        ) : (
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <StatusDot tone={state.tone} pulse={state.pulse} />
              <h1 className="text-[22px] leading-tight font-extrabold tracking-[-0.02em]">{state.label}</h1>
            </div>
            <p className="mt-1 max-w-[70ch] text-[13.5px] text-[var(--fg-dim)]">
              {status?.remote ? `Running on ${status.host}. Starting and stopping it belong to that machine.` : (status?.detail ?? 'Checking the engine.')}
            </p>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 pt-1">
          {meta ? (
            <>
              <button
                type="button"
                className="lz-btn lz-btn-outline"
                aria-pressed={Boolean(meta.pinned)}
                onClick={() => void setFlags(meta, { pinned: !meta.pinned }, meta.pinned ? `Unpinned ${meta.title}.` : `Pinned ${meta.title}.`)}
              >
                {meta.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                {meta.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                type="button"
                className="lz-btn lz-btn-outline"
                onClick={() => void setFlags(meta, { archived: true }, `Archived ${meta.title}. It stops refreshing until you restore it.`)}
              >
                <Archive size={11} />
                Archive
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void window.karmax.app.revealProfile()}
                className="mr-2 flex items-center gap-1.5 text-[12px] text-[var(--fg-faint)] transition-colors hover:text-[var(--fg)]"
              >
                <FolderOpen size={13} />
                Data folder
              </button>
              {status?.remote ? null : running ? (
                <>
                  <button type="button" className="lz-btn lz-btn-outline" disabled={busy !== null} onClick={() => void act('restart')}>
                    <RotateCw size={11} />
                    {busy === 'restart' ? 'Restarting' : 'Restart'}
                  </button>
                  <button type="button" className="lz-btn lz-btn-outline" disabled={busy !== null} onClick={() => void act('stop')}>
                    <CircleStop size={11} />
                    {busy === 'stop' ? 'Stopping' : 'Stop'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="lz-btn"
                  disabled={busy !== null || transitional || status?.state === 'unavailable'}
                  onClick={() => void act('start')}
                >
                  <Play size={11} />
                  {busy === 'start' || transitional ? 'Starting' : 'Start'}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 border-t border-[var(--edge)]">
        {meta && !running ? (
          <p className="px-8 pt-8 text-[14px] text-[var(--fg-faint)]">Start the engine to open this dashboard.</p>
        ) : (
          <Frame key={`${active}:${meta?.htmlVersion ?? 0}`} id={active} meta={meta} theme={theme} title={meta?.title ?? 'Overview'} />
        )}
      </div>

      <Modal
        open={archiveOpen && confirming === null}
        onClose={() => setArchiveOpen(false)}
        wide
        title="Archived dashboards"
        lede="Put away, and no longer refreshing. Restore one to bring back its tab and its schedule."
      >
        {archived.length === 0 ? (
          <p className="text-[13.5px] text-[var(--fg-faint)]">Nothing is archived.</p>
        ) : (
          <ul>
            {archived.map((d) => (
              <li key={d.id} className="flex items-center gap-4 border-b border-[var(--edge)] py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{d.title}</p>
                  <p className="mt-0.5 truncate text-[12px] text-[var(--fg-faint)]">
                    {d.archivedAt ? `Archived ${ago(d.archivedAt)}` : 'Archived'}
                    {d.description ? `. ${d.description}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="lz-btn lz-btn-outline"
                  onClick={() => {
                    void setFlags(d, { archived: false }, `Restored ${d.title}.`)
                    select(d.id)
                    if (archived.length === 1) setArchiveOpen(false)
                  }}
                >
                  Restore
                </button>
                <button type="button" className="lz-btn lz-btn-outline" onClick={() => setConfirming(d)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={confirming !== null}
        onClose={() => {
          if (!removing) setConfirming(null)
        }}
        title={`Delete ${confirming?.title ?? 'this dashboard'}?`}
        footer={
          <>
            <button type="button" className="lz-btn lz-btn-outline" disabled={removing} onClick={() => setConfirming(null)}>
              Keep it
            </button>
            <button type="button" className="lz-btn" disabled={removing} onClick={() => void remove()}>
              {removing ? 'Deleting' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--fg-dim)]">
          The page, its data and its refresh schedule are removed for good. An agent can build it again if you ask.
        </p>
      </Modal>
    </div>
  )
}
