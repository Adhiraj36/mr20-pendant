// What it did, as lines on the tape.
//
// A line opens to what the call was given and what it brought back, so "ran 4
// commands" is one click from the four commands and each one's output. The
// engine sends the arguments as the agent wrote them; this file only decides
// how each kind of argument reads.
import { useState } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import { summarise } from '@lyzn/chat-core'
import type { ToolCall } from '@lyzn/chat-core'
import { cn } from '@/lib/util'
import { CodeBlock } from '@/routes/chat/Markdown'
import { hasInput, inputPieces, openable } from '@/routes/chat/toolInput'

function Mark({ status }: { status: ToolCall['status'] }) {
  return (
    <span className="grid w-3 shrink-0 place-items-center">
      {status === 'in_progress' || status === 'pending' ? (
        <span className="relative flex size-[7px]">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-60" />
          <span className="relative size-[7px] rounded-full bg-[var(--accent)]" />
        </span>
      ) : status === 'failed' ? (
        <X size={11} strokeWidth={2.25} className="text-[var(--bad)]" />
      ) : (
        <Check size={11} strokeWidth={2.25} />
      )}
    </span>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={10}
      className={cn(
        'shrink-0 transition duration-150',
        open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100',
      )}
    />
  )
}

function CallDetail({ call }: { call: ToolCall }) {
  const output = call.output?.replace(/\s+$/, '')
  const running = call.status === 'in_progress' || call.status === 'pending'
  return (
    <div className="lz-call">
      {hasInput(call) && (
        <>
          <p className="lz-call-label">Input</p>
          {inputPieces(call.input!).map((p, i) =>
            'note' in p ? (
              <p key={i} className="lz-call-note">
                {p.note}
              </p>
            ) : (
              <CodeBlock key={i} code={p.code} lang={p.lang} maxHeight={260} />
            ),
          )}
        </>
      )}
      <p className="lz-call-label">Output</p>
      {output ? (
        <CodeBlock code={output} lang="" maxHeight={320} />
      ) : (
        <p className="lz-call-note">
          {running ? 'Still running.' : call.status === 'failed' ? 'It failed without saying why.' : 'Nothing came back.'}
        </p>
      )}
    </div>
  )
}

function CallRow({ call, label, live }: { call: ToolCall; label: string; live?: boolean }) {
  const [open, setOpen] = useState(false)
  const can = openable(call)
  return (
    <div>
      <button
        type="button"
        disabled={!can}
        aria-expanded={can ? open : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn('lz-ledger-line group', live && 'text-[var(--fg-dim)]')}
      >
        <Mark status={live ? 'in_progress' : call.status} />
        <span className="min-w-0 truncate" title={call.title}>
          {label}
        </span>
        {can && <Chevron open={open} />}
      </button>
      {open && <CallDetail call={call} />}
    </div>
  )
}

export function WorkRow({ calls, live }: { calls: ToolCall[]; live?: boolean }) {
  const [open, setOpen] = useState(false)

  if (calls.length === 1) return <CallRow call={calls[0]} label={summarise(calls)} live={live} />

  const status: ToolCall['status'] = calls.some((c) => c.status === 'failed') ? 'failed' : 'completed'
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="lz-ledger-line group">
        <Mark status={status} />
        <span className="min-w-0 truncate">{summarise(calls)}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="lz-ledger-calls">
          {calls.map((c) => (
            <CallRow key={c.id} call={c} label={c.title || c.kind || 'step'} />
          ))}
        </div>
      )}
    </div>
  )
}
