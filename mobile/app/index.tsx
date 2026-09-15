/**
 * The launch gate: four questions, asked in the order they can be answered.
 *
 * 1. Has Clerk answered? Until it has, nobody knows who this is, and routing
 *    on the assumption of "nobody" sends a signed-in person to the welcome
 *    screen a beat before the truth arrives.
 * 2. Is anyone signed in? No → O1.
 * 3. Has this account bought anything? `GET /plan` decides, Clerk's metadata
 *    answers while it is in flight, and `none` opens the chooser (U1) — once.
 *    The gate waits for `planChecked` first: showing a paying customer a price
 *    list on every cold start would be the worst bug in the app. Closing the
 *    chooser sets `planAsked`, and from then on an account with no plan is let
 *    through to the app like any other. Signing in is not a purchase, and the
 *    price list is not allowed to stand between the two.
 * 4. Has the pendant flow been walked? Only for an account with no pendant
 *    and no record of finishing — anyone else lands in the tabs, paired or
 *    not, because the Pendant tab handles the unpaired state itself.
 *
 * On screen it is the mark, pulsing, and nothing else.
 */
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '../src/state/store';
import { resolvePlan } from '../src/plan/resolve';
import { Screen, MarkPulse } from '../src/design/kit';

export default function Index() {
  const router = useRouter();
  const ready = useApp((s) => s.ready);
  const signedIn = useApp((s) => s.signedIn);
  const planChecked = useApp((s) => s.planChecked);
  const plan = useApp((s) => s.plan);
  const clerkPlan = useApp((s) => s.clerkPlan);
  const appConfig = useApp((s) => s.appConfig);
  const onboarded = useApp((s) => s.onboarded);
  const planAsked = useApp((s) => s.planAsked);
  const paired = useApp((s) => s.paired);
  // Derived here rather than through a selector: `resolvePlan` builds a new
  // object every call, and a zustand selector that never returns the same
  // reference re-renders on every store write.
  const resolution = useMemo(
    () => resolvePlan(clerkPlan, plan, appConfig),
    [clerkPlan, plan, appConfig],
  );

  useEffect(() => {
    if (!ready) return;
    if (!signedIn) {
      router.replace('/onboarding/welcome');
      return;
    }
    // Nobody is sent anywhere on the strength of a question that has not
    // been asked yet.
    if (!planChecked) return;

    // The chooser only ever opens on a real answer, and `source` is what
    // says there was one: Clerk's metadata is an object for every signed-in
    // account, empty included, so its presence proves nothing. A launch where
    // neither source spoke must not put a price list in front of somebody who
    // has already paid.
    const answered = resolution.source !== 'none';
    if (answered && resolution.needsChooser && !planAsked) {
      router.replace('/onboarding/plan');
      return;
    }

    if (!onboarded && !paired) {
      router.replace('/onboarding/pair');
      return;
    }
    router.replace('/(tabs)');
  }, [
    ready, signedIn, planChecked, plan, clerkPlan, resolution, planAsked,
    onboarded, paired, router,
  ]);

  return (
    <Screen>
      <View className="flex-1 items-center justify-center">
        <MarkPulse />
      </View>
    </Screen>
  );
}
