import type { ChatState, Message, TurnEvent } from './types.ts'

export const empty = (): ChatState => ({ conversationId: null, messages: [], busy: false })

let seq = 0
const id = () => `m${++seq}`

const blank = (role: Message['role'], text = ''): Message => ({
  id: id(), role, text, thought: '', toolCalls: [], plan: [], cards: [],
})

/** The person asks. The empty reply is created here so every event that
 *  follows has somewhere to land, whatever order they arrive in. */
export function ask(state: ChatState, text: string): ChatState {
  const user = blank('user', text)
  const reply = { ...blank('assistant'), streaming: true }
  return { ...state, busy: true, messages: [...state.messages, user, reply] }
}

/** Retry after a failure: drop the failed reply and open a fresh one, but
 *  leave the user's message where it is — `ask` would post it a second time. */
export function rearm(state: ChatState): ChatState {
  const messages = [...state.messages]
  const last = messages.at(-1)
  if (last?.role === 'assistant' && last.failed) messages.pop()
  messages.push({ ...blank('assistant'), streaming: true })
  return { ...state, busy: true, messages }
}

export function reduce(state: ChatState, event: TurnEvent): ChatState {
  if (event.kind === 'conversation') return { ...state, conversationId: event.id }

  const messages = [...state.messages]
  let i = messages.length - 1
  if (i < 0 || messages[i].role !== 'assistant') {
    // An event with no reply to attach to: the turn began elsewhere, or was
    // restored from history. Make somewhere for it rather than dropping it.
    messages.push({ ...blank('assistant'), streaming: true })
    i = messages.length - 1
  }
  const m: Message = {
    ...messages[i],
    toolCalls: [...messages[i].toolCalls],
    cards: [...messages[i].cards],
  }
  messages[i] = m

  switch (event.kind) {
    case 'message':
      // Prose either side of a tool call is two paragraphs. The CLI streams
      // each text block's deltas with nothing between blocks, so without this
      // "Let me check." and "## Found it" arrive as one run-on line.
      if (m.textBreak) {
        if (m.text) m.text = m.text.trimEnd() + '\n\n'
        delete m.textBreak
      }
      m.text += event.text
      return { ...state, messages }

    case 'thought':
      m.thought += event.text
      return { ...state, messages }

    case 'tool':
      m.toolCalls.push(event.tool)
      if (m.text) m.textBreak = true
      return { ...state, messages }

    case 'tool_update': {
      // Merge onto the call this update names. An update for a call nobody
      // announced is dropped rather than invented: TodoWrite becomes a plan,
      // so its own tool_result arrives with an id the transcript never saw.
      const k = m.toolCalls.findIndex((c) => c.id === event.tool.id)
      if (k >= 0) m.toolCalls[k] = { ...m.toolCalls[k], ...event.tool }
      return { ...state, messages }
    }

    case 'plan':
      // Replaced wholesale: the agent revises the whole list each time, and
      // merging entry by entry would invent a history it does not have.
      m.plan = event.plan
      if (m.text) m.textBreak = true
      return { ...state, messages }

    case 'ticket':
      m.cards.push({ kind: 'ticket', id: event.jobId, title: event.title, status: 'Running', live: true })
      return { ...state, messages }

    case 'meta':
      m.meta = { model: event.model, durationMs: event.durationMs, costUsd: event.costUsd }
      return { ...state, messages }

    case 'done':
      // The turn's own answer wins over the deltas: a partial stream can be
      // truncated, and this is the text the engine stands behind. It is only
      // the turn's last text block, though, so a stream that already ends
      // with it keeps what was written before the work.
      if (event.text && !m.text.trimEnd().endsWith(event.text.trim())) m.text = event.text
      delete m.textBreak
      m.streaming = false
      return { ...state, messages, busy: false }

    case 'error':
      m.streaming = false
      m.failed = true
      return { ...state, messages, busy: false }
  }
}
