// What the assistant remembers.
//
// Read, search and forget — not write: memories are written by the assistant as
// it works, and a screen that let a person hand-author them would quietly
// become a second, competing source of truth.
//
// NOTE: memory is GitLoom, always. The local branch below is what a machine
// with no key falls back to, and it exists to be reported rather than offered
// — see Settings → Memory, which asks LYZN for one.
//
// Two backends look different and are presented differently. Local memories are
// a chronological log, so they are listed newest-first with times. GitLoom
// memories are a filed tree — the id IS the path, the content is a summary, and
// there is no meaningful timestamp on a survey — so they are grouped by folder
// and never shown a fabricated date.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, Cloud, FolderTree, HardDrive, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { DaemonStatus, MemorySettings } from '@shared/types'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Panel,
  Rows,
  Spinner,
} from '@/components/ui'
import { useToast } from '@/components/Overlays'
import { useDebounced } from '@/lib/hooks'
import { ago, cn } from '@/lib/util'

interface Entry {
  id: string
  role: string
  content: string
  tags: string[] | null
  created_at: string
}

/** GitLoom entries arrive with the path as the id and the tier as a role. */
function isFiled(e: Entry): boolean {
  return e.role === 'gitloom' || (e.id.includes('/') && !e.created_at)
}

function folderOf(path: string): string {
  const file = path.split('#')[0]
  const cut = file.lastIndexOf('/')
  return cut > 0 ? file.slice(0, cut) : ''
}

/** The date a filed memory is about, when its path carries one.
 *
 *  GitLoom anchors a dated fact inside a page as `page.md#2026-08-14-what-it-
 *  was`, and a survey carries no timestamp at all — so the path is the only
 *  place a date exists, and the alternative is showing "never". */
function dateOf(path: string): string | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(path)
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`)
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

/** How many memories a folder shows before asking. A month of incidents can be
 *  a hundred and sixty rows, and rendering all of them makes the page a wall
 *  and the scroll useless. */
const PER_FOLDER = 20

export default function Memory({ status }: { status: DaemonStatus | null }) {
  const toast = useToast()
  const running = status?.state === 'running'
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 400)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [namespace, setNamespace] = useState('')
  const [memory, setMemory] = useState<MemorySettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void window.karmax.config.settings().then((s) => setMemory(s.memory))
  }, [])

  const load = useCallback(async () => {
    if (!running) {
      setEntries(null)
      return
    }
    setLoading(true)
    const path = debounced.trim()
      ? `/api/memory/entries?limit=200&q=${encodeURIComponent(debounced.trim())}`
      : '/api/memory/entries?limit=200'
    const res = await window.karmax.api.get<{ namespace: string; entries: Entry[] }>(path)
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      setEntries([])
      return
    }
    setError(null)
    setNamespace(res.data?.namespace ?? '')
    setEntries(res.data?.entries ?? [])
  }, [running, debounced])

  useEffect(() => {
    void load()
  }, [load])

  async function forget(id: string) {
    const res = await window.karmax.api.request(
      'DELETE',
      `/api/memory/entries/${encodeURIComponent(id)}`,
    )
    if (!res.ok) {
      toast(res.error ?? 'Could not forget that.', 'bad')
      return
    }
    setEntries((e) => (e ?? []).filter((x) => x.id !== id))
    toast('Forgotten.', 'ok')
  }

  const filed = useMemo(() => (entries ?? []).filter(isFiled), [entries])
  const logged = useMemo(() => (entries ?? []).filter((e) => !isFiled(e)), [entries])

  // Grouped by folder, folders in alphabetical order — which for GitLoom's
  // paths means facts before projects before people, i.e. the shape the
  // assistant actually filed them in.
  const groups = useMemo(() => {
    const byFolder = new Map<string, Entry[]>()
    for (const e of filed) {
      const key = folderOf(e.id) || 'top level'
      const list = byFolder.get(key) ?? []
      list.push(e)
      byFolder.set(key, list)
    }
    return [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filed])

  return (
    <>
      <PageHeader
        title="Memory"
        lede="Everything your assistant has decided is worth keeping. It writes these itself as it works."
        action={
          <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      {memory && <BackendNote memory={memory} namespace={namespace} count={entries?.length ?? 0} />}

      {!running ? (
        <Panel>
          <EmptyState
            icon={<Brain size={26} />}
            title="The engine is not running"
            body="Start it on the Dashboard page to read what it remembers."
          />
        </Panel>
      ) : (
        <>
          <div className="relative mb-4">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search everything it remembers…"
              className="pl-10"
              spellCheck={false}
            />
            {loading && (
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                <Spinner />
              </span>
            )}
          </div>

          {entries === null ? (
            <Panel>
              {/* A GitLoom survey walks the whole namespace and takes seconds,
                  so the wait says where it is going. A bare spinner reads as a
                  hang once it lasts longer than an instant. */}
              <div className="flex items-center gap-2.5 py-1">
                <Spinner />
                <span className="text-[13px] text-[var(--fg-dim)]">
                  {memory?.gitloomEnabled ? 'Reading from GitLoom…' : 'Loading…'}
                </span>
              </div>
            </Panel>
          ) : error ? (
            <Panel>
              <EmptyState title="Memory is not answering" body={error} />
            </Panel>
          ) : entries.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Brain size={26} />}
                title={query.trim() ? 'Nothing matched' : 'Nothing remembered yet'}
                body={
                  query.trim()
                    ? 'Try fewer words — search looks at meaning, not just exact matches.'
                    : memory?.gitloomEnabled
                      ? 'This namespace is empty. Memories appear as your assistant works.'
                      : 'Nothing is being remembered yet — this machine has no memory key. Settings → Memory will ask LYZN for one.'
                }
              />
            </Panel>
          ) : (
            <>
              {groups.map(([folder, items]) => (
                <Folder
                  key={folder}
                  folder={folder}
                  items={items}
                  onForget={(id) => void forget(id)}
                />
              ))}

              {logged.length > 0 && (
                <Panel padded={false}>
                  {groups.length > 0 && (
                    <header className="border-b px-6 py-3.5 text-[12.5px] text-[var(--fg-dim)]">
                      Kept on this computer
                    </header>
                  )}
                  <Rows>
                    {logged.map((e) => (
                      <article key={e.id} className="group flex gap-4 px-6 py-4">
                        <div className="min-w-0 flex-1">
                          <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed">
                            {e.content}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-[11.5px] text-[var(--fg-faint)]">
                              {ago(e.created_at)}
                            </span>
                            {e.role && <Badge tone="idle">{e.role}</Badge>}
                            {(e.tags ?? []).slice(0, 4).map((t) => (
                              <Badge key={t} tone="busy">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                          icon={<Trash2 size={13} />}
                          aria-label="Forget this"
                          onClick={() => void forget(e.id)}
                        />
                      </article>
                    ))}
                  </Rows>
                </Panel>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

function FiledMemory({ entry, onForget }: { entry: Entry; onForget: () => void }) {
  const [open, setOpen] = useState(false)
  const long = entry.content.length > 220
  const when = dateOf(entry.id)

  // No slug heading. GitLoom derives a path from the memory's own first line,
  // so a title above the summary is the same sentence twice — once badly
  // hyphenated. The summary leads; the path is provenance underneath.
  return (
    <article className="group flex gap-4 px-6 py-4">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'selectable whitespace-pre-wrap text-[13px] leading-relaxed',
            !open && long && 'line-clamp-3',
          )}
        >
          {entry.content}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {when && <span className="text-[11.5px] text-[var(--fg-faint)]">{when}</span>}
          {(entry.tags ?? []).slice(0, 3).map((t) => (
            <Badge key={t} tone="busy">
              {t}
            </Badge>
          ))}
          {long && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-[11.5px] text-[var(--accent)] transition hover:text-[var(--accent-bright)]"
            >
              {open ? 'Show less' : 'Show more'}
            </button>
          )}
          {/* Left-aligned, so a row with no date does not leave the path
              floating alone against the right edge. */}
          <span
            className="selectable min-w-0 flex-1 truncate font-mono text-[10.5px] text-[var(--fg-faint)]"
            title={entry.id}
          >
            {entry.id}
          </span>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        icon={<Trash2 size={13} />}
        aria-label="Forget this"
        onClick={onForget}
      />
    </article>
  )
}

/** One folder of filed memories, capped until asked. */
function Folder({
  folder,
  items,
  onForget,
}: {
  folder: string
  items: Entry[]
  onForget: (id: string) => void
}) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, PER_FOLDER)

  return (
    <Panel padded={false} className="mb-4">
      <header className="flex items-center gap-2 border-b px-6 py-3.5">
        <FolderTree size={14} className="shrink-0 text-[var(--fg-faint)]" />
        <span className="truncate font-mono text-[12.5px] text-[var(--fg-dim)]">{folder}</span>
        <span className="ml-auto shrink-0 text-[11.5px] text-[var(--fg-faint)]">{items.length}</span>
      </header>
      <Rows>
        {shown.map((e) => (
          <FiledMemory key={e.id} entry={e} onForget={() => onForget(e.id)} />
        ))}
      </Rows>
      {items.length > shown.length && (
        <button
          onClick={() => setAll(true)}
          className="w-full border-t px-6 py-3 text-[12.5px] text-[var(--accent)] transition hover:bg-[var(--skin-1)]"
        >
          Show the other {items.length - shown.length}
        </button>
      )}
    </Panel>
  )
}

/** Which store is answering. Worth stating plainly: the same screen shows very
 *  different things depending on it, and "my memories are missing" is almost
 *  always this. */
function BackendNote({
  memory,
  namespace,
  count,
}: {
  memory: MemorySettings
  namespace: string
  count: number
}) {
  return (
    <div className="mb-4 flex items-center gap-3 border bg-[var(--skin-1)] px-4 py-3">
      {memory.gitloomEnabled ? (
        <Cloud size={16} className="shrink-0 text-[var(--accent)]" />
      ) : (
        <HardDrive size={16} className="shrink-0 text-[var(--fg-faint)]" />
      )}
      <p className="min-w-0 flex-1 text-[12.5px] text-[var(--fg-dim)]">
        {memory.gitloomEnabled ? (
          <>
            Stored in GitLoom, namespace{' '}
            <code className="selectable font-mono text-[var(--fg)]">
              {memory.namespace || namespace || 'default'}
            </code>
            {count > 0 && ` · ${count} memories`}
          </>
        ) : (
          // Not a choice any more, so not an invitation. Memory belongs to the
          // account this machine signed in to, and a machine without a key is
          // a machine whose work will not be remembered — which is worth
          // saying plainly rather than describing as a local alternative.
          <>
            This machine has no memory key yet, so nothing it does is being remembered. Settings →
            Memory will ask LYZN for one.
          </>
        )}
      </p>
    </div>
  )
}
