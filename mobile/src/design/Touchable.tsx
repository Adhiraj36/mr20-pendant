/**
 * The single press response used by every tappable surface in the app.
 *
 * Scale 0.985 over 120 ms with a light haptic and no dim (app spec §3, §6).
 * Dimming reads as a disabled state; the scale alone is the whole answer.
 *
 * Round seven made it className-first, and the press itself with it: the
 * scale is now `active:scale-[0.985]` under a `transition-transform`, which
 * NativeWind runs as a real Reanimated transition on the UI thread. That is
 * not a stylistic preference — it is forced, and the reason is worth writing
 * down, because it is the rule the whole kit depends on:
 *
 * **A Reanimated `useAnimatedStyle` object in the `style` prop of a
 * className'd component silently destroys that component's classes.**
 * css-interop collects the inline `style` prop alongside the compiled rules
 * (`collectInlineRules`), and an animated style is not a style object — it is
 * a handle with worklet internals. Merging it drops the lot, so the element
 * renders with neither its classes nor its animation. Verified on the
 * simulator: an `Animated.createAnimatedComponent(Pressable)` carrying both
 * a className and `useAnimatedStyle` painted no background, no border and no
 * padding, while the same classes on a plain `Pressable` painted correctly.
 *
 * So: no `Animated.createAnimatedComponent` here, and no hand-written
 * `useAnimatedStyle`. `Pressable` is registered by css-interop's own runtime,
 * it exposes `onPressIn`/`onPressOut` (which is what `active:` needs), and
 * the transition classes are present from the first render — which is also
 * what keeps nativewind PR #1835's upgrade warning from ever firing.
 *
 * `style` still works, for the callers that must size or position
 * imperatively; a *plain* style object merges with the classes correctly.
 * Never hand this component a Reanimated style.
 */
import React from 'react';
import { Pressable, type ViewStyle, type StyleProp, type PressableProps } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Timed, not sprung: presses settle without a trace of bounce. `duration-ui`
 * is 160 ms in the package and the press is 120, so it names its own.
 *
 * `scale-100` is not decoration. A class that sets a CSS variable — and every
 * `scale-*`/`translate-*` does, through Tailwind's `--tw-*` transform slots —
 * makes css-interop wrap the element in a variable provider the first time it
 * appears. If the only such class were behind `active:`, that first time
 * would be the first *press*: a remount mid-gesture, and the upgrade warning
 * that nativewind PR #1835 shows crashing inside a React Navigation screen.
 * Declaring the resting scale puts the variables on the element from render
 * one, so a press only ever changes their value.
 */
const PRESS = 'scale-100 transition-transform duration-[120ms] ease-out active:scale-[0.985]';

/** The press response, shared by every tappable surface. */
export function Touchable({
  children, onPress, className, style, disabled, haptic = 'light', scaleTo = 0.985, ...rest
}: PressableProps & {
  children: React.ReactNode;
  /** The surface: ground, border, padding, layout. */
  className?: string;
  /** A plain style object only — never a Reanimated animated style. */
  style?: StyleProp<ViewStyle>;
  haptic?: 'light' | 'medium' | 'none';
  /**
   * `1` turns the press scale off, for the surfaces that are too large for
   * it to read as anything but a wobble. Any other value is the system's
   * 0.985: the scale is a class now, so it is a constant, not a dial.
   */
  scaleTo?: number;
}) {
  return (
    <Pressable
      // `rest` first: the handler below wraps whatever the caller passed
      // rather than being replaced by it.
      {...rest}
      onPressIn={(event) => {
        if (haptic !== 'none') {
          Haptics.impactAsync(
            haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
          ).catch(() => undefined);
        }
        rest.onPressIn?.(event);
      }}
      onPress={onPress}
      disabled={disabled}
      className={[
        scaleTo === 1 ? undefined : PRESS,
        className,
        disabled ? 'opacity-40' : undefined,
      ].filter(Boolean).join(' ')}
      style={style}
    >
      {children}
    </Pressable>
  );
}
