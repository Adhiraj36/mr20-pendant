// The window frame the app draws for itself, and the rail down its left side.
import { useEffect, useState, type ReactNode } from 'react'
import {
  Blocks,
  Brain,
  Gauge,
  MessageSquare,
  Minus,
  ReceiptText,
  Repeat2,
  Settings2,
  Square,
  SunMoon,
  X,
} from 'lucide-react'
import type { DaemonStatus } from '@shared/types'
import { cn } from '@/lib/util'
import { StatusDot, type Tone } from '@/components/ui'

export type Route = 'mira' | 'dashboard' | 'tasks' | 'apps' | 'loops' | 'memory' | 'settings'

const NAV: { id: Route; label: string; icon: typeof Gauge }[] = [
  { id: 'mira', label: 'Mira', icon: MessageSquare },
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'tasks', label: 'Tasks', icon: ReceiptText },
  { id: 'apps', label: 'Apps', icon: Blocks },
  { id: 'loops', label: 'Loops', icon: Repeat2 },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

/** How a daemon state reads to somebody who does not know what a daemon is. */
export function daemonTone(s: DaemonStatus | null): { tone: Tone; label: string; pulse: boolean } {
  switch (s?.state) {
    case 'running':
      return { tone: 'ok', label: 'Running', pulse: false }
    case 'starting':
    case 'restarting':
      return { tone: 'busy', label: 'Starting', pulse: true }
    case 'stopping':
      return { tone: 'busy', label: 'Stopping', pulse: true }
    case 'crashed':
      return { tone: 'bad', label: 'Needs attention', pulse: false }
    case 'unavailable':
      return { tone: 'bad', label: 'Not installed', pulse: false }
    default:
      return { tone: 'idle', label: 'Stopped', pulse: false }
  }
}

export function TitleBar({ theme, onTheme }: { theme: string; onTheme: () => void }) {
  const [maximized, setMaximized] = useState(false)
  const mac = window.karmax.app.platform === 'darwin'

  useEffect(() => {
    void window.karmax.window.isMaximized().then(setMaximized)
  }, [])

  return (
    <div
      className="relative z-20 flex h-11 shrink-0 items-center justify-between pr-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* On macOS the traffic lights live here, so the app leaves room rather
          than drawing controls that would sit on top of them. */}
      <div className={cn('flex items-center gap-2', mac ? 'pl-[86px]' : 'pl-4')}>
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.32em] text-[var(--fg-faint)]">LYZN</span>
      </div>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={onTheme}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          className="grid size-8 place-items-center text-[var(--fg-faint)] transition hover:bg-[var(--skin-2)] hover:text-[var(--fg)]"
        >
          <SunMoon size={15} />
        </button>

        {!mac && (
          <>
            <button
              onClick={() => void window.karmax.window.minimize()}
              aria-label="Minimise"
              className="grid size-8 place-items-center text-[var(--fg-faint)] transition hover:bg-[var(--skin-2)] hover:text-[var(--fg)]"
            >
              <Minus size={15} />
            </button>
            <button
              onClick={() => {
                void window.karmax.window.toggleMaximize()
                setMaximized((m) => !m)
              }}
              aria-label={maximized ? 'Restore' : 'Maximise'}
              className="grid size-8 place-items-center text-[var(--fg-faint)] transition hover:bg-[var(--skin-2)] hover:text-[var(--fg)]"
            >
              <Square size={12} />
            </button>
            <button
              onClick={() => void window.karmax.window.close()}
              aria-label="Close"
              className="grid size-8 place-items-center text-[var(--fg-faint)] transition hover:bg-[var(--bad)] hover:text-white"
            >
              <X size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function Sidebar({
  route,
  onRoute,
  status,
  badges,
}: {
  route: Route
  onRoute: (r: Route) => void
  status: DaemonStatus | null
  /** Things waiting on the reader, per screen. Carbon, never violet. */
  badges?: Partial<Record<Route, number>>
}) {
  const state = daemonTone(status)
  return (
    <nav className="relative z-10 flex w-[212px] shrink-0 flex-col gap-1 px-3 pb-3">
      {NAV.map(({ id, label, icon: Icon }) => {
        const active = route === id
        return (
          <button
            key={id}
            onClick={() => onRoute(id)}
            className={cn(
              'group relative flex items-center gap-3  px-3 py-2.5 text-left',
              'transition duration-200 [transition-timing-function:var(--ease-out-soft)]',
              active
                ? 'bg-[var(--skin-3)] text-[var(--fg)]'
                : 'text-[var(--fg-dim)] hover:bg-[var(--skin-1)] hover:text-[var(--fg)]',
            )}
          >
            {/* The active marker is a rail, not a fill: it survives a
                screenshot and does not rely on colour alone. */}
            <span
              className={cn(
                'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity duration-200',
                active ? 'opacity-100' : 'opacity-0',
              )}
              style={{ background: 'var(--accent)' }}
            />
            <Icon size={17} className={cn(active ? 'text-[var(--accent)]' : 'opacity-80')} />
            <span className="text-[13.5px] font-medium">{label}</span>
            {(badges?.[id] ?? 0) > 0 && (
              <span
                className="lz-badge ml-auto"
                aria-label={`${badges?.[id]} waiting on you`}
                title={`${badges?.[id]} waiting on you`}
              >
                {badges?.[id]}
              </span>
            )}
          </button>
        )
      })}

      <div className="mt-auto" />

      <button
        onClick={() => onRoute('dashboard')}
        className="flex items-center gap-2.5 border bg-[var(--skin-1)] px-3 py-2.5 text-left transition hover:bg-[var(--skin-2)]"
      >
        <StatusDot tone={state.tone} pulse={state.pulse} />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium">{state.label}</span>
          <span className="block truncate text-[11px] text-[var(--fg-faint)]">
            {status?.version ? `engine ${status.version}` : 'the engine'}
          </span>
        </span>
      </button>
    </nav>
  )
}

export function Scroller({ children, bleed }: { children: ReactNode; bleed?: boolean }) {
  // A screen that lays out its own panes gets the whole area and scrolls
  // itself; the rest share one centred column.
  if (bleed) return <main className="relative z-10 flex min-h-0 min-w-0 flex-1">{children}</main>
  return (
    <main className="relative z-10 min-w-0 flex-1 overflow-y-auto pb-14">
      <div className="mx-auto w-full max-w-[860px] px-8 pt-2">{children}</div>
    </main>
  )
}
