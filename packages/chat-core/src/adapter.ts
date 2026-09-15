import type { Message, TurnEvent, TurnOptions } from './types.ts'

export interface ConversationSummary {
  id: string
  title: string
  opening: string
  updated: string
}

/** How a chat reaches its engine. The package does no I/O itself: the desktop
 *  reads NDJSON from KARMAX over IPC, the phone reads SSE from the backend,
 *  and neither transport belongs in shared code. */
export interface Adapter {
  send(
    conversationId: string | null,
    text: string,
    onEvent: (e: TurnEvent) => void,
    options?: TurnOptions,
  ): Promise<void>
  stop(): void
  list(): Promise<ConversationSummary[]>
  history(id: string): Promise<Message[]>
}
