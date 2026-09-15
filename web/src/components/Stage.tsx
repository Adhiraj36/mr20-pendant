import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The visual language of the transformation.
 *
 * Everything the site shows of the app and the desktop agent is built from
 * these six pieces. They are deliberately abstract: neither product's real
 * interface exists yet, and a convincing fake screenshot would be a promise
 * the software has not made. What they do show — a waveform, timestamps, a
 * summary, a task, a status — is true of the pipeline that already runs.
 *
 * Everything animated here is driven by a CSS custom property that a parent
 * writes once a frame. No word, line or bar is a React render.
 */

export function Stage({
  label,
  children,
  className,
  style,
}: {
  label?: ReactNode
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      style={style}
      className={cn(
        'panel relative flex flex-col gap-5 overflow-hidden p-6 sm:p-7',
        className,
      )}
    >
      {label && <p className="label-sm text-tone-faint">{label}</p>}
      {children}
    </div>
  )
}

/**
 * Twelve bars. The only thing on the page that loops, because it is the one
 * thing that is genuinely still happening while you look at it.
 */
export function Waveform({ bars = 12, className }: { bars?: number; className?: string }) {
  const heights = [0.35, 0.7, 0.45, 1, 0.6, 0.85, 0.3, 0.75, 0.5, 0.9, 0.4, 0.65]
  return (
    <div className={cn('flex h-8 items-end gap-[3px]', className)} aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] flex-1 origin-bottom rounded-[1px] bg-tone-muted motion-safe:animate-[level_1.1s_ease-in-out_infinite]"
          style={{
            height: `${(heights[i % heights.length] ?? 0.5) * 100}%`,
            animationDelay: `${(i % 6) * 0.11}s`,
          }}
        />
      ))}
    </div>
  )
}

/** Words that arrive one at a time. `--reveal` counts them in. */
export function Words({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split(' ').map((word, i) => (
        <span
          key={`${word}-${i}`}
          style={{ '--i': String(i) } as CSSProperties}
          className="count-word"
        >
          {word}{' '}
        </span>
      ))}
    </span>
  )
}

export function SpokenLine({
  initial,
  speaker,
  text,
  reveal,
}: {
  initial: string
  speaker: string
  text: string
  reveal?: boolean
}) {
  return (
    <div className="flex gap-3.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-tone-line-2 font-mono text-[11px] text-tone-muted"
      >
        {initial}
      </span>
      <p className="text-[15px] leading-relaxed text-tone sm:text-base">
        <span className="sr-only">{speaker}: </span>
        {reveal ? <Words text={text} /> : text}
      </p>
    </div>
  )
}

export function TranscriptLine({
  t,
  speaker,
  text,
  recede,
  className,
  style,
}: {
  t: string
  speaker: string
  text: string
  /** For a parent that counts the lines in; goes on the <li> itself so the list stays a list. */
  className?: string
  style?: CSSProperties
  /**
   * Steps back behind the summary once the summary exists.
   *
   * A colour change rather than an opacity one. Fading this to 30% — which
   * is what "recedes" usually means — leaves real words on the screen at
   * around 2.5:1, which is not a visual effect, it is unreadable text. One
   * step down the same ramp says the same thing and stays legible.
   */
  recede?: boolean
}) {
  return (
    <li
      style={style}
      className={cn(
        'grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 sm:grid-cols-[auto_auto_1fr]',
        className,
      )}
    >
      <span className="font-mono text-[11px] text-tone-faint tabular-nums">{t}</span>
      <span
        className={cn('font-mono text-[11px]', recede ? 'text-tone-faint' : 'text-tone-muted')}
      >
        {speaker}
      </span>
      <span
        className={cn(
          'col-span-2 text-[14px] leading-snug transition-colors duration-500 sm:col-span-1',
          recede ? 'text-tone-muted' : 'text-tone',
        )}
      >
        {text}
      </span>
    </li>
  )
}

/**
 * The summary, with the two phrases the tasks come out of.
 *
 * `--sweep` draws the underline under those phrases, which is the moment the
 * section is really about: the tasks are not invented, they are lifted from
 * words that were actually said.
 */
export function SummaryCard({
  title,
  bullets,
  marks = [],
}: {
  title: string
  bullets: readonly string[]
  marks?: readonly string[]
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] font-medium text-tone">{title}</p>
      <ul className="flex flex-col gap-2">
        {bullets.map((bullet) => (
          <li key={bullet} className="text-[14px] leading-snug text-tone-muted">
            {mark(bullet, marks)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Wraps any marked phrase in a swept underline. */
function mark(text: string, marks: readonly string[]) {
  if (marks.length === 0) return text
  const pattern = new RegExp(`(${marks.map(escapeRegExp).join('|')})`, 'gi')
  return text.split(pattern).map((part, i) =>
    marks.some((m) => m.toLowerCase() === part.toLowerCase()) ? (
      <span
        key={i}
        className="sweep text-tone"
      >
        {part}
      </span>
    ) : (
      part
    ),
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function TaskRow({
  text,
  due,
  done,
  running,
  index = 0,
}: {
  text: string
  due: string
  done?: boolean
  running?: boolean
  index?: number
}) {
  return (
    <div
      style={{ '--i': String(index) } as CSSProperties}
      className="count-task flex items-center gap-3 rounded-[12px] border border-tone-line bg-tone-panel-2 px-3.5 py-3"
    >
      <Checkbox done={done} />
      <span
        className={cn(
          'min-w-0 flex-1 text-[14px] leading-snug text-tone transition-colors',
          done && 'text-tone-muted line-through decoration-tone-faint',
        )}
      >
        {text}
      </span>
      {running && (
        <span className="label-sm shrink-0 rounded-[6px] border border-tone-line-2 px-2 py-1 text-tone-muted">
          Run
        </span>
      )}
      <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-tone-muted">{due}</span>
    </div>
  )
}

export function Checkbox({ done }: { done?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-300',
        done ? 'border-transparent bg-tone-inv-bg' : 'border-tone-line-2',
      )}
    >
      {done && (
        <svg viewBox="0 0 12 12" className="size-3 text-tone-inv-fg">
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  )
}

/**
 * The desktop agent, as much of it as anyone needs to see.
 *
 * Three lines, no application name, no command. The point of the section is
 * the outcome, and a terminal on this page would make the product look like
 * something only a developer could own.
 */
export function StatusBlock({
  lines,
  className,
}: {
  lines: readonly { label: string; value: string }[]
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-[12px] border border-tone-line bg-tone-panel-2 p-4',
        className,
      )}
    >
      {lines.map((line, i) => (
        <div
          key={line.label}
          style={{ '--i': String(i) } as CSSProperties}
          className="count-status flex items-baseline justify-between gap-4"
        >
          <span className="label-sm text-tone-muted">{line.label}</span>
          {line.value && (
            <span className="truncate font-mono text-[11px] text-tone-faint tabular-nums">
              {line.value}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
