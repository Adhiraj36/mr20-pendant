/**
 * A paid plan, and a receipt to show for it.
 *
 * The chooser (U1) is what an account with **no** plan sees, so the default
 * fixture leaves the plan alone — `resolvePlan` answers `none` and the
 * chooser draws itself from the configuration, which is the state worth
 * photographing. `seedPaidPlan()` is the other half: an Act order, paid,
 * with the reference a U2 receipt prints.
 *
 * Development only.
 */
import { useApp } from '../../state/store';

/** The reference the canvas' own receipt carries the shape of. */
export const FIXTURE_ORDER = 'LYZN-4F2A91';

export async function seedPlanFixtures(): Promise<void> {
  // Deliberately nothing: an account with no plan is the chooser's state,
  // and the chooser is the screen this task owns. `seedPaidPlan` is called
  // by the screenshot pass when it wants the receipt instead.
  useApp.setState({ plan: undefined, clerkPlan: undefined });
}

/** What the app looks like the instant a payment has been verified. */
export function seedPaidPlan(): void {
  useApp.setState({
    plan: {
      plan: 'act',
      automation: true,
      status: 'active',
      since: new Date().toISOString(),
      orderReference: FIXTURE_ORDER,
    },
    clerkPlan: {
      plan: 'act',
      planStatus: 'active',
      planSince: new Date().toISOString(),
      orderReference: FIXTURE_ORDER,
    },
  });
}
