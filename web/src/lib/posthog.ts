import posthog from 'posthog-js'
import { POSTHOG_HOST, POSTHOG_KEY } from './env'

/**
 * Started once, from main.tsx, before the app renders.
 *
 * Off outside production: a laptop reloading the same page all day would
 * otherwise sit in the same funnels as an actual visitor. `defaults` pins
 * autocapture, pageview (including React Router's history-change
 * navigations) and pageleave to PostHog's 2026-05-30 settings, which is why
 * nothing here fires a `$pageview` by hand — the events below only add what
 * autocapture cannot see: which funnel stage, which plan, how much.
 */
export function initAnalytics() {
  if (!import.meta.env.PROD) return
  posthog.init(POSTHOG_KEY, { api_host: POSTHOG_HOST, defaults: '2026-05-30' })
}

/**
 * Every custom event this site sends, named once so a typo in an event name
 * or a missing property fails the build instead of silently going
 * uncounted in PostHog.
 */
type EventMap = {
  preorder_cta_clicked: { plan: string }
  tier_selected: { plan: string }
  checkout_contact_submitted: { plan: string; signedIn: boolean }
  checkout_code_verified: { plan: string }
  checkout_payment_started: { plan: string; reference: string; amount: number }
  /** The purchase event — `revenue` is the property PostHog's revenue
      analytics reads, in rupees, same figure the paysheet charged. */
  order_completed: { plan: string; reference: string; revenue: number; currency: string }
  checkout_payment_failed: {
    plan: string
    reason: 'order_create_failed' | 'verify_failed' | 'dismissed' | 'payment_failed'
  }
  daemon_download_clicked: { os: string; variant: 'primary' | 'alternate'; ownPlatform: boolean }
}

/** posthog.capture, typed against the table above. A no-op outside production, same as initAnalytics. */
export function track<K extends keyof EventMap>(name: K, props: EventMap[K]) {
  if (!import.meta.env.PROD) return
  posthog.capture(name, props)
}

/**
 * Links the anonymous trail PostHog has already been keeping to a signed-in
 * visitor's Clerk id, so a browse-then-sign-in-then-buy journey reads as one
 * person rather than two. `identifyUser`/`resetIdentity` are the only two
 * places `posthog.identify`/`posthog.reset` are called — see useAnalyticsIdentity.
 */
export function identifyUser(userId: string, email?: string) {
  if (!import.meta.env.PROD) return
  posthog.identify(userId, email ? { email } : undefined)
}

/** Drops the identity on sign-out, so the next visitor on a shared machine starts anonymous. */
export function resetIdentity() {
  if (!import.meta.env.PROD) return
  posthog.reset()
}
