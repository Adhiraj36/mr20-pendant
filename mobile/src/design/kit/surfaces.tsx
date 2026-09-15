/**
 * The things a screen is made of: the ground, the row at the top, the card,
 * the strip, the empty state, the chip, the bar, the ask bar.
 *
 * Every surface is a class expression over the `--tone-*` variables, so the
 * same component is correct on the desk and at night without asking which —
 * `bg-tone-panel` is the sheet in daylight and the night's own panel after
 * dark, and neither this file nor a screen ever branches on it.
 */
import React from 'react';
import { View, TextInput, StyleSheet, type TextInputProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { useUnstableNativeVariable } from 'nativewind';
import { Screen, useTone, type ScreenProps } from '../tone';
import { Touchable } from '../Touchable';
import { type IconComponent } from '../interop';
import { Txt, Label } from './text';
import { BG_TONE, cx, type TextTone } from './type';

export { Screen };
export type { ScreenProps };

// -- the field's placeholder -----------------------------------------------

/**
 * `TextInput` whose placeholder reads the tone.
 *
 * `placeholderTextColor` is a prop React Native resolves itself, and there
 * is no class that reaches it — so this is the one place in the kit that
 * reads a `--tone-*` variable in JavaScript. Written once, used by `AskBar`
 * and `Field`, rather than in each of them.
 */
export function KitTextInput(props: TextInputProps & { className?: string }) {
  const faint = useUnstableNativeVariable('--tone-faint');
  return (
    <TextInput
      placeholderTextColor={typeof faint === 'string' ? faint : undefined}
      {...props}
    />
  );
}

// -- the top row -----------------------------------------------------------

/**
 * A pushed screen's chrome: `← TODAY` on the left, an action or two on the
 * right, nothing in the middle — canvas C2, T2, R1, SET. Mono 10.5 tracked
 * at .14em, and the arrow is part of the label rather than an icon, because
 * on the canvas it is a character in the word.
 */
export function TopRow({
  back, onBack, right, className,
}: {
  /** The label without its arrow: `TODAY`, `TASKS`, `RECEIPTS`. */
  back?: string;
  onBack?: () => void;
  /** One or more `<TopAction>`s, or anything else the screen wants. */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <View
      className={cx('flex-row items-center justify-between px-[22px] pt-[10px] pb-[12px]', className)}
    >
      {back ? (
        <Touchable
          onPress={onBack}
          disabled={!onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`back to ${back.toLowerCase()}`}
          className="flex-row items-center"
        >
          <Label variant="back" tone="fg">{`← ${back}`}</Label>
        </Touchable>
      ) : <View />}
      <View className="flex-row items-center gap-[14px]">{right}</View>
    </View>
  );
}

/** One word on the right of a top row: `RENAME`, `DISMISS`, `#0412`. */
export function TopAction({
  label, onPress, tone = 'faint',
}: {
  label: string;
  onPress?: () => void;
  tone?: TextTone;
}) {
  if (!onPress) return <Label variant="back" tone={tone}>{label}</Label>;
  return (
    <Touchable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
    >
      <Label variant="back" tone={tone}>{label}</Label>
    </Touchable>
  );
}

// -- the card --------------------------------------------------------------

/**
 * What the canvas lays on the desk.
 *
 * `paper` is settled or historical, `carbon` is waiting on you, `void` and
 * `stamp` are a rule around paper rather than a fill (canvas T4: "void rule,
 * never void fill"), `dashed` is a placeholder, `ink` is the strip that
 * belongs to a different layer of the product.
 */
export type CardVariant = 'paper' | 'carbon' | 'void' | 'stamp' | 'dashed' | 'ink';

/** The canvas' four card densities, named by the one they belong to. */
export type CardPad = 'card' | 'roomy' | 'tight' | 'none';

const CARD_SURFACE: Record<CardVariant, string> = {
  paper: 'bg-tone-panel border border-tone-line',
  carbon: 'bg-tone-carbon border border-tone-carbon-line',
  // A failure is paper with a void rule around it, never a void fill (T4).
  void: 'bg-tone-panel border-[1.5px] border-tone-danger',
  // The stamp rule only ever lands on carbon: its one use on the canvas is
  // the selected task in the batch bar (T1), which is a waiting card the
  // violet has been drawn around rather than a surface of its own.
  stamp: 'bg-tone-carbon border-[1.5px] border-tone-stamp',
  // Android will not draw a dashed border at radius 0, so it gets the
  // smallest radius that is still square to the eye.
  dashed: 'bg-tone-panel border border-dashed border-tone-line rounded-[0.01px]',
  ink: 'bg-tone-inv-bg',
};

const CARD_PAD: Record<CardPad, string> = {
  card: 'py-[14px] px-[15px]',
  roomy: 'py-[22px] px-[20px]',
  tight: 'py-[12px] px-[13px]',
  none: '',
};

export interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  pad?: CardPad;
  onPress?: () => void;
  /** Layout only: margins, gaps, flex. */
  className?: string;
  accessibilityLabel?: string;
}

/** A card. Square corners, one hairline, no shadow — the receipt keeps that. */
export function Card({
  children, variant = 'paper', pad = 'card', onPress, className, accessibilityLabel,
}: CardProps) {
  const surface = cx(CARD_SURFACE[variant], CARD_PAD[pad], className);
  if (!onPress) return <View className={surface}>{children}</View>;
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={surface}
    >
      {children}
    </Touchable>
  );
}

// -- the strip -------------------------------------------------------------

/**
 * The line across the top of a screen that says what is wrong and offers one
 * way out — canvas S1, P2, P3. A dot, a sentence in mono, one action.
 */
export type BannerVariant = 'carbon' | 'void' | 'paper';

const BANNER_SURFACE: Record<BannerVariant, string> = {
  carbon: 'bg-tone-carbon',
  void: 'bg-tone-danger',
  paper: 'bg-tone-panel border-b border-tone-line',
};

/** Filled where the state is live, a ring where it is merely absent. */
const BANNER_DOT: Record<BannerVariant, string> = {
  carbon: 'border-2 border-tone-muted',
  void: 'bg-tone-inv-fg',
  paper: 'bg-tone-stamp',
};

const BANNER_TEXT: Record<BannerVariant, TextTone> = {
  carbon: 'muted', void: 'inv', paper: 'muted',
};

export function Banner({
  label, action, onAction, variant = 'carbon', className,
}: {
  label: string | (string | number | undefined | false | null)[];
  action?: string;
  onAction?: () => void;
  variant?: BannerVariant;
  className?: string;
}) {
  return (
    <View
      className={cx('flex-row items-center gap-[10px] py-[11px] px-[20px]', BANNER_SURFACE[variant], className)}
    >
      <View className={cx('w-[9px] h-[9px] rounded-full', BANNER_DOT[variant])} />
      <Label variant="action" tone={BANNER_TEXT[variant]} className="flex-1" numberOfLines={2}>
        {label}
      </Label>
      {action ? (
        <Touchable
          onPress={onAction}
          disabled={!onAction}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={action.toLowerCase()}
        >
          <Label variant="action" tone={variant === 'void' ? 'inv' : 'stamp'}>{action}</Label>
        </Touchable>
      ) : null}
    </View>
  );
}

// -- the empty state -------------------------------------------------------

/**
 * Canvas S3: real copy, no "nothing here yet". An eyebrow saying which list
 * is empty, a statement in the screen's own voice, a line of explanation,
 * and at most one thing to do about it.
 */
export function EmptyCard({
  eyebrow, statement, line, action, onAction, className,
}: {
  eyebrow: string;
  statement: string;
  line?: string;
  action?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <Card pad="roomy" className={cx('gap-[9px]', className)}>
      <Label variant="eyebrow">{eyebrow}</Label>
      <Txt variant="statement">{statement}</Txt>
      {line ? <Txt variant="bodyL" tone="muted">{line}</Txt> : null}
      {action ? (
        <Touchable
          onPress={onAction}
          disabled={!onAction}
          accessibilityRole="button"
          accessibilityLabel={action.toLowerCase()}
          className="mt-[7px] border-[1.5px] border-tone-line2 py-[14px] items-center"
        >
          <Label variant="action" tone="fg">{action}</Label>
        </Touchable>
      ) : null}
    </Card>
  );
}

// -- the chip --------------------------------------------------------------

/**
 * A one-word fact with a rule around it: a language pair, a count of
 * commitments, a citation back into a transcript. Mono 9, tracked .1em.
 */
export type ChipTone = 'faint' | 'stamp' | 'settled' | 'danger';

const CHIP_BORDER: Record<ChipTone, string> = {
  faint: 'border-tone-line',
  stamp: 'border-tone-stamp',
  // Settled is a value, not an outline: the canvas gives a `1 DONE ✓` chip
  // the ordinary hairline and lets the green live in the type.
  settled: 'border-tone-line',
  danger: 'border-tone-danger',
};

export function Chip({
  label, tone = 'faint', onPress, className,
}: {
  label: string;
  tone?: ChipTone;
  onPress?: () => void;
  className?: string;
}) {
  const box = cx('border py-[4px] px-[7px]', CHIP_BORDER[tone], className);
  const text = <Label variant="chip" tone={tone}>{label}</Label>;
  if (!onPress) return <View className={box}>{text}</View>;
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
      className={box}
    >
      {text}
    </Touchable>
  );
}

// -- the bar ---------------------------------------------------------------

/**
 * A progress rule — 3 px inside a card (canvas T4's running task), 6 px on
 * the pendant tab's battery and storage. Track in the tone's line, fill in
 * whichever signal owns the thing that is moving.
 */
export type ProgressTone = 'stamp' | 'ink' | 'danger' | 'settled';

const PROGRESS_FILL: Record<ProgressTone, string> = {
  stamp: BG_TONE.stamp,
  ink: BG_TONE.fg,
  danger: BG_TONE.danger,
  settled: BG_TONE.settled,
};

export function Progress({
  value, tone = 'stamp', size = 3, className,
}: {
  /** 0..1. Clamped, so a bad number is a full or empty bar, never a crash. */
  value: number;
  tone?: ProgressTone;
  size?: 3 | 6;
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      className={cx('bg-tone-line w-full', size === 3 ? 'h-[3px]' : 'h-[6px]', className)}
    >
      {/* The width is data, not design: a percentage cannot be a class. */}
      <View className={cx('h-full', PROGRESS_FILL[tone])} style={{ width: `${pct}%` }} />
    </View>
  );
}

// -- the ask bar -----------------------------------------------------------

/**
 * The one input that is also a button — canvas L1, L2, M1: a 1.5 px ink box
 * with the field on the left and an ink `ASK` block filling the right end of
 * it. The block is the ground inverted, so it is ink on the desk and paper
 * at night, which is what the canvas draws in both themes.
 */
export function AskBar({
  value, onChangeText, onSubmit, placeholder = 'Ask about your day…',
  action = 'ASK', busy, icon, onAttach, glass, className,
}: {
  value: string;
  onChangeText: (next: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  action?: string;
  busy?: boolean;
  /** An icon inside the field, before the action — the canvas' paperclip. */
  icon?: IconComponent;
  /** Makes `icon` a button. Without it the glyph stays decorative, as before. */
  onAttach?: () => void;
  /**
   * The frosted treatment: rounded, translucent, and blurring whatever the
   * thread scrolls underneath it. Opt-in, because the bar is square and opaque
   * everywhere else in the app and a sheet's own bar has no thread to blur.
   */
  glass?: boolean;
  className?: string;
}) {
  const Glyph = icon;
  const { ground } = useTone();
  const dark = ground === 'night' || ground === 'ink';

  const field = (
    <>
      <KitTextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        returnKeyType="send"
        multiline={glass}
        className={cx(
          'flex-1 font-sans-400 text-[14px] text-tone-fg',
          glass ? 'py-[12px] pl-[6px] pr-[10px] max-h-[120px]' : 'py-[14px] px-[14px]',
        )}
      />
      {Glyph ? (
        onAttach ? (
          <Touchable
            onPress={onAttach}
            disabled={busy}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="attach a file"
            className={glass ? 'mr-[6px] p-[6px]' : 'mr-[10px]'}
          >
            <Glyph className="text-tone-muted w-[19px] h-[19px]" />
          </Touchable>
        ) : (
          <Glyph className="text-tone-faint w-[17px] h-[17px] mr-[10px]" />
        )
      ) : null}
      <Touchable
        onPress={onSubmit}
        disabled={!onSubmit || busy || value.trim().length === 0}
        accessibilityRole="button"
        accessibilityLabel={action.toLowerCase()}
        className={
          glass
            ? 'bg-tone-inv-bg rounded-full py-[9px] px-[14px]'
            : 'bg-tone-inv-bg py-[14px] px-[16px]'
        }
      >
        <Label variant="nav" tone="inv">{busy ? '…' : action}</Label>
      </Touchable>
    </>
  );

  if (!glass) {
    return (
      <View className={cx('flex-row items-center bg-tone-panel border-[1.5px] border-tone-line2', className)}>
        {field}
      </View>
    );
  }

  return (
    // The blur is a layer under the row rather than a parent of it: a
    // `BlurView` that wraps children clips them on Android, and the send
    // button is the first thing that would lose its corner.
    <View className={cx('rounded-[24px] overflow-hidden border-[1.5px] border-tone-line2', className)}>
      <BlurView
        intensity={dark ? 40 : 60}
        tint={dark ? 'dark' : 'light'}
        // Android has no system blur; without this the view is simply
        // transparent and the thread scrolls through the bar unreadably.
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      {/* The blur alone does not carry enough contrast for 14 px text over a
          moving thread, so a wash of the ground sits on top of it. */}
      <View
        style={StyleSheet.absoluteFill}
        className={dark ? 'bg-tone-bg/55' : 'bg-tone-bg/45'}
      />
      <View className="flex-row items-end pl-[10px] pr-[8px] py-[7px]">
        {field}
      </View>
    </View>
  );
}
