// One exchange: what the person said, and what came back.
//
// The person's words sit on a slip laid on the right; the reply is not on
// anything, it is typeset straight onto the sheet. One slip and then prose
// reads as someone answering you, which is what this is.
//
// A turn that did work ends with a stamp. A receipt is LYZN's proof that
// something was carried out, and this is the smallest one there is: the steps
// counted, the model and the time, and DONE pressed at the angle every stamp in
// the product lands at. It lands once, when a turn settles in front of you — a
// reopened conversation shows it already pressed.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import { stampAngle } from '@lyzn/design'
import type { Message } from '@lyzn/chat-core'
import type { Route } from '@/components/Chrome'
import { Button } from '@/components/ui'
import { cn } from '@/lib/util'
import { injected, looksLikeTerminal, squeezeTerminal, stripGlyphs } from '@/routes/chat/clean'
import { Markdown } from '@/routes/chat/Markdown'
import { dashboardCards } from '@/routes/chat/dashboardCards'
import { ReceiptCard } from '@/routes/chat/ReceiptCard'

/** A short model name. "claude-opus-5" is the engine's business; "opus 5" is
 *  as much of it as belongs on screen. */
function brain(model?: string): string {
  if (!model) return ''
  const m = model.match(/(opus|sonnet|haiku)[-_]?(\d+(?:[.-]\d+)?)/i)
  return m ? `${m[1].toLowerCase()} ${m[2].replace('-', '.')}` : model
}

function UserTurn({ message, onFold }: { message: Message; onFold?: () => void }) {
  const [open, setOpen] = useState(false)
  const cli = injected(message.text)

  if (cli) {
    if (cli.kind === 'silent') return null
    return (
      <p className="mb-6 text-right font-mono text-[10.5px] text-[var(--fg-faint)]">
        {cli.kind === 'skill' ? `Loaded the ${cli.name} skill` : cli.kind === 'brief' ? 'Handed the task' : `Ran ${cli.name}`}
      </p>
    )
  }

  const terminal = looksLikeTerminal(message.text)
  const text = terminal ? squeezeTerminal(message.text) : stripGlyphs(message.text)
  const long = text.length > 720 || text.split('\n').length > 12

  return (
    // The slip stays text, not a button, so the question itself is still
    // selectable — folding lives in a control beside it instead.
    <div className="group mb-7 flex items-start justify-end gap-2">
      {onFold && (
        <button
          type="button"
          onClick={onFold}
          aria-label="Fold this turn"
          title="Fold this turn"
          className="mt-3.5 shrink-0 text-[var(--fg-faint)] opacity-0 transition-opacity duration-150 hover:text-[var(--fg)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <ChevronRight size={12} />
        </button>
      )}
      <div className="min-w-0 max-w-[min(88%,580px)] border border-[var(--edge)] bg-[var(--skin-2)]">
        <div
          className={cn(
            'selectable whitespace-pre-wrap break-words px-4 py-3 text-[var(--fg)]',
            terminal ? 'font-mono text-[11px] leading-[1.65]' : 'text-[14.5px] leading-[1.55]',
            long && !open && 'lz-clamp',
          )}
        >
          {text}
        </div>
        {long && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="block w-full border-t border-dashed border-[var(--edge)] px-4 py-1.5 text-left font-mono text-[10px] text-[var(--fg-faint)] transition-colors hover:text-[var(--fg)]"
          >
            {open ? 'Show less' : 'Show all'}
          </button>
        )}
      </div>
    </div>
  )
}

function AssistantTurn({
  message,
  onRoute,
  onRetry,
  canRetry,
}: {
  message: Message
  onRoute: (r: Route) => void
  onRetry: () => void
  canRetry: boolean
}) {
  // Whether this turn settled while on screen, which is the only time the
  // stamp is pressed rather than already there.
  const wasStreaming = useRef(message.streaming)
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    if (wasStreaming.current && !message.streaming) setLanded(true)
    wasStreaming.current = message.streaming
  }, [message.streaming])

  const empty = message.text.trim().length === 0
  const cards = [...message.cards, ...dashboardCards(message.toolCalls)]
  const steps = message.toolCalls.length
  const footer = [
    steps ? `${steps} step${steps === 1 ? '' : 's'}` : '',
    brain(message.meta?.model),
    message.meta?.durationMs ? `${(message.meta.durationMs / 1000).toFixed(1)}s` : '',
  ].filter(Boolean)

  // A turn that only worked has its tape above and nothing of its own to say.
  if (empty && !message.streaming && cards.length === 0 && !message.failed) {
    return null
  }

  return (
    <div className="mb-11">
      {/* An empty streaming reply still gets the caret, or the moment between
          asking and the first word looks like nothing happened. */}
      {(!empty || message.streaming) && <Markdown text={message.text} streaming={message.streaming} />}

      {cards.length > 0 && (
        <div className="mt-4 space-y-2">
          {cards.map((c) => (
            <ReceiptCard key={c.id} card={c} onOpen={onRoute} />
          ))}
        </div>
      )}

      {message.failed && (
        <div className="mt-3 flex items-center gap-3">
          <p className="text-[13px]" style={{ color: 'var(--bad)' }}>
            That stopped before it finished.
          </p>
          {canRetry && (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}

      {!message.streaming && !message.failed && !empty && footer.length > 0 && (
        <div className="mt-4 flex items-center gap-3.5 font-mono text-[10px] text-[var(--fg-faint)]">
          {steps > 0 && (
            <span
              className={cn('lz-stamp', landed && 'lz-stamp-land')}
              style={{ '--stamp-angle': `${stampAngle}deg` } as CSSProperties}
            >
              Done
            </span>
          )}
          {footer.map((bit) => (
            <span key={bit}>{bit}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export function Turn({
  message,
  onRoute,
  onRetry,
  canRetry,
  onFold,
}: {
  message: Message
  onRoute: (r: Route) => void
  onRetry: () => void
  /** Retrying mid-turn would leave two replies under one question, so the
   *  offer only exists while nothing is in flight. */
  canRetry: boolean
  onFold?: () => void
}) {
  return message.role === 'user' ? (
    <UserTurn message={message} onFold={onFold} />
  ) : (
    <AssistantTurn message={message} onRoute={onRoute} onRetry={onRetry} canRetry={canRetry} />
  )
}
