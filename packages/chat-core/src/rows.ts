// The transcript as rows, derived rather than stored.
//
// Kept apart from any renderer so the grouping rules — which are the whole
// reason a turn that read twelve files reads as two lines — can be tested
// without a DOM. The shape follows t3code's MessagesTimeline.logic.ts
// (https://github.com/pingdotgg/t3code, MIT, Copyright (c) 2026 T3 Tools Inc.)
import type { Message, PlanEntry, ToolCall, TurnMeta } from './types.ts'

/** Beyond this many groups in one turn, the older ones fold away.
 *
 *  A starting number, not a finding. Change it if it reads badly. */
export const WORK_GROUP_LIMIT = 4

/** What the person has clicked. Renderer state, passed in, so deriveRows
 *  stays a function of its arguments. */
export interface RowUiState {
  foldedTurns: ReadonlySet<string>
  expandedThoughts: ReadonlySet<string>
  expandedWork: ReadonlySet<string>
}

export const emptyUi: RowUiState = {
  foldedTurns: new Set(),
  expandedThoughts: new Set(),
  expandedWork: new Set(),
}

export type Row =
  | { kind: 'message'; id: string; message: Message }
  | { kind: 'thought'; id: string; ownerId: string; text: string; expanded: boolean }
  | { kind: 'work'; id: string; calls: ToolCall[] }
  | { kind: 'work-live'; id: string; call: ToolCall }
  | { kind: 'work-toggle'; id: string; ownerId: string; hidden: number; expanded: boolean }
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
  | { kind: 'turn-fold'; id: string; turnId: string; label: string }
  | { kind: 'meta'; id: string; meta: TurnMeta }

const settled = (c: ToolCall) => c.status === 'completed' || c.status === 'failed'

export function deriveRows(messages: Message[], ui: RowUiState): Row[] {
  const rows: Row[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]

    if (m.role === 'user') {
      // A folded turn is the question and nothing else — the reply that
      // follows it is skipped with it.
      if (ui.foldedTurns.has(m.id)) {
        rows.push({ kind: 'turn-fold', id: `${m.id}:fold`, turnId: m.id, label: m.text })
        if (messages[i + 1]?.role === 'assistant') i++
        continue
      }
      rows.push({ kind: 'message', id: m.id, message: m })
      continue
    }

    if (m.thought) {
      rows.push({
        kind: 'thought',
        id: `${m.id}:thought`,
        ownerId: m.id,
        text: m.thought,
        expanded: ui.expandedThoughts.has(m.id),
      })
    }

    // Build an ordered list of items (groups or live calls) in source order.
    // Consecutive settled calls of the same kind form one group.
    // Unsettled calls break groups and become separate live items.
    type WorkItem = { type: 'group'; calls: ToolCall[] } | { type: 'live'; call: ToolCall }
    const items: WorkItem[] = []
    let currentGroup: ToolCall[] | null = null

    for (const c of m.toolCalls) {
      if (!settled(c)) {
        // Unsettled call breaks the current group.
        if (currentGroup) {
          items.push({ type: 'group', calls: currentGroup })
          currentGroup = null
        }
        items.push({ type: 'live', call: c })
      } else {
        // Settled call extends or starts a group.
        const last = currentGroup
        if (last && last[0].kind === c.kind) last.push(c)
        else {
          if (last) items.push({ type: 'group', calls: last })
          currentGroup = [c]
        }
      }
    }
    if (currentGroup) items.push({ type: 'group', calls: currentGroup })

    // Extract settled groups to apply fold logic.
    const groups = items.filter((i) => i.type === 'group').map((i) => i.calls)
    const expanded = ui.expandedWork.has(m.id)
    const hiddenCount = expanded ? 0 : Math.max(0, groups.length - WORK_GROUP_LIMIT)
    const firstVisibleGroupIndex = hiddenCount

    // Map each item to its group index (if it's a group).
    let groupIndex = 0
    let toggleEmitted = false

    // The toggle sits above the groups in both states, because that is where
    // the hidden older work would have been — a control that moves to the far
    // end of the list on expand puts itself under a different finger than the
    // one that just clicked it.
    const foldable = groups.length > WORK_GROUP_LIMIT

    for (const item of items) {
      if (item.type === 'live') {
        if (!toggleEmitted && foldable) {
          rows.push({
            kind: 'work-toggle',
            id: `${m.id}:toggle`,
            ownerId: m.id,
            hidden: hiddenCount,
            expanded,
          })
          toggleEmitted = true
        }
        rows.push({ kind: 'work-live', id: `${m.id}:live:${item.call.id}`, call: item.call })
      } else {
        // Settled group.
        if (groupIndex >= firstVisibleGroupIndex) {
          // This group is visible.
          if (!toggleEmitted && foldable) {
            rows.push({
              kind: 'work-toggle',
              id: `${m.id}:toggle`,
              ownerId: m.id,
              hidden: hiddenCount,
              expanded,
            })
            toggleEmitted = true
          }
          rows.push({ kind: 'work', id: `${m.id}:work:${item.calls[0].id}`, calls: item.calls })
        }
        groupIndex++
      }
    }

    if (m.plan.length > 0) {
      rows.push({ kind: 'plan', id: `${m.id}:plan`, entries: m.plan })
    }

    rows.push({ kind: 'message', id: m.id, message: m })

    // Only once the turn has settled: a footer under a reply still being
    // written reports a duration that is not yet true.
    if (m.meta && !m.streaming) {
      rows.push({ kind: 'meta', id: `${m.id}:meta`, meta: m.meta })
    }
  }

  return rows
}

const NOUN: Record<string, [one: string, many: string]> = {
  read: ['file', 'files'],
  edit: ['file', 'files'],
  delete: ['file', 'files'],
  move: ['file', 'files'],
  search: ['search', 'searches'],
  execute: ['command', 'commands'],
  fetch: ['page', 'pages'],
  think: ['thought', 'thoughts'],
}

const VERB: Record<string, string> = {
  read: 'read', edit: 'wrote', delete: 'deleted', move: 'moved',
  search: 'searched', execute: 'ran', fetch: 'fetched', think: 'considered',
}

/** Tells an agent-written description apart from a bare token, so a single
 *  call never reads like "ran Check the tests still pass" — a title that's
 *  already a sentence doesn't need a verb bolted on front of it. A written
 *  phrase has a space in it and opens with a capital letter, the way a
 *  sentence does; a token (a filename, a glob, a host, a search pattern)
 *  either has no space or starts lowercase, e.g. "func main". */
function isWrittenPhrase(title: string): boolean {
  return /^[A-Z]/.test(title) && /\s/.test(title)
}

/** What a group of calls did, in a person's words.
 *
 *  One call says what it touched, because the title is the useful part;
 *  several say how many, because four file names in a row is noise. */
export function summarise(calls: ToolCall[]): string {
  const kind = calls[0].kind ?? 'other'
  if (calls.length === 1) {
    const title = calls[0].title ?? ''
    const verb = VERB[kind]
    if (verb && !isWrittenPhrase(title)) return `${verb} ${title}`.trim()
    return title || 'did something'
  }
  // 'other' and switch_mode cover questions, skills, searches and delegations
  // with nothing in common to verb or count — measured as 42 of 913 real
  // calls, not a rare case worth a fake "ran N things". Naming the first
  // call's own title, the way the single-call case already does, beats
  // inventing a verb for actions that share none.
  if (kind === 'other' || kind === 'switch_mode') {
    const title = calls[0].title ?? 'did something'
    return `${title} and ${calls.length - 1} more`
  }
  const verb = VERB[kind] ?? 'ran'
  const noun = NOUN[kind]?.[1] ?? 'things'
  return `${verb} ${calls.length} ${noun}`
}
