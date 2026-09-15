/**
 * **Deprecated — round seven.** The kit that replaces this file is
 * `src/design/kit/`, and every one of these has a className-based
 * counterpart there: `Txt`, `Label`, `Button`, `Chip`, `TopRow`, `Segments`
 * (was `Segmented`), `Card` (was `Panel`), `KeyValue` (was `Detail`),
 * `Toggle` (was `Switch`), `Field` (was `Control`), `EmptyCard` (was
 * `Empty`). Nothing new may import from here.
 *
 * It survives because T6–T8 rewrite the screens one at a time, and until
 * each is rewritten it still asks these for `useTone()`-resolved styles. The
 * file goes when the last screen stops importing it.
 *
 * ---
 *
 * The primitives — app spec §3.1 Foundations and §3.2 Controls.
 *
 * Every one of them reads its colours from `useTone()`, so the same element
 * is correct on ink and on paper without a caller ever naming a colour. The
 * only exceptions the spec allows are `colors.signal` (dots, 1–2 px rules,
 * the ✓ on a confirmed row, a focus border) and `colors.danger`.
 *
 * Nothing here draws a shadow, a gradient or a blur. Corners are the radii
 * in §4.4 and there is no pill anywhere.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Platform,
  type ViewStyle, type TextStyle, type StyleProp, type TextInputProps,
} from 'react-native';
import Animated, {
  useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { ArrowLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import {
  colors, tones, radius, space, type, tabular, fontFamily, joinLabel,
  topRowHeight, button, buttonLabel,
} from './tokens';
import { useTone, ToneProvider, type Ground, type Tone } from './tone';
import { Touchable } from './Touchable';
import { dur, ease, timing, useReducedMotionFlag } from './motion';

/** Any Lucide icon, without binding the primitive to the library's own type. */
export type IconComponent = React.ComponentType<{
  size?: number; color?: string; strokeWidth?: number;
}>;

// -- text ------------------------------------------------------------------

export type TextTone = 'fg' | 'muted' | 'faint' | 'signal' | 'danger' | 'inv';

function toneColor(tone: TextTone, t: Tone): string {
  switch (tone) {
    case 'muted': return t.muted;
    case 'faint': return t.faint;
    case 'signal': return colors.signal;
    case 'danger': return colors.danger;
    case 'inv': return t.invFg;
    case 'fg': default: return t.fg;
  }
}

/**
 * Swaps a sans style for its Martian Mono counterpart at the same weight.
 *
 * A table rather than a pair of branches, because the two maps no longer
 * hold the same weights: `sans` has an 800 (the display variants) that
 * `mono` has no cut of, so it lands on mono's heaviest, 700 — the button's.
 * Anything unmapped falls back to 500 rather than throwing; a mono label in
 * an unexpected weight is a blemish, a crash is not.
 */
const MONO_FOR_SANS: Record<string, string> = {
  [fontFamily.sans[400]]: fontFamily.mono[400],
  [fontFamily.sans[500]]: fontFamily.mono[500],
  [fontFamily.sans[600]]: fontFamily.mono[600],
  [fontFamily.sans[800]]: fontFamily.mono[700],
};

function asMono(style: { fontFamily: string }): { fontFamily: string } {
  if (style.fontFamily.startsWith('MartianMono')) return { fontFamily: style.fontFamily };
  return { fontFamily: MONO_FOR_SANS[style.fontFamily] ?? fontFamily.mono[500] };
}

export function Txt({
  children, variant = 'body', tone = 'fg', style, numberOfLines,
  center, mono, tabular: tab, ...rest
}: {
  children: React.ReactNode;
  variant?: keyof typeof type;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  center?: boolean;
  /** Martian Mono at the variant's weight. Tabular by implication. */
  mono?: boolean;
  /** Tabular figures without changing family — anything that counts in place. */
  tabular?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTone();
  const base = type[variant];
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        base,
        mono && asMono(base),
        { color: toneColor(tone, t) },
        (mono || tab) && tabular,
        center && { textAlign: 'center' },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
}

/**
 * A mono label. Fragments are joined with ` · ` and the empty ones dropped —
 * the site's slot rule, applied to every mono label in the app (spec §3.1).
 *
 * Screen readers spell out capitals, so the sentence-case original goes into
 * `accessibilityLabel` (spec §9, Accessibility).
 */
export function Label({
  children, size = 'md', tone = 'faint', style, numberOfLines,
}: {
  children: string | (string | undefined | false | null)[];
  size?: 'md' | 'sm';
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTone();
  const text = Array.isArray(children) ? joinLabel(children) : children;
  if (!text) return null;
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityLabel={text.toLowerCase()}
      style={[size === 'sm' ? type.labelSm : type.label, { color: toneColor(tone, t) }, style]}
    >
      {text}
    </Text>
  );
}

// -- layout ----------------------------------------------------------------

export function Row({ children, gap = space.sm, style, align = 'center' }: {
  children: React.ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  align?: ViewStyle['alignItems'];
}) {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap }, style]}>{children}</View>;
}

/** Hairline. Runs the full width inside the gutter (spec §4.3). */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTone();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: t.line }, style]} />;
}

/** The standard surface: radius 20, `panel` ground, one hairline. */
export function Panel({ children, style, padded = true, onPress }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
}) {
  const t = useTone();
  const surface: ViewStyle = {
    backgroundColor: t.panel,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
    padding: padded ? space.xl : 0,
  };
  if (!onPress) return <View style={[surface, style]}>{children}</View>;
  return <Touchable onPress={onPress} style={[surface, style]}>{children}</Touchable>;
}

/**
 * Which ground is "the other one". Written down since there are four: ink and
 * paper still invert into each other, and the desk's other layer is the
 * night rather than ink, so a panel on the desk reads as the same room with
 * the lights off rather than as a different product.
 */
const OTHER_GROUND: Record<Ground, Ground> = {
  ink: 'paper', paper: 'ink', desk: 'night', night: 'desk',
};

/**
 * The other ground, inside this one — the site's Automation strip, "a
 * different layer of the product" (spec §1.6). The only way to put one
 * ground inside another.
 */
export function PanelInverted({ children, style, padded = true, onPress }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
}) {
  const t = useTone();
  const other = OTHER_GROUND[t.ground];
  const surface: ViewStyle = {
    backgroundColor: tones[other].bg,
    borderRadius: radius.card,
    padding: padded ? space.xl : 0,
    overflow: 'hidden',
  };
  // The provider's own View is the surface, rather than a box around it:
  // this panel is positioned absolutely by its one caller, and an extra
  // wrapper would become the frame the absolute child positions against.
  return onPress
    ? (
      <Touchable onPress={onPress} style={[surface, style]}>
        <ToneProvider ground={other}>{children}</ToneProvider>
      </Touchable>
    )
    : <ToneProvider ground={other} style={[surface, style]}>{children}</ToneProvider>;
}

// -- buttons ---------------------------------------------------------------

export function Button({
  title, onPress, variant = 'primary', size = 'md', disabled, loading,
  loadingLabel = '…', style, icon, full = false, accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'compact';
  disabled?: boolean;
  loading?: boolean;
  /**
   * What `loading` puts in place of the title, always set in mono. §3.2's
   * default is the bare ellipsis; a screen that has a word for what it is
   * waiting on says it instead — the sign-in providers' `OPENING…` (§2.3).
   */
  loadingLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** A Lucide icon. */
  icon?: IconComponent;
  /** Stretch to the container's cross axis. Opt-in, as §3.2 writes it. */
  full?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTone();
  const [held, setHeld] = useState(false);
  const inactive = !!(disabled || loading);
  const compact = size === 'compact';

  /** At rest, or the narrower box the reference uses where there is less air. */
  const pad = compact ? button.compact : button.padding;

  const label = loading ? loadingLabel : title;

  /**
   * `button.fill` and `button.ink` are the website's button, and the website
   * is a paper ground: ink on a sheet. On the app's ink ground that same pair
   * would be a dark button on a dark screen, so ink takes the tone's own
   * inversion instead — the identical two colours, the other way up.
   */
  const onPaper = t.ground === 'paper';
  const fg = variant === 'primary' ? (onPaper ? button.ink : t.invFg)
    : variant === 'danger' ? colors.danger
    : variant === 'ghost' ? (held ? t.fg : t.muted)
    : t.fg;

  const box: ViewStyle = {
    // The token's padding is the button's shape; `minHeight` is §9's 44pt
    // touch target, and on a phone the taller of the two wins — which is the
    // target, since 12 + an 11pt label + 12 does not reach a thumb's size.
    minHeight: compact ? 40 : 48,
    paddingVertical: pad.y,
    paddingHorizontal: pad.x,
    // Square, both sizes — a button is a stamp on the receipt, not a pill
    // (R17b). `button.radius` is `radius.button` said where it is used, and
    // the compact size no longer keeps the input's 10.
    borderRadius: button.radius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: variant === 'primary' ? (onPaper ? button.fill : t.invBg) : 'transparent',
    borderWidth: variant === 'secondary' || variant === 'danger' ? StyleSheet.hairlineWidth : 0,
    borderColor: variant === 'danger' ? 'rgba(181,72,60,0.4)' : t.line2,
  };

  /**
   * One label for every variant and both sizes: Martian Mono 11/700,
   * uppercase, a tenth of an em apart. The face used to change under
   * `loading` — sans for a title, mono for the ellipsis — and there is
   * nothing left to change to.
   *
   * `button.hover` and `button.hoverInk` are the two fields of the package's
   * button this surface has no use for: there is no pointer on a phone, so
   * there is no hover state to paint. What a finger gets instead is `held`,
   * which the ghost variant's rule already reads.
   */
  const labelStyle: TextStyle = { ...buttonLabel, color: fg };

  const Icon = icon;

  return (
    <Touchable
      onPress={onPress}
      disabled={inactive}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={[box, full && { alignSelf: 'stretch' }, inactive && { opacity: 0.4 }, style]}
    >
      <Row gap={space.sm}>
        {Icon ? <Icon size={compact ? 16 : 18} color={fg} strokeWidth={1.5} /> : null}
        <View>
          <Text style={labelStyle}>{label}</Text>
          {/* RN has no underline offset, so a ghost button draws its own rule. */}
          {variant === 'ghost' ? (
            <View
              style={{
                position: 'absolute', left: 0, right: 0, bottom: -6,
                height: StyleSheet.hairlineWidth,
                backgroundColor: held ? t.fg : t.line2,
              }}
            />
          ) : null}
        </View>
      </Row>
    </Touchable>
  );
}

/**
 * The Back control. 40 × 40, radius 10, no circle anywhere (spec §1.3).
 */
export function Back({ onPress, style }: { onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const t = useTone();
  const router = useRouter();
  const [held, setHeld] = useState(false);
  return (
    <Touchable
      onPress={onPress ?? (() => router.back())}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={[
        {
          width: 40, height: 40, borderRadius: radius.input,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: held ? t.panel : 'transparent',
        },
        style,
      ]}
    >
      <ArrowLeft size={20} color={t.fg} strokeWidth={1.5} />
    </Touchable>
  );
}

/**
 * The chrome every pushed screen draws inside the safe area: Back at the
 * left, an optional centred label, an optional right action (spec §1.3).
 */
export function TopRow({ title, right, onBack, style }: {
  title?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          height: topRowHeight,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.lg,
        },
        style,
      ]}
    >
      <Back onPress={onBack} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        {/* One line, always: the row is 56 pt tall and a wrapped title would
            grow it. A long one (a conversation's own title, §2.10) truncates. */}
        {title ? <Label size="sm" tone="muted" numberOfLines={1}>{title}</Label> : null}
      </View>
      <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

// -- controls --------------------------------------------------------------

export function Chip({ label, active, danger, tone = 'fg', onPress, style }: {
  label: string;
  active?: boolean;
  danger?: boolean;
  /**
   * The label's colour when the chip is neither active nor danger. The link
   * chip on the Pendant tab (§2.13) reads `fg` when it is linked and `faint`
   * when it is not, which is the state itself receding rather than a second
   * sentence saying so.
   */
  tone?: TextTone;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTone();
  return (
    <Touchable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
      accessibilityState={{ selected: !!active }}
      style={[
        {
          height: 32,
          paddingHorizontal: 10,
          borderRadius: radius.chip,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: active ? t.invBg : t.line2,
          backgroundColor: active ? t.invBg : 'transparent',
        },
        style,
      ]}
    >
      <Text
        style={[
          type.labelSm,
          { color: active ? t.invFg : danger ? colors.danger : toneColor(tone, t) },
        ]}
      >
        {label}
      </Text>
    </Touchable>
  );
}

/** The tick, in a 12-unit box: stroke 1.6, round caps (spec §3.2). */
const TICK_PATH = 'M2.5 6.2 4.8 8.5 9.5 3.8';

export function Checkbox({ checked, onToggle, label }: {
  checked: boolean;
  onToggle?: () => void;
  /** Sentence-case description for a screen reader. */
  label?: string;
}) {
  const t = useTone();
  const fill = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    fill.value = withTiming(checked ? 1 : 0, { duration: 300, easing: ease.out });
  }, [checked, fill]);

  const box = useAnimatedStyle(() => ({ opacity: fill.value }));

  return (
    <Touchable
      onPress={onToggle}
      disabled={!onToggle}
      hitSlop={12}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={{
        width: 18, height: 18, borderRadius: radius.chip,
        borderWidth: StyleSheet.hairlineWidth, borderColor: t.line2,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: t.invBg, alignItems: 'center', justifyContent: 'center' },
          box,
        ]}
      >
        <Svg width={12} height={12} viewBox="0 0 12 12">
          <Path
            d={TICK_PATH}
            stroke={t.invFg}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Animated.View>
    </Touchable>
  );
}

/** Track 44 × 24, square knob 16 × 16. The state text is the caller's. */
export function Switch({ value, onChange, disabled, label }: {
  value: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const t = useTone();
  const on = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(value ? 1 : 0, { duration: 200, easing: ease.out });
  }, [value, on]);

  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * 20 }],
    backgroundColor: on.value > 0.5 ? t.fg : t.faint,
  }));

  return (
    <Touchable
      onPress={() => onChange?.(!value)}
      disabled={disabled || !onChange}
      hitSlop={10}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={label}
      style={{
        width: 44, height: 24, borderRadius: radius.chip,
        borderWidth: StyleSheet.hairlineWidth, borderColor: t.line2,
        backgroundColor: t.panel,
        justifyContent: 'center', paddingHorizontal: 4,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Animated.View style={[{ width: 16, height: 16, borderRadius: radius.knob }, knob]} />
    </Touchable>
  );
}

/** A text field. Height 48, radius 10, `panel` ground; focus borders `signal`. */
export function Control({
  value, onChangeText, placeholder, invalid, message, style, ...rest
}: TextInputProps & {
  invalid?: boolean;
  /** Sits beneath the field: `danger` when invalid, `faint` otherwise. */
  message?: string;
}) {
  const t = useTone();
  const [focused, setFocused] = useState(false);
  const border = invalid ? colors.danger : focused ? colors.signal : t.line2;

  return (
    // The outer View takes the field's `style`, which TextInputProps types
    // as a text style; the two differ only in text-only keys nobody passes
    // to a container, so the cast is honest.
    <View style={style as StyleProp<ViewStyle>}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.faint}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          height: 48,
          paddingHorizontal: 14,
          borderRadius: radius.input,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: border,
          backgroundColor: t.panel,
          color: t.fg,
          fontFamily: fontFamily.sans[400],
          fontSize: 15,
        }}
        {...rest}
      />
      {message ? (
        <Text
          style={[
            type.small,
            { color: invalid ? colors.danger : t.faint, marginTop: space.sm },
          ]}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, style }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTone();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          // 14 is the track's own radius (spec §3.2): 10 inside plus the 4 pad.
          borderRadius: 14,
          padding: 4,
          gap: 4,
          backgroundColor: t.panel,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.line,
        },
        style,
      ]}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Touchable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: radius.input,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? t.invBg : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: fontFamily.sans[500],
                fontSize: 14,
                color: active ? t.invFg : t.muted,
              }}
            >
              {option.label}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}

/** Key over value, 16 pt apart, a hairline between (spec §3.2). */
export function Detail({ rows, style }: {
  rows: { k: string; v: string; mono?: boolean }[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {rows.map((row, i) => (
        <View key={row.k}>
          {i > 0 ? <Divider /> : null}
          <View style={{ paddingVertical: space.lg, gap: space.xs }}>
            <Label size="sm">{row.k}</Label>
            <Txt variant="body" mono={row.mono}>{row.v}</Txt>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * A step can be a bare title, or a title with a `small` muted line under it —
 * the rail form the spec describes, and what the Welcome sequence needs
 * (§3.2, §2.2). The row form shows numeral and title only; a line there would
 * not fit across a phone.
 */
export type Step = string | { title: string; line?: string };

const stepTitle = (step: Step) => (typeof step === 'string' ? step : step.title);
const stepLine = (step: Step) => (typeof step === 'string' ? undefined : step.line);

export function Steps({ steps, active = -1, layout = 'row', style }: {
  steps: Step[];
  /**
   * Which step the user is on. The row form is progress and needs it; the
   * rail form is an explainer — §3.2 gives it one appearance, faint
   * numerals beside `body` 500 titles, with no current step — so it ignores
   * this. Defaults to "none started", which the row form reads as every
   * step still upcoming.
   */
  active?: number;
  layout?: 'row' | 'rail';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTone();
  const stateTone = (i: number): TextTone =>
    i === active ? 'fg' : i < active ? 'muted' : 'faint';

  if (layout === 'rail') {
    return (
      <View style={[{ gap: space.lg }, style]}>
        {steps.map((step, i) => (
          <Row key={stepTitle(step)} gap={space.md} align="flex-start">
            <Label size="sm" style={{ width: 24, paddingTop: 3 }}>
              {String(i + 1).padStart(2, '0')}
            </Label>
            <View style={{ flex: 1, gap: space.xs }}>
              <Txt variant="bodyStrong">{stepTitle(step)}</Txt>
              {stepLine(step) ? (
                <Txt variant="small" tone="muted">{stepLine(step)}</Txt>
              ) : null}
            </View>
          </Row>
        ))}
      </View>
    );
  }

  return (
    <Row gap={0} style={style}>
      {steps.map((step, i) => (
        <Row key={stepTitle(step)} gap={space.sm}>
          {i > 0 ? (
            <View
              style={{
                width: 24, height: StyleSheet.hairlineWidth,
                backgroundColor: t.line2, marginHorizontal: space.sm,
              }}
            />
          ) : null}
          <Label size="sm" tone={stateTone(i)}>
            {[String(i + 1).padStart(2, '0'), stepTitle(step)]}
          </Label>
        </Row>
      ))}
    </Row>
  );
}

/** No glyph (spec §3.2): a statement, a line of body, and maybe one button. */
export function Empty({ title, body, action }: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.huge, paddingHorizontal: space.xl, gap: space.md }}>
      <Txt variant="displayM" center>{title}</Txt>
      <Txt variant="body" tone="muted" center style={{ maxWidth: 300 }}>{body}</Txt>
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

// -- numbers ---------------------------------------------------------------

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * A number that rolls to its value on the UI thread (M12), so it stays smooth
 * while the JS thread is busy decoding a BLE transfer. Tabular, always.
 *
 * Under reduce motion the roll is instant — M12's reduced column — because a
 * value sliding into place is decoration, and the value itself is the point.
 */
export function RollingNumber({
  value, decimals = 0, suffix = '', variant = 'displayM', tone = 'fg', duration = 240, style,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  variant?: keyof typeof type;
  tone?: TextTone;
  duration?: number;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTone();
  const reduced = useReducedMotionFlag();
  const safe = Number.isFinite(value) ? value : 0;
  const shown = useSharedValue(safe);

  useEffect(() => {
    shown.value = withTiming(
      Number.isFinite(value) ? value : 0,
      timing(reduced ? 0 : duration),
    );
  }, [value, duration, reduced, shown]);

  const animatedProps = useAnimatedProps(
    () => ({ text: `${shown.value.toFixed(decimals)}${suffix}` }) as never,
  );

  return (
    <AnimatedTextInput
      animatedProps={animatedProps}
      editable={false}
      pointerEvents="none"
      defaultValue={`${safe.toFixed(decimals)}${suffix}`}
      style={[
        type[variant],
        tabular,
        {
          color: toneColor(tone, t),
          padding: 0,
          margin: 0,
          // RN gives TextInput intrinsic vertical padding that Text does not.
          ...Platform.select({ android: { paddingVertical: 0, textAlignVertical: 'center' as const } }),
        },
        style,
      ]}
    />
  );
}

// Re-exported so screens keep a single import site for the kit.
export { Touchable };
/** Re-exported for the screens that time their own animations. */
export { dur, ease };
