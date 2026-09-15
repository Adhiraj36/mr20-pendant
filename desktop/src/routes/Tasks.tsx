// Tasks: the work LYZN heard you promise, while it is being done and after.
//
// Two things, mostly. What is running is a sheet with a live edge and a tape of
// what the brain is doing right now; what is finished is a receipt, laid on the
// desk the way slips pile up beside a till. Queued work is a short list between
// them, because it is neither happening nor proven.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Check, ChevronRight, Link2Off, Loader2, Mic, RefreshCw, Square } from 'lucide-react'
import { barcodeBars, RECEIPT_TITLE, stampAngle } from '@lyzn/design'
import type { Message } from '@lyzn/chat-core'
import type { Ticket, Tickets } from '@shared/types'
import { EmptyState, Spinner } from '@/components/ui'
import { Modal, useToast } from '@/components/Overlays'
import { cn } from '@/lib/util'
import { toMessages } from '@/routes/chat/adapter'
import { Listening } from '@/routes/chat/Listening'
import { useDictation } from '@/routes/chat/useDictation'
import { Transcript } from '@/routes/chat/Transcript'
import { WorkRow } from '@/routes/chat/rows/WorkRow'
import { outcomeLine, slipRows, spokenOf, summaryOf, when } from '@/routes/tasks/receipt'
import { openQuestion } from '@/lib/questions'

const parse = (iso: string): number | null => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

const pad = (n: number) => String(n).padStart(2, '0')

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

function ago(iso: string): string {
  const then = parse(iso)
  if (then === null) return ''
  const mins = Math.floor((Date.now() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

function printedAt(t: Ticket): string {
  const d = new Date(t.receipt?.createdAt || t.finishedAt || t.createdAt)
  if (Number.isNaN(d.getTime())) return ''
  return d
    .toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .toUpperCase()
}

const kept = (t: Ticket) => t.status === 'done'

/** Each slip lies at its own small angle, the same one every time. */
function tilt(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return ((h % 25) - 12) / 10
}

const plain = (md: string) => md.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()

function useNow(every: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [every])
  return now
}

/** The brain's record of one task, re-read every few seconds while it runs. */
function useTaskWork(taskId: string, follow: boolean): { messages: Message[]; live: boolean } | null {
  const [work, setWork] = useState<{ messages: Message[]; live: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    const read = async () => {
      const t = await window.karmax.tasks.transcript(taskId).catch(() => null)
      if (!alive) return
      if (!t) return setWork(null)
      const messages = toMessages(taskId, t.messages)
      // A live task's last reply is still being written: it gets the caret,
      // not the Done stamp a finished turn earns.
      const last = messages.at(-1)
      if (t.live && last?.role === 'assistant') messages[messages.length - 1] = { ...last, streaming: true }
      setWork({ messages, live: t.live })
    }
    void read()
    const timer = follow ? setInterval(read, 3000) : null
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [taskId, follow])
  return work
}

function LiveDot() {
  return (
    <span className="relative flex size-[7px] shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-60" />
      <span className="relative size-[7px] rounded-full bg-[var(--accent)]" />
    </span>
  )
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

function closesIn(ms: number): string {
  if (ms <= 0) return 'closing now'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `closes in ${mins} min`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `closes in ${hours} h` : `closes in ${Math.round(hours / 24)} days`
}

const ANSWERED_BY: Record<string, string> = { app: 'on your phone', desktop: 'here', comms: 'by message' }

/** A question a task is parked on. Carbon, because it is the one thing on the
 *  page waiting on the reader rather than on a machine; answered here or on
 *  the phone, whichever comes first. */
function QuestionCard({ task, onAnswered }: { task: Ticket; onAnswered: () => void }) {
  const q = task.question!
  const toast = useToast()
  const now = useNow(30_000)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const base = useRef<string | null>(null)
  const answered = !openQuestion(task)
  const options = q.options ?? []
  const expires = parse(q.expiresAt)

  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const dictation = useDictation({
    onText: (text, final) => {
      const before = base.current
      if (before === null) return
      setDraft(before && text ? `${before.replace(/\s+$/, '')} ${text}` : before || text)
      requestAnimationFrame(() => fit(box.current))
      if (final) {
        base.current = null
        box.current?.focus()
      }
    },
    onError: (message) => {
      base.current = null
      toast(message, 'bad')
    },
  })
  const listening = dictation.state !== 'idle'

  const send = async (answer: string) => {
    const text = answer.trim()
    if (!text || sending !== null) return
    base.current = null
    dictation.cancel()
    setSending(text)
    try {
      const res = await window.karmax.lyzn.answer(task.taskId, text)
      if (res.ok) {
        setDraft('')
        toast('Answered. The task picks back up in a moment.', 'ok')
        onAnswered()
      } else {
        toast(res.error ?? 'LYZN did not take that answer. Try again.', 'bad')
      }
    } finally {
      setSending(null)
    }
  }

  return (
    <article className="lz-ask">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pt-5 font-mono text-[10.5px] text-[var(--ask-muted)]">
        <span className="text-[var(--ask-ink)]">{answered ? 'Answered' : 'Waiting on you'}</span>
        <span>asked {ago(q.askedAt)}</span>
        {!answered && expires !== null && <span>{closesIn(expires - now)}</span>}
      </div>
      <h3 className="max-w-[44ch] px-6 pt-3 text-[24px] leading-[1.18] font-extrabold tracking-[-0.02em]">{q.text}</h3>
      <p className="max-w-[72ch] px-6 pt-2.5 text-[13px] leading-snug text-[var(--ask-muted)]">For “{task.text}”</p>

      {answered ? (
        <div className="mx-6 mt-5 mb-6 flex items-start gap-3 border-t border-dashed border-[var(--ask-rule)] pt-4">
          <Check size={16} strokeWidth={2.5} className="mt-1 shrink-0 text-[var(--ok)]" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">“{q.answer}”</p>
            <p className="mt-1 font-mono text-[10.5px] text-[var(--ask-muted)]">
              Answered {ANSWERED_BY[q.answeredBy ?? ''] ?? ''} {q.answeredAt ? ago(q.answeredAt) : ''}.{' '}
              {task.mine ? 'This machine picks the task back up within a minute.' : 'The machine that asked picks it back up.'}
            </p>
          </div>
        </div>
      ) : !task.mine ? (
        <p className="mx-6 mt-5 mb-6 border-t border-dashed border-[var(--ask-rule)] pt-4 text-[13.5px] text-[var(--ask-muted)]">
          Another machine asked this, so answer it in the LYZN app on your phone.
        </p>
      ) : (
        <div className="px-6 pt-5 pb-6">
          {options.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {options.map((o) => (
                <button key={o} type="button" className="lz-choice" disabled={sending !== null} onClick={() => void send(o)}>
                  {sending === o ? 'Sending' : o}
                </button>
              ))}
            </div>
          )}
          <div className={cn('lz-answer', listening && 'lz-answer-live')}>
            <textarea
              ref={box}
              rows={1}
              value={draft}
              aria-label="Your answer"
              placeholder={listening ? 'Listening' : options.length ? 'Or answer in your own words' : 'Your answer'}
              onChange={(e) => {
                setDraft(e.target.value)
                fit(e.target)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send(draft)
                } else if (e.key === 'Escape' && listening) {
                  e.preventDefault()
                  setDraft(base.current ?? draft)
                  base.current = null
                  dictation.cancel()
                }
              }}
              className="block max-h-40 min-h-[46px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] leading-[1.5] text-[var(--ask-ink)] outline-none placeholder:text-[var(--ask-muted)]"
            />
            <div className="flex items-center gap-1 py-2 pr-2 pl-2">
              {listening ? (
                <Listening levels={dictation.levels} startedAt={dictation.startedAt} finishing={dictation.state === 'finishing'} />
              ) : (
                <span className="min-w-0 flex-1 truncate pl-2 font-mono text-[10px] text-[var(--ask-muted)]">
                  Enter to send. Your phone sees it answered too.
                </span>
              )}
              {dictation.available && (
                <button
                  type="button"
                  onClick={() => {
                    if (dictation.state === 'idle') {
                      base.current = draft
                      void dictation.start()
                    } else {
                      dictation.stop()
                    }
                  }}
                  disabled={dictation.state === 'finishing'}
                  aria-pressed={listening}
                  aria-label={listening ? 'Stop dictating' : 'Dictate'}
                  title={listening ? 'Stop dictating' : 'Dictate'}
                  className={cn(
                    'grid size-[31px] shrink-0 place-items-center border transition-colors duration-150',
                    listening
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-transparent text-[var(--ask-muted)] hover:border-[var(--ask-rule)] hover:text-[var(--ask-ink)]',
                  )}
                >
                  {dictation.state === 'finishing' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : listening ? (
                    <Square size={9} fill="currentColor" />
                  ) : (
                    <Mic size={15} />
                  )}
                </button>
              )}
              <button
                type="button"
                className="lz-btn"
                disabled={!draft.trim() || sending !== null}
                onClick={() => void send(draft)}
              >
                {sending !== null && sending === draft.trim() ? 'Sending' : 'Answer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

function RunningCard({
  task,
  stopping,
  onStop,
  onOpen,
}: {
  task: Ticket
  stopping: boolean
  onStop: (taskId: string) => void
  onOpen: (task: Ticket) => void
}) {
  const now = useNow(1000)
  // Only this machine keeps the record of what it is doing.
  const work = useTaskWork(task.taskId, task.mine)
  const calls = work?.messages.filter((m) => m.role === 'assistant').flatMap((m) => m.toolCalls) ?? []
  const tail = calls.slice(-5)
  const said = [...(work?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && m.text.trim())?.text
  const started = parse(task.claimedAt)

  return (
    <article className="lz-job">
      <div className="lz-job-bar" aria-hidden="true" />

      <div className="flex items-center gap-2.5 px-6 pt-5">
        <LiveDot />
        <span className="font-mono text-[10.5px] text-[var(--accent)]">
          {task.mine ? 'Running on this machine' : 'Running on another machine'}
        </span>
        <span className="ml-auto font-mono text-[13px] tabular-nums text-[var(--fg-dim)]" title="Time since it started">
          {started !== null ? clock(now - started) : ''}
        </span>
        {task.mine && (
          <button
            type="button"
            className="lz-btn lz-btn-outline ml-2"
            disabled={stopping}
            onClick={() => onStop(task.taskId)}
          >
            <Square size={8} fill="currentColor" />
            {stopping ? 'Stopping' : 'Stop'}
          </button>
        )}
      </div>

      <h3 className="max-w-[58ch] px-6 pt-3 text-[21px] leading-[1.25] font-bold tracking-[-0.015em]">{task.text}</h3>
      {task.quote && task.quote.trim() !== task.text.trim() && (
        <p className="max-w-[62ch] px-6 pt-2 text-[14px] leading-snug text-[var(--fg-dim)] italic">“{task.quote}”</p>
      )}
      {task.context.title && (
        <p className="px-6 pt-2 text-[12.5px] text-[var(--fg-faint)]">
          From “{task.context.title}”, {ago(task.createdAt)}
        </p>
      )}

      {tail.length > 0 && (
        <div className="px-6 pt-5">
        <div className="lz-ledger">
          {calls.length > tail.length && (
            <p className="lz-ledger-line">
              <span className="w-3 shrink-0 text-center">+</span>
              {calls.length - tail.length} earlier steps
            </p>
          )}
          {tail.map((c) => (
            <WorkRow key={c.id} calls={[c]} live={c.status === 'in_progress' || c.status === 'pending'} />
          ))}
        </div>
        </div>
      )}
      {said && (
        <p className="line-clamp-2 max-w-[70ch] px-6 pt-3 text-[13.5px] leading-relaxed text-[var(--fg-dim)]">
          {plain(said.split('\n\n').at(-1) ?? said)}
        </p>
      )}

      <div className="mt-5 flex min-h-11 items-center border-t border-dashed border-[var(--edge)] px-6 py-2.5">
        {work ? (
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="font-mono text-[10.5px] text-[var(--fg-dim)] transition-colors hover:text-[var(--fg)]"
          >
            See everything it has done
          </button>
        ) : (
          <span className="font-mono text-[10.5px] text-[var(--fg-faint)]">
            {task.mine ? 'Getting started' : 'Its record of the work stays on that machine'}
          </span>
        )}
      </div>
    </article>
  )
}

function Barcode({ seed }: { seed: string }) {
  const bars = useMemo(() => barcodeBars(seed), [seed])
  return (
    <span aria-hidden="true" className="mt-5 flex h-9 w-full items-stretch overflow-hidden">
      {bars.map((w, i) => (
        <span key={i} style={{ flex: `${w} 1 0` }} className={i % 2 === 0 ? 'lz-bar' : ''} />
      ))}
    </span>
  )
}

/** A finished task, printed. The engine's receipt when there is one; the task's
 *  own record when a receipt could not be read — never a blank slip. */
function Slip({
  task,
  printing,
  onOpen,
  detail,
}: {
  task: Ticket
  printing?: boolean
  onOpen?: (task: Ticket) => void
  /** Beside the detail, where the outcome is the heading rather than a line. */
  detail?: boolean
}) {
  const r = task.receipt
  const ok = kept(task)
  const id = r?.receiptId || task.taskId
  const title = r?.title || task.text
  const note = detail ? '' : outcomeLine(summaryOf(task))

  const paper = (
    <span className="lz-paper">
      <span className="block text-center text-[10.5px] font-semibold tracking-[0.16em]">{RECEIPT_TITLE}</span>
      <span className="lz-faint mt-1 block text-center text-[9.5px] tracking-[0.12em]">{printedAt(task)}</span>

      <span className="lz-cut mt-3.5 block pt-3.5">
        <span
          className={cn('block font-sans text-[14.5px] leading-snug font-semibold tracking-[-0.01em]', !detail && 'line-clamp-4')}
          title={title}
        >
          {title}
        </span>
        {note && (
          <span className={cn('mt-2 line-clamp-2 block font-sans text-[12.5px] leading-snug', ok ? 'lz-faint' : 'lz-void')}>
            {note}
          </span>
        )}
      </span>

      <span className="lz-cut mt-3.5 block pt-2">
        {slipRows(task).map((row) => (
          <span key={`${row.k}${row.v}`} className="lz-row">
            <span className="lz-key">{row.k}</span>
            <span className="lz-lead" />
            <span className={cn('lz-val', row.ok && 'lz-ok')} title={row.v}>
              {row.v}
              {row.ok ? ' ✓' : ''}
            </span>
          </span>
        ))}
      </span>

      <Barcode seed={id} />
      <span className="lz-faint mt-2 block text-[9px] tracking-[0.14em]">TXN {id.slice(-10).toUpperCase()}</span>
      {/* Pressed in the corner under the barcode, so it never takes width
          from the title to find somewhere to go. */}
      <span className={cn('lz-paper-stamp', !ok && 'lz-paper-stamp-void')}>{r?.stamp || (ok ? 'Done' : 'Not kept')}</span>
    </span>
  )

  const angle = { '--stamp-angle': `${stampAngle}deg` } as CSSProperties
  if (!onOpen) {
    return (
      <div className="lz-slip lz-slip-static" style={angle}>
        {paper}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      aria-label={`Receipt: ${title}`}
      className={cn('lz-slip', printing && 'lz-print')}
      style={{ ...angle, '--tilt': `${tilt(id)}deg` } as CSSProperties}
    >
      {paper}
    </button>
  )
}

function Disclosure({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: string }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="lz-disclose">
      <ChevronRight size={13} className={cn('shrink-0 transition-transform duration-150', open && 'rotate-90')} />
      {children}
    </button>
  )
}

function TaskDetail({ task, onClose }: { task: Ticket | null; onClose: () => void }) {
  return (
    <Modal open={task !== null} onClose={onClose} title={task?.text ?? ''} plain lg>
      {task && (task.status === 'executing' ? <RunningDetail task={task} /> : <FinishedDetail task={task} />)}
    </Modal>
  )
}

function WorkTranscript({ messages }: { messages: Message[] }) {
  return <Transcript messages={messages} onRoute={() => {}} onRetry={() => {}} canRetry={false} />
}

function RunningDetail({ task }: { task: Ticket }) {
  const work = useTaskWork(task.taskId, task.mine)
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2.5 text-[12.5px] text-[var(--accent)]">
        <LiveDot />
        {task.mine ? 'Running on this machine' : 'Running on another machine'}
      </p>
      <h2 className="mt-3 max-w-[36ch] text-[24px] leading-[1.2] font-extrabold tracking-[-0.02em]">{task.text}</h2>
      {work && work.messages.length > 0 ? (
        <div className="mt-8 border-t border-dashed border-[var(--edge)] pt-7">
          <WorkTranscript messages={work.messages} />
        </div>
      ) : (
        <p className="mt-6 text-[13.5px] text-[var(--fg-faint)]">What it does shows up here once its first step finishes.</p>
      )}
    </div>
  )
}

function FinishedDetail({ task }: { task: Ticket }) {
  const ok = kept(task)
  // Only present while the engine still holds the session: it removes a
  // task's transcript once the task is closed, so most finished tasks have none.
  const work = useTaskWork(task.taskId, false)
  const [more, setMore] = useState(false)
  const [seeWork, setSeeWork] = useState(false)
  const outcome = outcomeLine(summaryOf(task)) || (ok ? 'Done.' : 'It stopped before it finished.')
  const said = spokenOf(task)
  const facts = task.context.facts ?? []
  const finished = task.receipt?.createdAt || task.finishedAt
  const steps = work?.messages.reduce((n, m) => n + m.toolCalls.length, 0) ?? 0

  return (
    <div className="grid items-start gap-10 md:grid-cols-[288px_minmax(0,1fr)]">
      <Slip task={task} detail />

      <div className="min-w-0 pt-2">
        <p className="flex items-baseline gap-3 text-[12.5px]">
          <span className={cn('font-semibold', ok ? 'text-[var(--ok)]' : 'text-[var(--bad)]')}>{ok ? 'Kept' : 'Not kept'}</span>
          {finished && <span className="text-[var(--fg-faint)]">{when(finished)}</span>}
        </p>
        <h2 className="mt-3 max-w-[26ch] text-[27px] leading-[1.14] font-extrabold tracking-[-0.025em]">{outcome}</h2>

        {(said || task.context.title) && (
          <figure className="mt-9 border-t border-dashed border-[var(--edge)] pt-6">
            {said && <blockquote className="max-w-[48ch] text-[16px] leading-[1.5] text-[var(--fg)]">“{said}”</blockquote>}
            {task.context.title && (
              <figcaption className={cn('text-[12.5px] text-[var(--fg-faint)]', said && 'mt-2')}>
                From “{task.context.title}”
              </figcaption>
            )}
          </figure>
        )}

        <div className="mt-5 space-y-1">
          {(task.context.summary || facts.length > 0) && (
            <div>
              <Disclosure open={more} onToggle={() => setMore((m) => !m)}>
                More from that recording
              </Disclosure>
              {more && (
                <div className="mt-2 mb-4 space-y-4 pl-[21px]">
                  {task.context.summary && (
                    <p className="max-w-[60ch] text-[13.5px] leading-relaxed text-[var(--fg-dim)]">{task.context.summary}</p>
                  )}
                  {facts.length > 0 && (
                    <ul className="space-y-2">
                      {facts.map((f, i) => (
                        <li key={i} className="flex max-w-[60ch] gap-2.5 text-[13px] leading-snug text-[var(--fg-dim)]">
                          <span className="mt-[8px] h-[1.5px] w-2 shrink-0 bg-[var(--fg-faint)]" />
                          {f.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {work && work.messages.length > 0 && (
            <div>
              <Disclosure open={seeWork} onToggle={() => setSeeWork((w) => !w)}>
                {steps > 0 ? `See the work, ${steps} step${steps === 1 ? '' : 's'}` : 'See the work'}
              </Disclosure>
              {seeWork && (
                <div className="mt-4 max-h-[52vh] overflow-y-auto pr-2 pl-[21px]">
                  <WorkTranscript messages={work.messages} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type Filter = 'all' | 'kept' | 'not'

export default function TasksPage() {
  const toast = useToast()
  const [paired, setPaired] = useState<boolean | null>(null)
  const [data, setData] = useState<Tickets | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pendingStop, setPendingStop] = useState<string | null>(null)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [open, setOpen] = useState<Ticket | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [printing, setPrinting] = useState<ReadonlySet<string>>(new Set())
  const seen = useRef<Set<string> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = await window.karmax.lyzn.pairing()
      setPaired(p.paired)
      if (!p.paired) return
      const res = await window.karmax.lyzn.tickets()
      if (res.ok && res.data) {
        setData(res.data)
        setError(null)
      } else {
        setError(res.error ?? 'Could not read your tasks. Check this machine is online, then refresh.')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const running = data?.running ?? []
  const waiting = data?.waiting ?? []
  const finished = data?.finished ?? []
  // Open questions first; an answered one stays until its task picks back up.
  const blocked = [...(data?.blocked ?? [])].sort((a, b) => Number(!openQuestion(a)) - Number(!openQuestion(b)))

  // Hard while something runs, so its receipt arrives when it is printed;
  // a minute otherwise, matching the loop's own beat.
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), running.length + blocked.length > 0 ? 8_000 : 60_000)
    return () => clearInterval(t)
  }, [load, running.length, blocked.length])

  // Only receipts that appear while the page is open print; the ones already
  // there on arrival are simply lying on the desk.
  useEffect(() => {
    if (!data) return
    const ids = data.finished.map((t) => t.taskId)
    if (seen.current === null) {
      seen.current = new Set(ids)
      return
    }
    const fresh = ids.filter((id) => !seen.current!.has(id))
    fresh.forEach((id) => seen.current!.add(id))
    if (fresh.length) setPrinting(new Set(fresh))
  }, [data])

  const confirmStop = useCallback(async () => {
    const taskId = pendingStop
    if (!taskId) return
    setStoppingId(taskId)
    try {
      const res = await window.karmax.lyzn.stopTask(taskId)
      if (res.ok) {
        toast(
          res.alreadyFinished ? 'It had already finished.' : 'Stopped. LYZN printed it as not kept.',
          res.alreadyFinished ? 'info' : 'ok',
        )
      } else {
        toast(res.error ?? 'Could not stop the task.', 'bad')
      }
    } finally {
      setStoppingId(null)
      setPendingStop(null)
      void load()
    }
  }, [pendingStop, load, toast])

  const slips = finished.filter((t) => (filter === 'all' ? true : filter === 'kept' ? kept(t) : !kept(t)))
  const keptCount = finished.filter(kept).length

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1060px] px-10 pt-5 pb-20">
          <header className="mb-11 flex items-end justify-between gap-6">
            <div>
              <h1 className="lz-title">Tasks</h1>
              <p className="mt-2.5 max-w-[56ch] text-[14.5px] leading-relaxed text-[var(--fg-dim)]">
                What you approved in the LYZN app, while it is being done and once it is.
              </p>
            </div>
            {paired && (
              <button
                type="button"
                onClick={() => void load()}
                aria-label="Refresh"
                title="Refresh"
                className="grid size-9 place-items-center border border-[var(--edge)] text-[var(--fg-faint)] transition-colors hover:border-[var(--fg)] hover:text-[var(--fg)]"
              >
                <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
              </button>
            )}
          </header>

          {paired === null ? (
            <Spinner />
          ) : !paired ? (
            <div className="border border-[var(--edge)] bg-[var(--skin-1)]">
              <EmptyState
                icon={<Link2Off size={20} />}
                title="This machine is not paired with LYZN yet"
                body="In the LYZN app on your phone: Settings → Laptop daemon → Pair a laptop. Then enter the six characters in Settings → LYZN."
              />
            </div>
          ) : (
            <>
              {error && (
                <p className="mb-8 border border-[var(--bad)] bg-[var(--bad-skin)] px-4 py-3 text-[13px] text-[var(--bad)]">
                  {error}
                </p>
              )}

              {blocked.length > 0 && (
                <section className="mb-14">
                  <div className="mb-5">
                    <SectionTitle title="Needs you" count={blocked.filter(openQuestion).length} />
                  </div>
                  <div className="space-y-5">
                    {blocked.map((t) => (
                      <QuestionCard key={t.question?.id ?? t.taskId} task={t} onAnswered={() => void load()} />
                    ))}
                  </div>
                </section>
              )}

              <section className="mb-14">
                <div className="mb-5">
                  <SectionTitle title="Now" count={running.length} />
                </div>
                {running.length === 0 ? (
                  <p className="border-t border-[var(--edge)] pt-4 text-[14px] text-[var(--fg-faint)]">
                    Nothing is running. Approve a task in the LYZN app and this machine starts on it.
                  </p>
                ) : (
                  <div className="space-y-5">
                    {running.map((t) => (
                      <RunningCard
                        key={t.taskId}
                        task={t}
                        stopping={stoppingId === t.taskId}
                        onStop={setPendingStop}
                        onOpen={setOpen}
                      />
                    ))}
                  </div>
                )}
              </section>

              {waiting.length > 0 && (
                <section className="mb-14">
                  <div className="mb-4">
                    <SectionTitle title="Up next" count={waiting.length} />
                  </div>
                  <ul className="border-t border-[var(--edge)]">
                    {waiting.map((t) => (
                      <li key={t.taskId} className="flex items-baseline gap-6 border-b border-[var(--edge)] py-3.5">
                        <span className="min-w-0 flex-1 text-[14px] leading-snug">{t.text}</span>
                        <span className="shrink-0 font-mono text-[10px] text-[var(--fg-faint)]">
                          approved {ago(t.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
                  <SectionTitle title="Receipts" count={finished.length} />
                  {finished.length > 0 && (
                    <div className="flex items-center gap-5" role="group" aria-label="Show receipts">
                      {(
                        [
                          ['all', 'All'],
                          ['kept', `Kept ${keptCount}`],
                          ['not', `Not kept ${finished.length - keptCount}`],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={filter === id}
                          onClick={() => setFilter(id)}
                          className="lz-filter"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {finished.length === 0 ? (
                  <p className="border-t border-[var(--edge)] pt-4 text-[14px] text-[var(--fg-faint)]">
                    No receipts yet. Every task this machine finishes prints one here.
                  </p>
                ) : slips.length === 0 ? (
                  <p className="border-t border-[var(--edge)] pt-4 text-[14px] text-[var(--fg-faint)]">
                    {filter === 'kept' ? 'None kept yet.' : 'Nothing has gone unkept.'}
                  </p>
                ) : (
                  <div className="lz-receipts">
                    {slips.map((t) => (
                      <Slip key={t.taskId} task={t} printing={printing.has(t.taskId)} onOpen={setOpen} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      <TaskDetail task={open} onClose={() => setOpen(null)} />

      <Modal
        open={pendingStop !== null}
        onClose={() => {
          if (!stoppingId) setPendingStop(null)
        }}
        title="Stop this task?"
        footer={
          <>
            <button type="button" className="lz-btn lz-btn-outline" disabled={!!stoppingId} onClick={() => setPendingStop(null)}>
              Keep running
            </button>
            <button type="button" className="lz-btn" disabled={!!stoppingId} onClick={() => void confirmStop()}>
              {stoppingId ? 'Stopping' : 'Stop task'}
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--fg-dim)]">
          The work stops now and LYZN records the task as not kept. Anything it already changed on this machine
          stays changed.
        </p>
      </Modal>
    </div>
  )
}
