// The browser you and your assistant share.
//
// This is the thing that makes the rest of the Apps page work, and it is worth
// a panel of its own rather than being an implementation detail of a connect
// flow. Signing into Instagram here is what lets the assistant act as you
// there; closing it is what stops that. The window IS the permission, and a
// person cannot understand that from a flow that opens a browser at them
// mid-task.
import { Globe, LogIn, Power, RefreshCw } from 'lucide-react'
import type { BrowserState } from '@shared/types'
import { Button, Panel, SectionHeader, Spinner, StatusDot } from '@/components/ui'
import { useAsync } from '@/lib/hooks'

export function SharedBrowser({ running }: { running: boolean }) {
  const state = useAsync(async () => {
    if (!running) return null
    const res = await window.karmax.api.get<BrowserState>('/api/browser')
    return res.ok ? (res.data ?? null) : null
  }, [running])

  const b = state.data
  const act = async (path: string, body?: unknown) => {
    await window.karmax.api.post(path, body)
    state.reload()
  }

  return (
    <Panel className="mb-4">
      <SectionHeader
        title="The browser you share"
        hint="One window. You sign in; your assistant works in the same session afterwards."
        action={
          b?.running ? (
            <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={state.reload}>
              Refresh
            </Button>
          ) : undefined
        }
      />

      {state.loading ? (
        <Spinner />
      ) : !b ? (
        <p className="text-[13px] text-[var(--fg-dim)]">
          Start the engine on the Dashboard page to use this.
        </p>
      ) : !b.available ? (
        <p className="text-[13px] text-[var(--fg-dim)]">
          {b.reason ?? 'No browser found.'} Install Chrome, Chromium, Edge or Brave and this
          becomes available.
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <StatusDot tone={b.running ? 'ok' : 'idle'} pulse={b.running} />
            <span className="text-[13px]">{b.running ? 'Open' : 'Closed'}</span>
            <span className="ml-auto flex gap-2">
              {b.running ? (
                <>
                  <Button
                    variant="ghost"
                    icon={<LogIn size={14} />}
                    onClick={() => void act('/api/browser/open', { url: 'https://myaccount.google.com/' })}
                  >
                    Sign into something
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<Power size={14} />}
                    onClick={() => void act('/api/browser/stop')}
                  >
                    Close
                  </Button>
                </>
              ) : (
                <Button icon={<Globe size={14} />} onClick={() => void act('/api/browser/start')}>
                  Open it
                </Button>
              )}
            </span>
          </div>

          {b.running && real(b).length === 0 && (
            <p className="text-[13px] text-[var(--fg-dim)]">
              Nothing open yet. Sign in to whatever you want your assistant to be able to use.
            </p>
          )}

          {b.running && real(b).length > 0 && (
            <div className="space-y-1">
              {real(b).map((t) => (
                <div
                  key={t.url}
                  className="flex items-center gap-2 rounded-[var(--radius)] px-2 py-1.5"
                  style={{ background: 'var(--skin-1)' }}
                >
                  <Globe size={13} style={{ color: 'var(--fg-dim)', flexShrink: 0 }} />
                  <span className="flex-1 truncate text-[12.5px]">{t.title || t.url}</span>
                  <span className="truncate font-mono text-[11px] text-[var(--fg-faint)]">
                    {hostOf(t.url)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="mt-3 text-[12px] text-[var(--fg-dim)]">
            It is a profile of its own, not your everyday browser — what your assistant can reach
            is exactly what you sign into here. Closing it takes that away, and nothing else has to
            be undone.
          </p>
        </>
      )}
    </Panel>
  )
}

/** The tabs worth listing.
 *
 *  A window that has just opened has one about:blank in it, and showing that
 *  as though it were something the person had signed into reads as a bug. */
function real(b: BrowserState) {
  return b.tabs.filter((t) => t.url && t.url !== 'about:blank')
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
