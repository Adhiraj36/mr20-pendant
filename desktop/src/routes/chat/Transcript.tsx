// The conversation, as rows.
//
// deriveRows decides what the rows ARE and is tested in @lyzn/chat-core with
// no DOM; this file only decides what they look like. Consecutive rows of work
// are drawn as one ledger — a strip of tape down the reply's margin — so a turn
// that ran twelve commands reads as one block of evidence above the answer,
// not twelve interruptions in it.
import { useState, type ReactNode } from 'react'
import { deriveRows, emptyUi } from '@lyzn/chat-core'
import type { Message, Row, RowUiState } from '@lyzn/chat-core'
import type { Route } from '@/components/Chrome'
import { Turn } from '@/routes/chat/Turn'
import { PlanRow } from '@/routes/chat/rows/PlanRow'
import { ThoughtRow } from '@/routes/chat/rows/ThoughtRow'
import { TurnFoldRow } from '@/routes/chat/rows/TurnFoldRow'
import { WorkRow } from '@/routes/chat/rows/WorkRow'

/** Adds or removes one id, returning a new set — React will not re-render for
 *  a set mutated in place. */
const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

const ON_TAPE = new Set<Row['kind']>(['thought', 'work', 'work-live', 'work-toggle'])

/** The message a work row belongs to, so its ledger keeps one key for the
 *  whole turn — and the rows inside keep whatever was opened — however many
 *  calls arrive. */
const ownerOf = (row: Row): string => row.id.replace(/:(thought|work|live|toggle)(:.*)?$/, '')

export function Transcript({
  messages,
  onRoute,
  onRetry,
  canRetry,
  anchorId,
}: {
  messages: Message[]
  onRoute: (r: Route) => void
  onRetry: () => void
  canRetry: boolean
  /** The question the view is anchored to, given a scroll margin so it does
   *  not land flush against the sheet's header. */
  anchorId?: string
}) {
  const [ui, setUi] = useState<RowUiState>(emptyUi)
  const rows = deriveRows(messages, ui)

  const draw = (row: Row): ReactNode => {
    switch (row.kind) {
      case 'message':
        return (
          <div
            key={row.id}
            id={`turn-${row.id}`}
            style={row.id === anchorId ? { scrollMarginTop: '1.5rem' } : undefined}
          >
            <Turn
              message={row.message}
              onRoute={onRoute}
              onRetry={onRetry}
              canRetry={canRetry}
              onFold={
                row.message.role === 'user'
                  ? () => setUi((u) => ({ ...u, foldedTurns: toggle(u.foldedTurns, row.message.id) }))
                  : undefined
              }
            />
          </div>
        )

      case 'thought':
        return (
          <ThoughtRow
            key={row.id}
            text={row.text}
            expanded={row.expanded}
            onToggle={() => setUi((u) => ({ ...u, expandedThoughts: toggle(u.expandedThoughts, row.ownerId) }))}
          />
        )

      case 'work':
        return <WorkRow key={row.id} calls={row.calls} />

      case 'work-live':
        return <WorkRow key={row.id} calls={[row.call]} live />

      case 'work-toggle':
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => setUi((u) => ({ ...u, expandedWork: toggle(u.expandedWork, row.ownerId) }))}
            className="lz-ledger-line"
          >
            <span className="w-3 shrink-0 text-center">{row.expanded ? '−' : '+'}</span>
            <span>{row.expanded ? 'Show less' : `Show ${row.hidden} earlier`}</span>
          </button>
        )

      case 'plan':
        return <PlanRow key={row.id} entries={row.entries} />

      // The turn draws its own footer from the message's meta.
      case 'meta':
        return null

      case 'turn-fold':
        return (
          <TurnFoldRow
            key={row.id}
            label={row.label}
            onUnfold={() => setUi((u) => ({ ...u, foldedTurns: toggle(u.foldedTurns, row.turnId) }))}
          />
        )
    }
  }

  const out: ReactNode[] = []
  let tape: ReactNode[] = []
  let tapeOwner = ''
  const flush = () => {
    if (tape.length === 0) return
    out.push(
      <div key={`${tapeOwner}:tape`} className="lz-ledger">
        {tape}
      </div>,
    )
    tape = []
  }

  for (const row of rows) {
    if (ON_TAPE.has(row.kind)) {
      if (tape.length === 0) tapeOwner = ownerOf(row)
      tape.push(draw(row))
    } else {
      flush()
      out.push(draw(row))
    }
  }
  flush()

  return <div>{out}</div>
}
