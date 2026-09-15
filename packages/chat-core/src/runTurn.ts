import type { Adapter } from './adapter.ts'
import type { TurnEvent, TurnOptions } from './types.ts'

/** Drives one turn through an adapter, filtering events through a guard.
 *
 *  Pulled out of the hook so the race it closes — a stale turn's late event
 *  landing after the person has switched conversations — is testable without
 *  a renderer. */
export async function runTurn(
  adapter: Adapter,
  conversationId: string | null,
  text: string,
  apply: (e: TurnEvent) => void,
  isCurrent: () => boolean,
  options?: TurnOptions,
): Promise<void> {
  await adapter.send(
    conversationId,
    text,
    (e) => {
      if (isCurrent()) apply(e)
    },
    options,
  )
}
