import { useEffect, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { identifyUser, resetIdentity } from './posthog'

/**
 * Links a visitor's anonymous PostHog trail to their Clerk identity the
 * moment they sign in, and drops it back to anonymous on sign-out — so a
 * shared machine's next visitor never inherits somebody else's history.
 *
 * Mounted once, near the root (App.tsx) — every page reads the same Clerk
 * session, so there is only ever one identity to track.
 */
export function useAnalyticsIdentity() {
  const { isLoaded, isSignedIn, user } = useUser()
  const identified = useRef<string | null>(null)

  useEffect(() => {
    if (!isLoaded) return

    if (isSignedIn && user && identified.current !== user.id) {
      identifyUser(user.id, user.primaryEmailAddress?.emailAddress)
      identified.current = user.id
      return
    }

    if (!isSignedIn && identified.current) {
      resetIdentity()
      identified.current = null
    }
  }, [isLoaded, isSignedIn, user])
}
