/**
 * Type. `Txt` sets sans, `Label` sets mono, `MetaLine` joins fragments.
 *
 * Colour does not cascade in React Native — a `text-tone-fg` on a `View`
 * reaches nothing — so every one of these puts the colour on its own `Text`.
 * That is the rule the whole kit is built around: a card never colours its
 * children, it only chooses which of these to hand them to.
 */
import React from 'react';
import { Text } from 'react-native';
import {
  TXT, MONO, TEXT_TONE, cx,
  type TxtVariant, type MonoVariant, type TextTone,
} from './type';
import { metaLine } from './models';

export interface TxtProps {
  children: React.ReactNode;
  /** Which line of the canvas' sans ladder this is. Defaults to body copy. */
  variant?: TxtVariant;
  /** Which `--tone-*` colour it reads. Defaults to the ground's own ink. */
  tone?: TextTone;
  center?: boolean;
  numberOfLines?: number;
  /** Layout only — padding, margin, flex. Never a colour or a size. */
  className?: string;
  accessibilityLabel?: string;
}

/** A line of sans, at one of the canvas' sizes, in one of the tone's colours. */
export function Txt({
  children, variant = 'body', tone = 'fg', center, numberOfLines, className,
  accessibilityLabel,
}: TxtProps) {
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      className={cx(TXT[variant], TEXT_TONE[tone], center && 'text-center', className)}
    >
      {children}
    </Text>
  );
}

export interface LabelProps {
  /** A string, or fragments joined with ` · ` and the empty ones dropped. */
  children: string | (string | number | undefined | false | null)[];
  /** Which mono job this is. Defaults to a card's eyebrow. */
  variant?: MonoVariant;
  tone?: TextTone;
  center?: boolean;
  numberOfLines?: number;
  className?: string;
}

/**
 * A mono label: uppercase, tracked open, fragments joined with ` · `.
 *
 * A screen reader spells capitals out one at a time, so the sentence-case
 * original goes into `accessibilityLabel` and the eye gets the stencil.
 * Renders nothing at all when every fragment is empty — never a stray dot.
 */
export function Label({
  children, variant = 'tag', tone = 'faint', center, numberOfLines, className,
}: LabelProps) {
  const text = Array.isArray(children) ? metaLine(children) : children;
  if (!text) return null;
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityLabel={text.toLowerCase()}
      className={cx(MONO[variant], TEXT_TONE[tone], center && 'text-center', className)}
    >
      {text}
    </Text>
  );
}

/**
 * The line of context above or below a thing: `11:04 · OFFICE · TE + EN`.
 *
 * `Label` with the join made explicit and the nav size as its default,
 * because that is the one every meta line on the canvas is set at.
 */
export function MetaLine({
  parts, tone = 'faint', variant = 'nav', className, numberOfLines,
}: {
  parts: (string | number | undefined | false | null)[];
  tone?: TextTone;
  variant?: MonoVariant;
  className?: string;
  numberOfLines?: number;
}) {
  return (
    <Label variant={variant} tone={tone} className={className} numberOfLines={numberOfLines}>
      {parts}
    </Label>
  );
}
