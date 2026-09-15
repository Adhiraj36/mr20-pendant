// Watching an agent connect something.
//
// The engine does the work — an agent, in the browser, clicking through a
// console (see KARMAX's internal/setupagent). This is the part that carries
// what it is doing back to a window somebody is looking at.
//
// It matters that this streams. Connecting Google takes minutes, and a person
// staring at a spinner for four of them will close the app. What they need is
// the running commentary, and above all the moment it becomes their turn: an
// agent waiting at a consent screen looks exactly like an agent that has
// crashed, unless something says otherwise.
import { EventEmitter } from 'node:events'
import { apiStream } from './api.js'
import type { ConnectProgress } from './shared/types.js'

export class ConnectRunner extends EventEmitter {
  private abort: AbortController | null = null
  private currentId: string | null = null

  /** Which service is being connected, or null. */
  busy(): string | null {
    return this.currentId
  }

  /** Start connecting one service. One at a time: they share a browser, and
   *  two agents clicking in the same window is not a thing to find out about
   *  from a bug report. */
  async start(id: string, account?: string): Promise<{ ok: boolean; error?: string }> {
    if (this.currentId) {
      return { ok: false, error: `Still connecting ${this.currentId}.` }
    }
    this.currentId = id
    this.abort = new AbortController()

    const push = (p: ConnectProgress) => this.emit('progress', { id, ...p })
    const finish = (kind: 'done' | 'failed', text: string) => {
      this.currentId = null
      this.abort = null
      this.emit('progress', { id, kind, text })
    }

    const res = await apiStream('POST', `/api/connect/${encodeURIComponent(id)}`,
      account ? { account } : {}, this.abort.signal)
    if (!res.ok || !res.body) {
      finish('failed', res.error ?? 'The engine would not start it.')
      return { ok: false, error: res.error ?? undefined }
    }

    void this.pump(res.body, push, finish)
    return { ok: true }
  }

  cancel(): void {
    this.abort?.abort()
  }

  /** Read newline-delimited JSON as it arrives.
   *
   *  A page snapshot arrives on one line and can be large, so lines are
   *  assembled across chunk boundaries rather than assuming a chunk is a line —
   *  which is true right up until the day it is not. */
  private async pump(
    body: ReadableStream<Uint8Array>,
    push: (p: ConnectProgress) => void,
    finish: (kind: 'done' | 'failed', text: string) => void,
  ): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ''
    let last: ConnectProgress | null = null
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
            const p = JSON.parse(line) as ConnectProgress
            last = p
            push(p)
          } catch {
            // A half-written line from a stream that was cut off. There is
            // nothing useful to show and nothing to fix.
          }
        }
      }
    } catch (e) {
      const err = e as Error
      finish('failed', err.name === 'AbortError' ? 'Stopped.' : err.message)
      return
    }
    // The engine's own last word decides the outcome. Reaching the end of the
    // stream without one means it was cut off.
    if (last?.kind === 'done') {
      finish('done', last.text ?? '')
    } else if (last?.kind === 'failed') {
      finish('failed', last.text ?? 'It stopped before it finished.')
    } else {
      finish('failed', 'The engine stopped talking before it finished.')
    }
  }
}
