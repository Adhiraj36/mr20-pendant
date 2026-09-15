/**
 * The kit — every part on the design canvas, once, with the rule that
 * governs it (canvas §06, "COMPONENT SHEET").
 *
 * One import site for a screen. Three rules hold the whole thing together:
 *
 * 1. **A component names a role, never a colour.** Every surface is written
 *    over the `--tone-*` variables, so the same class is right on the desk
 *    and at night and no component branches on the theme.
 * 2. **`className` is layout only** — margin, gap, flex, position. A card's
 *    ground, a label's size and a button's fill belong to its props, because
 *    two classes that set the same property are decided by the order
 *    Tailwind emitted them, which is not something a caller can reason about.
 * 3. **The decisions are pure.** `taskCardState`, `receiptFromTask`,
 *    `codeBoxes` and the label joins live in `models.ts` with no React
 *    around them, so `node --test` can ask them directly.
 */

// The type scale and the colour roles, as classes.
export {
  TXT, MONO, TEXT_TONE, BG_TONE, BORDER_TONE, cx,
  type TxtVariant, type MonoVariant, type TextTone, type BgTone, type BorderTone,
} from './type';

// The decisions, pure.
export {
  taskCardState, taskTag, taskKindLabel, taskEyebrow,
  receiptFromTask, receiptClock,
  metaLine, countLabel, conversationChips,
  codeBoxes, codeGroups, parseInk, isInk, inkHex, INKS, DEFAULT_INK, INK_STORAGE_KEY,
  RECEIPT_GROUND,
  type TaskStatus, type TaskKind, type TaskCardState, type TaskLike,
  type DraftReceipt, type ReceiptRowModel, type CodeBoxes as CodeBoxesModel,
  type InkId,
} from './models';

// Type.
export { Txt, Label, MetaLine, type TxtProps, type LabelProps } from './text';

// Ground, chrome, surfaces.
export {
  Screen, TopRow, TopAction, Card, Banner, EmptyCard, Chip, Progress, AskBar,
  KitTextInput,
  type ScreenProps, type CardProps, type CardVariant, type CardPad,
  type BannerVariant, type ChipTone, type ProgressTone,
} from './surfaces';

// Controls.
export {
  Button, Segments, Toggle, Field, CodeBoxes, CodePlate, InkPicker, useInk,
  type ButtonProps, type ButtonVariant, type ButtonSize,
} from './controls';

// Rows and cards.
export {
  KeyValue, KeyValues, SettingsRow, TaskCard, ConversationRow,
  NotificationCard, RecordingPill,
  type TaskCardProps, type NotificationVariant,
} from './rows';

// Proof of work.
export { Receipt, ReceiptCard, type ReceiptProps } from './receipt';

// The sheet and the bar.
export { Sheet } from './Sheet';
export { TabBar, TABS, type TabItem } from './TabBar';

// The waveform, in the canvas' void red by default.
export { Waveform, type WaveformTone } from './Waveform';

// Migrated to classes, re-exported so a screen has one import site.
export { Touchable } from '../Touchable';
export { Enter } from '../Enter';
export { MarkPulse } from '../MarkPulse';
export { Scrub } from '../Scrub';
export { TickRow } from '../TickRow';
export { ToastProvider, useToast, type ToastTone } from '../Toast';

// The tone, for the two things that own a ground of their own.
export { ToneProvider, useTone, useTheme, setTheme, type Ground, type Tone } from '../tone';
export { Icon, type IconComponent, type IconName } from '../interop';
