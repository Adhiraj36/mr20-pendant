import { useEffect, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import type { PlanId } from '@/data/pricing'

/** The key this site owns under a reader's own Clerk metadata. */
export const SELECTED_PLAN_KEY = 'selectedPlan'

export type SelectedPlan = {
  plan: PlanId
  /** When they last chose it, ISO 8601. */
  at: string
}

/**
 * Which tier a signed-in reader has chosen, kept on their Clerk profile.
 *
 * Every tier holds for the same ₹999 now, so the payment no longer says
 * which one was wanted — the amount is identical on all three. What a
 * person chose has to be recorded somewhere other than the money, and it
 * has to be recorded before the money, because most people who pick a tier
 * do not reach a payment sheet at all. This is that record.
 *
 * **Not `plan`, and not public metadata.** Those two belong to the backend:
 * `clerkmeta.SetPlanMetadata` writes `plan`, `planStatus`, `planSince` and
 * `orderReference` onto a user when an order is *verified*, and the app
 * treats any tier it finds under `plan` as one this account holds — it
 * renders it on the first frame and stops offering the chooser. An intent
 * written there would be an entitlement nobody paid for. So a chosen tier
 * goes under its own key, in `unsafeMetadata`, which is the bucket a
 * browser is allowed to write and the one this site already keeps a
 * billing address in.
 *
 * Fire and forget. A reader whose Clerk write fails still has a working
 * checkout, and the next change of mind tries again.
 */
export function useRecordedPlan(plan: PlanId) {
  const { isLoaded, isSignedIn, user } = useUser()
  // What this hook has already sent. Clerk's local user object does not
  // carry the new value until the round trip lands, and without this the
  // effect would fire again on the re-render the write itself causes.
  const sent = useRef<PlanId | null>(null)

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return

    const metadata = (user.unsafeMetadata ?? {}) as Record<string, unknown>
    const stored = (metadata[SELECTED_PLAN_KEY] as Partial<SelectedPlan> | undefined)?.plan
    if (stored === plan || sent.current === plan) return

    sent.current = plan
    const selected: SelectedPlan = { plan, at: new Date().toISOString() }
    // Spread, never replace: the address the checkout keeps here is not
    // this hook's to throw away.
    void user
      .update({ unsafeMetadata: { ...metadata, [SELECTED_PLAN_KEY]: selected } })
      .catch(() => {
        // Let the next change of mind — or the next mount — try again.
        sent.current = null
      })
  }, [isLoaded, isSignedIn, user, plan])
}
