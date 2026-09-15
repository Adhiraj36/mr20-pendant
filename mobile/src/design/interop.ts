/**
 * `className` on the components that pick their own props.
 *
 * Imported once, from `app/_layout.tsx`, for the side effect: `cssInterop`
 * writes into react-native-css-interop's global registry keyed by the *base*
 * component, and the JSX runtime looks each element type up in that registry
 * — so registering here reaches every `<Path>` and `<Animated.View>` in the
 * app, wherever it was imported from.
 *
 * `cssInterop` resolves a className into a real style object and can push
 * individual style attributes back out as top-level props; `remapProps` only
 * renames className → style and is cheaper, so it is the right tool when a
 * component just needs its style prop filled.
 *
 * `View`, `Text`, `Image`, `Pressable`, `ScrollView`, `TextInput`,
 * `FlatList`, `Switch`, `StatusBar`, the three `Touchable*`s and
 * safe-area-context's `SafeAreaView` are registered by the runtime already —
 * nothing below repeats them. `SafeAreaProvider` is separately patched to
 * publish the four inset variables, which is what makes `pt-safe` work.
 *
 * What is *not* registered, and why, is the long comment below: Reanimated.
 */
import type { ComponentType } from 'react';
import { cssInterop } from 'nativewind';
import { Svg, Path, Circle as SvgCircle, Rect, G, Line } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, X, Check, Plus, Minus,
  ChevronDown, ChevronRight, CornerDownRight, Play, Pause, RotateCcw, RotateCw,
  Image as ImageIcon, Paperclip, File, Ellipsis,
  House, MessageSquare, Bluetooth, Settings, Bell, Send, Search, Mic, Pencil,
  Share2, TriangleAlert, Circle, Square, SquareCheck,
} from 'lucide-react-native';

/** A component registered for its style prop, whatever else it takes. */
type AnyComponent = ComponentType<Record<string, unknown>>;

/*
 * Reanimated is deliberately **not** registered here, and the reason is a
 * rule the whole design system now depends on:
 *
 *   **A Reanimated `useAnimatedStyle` object in the `style` prop of a
 *   className'd component silently destroys that component's styles.**
 *
 * css-interop collects the inline `style` prop alongside the compiled rules
 * (`collectInlineRules` in native-interop.js) so that a class and a style can
 * be merged. An animated style is not a style object, though — it is a handle
 * with worklet internals — and merging it drops the lot: neither the classes
 * nor the animation survive, and the element lays out at zero height.
 *
 * Measured on the simulator (iPhone 17 Pro, iOS 26.5), three boxes with the
 * same `{width, height, backgroundColor}` inline style:
 *
 *   | element                                        | renders |
 *   |------------------------------------------------|---------|
 *   | `<View style={plain} />`                        | yes     |
 *   | `<Animated.View style={[plain, animated]} />`    | **no**  |
 *   | `<Animated.View cssInterop={false} style={…} />` | yes     |
 *
 * Registering `Animated.View` would therefore break every hand-written
 * animation in the app — the receipt's paper and print bands, the mark pulse,
 * the entrance stagger, the waveform, the tick row, the scrub — in exchange
 * for a `className` on the one kind of component that must not have one.
 *
 * So the rule is: **an `Animated.*` component carries a `useAnimatedStyle`
 * and never a `className`; a class-animated element is a plain component with
 * `transition-*` on it.** The runtime upgrades the latter to an animated
 * component by itself (`render-component.js` calls
 * `Animated.createAnimatedComponent` when a class needs it), which is how
 * `Touchable`'s press scale works without an `Animated.Pressable` at all.
 * Where both are genuinely needed, nest them: the animated view outside with
 * the motion, a plain `View` inside with the classes.
 */

/* react-native-svg. `fill`/`stroke`/`strokeWidth` are not React Native style
   attributes — the NativeWind preset emits them as moved props, and
   `nativeStyleToProp` is what lifts them onto the element. `Svg` itself wants
   width and height as props rather than as style. */
cssInterop(Svg, {
  className: { target: 'style', nativeStyleToProp: { width: true, height: true } },
});
// The loop is typed loosely on purpose: `cssInterop` infers its mapping from
// each component's own prop type, and the five shapes below do not agree on
// one — `nativeStyleToProp` would have to be written out five times to say
// the same thing.
//
// `strokeWidth` is not in the map, and does not need to be: `stroke-2`
// compiles to a value the rule itself marks as belonging to the
// `strokeWidth` prop, so the runtime moves it without being told. `fill` and
// `stroke` are named because they are also real style attribute names, and
// naming them is what stops the colour being left in `style`.
for (const El of [Path, SvgCircle, Rect, G, Line] as AnyComponent[]) {
  cssInterop(El, {
    className: { target: 'style', nativeStyleToProp: { fill: true, stroke: true } },
  });
}

/* expo-linear-gradient and expo-blur both take a plain style prop. */
cssInterop(LinearGradient, { className: 'style' });
cssInterop(BlurView, { className: 'style' });

/* lucide-react-native takes colour and size as props, so a className has to
 * be pushed back out as props rather than left in style: `text-tone-fg` →
 * `color`, `w-[22px] h-[22px]` → width/height.
 *
 * The NativeWind report's loop over lucide's `icons` map does not apply to
 * this package: `lucide-react-native@1.41` exports one component per icon and
 * no map (the map is `lucide-react`'s), and importing the barrel to build one
 * would pull all ~1,600 icons into the bundle. `ICONS` below is the app's
 * whole icon vocabulary written out — an icon that reaches a screen is an
 * icon registered here. */
const ICONS = {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, X, Check, Plus, Minus,
  ChevronDown, ChevronRight, CornerDownRight, Play, Pause, RotateCcw, RotateCw,
  Image: ImageIcon, Paperclip, File, Ellipsis,
  House, MessageSquare, Bluetooth, Settings, Bell, Send, Search, Mic, Pencil,
  Share2, TriangleAlert, Circle, Square, SquareCheck,
};

for (const El of Object.values(ICONS) as unknown as AnyComponent[]) {
  cssInterop(El, {
    className: {
      target: 'style',
      nativeStyleToProp: { color: true, width: true, height: true },
    },
  });
}

/**
 * What the kit hands an icon: a `className` for its colour and its box, and
 * the imperative props for the one place a colour is data rather than a
 * token (the ink picker's swatch). Lucide's own props type has no
 * `className` — `cssInterop` adds one at runtime, and this is the type
 * catching up with it.
 */
export type IconComponent = ComponentType<{
  className?: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

/** The icon vocabulary, typed for `className`: `Icon.House`, `Icon.Send`. */
export const Icon = ICONS as unknown as Record<keyof typeof ICONS, IconComponent>;

export type IconName = keyof typeof ICONS;

/* @shopify/react-native-skia's Canvas is deliberately absent: Skia paints on
   its own surface and reads no React Native style attribute, so the className
   goes on a wrapping View and Canvas keeps a plain flex style. */

