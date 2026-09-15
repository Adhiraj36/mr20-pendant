// Watching an agent connect something.
//
// Connecting Google is a project, six APIs, a consent screen, an OAuth client
// and a download. An agent does that part; this is the window it does it in
// front of.
//
// The design problem here is not the log — it is that an agent waiting for
// somebody to click Allow looks exactly like an agent that has crashed. So the
// running commentary is the body, and the moment it becomes your turn is lifted
// out of it entirely and put where it cannot be scrolled past.
import { useEffect, useRef, useState } from 'react'
import { Check, Hand, Loader2, X } from 'lucide-react'
import type { ConnectProgress } from '@shared/types'
import { Button } from '@/components/ui'
import { Modal } from '@/components/Overlays'

type Line = { kind: ConnectProgress['kind']; text: string; at: number }

export function ConnectFlow({
  open,
  onClose,
  id,
  name,
  lede,
  onFinished,
}: {
  open: boolean
  onClose: () => void
  id: string
  name: string
  lede: string
  onFinished?: (ok: boolean) => void
}) {
  const [lines, setLines] = useState<Line[]>([])
  const [turn, setTurn] = useState<string | null>(null)
  const [done, setDone] = useState<boolean | null>(null)
  const [closing, setClosing] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  /** Which run this component has already started.
   *
   *  React runs an effect twice in development, and the cleanup in between
   *  used to cancel the run the first pass had just started — so the window
   *  showed "Stopped." before the agent had done anything, then began again.
   *  Stopping is a thing the person does, not a thing a re-render does. */
  const started = useRef<string | null>(null)

  // Listening and starting are separate on purpose.
  //
  // React runs an effect twice in development. Guarding both together meant
  // the second pass returned early — after the first pass's cleanup had
  // already unsubscribed — and the window then sat on "Starting…" while the
  // agent worked away with nobody listening.
  useEffect(() => {
    if (!open) return
    return window.karmax.connect.onProgress((p) => {
      if (p.id && p.id !== id) return
      const text = plain(p.text ?? '')

      if (p.kind === 'needs-you') {
        // Kept out of the log as well as in it. Somebody who looks away for a
        // minute has to be able to come back and see whose turn it is without
        // reading anything.
        //
        // And it stays until the run ends or another one replaces it. An
        // earlier version cleared it as soon as the agent did anything else,
        // which meant the panel vanished the instant the agent started
        // polling for the page to change — that is, at the exact moment the
        // person was the only one who could do anything.
        setTurn(text)
      }

      if (p.kind === 'done' || p.kind === 'failed') {
        setDone(p.kind === 'done')
        setTurn(null)
        setClosing(text)
        onFinished?.(p.kind === 'done')
      }
      // The opening line is already the window's subtitle; repeating it as the
      // first thing in the log reads like a stutter.
      if (text && p.kind !== 'starting') {
        setLines((l) => [...l, { kind: p.kind, text, at: Date.now() }].slice(-300))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id])

  // Started once per opening. Stopping is a thing the person does, not a thing
  // a re-render does, so nothing here cancels on unmount — see close().
  useEffect(() => {
    if (!open || started.current === id) return
    started.current = id
    setLines([])
    setTurn(null)
    setDone(null)
    setClosing('')

    void window.karmax.connect.start(id).then((r) => {
      if (!r.ok) {
        setDone(false)
        setClosing(r.error ?? 'Could not start.')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines.length])

  /** Closing the window is what stops the run — and the only thing that does.
   *  A finished run has nothing to cancel, so this is safe either way. */
  const close = () => {
    started.current = null
    void window.karmax.connect.cancel()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Connect ${name}`}
      lede={lede}
      wide
      footer={
        <>
          {done === null && (
            <span className="mr-auto flex items-center gap-2 text-[12.5px] text-[var(--fg-dim)]">
              <Loader2 size={14} className="animate-spin" />
              Working — you can leave this open.
            </span>
          )}
          {done === true && (
            <span className="mr-auto flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--ok)' }}>
              <Check size={14} /> {name} is connected.
            </span>
          )}
          {done === false && (
            <span className="mr-auto flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--bad)' }}>
              <X size={14} /> Stopped before it finished.
            </span>
          )}
          <Button variant={done === null ? 'ghost' : 'primary'} onClick={close}>
            {done === null ? 'Stop' : 'Close'}
          </Button>
        </>
      }
    >
      {turn && <YourTurn text={turn} />}

      {done !== null && closing && (
        <div
          className="mb-3 rounded-[var(--radius)] border p-3 text-[13px] leading-relaxed"
          style={{
            borderColor: done ? 'var(--ok)' : 'var(--bad)',
            color: 'var(--fg)',
            background: 'var(--surface)',
          }}
        >
          {closing}
        </div>
      )}

      <div
        ref={logRef}
        className="max-h-[46vh] overflow-y-auto rounded-[var(--radius)] border p-3"
        style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
      >
        {lines.length === 0 ? (
          <p className="text-[13px] text-[var(--fg-dim)]">Starting…</p>
        ) : (
          <ol className="space-y-1.5">
            {lines.map((l, i) => (
              <Step key={i} line={l} last={i === lines.length - 1 && done === null} />
            ))}
          </ol>
        )}
      </div>
    </Modal>
  )
}

/** Markdown, flattened.
 *
 *  The agent writes for a chat window and emphasises the important sentence
 *  with asterisks. Rendering markdown here would be a lot of surface for one
 *  effect; showing the asterisks is worse than not emphasising at all. */
function plain(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

/** The one thing on this screen somebody has to act on. */
function YourTurn({ text }: { text: string }) {
  return (
    <div
      className="mb-3 flex gap-3 rounded-[var(--radius)] border-2 p-3"
      style={{ borderColor: 'var(--accent)', background: 'var(--surface)' }}
    >
      <Hand size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
      <div>
        <p className="text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          Your turn
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--fg)]">
          {text}
        </p>
        <p className="mt-1.5 text-[12px] text-[var(--fg-dim)]">
          It is in the browser window that just opened. This carries on by itself afterwards.
        </p>
      </div>
    </div>
  )
}

/** One line of the commentary.
 *
 *  What the agent DID is dimmed and small; what it SAID is the readable part.
 *  A person skimming wants the sentences, not the click-by-click. */
function Step({ line, last }: { line: Line; last: boolean }) {
  if (line.kind === 'doing') {
    return (
      <li className="flex items-center gap-2 text-[12.5px] text-[var(--fg-dim)]">
        {last ? (
          <Loader2 size={12} className="animate-spin" style={{ flexShrink: 0 }} />
        ) : (
          <span
            className="inline-block h-1 w-1 rounded-full"
            style={{ background: 'var(--fg-dim)', flexShrink: 0, marginLeft: 5, marginRight: 5 }}
          />
        )}
        {line.text}
      </li>
    )
  }
  const isTurn = line.kind === 'needs-you'
  return (
    <li
      className="whitespace-pre-wrap text-[13px] leading-relaxed"
      style={{ color: isTurn ? 'var(--accent)' : 'var(--fg)' }}
    >
      {line.text}
    </li>
  )
}
