import { useEffect } from 'react'

/**
 * Sets the tab title for as long as this page is mounted, then restores
 * whatever it was before.
 *
 * Without the restore, leaving a checkout step for the one before it (the
 * back link, a validation redirect) leaves that step's title sitting in the
 * tab — right up until the next page happens to set its own.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
