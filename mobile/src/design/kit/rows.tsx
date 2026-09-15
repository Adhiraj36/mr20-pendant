/**
 * The rows: the dotted-leader key/value, the task card in its five lives,
 * the conversation, the roll item, the notification, the recording pill.
 *
 * These are where the canvas' vocabulary actually lives — a screen picks one
 * and hands it data, and never assembles a card out of `Card` and `Label` by
 * hand, because then two screens would draw the same card differently.
 */
import React from 'react';
import { View } from 'react-native';
import { Touchable } from '../Touchable';
import { Icon } from '../interop';
import { Txt, Label } from './text';
import { Card, Progress, Chip, type ChipTone } from './surfaces';
import { Button } from './controls';
import { cx, type TextTone } from './type';
import { type TaskCardState } from './models';

// -- the key-value row -----------------------------------------------------

/**
 * A key, a dotted leader that takes the slack, a value — the receipt's row,
 * borrowed by every "what will happen" and "what is held" list on the canvas.
 *
 * The leader is a bottom rule on a flexed view, lifted three points so it
 * sits under the baseline rather than through it (the canvas' own
 * `translateY(-3px)`); Android will not draw a dotted border at radius zero,
 * hence the hundredth of a point.
 */
export function KeyValue({
  k, v, tone = 'fg', ok, className,
}: {
  k: string;
  v?: string;
  /** The value's colour. The key is always faint. */
  tone?: TextTone;
  /** Settled green with a ✓ — the line that says the thing actually happened. */
  ok?: boolean;
  className?: string;
}) {
  return (
    <View className={cx('flex-row items-baseline gap-[6px] py-[3px]', className)}>
      {/* The key keeps its own width and the value gives way: a row whose
          key reads `TA…` has told you nothing, and the value beside it is
          usually the part that can afford an ellipsis. */}
      <Label variant="value" tone="muted" numberOfLines={1}>{k}</Label>
      <View className="flex-1 border-b border-dotted border-tone-line rounded-[0.01px] -translate-y-[3px]" />
      {v !== undefined ? (
        <Label variant="value" tone={ok ? 'settled' : tone} numberOfLines={1} className="shrink">
          {ok ? `${v} ✓` : v}
        </Label>
      ) : null}
    </View>
  );
}

/** A block of them, so a caller writes rows rather than a loop. */
export function KeyValues({
  rows, className,
}: {
  rows: { k: string; v?: string; ok?: boolean; tone?: TextTone }[];
  className?: string;
}) {
  return (
    <View className={className}>
      {rows.map((row) => <KeyValue key={row.k} {...row} />)}
    </View>
  );
}

// -- the settings row ------------------------------------------------------

/** Canvas SET: a name on the left, its current value on the right, one flat list. */
export function SettingsRow({
  label, note, noteTone = 'stamp', value, valueTone = 'faint',
  onPress, right, danger, className,
}: {
  label: string;
  /** The line under the name: `ASK ME FIRST`, `RUNS AUTOMATICALLY`. */
  note?: string;
  noteTone?: TextTone;
  value?: string;
  valueTone?: TextTone;
  onPress?: () => void;
  /** A control instead of a value — the settings toggle. */
  right?: React.ReactNode;
  danger?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <View className="flex-1 gap-[3px]">
        <Txt variant="strong" tone={danger ? 'danger' : 'fg'}>{label}</Txt>
        {note ? <Label variant="value" tone={noteTone}>{note}</Label> : null}
      </View>
      {right ?? (value
        ? <Label variant="tag" tone={danger ? 'danger' : valueTone} className="text-right">{value}</Label>
        : null)}
    </>
  );
  const surface = cx(
    'flex-row justify-between items-center gap-[12px] py-[11px] px-[15px] bg-tone-panel',
    danger ? 'border-[1.5px] border-tone-danger' : 'border border-tone-line',
    className,
  );
  if (!onPress) return <View className={surface}>{body}</View>;
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
      className={surface}
    >
      {body}
    </Touchable>
  );
}

// -- the task card ---------------------------------------------------------

export interface TaskCardProps {
  /** From `taskCardState(status, { execution })` — never guessed at a call site. */
  state: TaskCardState;
  /** `SPENDS ₹540 · KARACHI BAKERY` — what it does, and to whom. */
  eyebrow?: string;
  title: string;
  /** What you actually said, in quotation marks. */
  quote?: string;
  /** `APPROVED 11:05:01`, `TRIED 12:02 · STOPPED`, `DELIVERED 11:05:07`. */
  meta?: string;
  /** The plain sentence a failure owes you. */
  reason?: string;
  /** 0..1 while running; the 3 px bar and the line under it. */
  progress?: number;
  progressNote?: string;
  /** `RECEIPT #0412 →`, on a done card. */
  receiptRef?: string;
  onOpenReceipt?: () => void;
  onPress?: () => void;
  /** The batch-select square. Only drawn when `onToggleSelect` is given. */
  selected?: boolean;
  onToggleSelect?: () => void;
  /** The two actions a waiting, failed or capture card offers. */
  primaryAction?: { label: string; onPress?: () => void };
  secondaryAction?: { label: string; onPress?: () => void };
  className?: string;
}

/** The tag in the top-right corner, and the colour it carries. */
const STATE_TAG: Record<TaskCardState, { text?: string; tone: TextTone }> = {
  waiting: { tone: 'stamp' },
  running: { text: 'RUNNING', tone: 'stamp' },
  done: { text: 'DONE ✓', tone: 'settled' },
  failed: { text: "DIDN'T GO THROUGH", tone: 'danger' },
  capture: { tone: 'fg' },
  blocked: { text: 'NEEDS AN ANSWER', tone: 'stamp' },
};

/**
 * One card, six lives — canvas T4 plus the Capture tier's T0, plus `blocked`.
 *
 * `waiting` is carbon because it is waiting on you; `running` and `done` are
 * paper because they are no longer your problem; `failed` is paper with a
 * void rule around it, never a void fill; `capture` is carbon that says out
 * loud that lyzn cannot do this one for you yet; `blocked` is carbon too —
 * it is waiting on you as surely as `waiting` is — but tagged `NEEDS AN
 * ANSWER` rather than `RUNNING` or `DIDN'T GO THROUGH`, because it is
 * neither still going nor broken. It is a question.
 */
export function TaskCard({
  state, eyebrow, title, quote, meta, reason, progress, progressNote,
  receiptRef, onOpenReceipt, onPress, selected, onToggleSelect,
  primaryAction, secondaryAction, className,
}: TaskCardProps) {
  const tag = STATE_TAG[state];
  const variant = state === 'waiting' || state === 'capture' || state === 'blocked'
    ? (selected ? 'stamp' : 'carbon')
    : state === 'failed' ? 'void' : 'paper';

  return (
    <Card variant={variant} onPress={onPress} accessibilityLabel={title} className={cx('gap-[7px]', className)}>
      <View className="flex-row gap-[12px]">
        {onToggleSelect ? (
          <Touchable
            onPress={onToggleSelect}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!selected }}
            accessibilityLabel={`select ${title.toLowerCase()}`}
            className={cx(
              'w-[22px] h-[22px] items-center justify-center mt-[2px]',
              selected ? 'bg-tone-stamp border-[1.5px] border-tone-stamp' : 'bg-tone-panel border-[1.5px] border-tone-carbon-line',
            )}
          >
            {selected ? <Icon.Check className="w-[13px] h-[13px] text-tone-inv-fg" /> : null}
          </Touchable>
        ) : null}

        <View className="flex-1 gap-[6px]">
          {eyebrow || tag.text ? (
            <View className="flex-row items-start justify-between gap-[10px]">
              {/* The spacer keeps the tag in the corner the canvas puts it in
                  (T4) on the cards that carry no eyebrow. */}
              {eyebrow
                ? <Label variant="tag" className="flex-1">{eyebrow}</Label>
                : <View className="flex-1" />}
              {tag.text ? <Label variant="tag" tone={tag.tone}>{tag.text}</Label> : null}
            </View>
          ) : null}

          {meta ? <Label variant="tag">{meta}</Label> : null}
          <Txt variant="card">{title}</Txt>
          {quote ? <Txt variant="quote" tone="muted">{`“${quote}”`}</Txt> : null}
          {reason ? <Txt variant="small" tone="muted">{reason}</Txt> : null}

          {progress !== undefined ? (
            <View className="gap-[6px] mt-[2px]">
              <Progress value={progress} tone="stamp" />
              {progressNote ? <Label variant="tag">{progressNote}</Label> : null}
            </View>
          ) : null}

          {receiptRef ? (
            <Touchable
              onPress={onOpenReceipt}
              disabled={!onOpenReceipt}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel={receiptRef.toLowerCase()}
            >
              <Label variant="tag" tone="stamp">{`${receiptRef} →`}</Label>
            </Touchable>
          ) : null}

          {state === 'capture' ? (
            <View className="flex-row items-center gap-[8px] mt-[2px]">
              <Label variant="loud" tone="fg" className="flex-1">YOU STILL HAVE TO DO THIS</Label>
              {primaryAction ? (
                <Button
                  variant="secondary"
                  size="compact"
                  title={primaryAction.label}
                  onPress={primaryAction.onPress}
                />
              ) : null}
            </View>
          ) : null}

          {state !== 'capture' && (primaryAction || secondaryAction) ? (
            <View className="flex-row gap-[8px] mt-[3px]">
              {primaryAction ? (
                <Button
                  variant="primary"
                  size="compact"
                  title={primaryAction.label}
                  onPress={primaryAction.onPress}
                  className="flex-1"
                />
              ) : null}
              {secondaryAction ? (
                <Button
                  variant="secondary"
                  size="compact"
                  title={secondaryAction.label}
                  onPress={secondaryAction.onPress}
                  className="flex-1"
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

// -- the conversation row --------------------------------------------------

/**
 * Canvas H1: when and where, how long, what it was about, and the chips that
 * say what came out of it. A paper card, because a finished conversation is
 * history rather than something waiting on you.
 */
export function ConversationRow({
  when, place, duration, title, summary, chips, onPress, className,
}: {
  /** `11:04`. */
  when: string;
  /** `OFFICE`, `CALL`, `CAR` — where the pendant thought it was. */
  place?: string;
  /** `22 MIN`. */
  duration?: string;
  title: string;
  summary?: string;
  /** From `conversationChips(...)` — languages, commitments, what is settled. */
  chips?: { label: string; tone: ChipTone }[];
  onPress?: () => void;
  className?: string;
}) {
  return (
    <Card onPress={onPress} accessibilityLabel={title} className={cx('gap-[7px]', className)}>
      <View className="flex-row justify-between items-baseline gap-[10px]">
        <Label variant="nav">{[when, place]}</Label>
        {duration ? <Label variant="nav">{duration}</Label> : null}
      </View>
      <Txt variant="row">{title}</Txt>
      {summary ? <Txt variant="small" tone="muted" numberOfLines={2}>{summary}</Txt> : null}
      {chips?.length ? (
        <View className="flex-row flex-wrap gap-[7px] mt-[2px]">
          {chips.map((chip) => <Chip key={chip.label} label={chip.label} tone={chip.tone} />)}
        </View>
      ) : null}
    </Card>
  );
}

// -- the notification card -------------------------------------------------

/**
 * What lyzn says on a lock screen and in the app's own list — canvas S2.
 * `ask` is carbon and carries buttons, `done` is paper and carries a receipt
 * reference, `note` is the quiet one that only reports.
 */
export type NotificationVariant = 'ask' | 'done' | 'note';

export function NotificationCard({
  variant = 'note', source = 'LYZN', when, title, body, footnote,
  primaryAction, secondaryAction, onPress, className,
}: {
  variant?: NotificationVariant;
  /** `LYZN · NEEDS YOUR YES`, `LYZN · DONE`. */
  source?: string;
  /** `NOW`, `11:05`. */
  when?: string;
  title: string;
  body?: string;
  /** `11:05:07 ✓ · RECEIPT #0412`, in settled green. */
  footnote?: string;
  primaryAction?: { label: string; onPress?: () => void };
  secondaryAction?: { label: string; onPress?: () => void };
  onPress?: () => void;
  className?: string;
}) {
  return (
    <Card
      variant={variant === 'ask' ? 'carbon' : 'paper'}
      onPress={onPress}
      accessibilityLabel={title}
      className={cx('gap-[6px]', className)}
    >
      <View className="flex-row justify-between items-baseline gap-[10px]">
        <Label variant="tag" tone={variant === 'ask' ? 'stamp' : 'faint'} className="flex-1">
          {source}
        </Label>
        {when ? <Label variant="tag">{when}</Label> : null}
      </View>
      <Txt variant="card">{title}</Txt>
      {body ? <Txt variant="small" tone="muted">{body}</Txt> : null}
      {footnote ? <Label variant="tag" tone="settled">{footnote}</Label> : null}
      {primaryAction || secondaryAction ? (
        <View className="flex-row gap-[7px] mt-[4px]">
          {primaryAction ? (
            <Button variant="primary" size="compact" title={primaryAction.label} onPress={primaryAction.onPress} className="flex-1" />
          ) : null}
          {secondaryAction ? (
            <Button variant="secondary" size="compact" title={secondaryAction.label} onPress={secondaryAction.onPress} className="flex-1" />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

// -- the recording pill ----------------------------------------------------

/**
 * Canvas H1 and P1: a void rule around paper, a red dot, the word, the clock
 * and six bars. It is the only thing on Home allowed to say `RECORDING`, and
 * it says it in red because the room can see the pendant's light too.
 */
export function RecordingPill({
  label = 'RECORDING', detail, bars = [8, 17, 11, 22, 7, 14], onPress, className,
}: {
  label?: string;
  /** `Now · 04:12`, `Office · since 11:04`. */
  detail?: string;
  /** Bar heights in points — six, as the canvas draws them. */
  bars?: number[];
  onPress?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <View className="w-[9px] h-[9px] rounded-full bg-tone-danger" />
      <View className="flex-1">
        <Label variant="action" tone="danger">{label}</Label>
        {detail ? <Txt variant="strong">{detail}</Txt> : null}
      </View>
      <View className="flex-row items-end gap-[2.5px] h-[24px]">
        {bars.map((h, i) => (
          <View key={i} className="w-[2.5px] bg-tone-danger" style={{ height: h }} />
        ))}
      </View>
    </>
  );
  const surface = cx(
    'flex-row items-center gap-[11px] py-[14px] px-[15px] bg-tone-panel border-[1.5px] border-tone-danger',
    className,
  );
  if (!onPress) return <View className={surface}>{body}</View>;
  return (
    <Touchable onPress={onPress} accessibilityRole="button" accessibilityLabel={label.toLowerCase()} className={surface}>
      {body}
    </Touchable>
  );
}
