// Dictation for the composer: the helper's events, reduced to what the
// composer draws — whether it is listening, how loud, and the words so far.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DictationEvent } from '@shared/types'

export type DictationState = 'idle' | 'starting' | 'listening' | 'finishing'

const BARS = 36
const quiet = () => Array<number>(BARS).fill(0)

export function useDictation(handlers: {
  /** The transcript so far; `final` once it has settled. */
  onText: (text: string, final: boolean) => void
  onError: (message: string, code: string) => void
}) {
  const [available, setAvailable] = useState(false)
  const [state, setState] = useState<DictationState>('idle')
  const [levels, setLevels] = useState<number[]>(quiet)
  const [startedAt, setStartedAt] = useState(0)
  const on = useRef(handlers)
  on.current = handlers
  // The helper broadcasts to the whole window; only the composer that pressed
  // the microphone listens to it, or every answer box on a page would fill.
  const mine = useRef(false)

  useEffect(() => {
    void window.karmax.dictation
      ?.available()
      .then(setAvailable)
      .catch(() => setAvailable(false))
  }, [])

  useEffect(
    () =>
      window.karmax.dictation?.onEvent((e: DictationEvent) => {
        if (!mine.current) return
        switch (e.type) {
          case 'ready':
            setState('listening')
            setStartedAt(Date.now())
            return
          case 'level':
            setLevels((l) => [...l.slice(1), e.value])
            return
          case 'partial':
            on.current.onText(e.text, false)
            return
          case 'final':
            on.current.onText(e.text, true)
            setState('idle')
            mine.current = false
            return
          case 'error':
            // Silence is not a failure worth a message; the composer just
            // gets its microphone back.
            if (e.code !== 'no-speech') on.current.onError(e.message, e.code)
            setState('idle')
            mine.current = false
            return
          case 'end':
            setState('idle')
            setLevels(quiet())
            mine.current = false
            return
        }
      }),
    [],
  )

  // Leaving the screen mid-sentence must not leave a microphone open.
  useEffect(
    () => () => {
      if (mine.current) void window.karmax.dictation?.cancel()
    },
    [],
  )

  const start = useCallback(async () => {
    if (state !== 'idle') return
    setState('starting')
    setStartedAt(0)
    mine.current = true
    const res = await window.karmax.dictation.start()
    if (!res.ok) {
      mine.current = false
      setState('idle')
      on.current.onError(res.error ?? 'Dictation could not start.', 'failed')
    }
  }, [state])

  const stop = useCallback(() => {
    if (state !== 'listening' && state !== 'starting') return
    setState('finishing')
    void window.karmax.dictation.stop()
  }, [state])

  const cancel = useCallback(() => {
    if (state === 'idle' || !mine.current) return
    void window.karmax.dictation.cancel()
  }, [state])

  return { available, state, levels, startedAt, start, stop, cancel }
}
