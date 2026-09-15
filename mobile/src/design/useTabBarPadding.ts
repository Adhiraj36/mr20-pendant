/**
 * Bottom padding a tab screen needs so its last row clears the tab bar.
 *
 * The bar is the kit's own strip of paper now (round seven), rendered by
 * React Navigation inside the layout rather than by UIKit underneath it, so
 * the scene already ends where the bar begins and the safe-area inset is the
 * bar's own (`pb-safe` in `TabBar`). What is left is breathing room, and a
 * screen that wants none passes zero.
 */
import { space } from './tokens';

export function useTabBarPadding(extra = space.lg): number {
  return extra;
}
