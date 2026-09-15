// The engine, shaped the way @lyzn/chat-core expects.
//
// Every call here names an intent. The engine's address and its token stay in
// the main process, because that token can invoke shell.exec and a chat screen
// is not a reason to relax the one rule this app has about it.
import type { Adapter, Message, ToolCall, TurnEvent, TurnOptions } from '@lyzn/chat-core'
import type { EngineMessage } from '@shared/types'
import { unglue } from '@/routes/chat/clean'

/** An older engine kept a turn's work as `{tool, phase}` steps, with no id and
 *  no title. Read onto the call shape so a history from one still shows that
 *  work happened, even though it cannot say which file. */
type LegacyStep = { tool?: string; phase?: string; detail?: string }

const LEGACY: Record<string, [kind: ToolCall['kind'], title: string]> = {
  Bash: ['execute', 'a command'],
  Read: ['read', 'a file'],
  Write: ['edit', 'a file'],
  Edit: ['edit', 'a file'],
  MultiEdit: ['edit', 'a file'],
  Grep: ['search', 'the files'],
  Glob: ['search', 'the files'],
  WebFetch: ['fetch', 'a page'],
  WebSearch: ['fetch', 'the web'],
}

function fromSteps(owner: string, steps: LegacyStep[]): ToolCall[] {
  return steps.map((s, j) => {
    const [kind, title] = LEGACY[s.tool ?? ''] ?? ['other', s.tool ?? 'Worked']
    return {
      id: `${owner}-step-${j}`,
      kind,
      title: s.detail?.trim() || title,
      status: s.phase === 'failed' || s.phase === 'error' ? 'failed' : 'completed',
    }
  })
}

/** A turn, resolved when the engine stops talking.
 *
 *  The bridge broadcasts every event to the whole window rather than to a
 *  caller, so the promise is closed by the terminal event instead of by the
 *  send() call — which returns as soon as the request is accepted, long before
 *  the answer exists. */
function turn(
  conversationId: string | null,
  text: string,
  onEvent: (e: TurnEvent) => void,
  options?: TurnOptions,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      off()
      resolve()
    }
    const off = window.karmax.chat.onEvent((e) => {
      onEvent(e)
      if (e.kind === 'done' || e.kind === 'error') finish()
    })
    void window.karmax.chat.send(conversationId, text, options).then((r) => {
      // A refusal before the stream opens never produces a terminal event of
      // its own, so the turn would otherwise hang with the reply still marked
      // streaming.
      if (!r.ok) finish()
    })
  })
}

/** A stored transcript as the package's messages. The chat's history and a
 *  task's record of work are kept by the engine in the same shape. */
export function toMessages(owner: string, msgs: EngineMessage[]): Message[] {
  // The engine's message and the package's are not the same shape: a
  // transcript read from disk has no ids and no cards, because neither exists
  // until a screen renders it.
  return msgs.map((m, i) => ({
    id: `${owner}:${i}`,
    role: m.role,
    // No toolCalls means the older engine, which also glued its prose.
    text: m.toolCalls || m.role === 'user' ? m.text : unglue(m.text),
    thought: '',
    toolCalls: (m.toolCalls as ToolCall[] | undefined) ?? fromSteps(`${owner}-${i}`, (m as { steps?: LegacyStep[] }).steps ?? []),
    plan: [],
    cards: [],
  }))
}

export const engineAdapter: Adapter = {
  send: turn,
  stop() {
    void window.karmax.chat.stop()
  },
  async list() {
    return (await window.karmax.chat.list()).conversations
  },
  async history(id): Promise<Message[]> {
    return toMessages(id, await window.karmax.chat.history(id))
  },
}
