/**
 * The controls: the button, the segments, the one pill, the field, the code
 * boxes, the ink picker.
 *
 * The whole set is square except the toggle, which is the only round-ended
 * control the system allows — a switch that looks like a button reads as a
 * button (canvas CS, "TOGGLES"). Nothing here names a colour: a primary
 * button is `bg-tone-inv-bg text-tone-inv-fg`, which is ink on the desk and
 * paper at night, exactly as the canvas draws it in both themes.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { toggle as toggleSize } from '@lyzn/design';
import { Touchable } from '../Touchable';
import { type IconComponent } from '../interop';
import { Label } from './text';
import { KitTextInput } from './surfaces';
import { cx } from './type';
import {
  INKS, INK_STORAGE_KEY, DEFAULT_INK, parseInk, inkHex, codeBoxes, codeGroups,
  type InkId,
} from './models';

// -- the button ------------------------------------------------------------

/**
 * `primary` is the ink fill, `secondary` the 1.5 px outline, `void` the red
 * fill that stops a recording, `stamp` the violet one that starts a live
 * action, `ghost` a mono link with no box at all.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'void' | 'stamp' | 'ghost';

/** `md` is the canvas' 17/16 px button; `compact` is the 12 px one in a card. */
export type ButtonSize = 'md' | 'compact';

const BUTTON_BOX: Record<ButtonVariant, string> = {
  primary: 'bg-tone-inv-bg',
  secondary: 'border-[1.5px] border-tone-line2',
  void: 'bg-tone-danger',
  stamp: 'bg-tone-stamp',
  ghost: '',
};

/**
 * Disabled is the canvas' greyed outline, not a dimmed fill: a 1.5 px rule
 * in the tone's hairline with faint type inside it. It **replaces** the
 * variant's box rather than being added to it — two `bg-*` classes on one
 * element are decided by the order Tailwind emitted them, which is not a
 * thing a component may depend on.
 */
const BUTTON_DISABLED_BOX = 'border-[1.5px] border-tone-line';

/**
 * A filled button's label is `inv-fg` for all three fills, and that is not a
 * coincidence: `inv-fg` is "the ink a strong fill needs" in each ground, so
 * the sheet on the desk's dark ink and the night's dark on its light red.
 */
const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: 'text-tone-inv-fg',
  secondary: 'text-tone-fg',
  void: 'text-tone-inv-fg',
  stamp: 'text-tone-inv-fg',
  ghost: 'text-tone-faint',
};

const BUTTON_PAD: Record<ButtonVariant, Record<ButtonSize, string>> = {
  // The fills carry a point more vertical padding than the outlines, so the
  // two sit on the same baseline once the 1.5 px rule is counted.
  primary: { md: 'py-[17px] px-[16px]', compact: 'py-[12px] px-[11px]' },
  secondary: { md: 'py-[16px] px-[16px]', compact: 'py-[11px] px-[11px]' },
  void: { md: 'py-[17px] px-[16px]', compact: 'py-[12px] px-[11px]' },
  stamp: { md: 'py-[17px] px-[16px]', compact: 'py-[12px] px-[11px]' },
  ghost: { md: 'py-[10px]', compact: 'py-[6px]' },
};

/** 11/700 tracked .14em on the full size; 10/500 tracked .12em compact. */
const BUTTON_LABEL: Record<ButtonSize, string> = {
  md: 'font-mono-700 text-[11px] tracking-[1.54px] uppercase',
  compact: 'font-mono-500 text-[10px] tracking-[1.2px] uppercase',
};

/** A secondary button is not bold: the canvas sets its label at 500. */
const BUTTON_LABEL_LIGHT: Record<ButtonSize, string> = {
  md: 'font-mono-500 text-[11px] tracking-[1.54px] uppercase',
  compact: 'font-mono-500 text-[10px] tracking-[1.2px] uppercase',
};

/** Ghost is a link, not a box: 10.5 tracked .1em, and it never fills. */
const GHOST_LABEL = 'font-mono-500 text-[10.5px] tracking-[1.05px] uppercase';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Replaces the title while something is in flight. */
  busy?: boolean;
  busyLabel?: string;
  /** Stretch across the container. Opt-in, so a row of two can share a line. */
  full?: boolean;
  icon?: IconComponent;
  className?: string;
  accessibilityLabel?: string;
}

/** The button. Square, mono, uppercase — a stamp on the receipt, not a pill. */
export function Button({
  title, onPress, variant = 'primary', size = 'md', disabled, busy,
  busyLabel = '…', full, icon, className, accessibilityLabel,
}: ButtonProps) {
  const inactive = !!(disabled || busy);
  const Glyph = icon;
  const label = busy ? busyLabel : title;
  const greyed = !!disabled && variant !== 'ghost';
  const labelClass = variant === 'ghost'
    ? GHOST_LABEL
    : variant === 'secondary' ? BUTTON_LABEL_LIGHT[size] : BUTTON_LABEL[size];

  return (
    <Touchable
      onPress={onPress}
      disabled={inactive || !onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title.toLowerCase()}
      accessibilityState={{ disabled: inactive }}
      className={cx(
        'flex-row items-center justify-center gap-[8px]',
        greyed ? BUTTON_DISABLED_BOX : BUTTON_BOX[variant],
        BUTTON_PAD[greyed ? 'secondary' : variant][size],
        full && 'self-stretch',
        className,
      )}
    >
      {Glyph ? (
        <Glyph
          className={cx(
            size === 'compact' ? 'w-[14px] h-[14px]' : 'w-[16px] h-[16px]',
            disabled ? 'text-tone-faint' : BUTTON_TEXT[variant],
          )}
        />
      ) : null}
      <Text className={cx(labelClass, disabled ? 'text-tone-faint' : BUTTON_TEXT[variant])}>
        {label}
      </Text>
    </Touchable>
  );
}

// -- the segments ----------------------------------------------------------

/**
 * One 1.5 px ink box cut into equal parts, the active part filled ink —
 * canvas H1's `CONVERSATIONS · TASKS · RECEIPTS`. Not a track with a pill in
 * it: there is nothing rounded and nothing that slides.
 */
export function Segments<T extends string>({
  options, value, onChange, className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <View className={cx('flex-row bg-tone-panel border-[1.5px] border-tone-line2', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Touchable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label.toLowerCase()}
            className={cx('flex-1 items-center py-[11px]', active && 'bg-tone-inv-bg')}
          >
            <Label variant="nav" tone={active ? 'inv' : 'faint'} numberOfLines={1}>
              {option.label}
            </Label>
          </Touchable>
        );
      })}
    </View>
  );
}

// -- the one pill ----------------------------------------------------------

/**
 * 44 × 26, radius 13 — the only round-ended control in the system, and the
 * size is the package's `toggle` rather than three numbers written here.
 * Settled green when on, the tone's hairline when off (canvas CS).
 */
export function Toggle({
  value, onChange, disabled, label,
}: {
  value: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Sentence-case, for a screen reader; the visible words are the row's. */
  label?: string;
}) {
  return (
    <Touchable
      onPress={() => onChange?.(!value)}
      disabled={disabled || !onChange}
      hitSlop={10}
      haptic="light"
      // The pill is small enough that the press scale reads as a wobble.
      scaleTo={1}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={label}
      className={cx('justify-center', value ? 'bg-tone-settled' : 'bg-tone-line')}
      // The pill's three numbers are the package's, not this file's.
      style={{
        width: toggleSize.w,
        height: toggleSize.h,
        borderRadius: toggleSize.radius,
        padding: 3,
      }}
    >
      {/*
        The knob is the ground itself — the one colour that shows against both
        the settled green and the hairline grey, in both themes.

        Its travel is a class under a transition, not a `useAnimatedStyle`: a
        Reanimated style object handed to a className'd element is collected
        as an inline rule and takes the classes down with it (see
        `Touchable.tsx`'s header). Both states name a `translate-x`, so the
        transform variables exist from the first render and the toggle never
        remounts to acquire them.
      */}
      <View
        className={cx(
          'bg-tone-bg rounded-full transition-transform duration-[200ms] ease-out',
          value ? 'translate-x-[18px]' : 'translate-x-[0px]',
        )}
        style={{ width: toggleSize.h - 6, height: toggleSize.h - 6 }}
      />
    </Touchable>
  );
}

// -- the field -------------------------------------------------------------

/**
 * A 1.5 px ink box on paper. Focus takes it to 2 px in stamp violet, invalid
 * to void red with the reason in mono beneath — canvas CS, "INPUTS".
 */
export function Field({
  value, onChangeText, placeholder, invalid, message, multiline,
  autoFocus, keyboardType, secureTextEntry, maxLength, className, accessibilityLabel,
  onFocus, onBlur, onSubmitEditing, returnKeyType, autoCapitalize,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  invalid?: boolean;
  /** Under the box: void red when invalid, faint otherwise. */
  message?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'email-address' | 'phone-pad';
  secureTextEntry?: boolean;
  maxLength?: number;
  className?: string;
  accessibilityLabel?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  /** The keyboard's own key. A one-line form field is finished by it. */
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const [focused, setFocused] = useState(false);
  const border = invalid
    ? 'border-[1.5px] border-tone-danger'
    : focused ? 'border-2 border-tone-stamp' : 'border-[1.5px] border-tone-line2';

  return (
    <View className={className}>
      <KitTextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
        multiline={multiline}
        autoFocus={autoFocus}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        maxLength={maxLength}
        accessibilityLabel={accessibilityLabel}
        onFocus={() => { setFocused(true); onFocus?.(); }}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        className={cx(
          'bg-tone-panel p-[13px] font-sans-400 text-[14px] text-tone-fg',
          multiline && 'min-h-[96px]',
          border,
        )}
        style={multiline ? { textAlignVertical: 'top' } : undefined}
      />
      {message ? (
        <Label variant="value" tone={invalid ? 'danger' : 'faint'} className="mt-[7px]">
          {message}
        </Label>
      ) : null}
    </View>
  );
}

// -- the code boxes --------------------------------------------------------

/**
 * Six boxes 62 tall, the typed ones ink-bordered, the caret's box 2 px in
 * stamp violet with a violet bar in it, the rest in the tone's hairline —
 * canvas O2, "caret in stamp violet".
 *
 * One real `TextInput` sits invisibly over the row and takes every keystroke;
 * the boxes are the picture of what it holds. That is the only arrangement
 * that gets autofill, paste and the number pad for free.
 */
export function CodeBoxes({
  value, onChangeText, length = 6, autoFocus = true, invalid, className,
}: {
  value: string;
  onChangeText: (next: string) => void;
  length?: number;
  autoFocus?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const { chars, caret } = codeBoxes(value, length);
  return (
    <View className={cx('relative', className)}>
      <View className="flex-row gap-[9px]">
        {chars.map((char, i) => (
          <View
            key={i}
            className={cx(
              'flex-1 h-[62px] bg-tone-panel items-center justify-center',
              invalid ? 'border-[1.5px] border-tone-danger'
                : i === caret ? 'border-2 border-tone-stamp'
                : char ? 'border-[1.5px] border-tone-line2'
                : 'border-[1.5px] border-tone-line',
            )}
          >
            {char
              ? <Text className="font-mono-700 text-[22px] text-tone-fg">{char}</Text>
              : i === caret
                ? <View className="w-[2px] h-[22px] bg-tone-stamp" />
                : null}
          </View>
        ))}
      </View>
      <KitTextInput
        value={value}
        onChangeText={(next) => onChangeText(next.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        accessibilityLabel="verification code"
        // Invisible, on top, full bleed: the boxes below are the picture and
        // this is the field. `opacity-0` rather than a colour, so no ground
        // has to be guessed for it.
        className="absolute inset-0 opacity-0 text-[22px]"
      />
    </View>
  );
}

// -- the code plate --------------------------------------------------------

/**
 * A code to be read off this screen and typed into another one — the pairing
 * code a laptop redeems (canvas SET, the daemon screen).
 *
 * The sibling of `CodeBoxes` and its opposite: that one is six boxes waiting
 * for a thumb, this one is a number plate. It takes no input, cannot be
 * focused, and is grouped in threes because six characters read aloud across
 * a desk are easier in two halves. The alphabet it is drawn from already
 * excludes I, O, 0 and 1, so nothing here has to disambiguate them.
 */
export function CodePlate({
  code, group = 3, className,
}: {
  /** The characters as minted. Case and spacing are normalised for display. */
  code: string;
  /** How many characters per group. `0` draws it as one run. */
  group?: number;
  className?: string;
}) {
  const groups = group > 0 ? codeGroups(code, group) : [code.toUpperCase()];
  return (
    <View
      className={cx(
        'flex-row items-center justify-center gap-[14px] py-[18px] px-[14px]',
        'bg-tone-panel border-[1.5px] border-tone-line2',
        className,
      )}
      accessibilityRole="text"
      accessibilityLabel={`pairing code ${[...code.toUpperCase()].join(' ')}`}
    >
      {groups.map((part, i) => (
        <Text key={i} className="font-mono-700 text-[30px] tracking-[3px] text-tone-fg">
          {part}
        </Text>
      ))}
    </View>
  );
}

// -- the ink picker --------------------------------------------------------

/**
 * The six printer inks, 24 px each; the chosen one wears a double ring in
 * its own ink — canvas CS, "SELECTED = DOUBLE RING IN ITS OWN INK".
 *
 * The swatch is the one place in the kit where a colour arrives as data
 * rather than as a token: the ink *is* the value being picked, so it goes
 * inline. The ring's gap is the card's own panel showing through.
 */
export function InkPicker({
  value, onChange, className,
}: {
  value: InkId;
  onChange: (next: InkId) => void;
  className?: string;
}) {
  return (
    <View
      className={cx('flex-row items-center gap-[12px] p-[14px] bg-tone-panel border border-tone-line', className)}
      accessibilityRole="radiogroup"
    >
      {INKS.map((ink) => {
        const selected = ink.id === value;
        return (
          <Touchable
            key={ink.id}
            onPress={() => onChange(ink.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={ink.label.toLowerCase()}
            className="w-[33px] h-[33px] items-center justify-center rounded-full"
            style={selected ? { borderWidth: 1.5, borderColor: ink.hex } : undefined}
          >
            {/* The hairline is not the canvas', and it is needed: the default
                ink is the ground's own near-black, and at night a swatch of it
                on the night panel is a circle nobody can see. */}
            <View
              className="w-[24px] h-[24px] rounded-full border border-tone-line"
              style={{ backgroundColor: ink.hex }}
            />
          </Touchable>
        );
      })}
    </View>
  );
}

/**
 * The picker's value, read from and written to `lyzn.ink` — the same key the
 * website uses, so a future account sync maps one to one.
 *
 * Storage answering with nothing, or with an ink an older build wrote and
 * this one has dropped, is the default ink and not an error (`parseInk`).
 */
export function useInk(): [InkId, (next: InkId) => void, boolean] {
  const [ink, setInk] = useState<InkId>(DEFAULT_INK);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(INK_STORAGE_KEY)
      .then((raw) => { if (live) setInk(parseInk(raw)); })
      .catch(() => undefined)
      .finally(() => { if (live) setHydrated(true); });
    return () => { live = false; };
  }, []);

  const choose = useCallback((next: InkId) => {
    // Live before the write lands: a setting that waits for the disk feels
    // broken, and a failed write costs the choice on the next cold start.
    setInk(next);
    AsyncStorage.setItem(INK_STORAGE_KEY, next).catch(() => undefined);
  }, []);

  return [ink, choose, hydrated];
}

export { inkHex, type InkId };
