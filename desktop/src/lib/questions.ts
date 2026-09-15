// The questions tasks are waiting on, watched from above every screen.
//
// A task that needs a follow-up asks on the phone and here at once, and the
// first answer from either is the answer. So the watch cannot live on the Tasks
// page: the sidebar counts what is open wherever you are, and a question that
// arrives while the window is in the background raises a notification.
import { useEffect, useRef, useState } from 'react'
import type { Ticket } from '@shared/types'

export const openQuestion = (t: Ticket): boolean => Boolean(t.question && !t.question.answer?.trim())

export function useQuestions(enabled: boolean, onOpen: () => void): Ticket[] {
  const [open, setOpen] = useState<Ticket[]>([])
  const seen = useRef<Set<string> | null>(null)
  const go = useRef(onOpen)
  go.current = onOpen

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const read = async () => {
      const res = await window.karmax.lyzn.tickets().catch(() => null)
      if (!alive || !res?.ok || !res.data) return
      const waiting = (res.data.blocked ?? []).filter(openQuestion)
      setOpen(waiting)

      // The ones already open when the window opened are counted, not
      // announced: a notification is for something that just happened.
      if (seen.current === null) {
        seen.current = new Set(waiting.map((t) => t.question!.id))
        return
      }
      for (const t of waiting) {
        const id = t.question!.id
        if (seen.current.has(id)) continue
        seen.current.add(id)
        if (document.hasFocus()) continue
        try {
          const note = new Notification('A task needs your answer', { body: t.question!.text })
          note.onclick = () => {
            void window.karmax.app.focus()
            go.current()
          }
        } catch {
          // A notification is a courtesy; the sidebar still counts it.
        }
      }
    }
    void read()
    const timer = setInterval(read, 20_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [enabled])

  return open
}
