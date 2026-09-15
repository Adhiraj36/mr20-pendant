/** A tool call, as the engine reports it.
 *
 *  `kind` and `status` are ACP's vocabularies verbatim, so a second harness
 *  speaking that protocol needs no translation table here. */
export interface ToolCall {
  /** Stable for the life of the call. Updates are merged onto it by id —
   *  matching by name is what made two calls to one tool resolve each other. */
  id: string
  title?: string
  kind?: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  locations?: { path: string; line?: number }[]
  /** The call's arguments as the agent sent them, long strings already cut
   *  by the engine. What makes "ran a command" say which command. */
  input?: Record<string, unknown>
  output?: string
}

/** How one turn should be answered. Absent fields mean the engine's own
 *  defaults, so an engine that knows nothing of them answers as before. */
export interface TurnOptions {
  model?: string
  effort?: string
}

/** One line of the agent's plan. */
export interface PlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
  priority?: string
}

/** What a finished turn cost, for the transcript's footer. */
export interface TurnMeta {
  model?: string
  durationMs?: number
  costUsd?: number
}

/** One thing the engine says while a turn is running.
 *
 *  Closed on purpose: the reducer is a switch over this, and a kind nobody
 *  handles is a silent no-op rather than a visible bug. */
export type TurnEvent =
  | { kind: 'conversation'; id: string }
  | { kind: 'message'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; tool: ToolCall }
  | { kind: 'tool_update'; tool: Pick<ToolCall, 'id' | 'status'> & Partial<ToolCall> }
  | { kind: 'plan'; plan: PlanEntry[] }
  | { kind: 'ticket'; jobId: string; title: string }
  | { kind: 'meta'; model?: string; durationMs?: number; costUsd?: number }
  | { kind: 'done'; text?: string }
  | { kind: 'error'; text: string }

/** Something the assistant made or started, that you can go and look at. */
export interface Card {
  kind: 'ticket' | 'loop' | 'dashboard'
  id: string
  title: string
  status: string
  /** Still moving — the card shows a pulsing dot and expects updates. */
  live: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Reasoning, when the conversation asked for it. Kept apart from `text`
   *  because it is evidence of work, not the answer. */
  thought: string
  toolCalls: ToolCall[]
  plan: PlanEntry[]
  cards: Card[]
  /** Work landed after some of the reply was written, so the next words open
   *  a new paragraph rather than running on from the last. */
  textBreak?: boolean
  meta?: TurnMeta
  streaming?: boolean
  failed?: boolean
}

export interface ChatState {
  conversationId: string | null
  messages: Message[]
  busy: boolean
}
