import { useCallback, useEffect, useRef, useState } from 'react'
import type { Adapter } from './adapter.ts'
import { ask, empty, rearm, reduce } from './reduce.ts'
import { runTurn } from './runTurn.ts'
import type { ChatState, TurnOptions } from './types.ts'

/** One conversation, held outside the screen.
 *
 *  The reply reduces into this state rather than into component state:
 *  leaving the thread mid-answer must not kill the turn. */
export function useConversation(adapter: Adapter, conversationId: string | null) {
  const [state, setState] = useState<ChatState>(empty())
  const lastAsked = useRef<{ text: string; options?: TurnOptions }>({ text: '' })
  // Bumped by every send and by every conversation switch: a turn's events
  // only apply while its own value is still current, so an abandoned turn
  // can't write into a conversation the person has since moved on from.
  const turn = useRef(0)

  useEffect(() => {
    turn.current++
    let live = true
    if (!conversationId) { setState(empty()); return }
    void adapter.history(conversationId).then((messages) => {
      if (live) setState({ conversationId, messages, busy: false })
    })
    return () => { live = false }
  }, [adapter, conversationId])

  const start = useCallback((text: string, seed: (s: ChatState) => ChatState, options?: TurnOptions) => {
    lastAsked.current = { text, options }
    const mine = ++turn.current
    setState(seed)
    // state.conversationId, not the id argument: a turn can establish the
    // session mid-flight, and that is what the next turn must continue.
    return runTurn(adapter, state.conversationId, text, (e) => {
      setState((prev) => reduce(prev, e))
    }, () => turn.current === mine, options)
  }, [adapter, state.conversationId])

  const send = useCallback(
    (text: string, options?: TurnOptions) => start(text, (prev) => ask(prev, text), options),
    [start],
  )

  const retry = useCallback(() => {
    // A retry is the same question asked the same way, model and effort too.
    const { text, options } = lastAsked.current
    if (text) void start(text, rearm, options)
  }, [start])

  return { state, send, retry, stop: adapter.stop }
}
