import { useCallback, useState } from 'react'
import type { Contact, FieldErrors } from '@/data/pricing'

/**
 * Errors that are always current, and only shown once they are earned.
 *
 * The obvious way to do this — validate in an onBlur handler and store the
 * result — reports on the values the handler closed over, which are one
 * render behind whatever was just typed. The last field somebody fills is
 * then marked invalid while showing a perfectly valid value.
 *
 * So validation is derived during render from the live basket, and the only
 * thing held in state is which fields the person has finished with. A field
 * they have not reached yet stays quiet; a field they have left, or the
 * whole form once they press the button, says what is wrong.
 */
export function useFieldErrors(validate: () => FieldErrors) {
  const [touched, setTouched] = useState<Set<keyof Contact>>(() => new Set())
  const [submitted, setSubmitted] = useState(false)

  const all = validate()

  const touch = useCallback((key: keyof Contact) => {
    setTouched((previous) => {
      if (previous.has(key)) return previous
      const next = new Set(previous)
      next.add(key)
      return next
    })
  }, [])

  const showAll = useCallback(() => setSubmitted(true), [])

  const errors: FieldErrors = submitted
    ? all
    : Object.fromEntries(
        Object.entries(all).filter(([key]) => touched.has(key as keyof Contact)),
      )

  return { errors, all, touch, showAll }
}
