// The chat's transport, in the main process.
//
// The renderer never sees the engine's URL or its token: the token can invoke
// shell.exec, and the rule that it stays here is not relaxed for a chat. The
// page names a conversation and a message; this turns that into a stream.
//
// It forwards the engine's lines as they are. `done` repeating the whole
// answer after the deltas is not a duplicate to be filtered out here — the
// reducer in @lyzn/chat-core is where that is already decided, and a transport
// that also has an opinion is two places to look when the text is wrong.
import { EventEmitter } from 'node:events'
import { apiStream } from './api.js'
import type { TurnEvent } from './shared/types.js'

/** Why a turn never started, in words a person can act on.
 *
 *  The fetch layer and the engine each answer in their own terms — "This
 *  operation was aborted", "KARMAX is not set up yet" — and neither is a
 *  sentence this app may show: the engine's true name never appears on
 *  screen, and nothing here is jargon. Raw text is never passed through,
 *  because the set of things that can appear in it is not ours to bound.
 */
function whyItCouldNotStart(raw: string | null | undefined, signal: AbortSignal): string {
  if (signal.aborted) return 'Stopped.'
  const text = (raw ?? '').toLowerCase()
  if (text.includes('abort')) return 'Stopped.'
  if (text.includes('not set up') || text.includes('karmax')) {
    return 'Your assistant is not set up on this machine yet.'
  }
  if (text.includes('refused') || text.includes('not running') || text.includes('fetch failed')) {
    return 'The engine is not running. Start it on the dashboard and try again.'
  }
  return 'Your assistant could not be reached just now.'
}

/** Only well-formed choices reach the engine; it validates them again, but a
 *  400 there would surface as a turn that failed for no visible reason. */
function turnOptions(options?: { model?: string; effort?: string }): { model?: string; effort?: string } {
  const out: { model?: string; effort?: string } = {}
  if (typeof options?.model === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(options.model)) out.model = options.model
  if (typeof options?.effort === 'string' && /^(low|medium|high|xhigh|max)$/.test(options.effort)) out.effort = options.effort
  return out
}

export class ChatRunner extends EventEmitter {
  private abort: AbortController | null = null

  /** Ask the engine, and stream the answer back as `event`.
   *
   *  One turn at a time: a second send abandons the first rather than queueing
   *  it, because the window only has one reply open and the person who typed
   *  again meant the new question. */
  async send(
    conversationId: string | null,
    message: string,
    options?: { model?: string; effort?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    this.abort?.abort()
    const turn = new AbortController()
    this.abort = turn

    const res = await apiStream('POST', '/api/chat/stream', { conversationId, message, ...turnOptions(options) }, turn.signal)
    if (!res.ok || !res.body) {
      const error = whyItCouldNotStart(res.error, turn.signal)
      this.push(turn, { kind: 'error', text: error })
      this.settle(turn)
      return { ok: false, error }
    }

    void this.pump(res.body, turn)
    return { ok: true }
  }

  stop(): void {
    this.abort?.abort()
  }

  /** Read newline-delimited JSON as it arrives.
   *
   *  Lines are assembled across chunk boundaries rather than assuming a chunk
   *  is a line: the text deltas are small and arrive 20ms apart, but `done`
   *  carries the whole answer and will not fit in one. */
  private async pump(body: ReadableStream<Uint8Array>, turn: AbortController): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ''
    let ended = false
    try {
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        let cut = buffer.indexOf('\n')
        while (cut >= 0) {
          const line = buffer.slice(0, cut).trim()
          buffer = buffer.slice(cut + 1)
          cut = buffer.indexOf('\n')
          if (!line) continue
          try {
            const event = JSON.parse(line) as TurnEvent
            if (event.kind === 'done' || event.kind === 'error') ended = true
            this.push(turn, event)
          } catch {
            // A half-written line from a stream that was cut off. There is
            // nothing useful to show and nothing to fix.
          }
        }
      }
    } catch (e) {
      const err = e as Error
      this.push(turn, { kind: 'error', text: err.name === 'AbortError' ? 'Stopped.' : err.message })
      this.settle(turn)
      return
    }
    // Nothing but `done` or `error` ends a turn for the window: without one of
    // them the reply stays open, streaming, forever. A stream that stops
    // talking has to say so itself.
    if (!ended) {
      this.push(turn, { kind: 'error', text: 'The engine stopped talking before it finished.' })
    }
    this.settle(turn)
  }

  /** Events from a turn that has been superseded are dropped: a second send
   *  aborts the first, and the dying one's `Stopped.` would otherwise land on
   *  the reply that replaced it. */
  private push(turn: AbortController, event: TurnEvent): void {
    if (this.abort === turn) this.emit('event', event)
  }

  private settle(turn: AbortController): void {
    if (this.abort === turn) this.abort = null
  }
}
