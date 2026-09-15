/**
 * The canvas' type and colour roles, as Tailwind class strings.
 *
 * Every size, weight, tracking and leading the design canvas draws is
 * written down once, here, and nowhere else — a kit component names a role
 * (`TXT.card`, `MONO.eyebrow`) and a screen names a kit prop. The numbers are
 * the canvas' own: `letter-spacing:.14em` at 11px is 1.54px, because React
 * Native's `letterSpacing` is absolute where CSS's is a fraction of the em
 * (NativeWind's native preset replaces Tailwind's em `tracking-*` scale with
 * a px one; arbitrary px is therefore the honest spelling).
 *
 * These are plain strings so Tailwind's content scanner finds them: it reads
 * source text, not evaluated JavaScript, so a class only exists if it is
 * spelled out somewhere under `src/` or `app/`. Never build one by
 * concatenation.
 *
 * No React, no react-native — the tests reach this file directly.
 */

/**
 * Sans, by the job it does on the canvas rather than by its size.
 *
 * Archivo ships 400/500/600/800 and the canvas asks for 700 in three places.
 * There is no 700 file, and a `fontWeight` without a family gets a
 * synthesised fake bold on Android, so the canvas' 700 lands on **800** (the
 * heaviest cut we load) and its 600 on 600. The hierarchy the canvas draws
 * is a size ladder, not a weight ladder, so nothing is lost.
 */
export const TXT = {
  /**
   * 34/800 — the one claim on the welcome screen, and nowhere else. The
   * canvas sets O1's headline a full step above every other screen's title
   * because it is the only sentence in the app that has a page to itself.
   */
  claim: 'font-sans-800 text-[34px] tracking-[-1.19px] leading-[1.1]',
  /** 27/800 — a tab's own title: "Today", "Receipts", "Ask lyzn". */
  screen: 'font-sans-800 text-[27px] tracking-[-0.81px] leading-[1.05]',
  /** 23/800 — a pushed screen's headline. */
  title: 'font-sans-800 text-[23px] tracking-[-0.64px] leading-[1.14]',
  /** 19/800 — the statement an empty state or a system card opens with. */
  statement: 'font-sans-800 text-[19px] tracking-[-0.42px] leading-[1.22]',
  /** 16/700 — a card's own headline: the task, the notification. */
  card: 'font-sans-800 text-[16px] tracking-[-0.24px] leading-[1.25]',
  /** 16.5/700 — a conversation row's title, the one place the canvas widens. */
  row: 'font-sans-800 text-[16.5px] tracking-[-0.25px] leading-[1.25]',
  /** 15/600 — a settings row, a receipt's quote, a "what you can do" line. */
  strong: 'font-sans-600 text-[15px] leading-[1.35]',
  /** 15/400 — body copy. */
  body: 'font-sans-400 text-[15px] leading-[1.5]',
  /** 14.5/400 — the longer body the canvas sets under a statement. */
  bodyL: 'font-sans-400 text-[14.5px] leading-[1.5]',
  /** 13.5/400 — a card's supporting line. */
  small: 'font-sans-400 text-[13.5px] leading-[1.45]',
  /** 13/400 — the quote under a task, the tightest copy on the canvas. */
  quote: 'font-sans-400 text-[13px] leading-[1.4]',
  /** 14.5/600 — a receipt's quote slot. */
  slip: 'font-sans-600 text-[14.5px] tracking-[-0.15px] leading-[1.3]',
} as const;

export type TxtVariant = keyof typeof TXT;

/**
 * Martian Mono, uppercase, by the job it does. Every label in the app is one
 * of these; tracking opens as the size drops, which is the canvas' own habit.
 */
export const MONO = {
  /**
   * 12/700 · .36em — the wordmark, standing alone at the top of the welcome
   * screen (canvas O1). Nothing else in the app is tracked this far open;
   * it is a mark rather than a label, which is why it gets its own row.
   */
  mark: 'font-mono-700 text-[12px] tracking-[4.32px] uppercase',
  /** 11/700 · .14em — the primary button, and only the button. */
  button: 'font-mono-700 text-[11px] tracking-[1.54px] uppercase',
  /** 11/500 · .14em — a secondary button's label. */
  buttonSecondary: 'font-mono-500 text-[11px] tracking-[1.54px] uppercase',
  /** 10.5/500 · .14em — `← TODAY`, a top row's back label and right action. */
  back: 'font-mono-500 text-[10.5px] tracking-[1.47px] uppercase',
  /** 10.5/500 · .1em — a ghost link, the quiet line under a button. */
  ghost: 'font-mono-500 text-[10.5px] tracking-[1.05px] uppercase',
  /** 10/500 · .12em — a compact button, a banner's action, a card's tag. */
  action: 'font-mono-500 text-[10px] tracking-[1.2px] uppercase',
  /** 10/500 · .1em — a segment, a tab label, a conversation's meta line. */
  nav: 'font-mono-500 text-[10px] tracking-[1px] uppercase',
  /**
   * 10/400 · .1em — a key-value row: the key, the leader and the value.
   * **Not uppercased**, alone among the mono variants: a receipt's value is
   * data, and `quote-RK-0904.pdf` is a filename, not a label. Callers write
   * the keys in capitals because that is what they are.
   */
  value: 'font-mono-400 text-[10px] tracking-[1px]',
  /** 10/700 · .12em — `YOU STILL HAVE TO DO THIS`, the one loud mono line. */
  loud: 'font-mono-700 text-[10px] tracking-[1.2px] uppercase',
  /** 9.5/500 · .14em — a section eyebrow above a card. */
  eyebrow: 'font-mono-500 text-[9.5px] tracking-[1.33px] uppercase',
  /** 9.5/500 · .12em — a card's own eyebrow: the kind, and who it is for. */
  tag: 'font-mono-500 text-[9.5px] tracking-[1.14px] uppercase',
  /** 9/500 · .1em — a chip. */
  chip: 'font-mono-500 text-[9px] tracking-[0.9px] uppercase',
  /** 9/700 · .22em — `LYZN · PROOF OF WORK`, on a full receipt. */
  slipTitle: 'font-mono-700 text-[9px] tracking-[1.98px] uppercase',
  /** 8.5/700 · .2em — the same title on a roll item. */
  slipTitleSm: 'font-mono-700 text-[8.5px] tracking-[1.7px] uppercase',
  /** 10/700 · .12em — a stamp's word, inside its rotated box. */
  stamp: 'font-mono-700 text-[10px] tracking-[1.2px] uppercase',
  /** 22/700 — the digit in a code box. */
  code: 'font-mono-700 text-[22px]',
} as const;

export type MonoVariant = keyof typeof MONO;

/**
 * The colour roles, as text classes. Each is a `--tone-*` variable, so the
 * same class is correct on the desk and at night with no branching — that is
 * the whole reason the tone system exists (plan §2.3).
 *
 * `inv` is the ink a strong fill needs: the sheet on the desk, the night's
 * own dark at night. It is what makes one `bg-tone-inv-bg text-tone-inv-fg`
 * button read correctly in both themes.
 */
export const TEXT_TONE = {
  fg: 'text-tone-fg',
  muted: 'text-tone-muted',
  faint: 'text-tone-faint',
  inv: 'text-tone-inv-fg',
  stamp: 'text-tone-stamp',
  settled: 'text-tone-settled',
  danger: 'text-tone-danger',
} as const;

export type TextTone = keyof typeof TEXT_TONE;

/** The same roles as a background, for the dots and bars that carry them. */
export const BG_TONE = {
  fg: 'bg-tone-fg',
  muted: 'bg-tone-muted',
  faint: 'bg-tone-faint',
  line: 'bg-tone-line',
  inv: 'bg-tone-inv-bg',
  stamp: 'bg-tone-stamp',
  settled: 'bg-tone-settled',
  danger: 'bg-tone-danger',
} as const;

export type BgTone = keyof typeof BG_TONE;

/** And as a border, for the rules and rings that carry them. */
export const BORDER_TONE = {
  line: 'border-tone-line',
  line2: 'border-tone-line2',
  carbon: 'border-tone-carbon-line',
  stamp: 'border-tone-stamp',
  settled: 'border-tone-settled',
  danger: 'border-tone-danger',
} as const;

export type BorderTone = keyof typeof BORDER_TONE;

/**
 * Joins class fragments, dropping the falsy ones. Only ever used on whole
 * strings from the tables above plus a caller's `className` — never to build
 * a class name from parts, which the scanner could not see.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
