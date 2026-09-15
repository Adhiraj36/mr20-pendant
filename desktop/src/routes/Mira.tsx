// The front door: your assistant, answered by the engine on this machine.
//
// Mira lays out its own panes rather than living in the shell's centred
// column: the conversations down the desk on the left, and the open one as a
// sheet of paper filling the rest of the window. The transcript scrolls inside
// that sheet and the composer is docked to its foot, so neither fights a page
// scroll for the bottom of the window.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  HardDrive,
  Loader2,
  MessageCircle,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ReceiptText,
  Square,
} from 'lucide-react'
import { initialScroll, nextScroll, useConversation } from '@lyzn/chat-core'
import type { ConversationSummary, ScrollMode } from '@lyzn/chat-core'
import type { Route } from '@/components/Chrome'
import { useToast } from '@/components/Overlays'
import { Spinner } from '@/components/ui'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/util'
import { engineAdapter } from '@/routes/chat/adapter'
import { conversationTitle, dayGroup, shortAgo, type DayGroup } from '@/routes/chat/clean'
import { Picker, type Choice } from '@/routes/chat/Picker'
import { Transcript } from '@/routes/chat/Transcript'
import { Listening } from '@/routes/chat/Listening'
import { useDictation } from '@/routes/chat/useDictation'

const LIST_KEY = 'lyzn.mira.list'

/** Things this machine can actually do, so the first question is a real one. */
const STARTERS = [
  { icon: HardDrive, text: "Find what's taking up space on this machine" },
  { icon: CalendarDays, text: "What's on my calendar today?" },
  { icon: ReceiptText, text: 'What did I promise people this week?' },
  { icon: MessageCircle, text: "Check WhatsApp for messages I haven't answered" },
]

const BRAINS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }

const EFFORTS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** A choice that outlives the window. Read back only while the engine still
 *  offers it, so a model it dropped is not sent forever. */
function useStored(key: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  const set = useCallback(
    (next: string) => {
      setValue(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        /* a remembered choice is a convenience, not state */
      }
    },
    [key],
  )
  return [value, set]
}

function LiveDot() {
  return (
    <span className="relative flex size-[7px] shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-60" />
      <span className="relative size-[7px] rounded-full bg-[var(--accent)]" />
    </span>
  )
}

function Welcome({ machine, onPick }: { machine: string; onPick: (text: string) => void }) {
  return (
    <div className="my-auto pb-6">
      <h1 className="lz-display">What needs doing?</h1>
      <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.6] text-[var(--fg-dim)]">
        Mira runs on {machine}, so it can do the job instead of describing it: open files, drive a
        browser, put work on your calendar.
      </p>
      <ul className="mt-9 border-t border-[var(--edge)]">
        {STARTERS.map(({ icon: Icon, text }) => (
          <li key={text}>
            <button
              type="button"
              onClick={() => onPick(text)}
              className="group flex w-full items-center gap-3.5 border-b border-[var(--edge)] py-3 text-left text-[14px] text-[var(--fg-dim)] transition-colors duration-150 hover:text-[var(--fg)]"
            >
              <Icon size={15} className="shrink-0 text-[var(--fg-faint)] transition-colors group-hover:text-[var(--fg)]" />
              <span>{text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Mira({ onRoute }: { onRoute: (r: Route) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [listOpen, setListOpen] = useState(() => {
    try {
      return localStorage.getItem(LIST_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const { state, send, retry, stop } = useConversation(engineAdapter, selected)
  const toast = useToast()

  const offered = useAsync(() => window.karmax.chat.options(), [])
  const [model, setModel] = useStored('lyzn.mira.model')
  const [effort, setEffort] = useStored('lyzn.mira.effort')
  const models = offered.data?.models ?? []
  const efforts = offered.data?.efforts ?? []
  const pickedModel = models.some((m) => m.id === model) ? model : ''
  const pickedEffort = efforts.includes(effort) ? effort : ''
  const fallback = offered.data?.defaultModel ?? ''
  const modelChoices: Choice[] = [
    { id: '', label: models.find((m) => m.id === fallback)?.label ?? (fallback || 'Default'), hint: 'default' },
    ...models.filter((m) => m.id !== fallback).map((m) => ({ id: m.id, label: m.label })),
  ]
  const effortChoices: Choice[] = [
    { id: '', label: 'Default' },
    ...efforts.map((e) => ({ id: e, label: EFFORTS[e] ?? e })),
  ]

  // Reloaded when a turn settles, because that is when the engine has titled a
  // new conversation and when an existing one changes order.
  const conversations = useAsync(() => window.karmax.chat.list(), [state.conversationId, state.busy])

  const scroller = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const mode = useRef<ScrollMode>(initialScroll)

  const mac = window.karmax.app.platform === 'darwin'

  useEffect(() => {
    try {
      localStorage.setItem(LIST_KEY, listOpen ? 'open' : 'closed')
    } catch {
      /* a remembered pane is a convenience, not state */
    }
  }, [listOpen])

  // A conversation opened fresh follows its end, whatever the last one was
  // doing — and the composer is where the next thing gets typed.
  useEffect(() => {
    mode.current = initialScroll
    input.current?.focus()
  }, [selected])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      mode.current = nextScroll(mode.current, { type: atEnd ? 'reached-end' : 'scrolled-away' })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // The question just asked, so the anchored view has something to hold on to.
  const lastAsk = [...state.messages].reverse().find((m) => m.role === 'user')

  const last = state.messages.at(-1)
  useEffect(() => {
    if (mode.current === 'free-scrolling') return
    if (mode.current === 'anchoring-new-turn') {
      document.getElementById(`turn-${lastAsk?.id}`)?.scrollIntoView({ block: 'start' })
      return
    }
    foot.current?.scrollIntoView({ block: 'end' })
  }, [state.messages.length, last?.text, last?.toolCalls.length, lastAsk?.id])

  // A settled turn releases the anchor, so the next short reply follows again.
  useEffect(() => {
    if (!state.busy) mode.current = nextScroll(mode.current, { type: 'turn-settled' })
  }, [state.busy])

  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }

  // What was in the box when dictation began; null once it is over, so a
  // partial that lands after a send or a discard writes nothing.
  const base = useRef<string | null>(null)
  const dictation = useDictation({
    onText: (text, final) => {
      const before = base.current
      if (before === null) return
      setDraft(before && text ? `${before.replace(/\s+$/, '')} ${text}` : before || text)
      requestAnimationFrame(() => fit(input.current))
      if (final) {
        base.current = null
        input.current?.focus()
      }
    },
    onError: (message, code) => {
      base.current = null
      toast(message, 'bad')
      if (code === 'mic-denied') void window.karmax.dictation.openSettings('microphone')
      if (code === 'speech-denied') void window.karmax.dictation.openSettings('speech')
    },
  })
  const listening = dictation.state !== 'idle'
  const toggleDictation = () => {
    if (dictation.state === 'idle') {
      base.current = draft
      void dictation.start()
    } else {
      dictation.stop()
    }
  }

  const submit = useCallback(() => {
    const text = draft.trim()
    if (!text || state.busy) return
    // Sending ends dictation; what was said so far is already in the box.
    base.current = null
    dictation.cancel()
    setDraft('')
    requestAnimationFrame(() => fit(input.current))
    mode.current = nextScroll(mode.current, { type: 'turn-started' })
    void send(text, { model: pickedModel || undefined, effort: pickedEffort || undefined })
  }, [draft, state.busy, send, dictation, pickedModel, pickedEffort])

  // A retried turn is a new turn as far as the view is concerned — it needs
  // the same anchor a fresh question gets.
  const handleRetry = useCallback(() => {
    mode.current = nextScroll(mode.current, { type: 'turn-started' })
    retry()
  }, [retry])

  const startNew = useCallback(() => {
    setSelected(null)
    setDraft('')
    input.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        startNew()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startNew])

  const data = conversations.data
  const list = useMemo(() => data?.conversations ?? [], [data])
  const groups = useMemo(() => {
    const out: { label: DayGroup; items: ConversationSummary[] }[] = []
    for (const c of list) {
      const label = dayGroup(c.updated)
      const tail = out.at(-1)
      if (tail?.label === label) tail.items.push(c)
      else out.push({ label, items: [c] })
    }
    return out
  }, [list])

  const current = state.conversationId ?? selected
  const open = list.find((c) => c.id === current)
  const title = current
    ? conversationTitle(open ?? { opening: state.messages.find((m) => m.role === 'user')?.text })
    : 'New conversation'
  const brainName = data?.brain ? (BRAINS[data.brain] ?? data.brain) : ''

  const pick = (text: string) => {
    setDraft(text)
    requestAnimationFrame(() => {
      fit(input.current)
      input.current?.focus()
    })
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {listOpen && (
        <aside className="flex w-[248px] shrink-0 flex-col pr-3 pb-3" aria-label="Conversations">
          <button
            type="button"
            onClick={startNew}
            className="mb-4 flex h-9 shrink-0 items-center gap-2.5 border border-[var(--edge)] bg-[var(--skin-1)] px-3 text-left text-[13px] font-medium transition-colors duration-150 hover:border-[var(--fg)]"
          >
            <Plus size={14} className="shrink-0" />
            <span className="flex-1">New conversation</span>
            <kbd className="font-mono text-[10px] text-[var(--fg-faint)]">{mac ? '⌘N' : 'Ctrl+N'}</kbd>
          </button>

          <nav className="-mr-3 min-h-0 flex-1 overflow-y-auto pr-3">
            {conversations.loading && list.length === 0 ? (
              <Spinner className="mt-2 ml-2.5" />
            ) : list.length === 0 ? (
              <p className="px-2.5 text-[12.5px] leading-relaxed text-[var(--fg-faint)]">
                Nothing yet. Anything you ask Mira is kept here.
              </p>
            ) : (
              groups.map((g) => (
                <section key={g.label} className="mb-5">
                  <h3 className="mb-1 px-2.5 text-[11.5px] font-medium text-[var(--fg-faint)]">{g.label}</h3>
                  {g.items.map((c) => {
                    const on = c.id === current
                    const name = conversationTitle(c)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        // Re-selecting the conversation a turn is running in
                        // would reload it and orphan that turn.
                        onClick={() => {
                          if (!on) setSelected(c.id)
                        }}
                        title={name}
                        aria-current={on ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 px-2.5 py-[7px] text-left text-[13px] transition-colors duration-150',
                          on
                            ? 'bg-[var(--skin-1)] text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--edge)]'
                            : 'text-[var(--fg-dim)] hover:bg-[color-mix(in_srgb,var(--skin-1)_55%,transparent)] hover:text-[var(--fg)]',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        {on && state.busy ? (
                          <LiveDot />
                        ) : (
                          <span className="shrink-0 font-mono text-[9.5px] text-[var(--fg-faint)]">
                            {shortAgo(c.updated)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </section>
              ))
            )}

            {data?.brain === 'codex' && (
              <p className="mt-1 px-2.5 text-[11.5px] leading-snug text-[var(--fg-faint)]">
                Conversations are only kept for Claude Code at the moment.
              </p>
            )}
          </nav>
        </aside>
      )}

      <section className="flex min-w-0 flex-1 flex-col border-t border-l border-[var(--edge)] bg-[var(--skin-1)]">
        <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--edge)] pr-4 pl-2">
          <button
            type="button"
            onClick={() => setListOpen((o) => !o)}
            aria-label={listOpen ? 'Hide conversations' : 'Show conversations'}
            title={listOpen ? 'Hide conversations' : 'Show conversations'}
            className="grid size-7 shrink-0 place-items-center text-[var(--fg-faint)] transition-colors hover:bg-[var(--skin-2)] hover:text-[var(--fg)]"
          >
            {listOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
          {!listOpen && (
            <button
              type="button"
              onClick={startNew}
              aria-label="New conversation"
              title="New conversation"
              className="grid size-7 shrink-0 place-items-center text-[var(--fg-faint)] transition-colors hover:bg-[var(--skin-2)] hover:text-[var(--fg)]"
            >
              <Plus size={15} />
            </button>
          )}
          <h2 className="ml-1 min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</h2>
          {state.busy ? (
            <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-[var(--accent)]">
              <LiveDot />
              Working
            </span>
          ) : (
            brainName && <span className="shrink-0 font-mono text-[10px] text-[var(--fg-faint)]">{brainName}</span>
          )}
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-10 pt-10 pb-6">
            {state.messages.length === 0 ? (
              current ? (
                <Spinner className="m-auto" />
              ) : (
                <Welcome machine={mac ? 'this Mac' : 'this computer'} onPick={pick} />
              )
            ) : (
              <Transcript
                messages={state.messages}
                onRoute={onRoute}
                onRetry={handleRetry}
                canRetry={!state.busy}
                anchorId={lastAsk?.id}
              />
            )}
            <div ref={foot} />
          </div>
        </div>

        <div className="relative shrink-0">
          {/* The fade keeps the last line of a reply from appearing to touch
              the composer as it scrolls underneath. */}
          <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-b from-transparent to-[var(--skin-1)]" />
          <div className="mx-auto w-full max-w-[760px] px-10 pb-6">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
              className={cn(
                'lz-composer border bg-[var(--skin-1)] transition-colors duration-150',
                listening ? 'border-[var(--accent)]' : 'border-[var(--edge-strong)] focus-within:border-[var(--fg)]',
              )}
            >
              <textarea
                ref={input}
                value={draft}
                rows={1}
                aria-label="Message Mira"
                placeholder={
                  listening
                    ? 'Listening'
                    : state.busy
                      ? 'Mira is working. You can write the next thing.'
                      : 'Ask Mira to do something'
                }
                onChange={(e) => {
                  setDraft(e.target.value)
                  fit(e.target)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    submit()
                  } else if (e.key === 'Escape' && listening) {
                    e.preventDefault()
                    setDraft(base.current ?? draft)
                    base.current = null
                    dictation.cancel()
                  } else if (e.key === 'Escape' && state.busy) {
                    e.preventDefault()
                    stop()
                  }
                }}
                className="block max-h-[220px] min-h-[50px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-[1.55] text-[var(--fg)] outline-none placeholder:text-[var(--fg-faint)] focus-visible:outline-none"
              />
              <div className="flex items-center gap-1 py-2 pr-2 pl-2">
                {listening ? (
                  <Listening
                    levels={dictation.levels}
                    startedAt={dictation.startedAt}
                    finishing={dictation.state === 'finishing'}
                  />
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-0.5">
                    {models.length > 0 && (
                      <Picker name="Model" value={pickedModel} choices={modelChoices} onChange={setModel} />
                    )}
                    {efforts.length > 0 && (
                      <Picker name="Effort" prefix="Effort" value={pickedEffort} choices={effortChoices} onChange={setEffort} />
                    )}
                    <span className="ml-2 min-w-0 truncate font-mono text-[10px] text-[var(--fg-faint)]">
                      {state.busy ? 'Esc to stop' : models.length > 0 ? '' : 'Enter to send, Shift+Enter for a new line'}
                    </span>
                  </div>
                )}
                {dictation.available && (
                  <button
                    type="button"
                    onClick={toggleDictation}
                    disabled={dictation.state === 'finishing'}
                    aria-pressed={listening}
                    aria-label={listening ? 'Stop dictating' : 'Dictate'}
                    title={listening ? 'Stop dictating' : 'Dictate'}
                    className={cn(
                      'grid size-[31px] shrink-0 place-items-center border transition-colors duration-150',
                      listening
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                        : 'border-transparent text-[var(--fg-faint)] hover:border-[var(--edge)] hover:text-[var(--fg)]',
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
                {state.busy ? (
                  <button type="button" onClick={stop} className="lz-btn lz-btn-outline">
                    <Square size={8} fill="currentColor" />
                    Stop
                  </button>
                ) : (
                  <button type="submit" disabled={!draft.trim()} className="lz-btn">
                    Send
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  )
}
