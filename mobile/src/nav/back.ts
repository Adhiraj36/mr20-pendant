/**
 * BACK, on a screen that is not always arrived at.
 *
 * The launch gate `replace`s into `onboarding/plan` and `onboarding/pair`,
 * which leaves nothing underneath them to pop. `router.back()` there is not
 * an error the screen can see: expo-router logs "The action 'GO_BACK' was not
 * handled by any navigator" to the console and the tap does nothing at all —
 * so the person is on a price list, pressing BACK, and the app is silent.
 * That is the whole bug, and it is a routing one rather than a screen one,
 * which is why the answer lives here and not in either screen.
 *
 * Pushed onto a stack — from Settings, from a locked surface — there is
 * something to go back to, and `canGoBack` says so. The label a screen draws
 * should follow it: an arrow that says BACK when nothing is behind it is a
 * lie, however well it behaves when pressed.
 */
import { useRouter, type Href } from 'expo-router';

export interface Back {
  /** True when there is a screen underneath this one. */
  canGoBack: boolean;
  /** Pop if there is anything to pop; otherwise go to `fallback`. */
  goBack: () => void;
}

export function useGoBack(fallback: Href = '/'): Back {
  const router = useRouter();
  const canGoBack = router.canGoBack();
  return {
    canGoBack,
    goBack: () => {
      if (canGoBack) router.back();
      else router.replace(fallback);
    },
  };
}
