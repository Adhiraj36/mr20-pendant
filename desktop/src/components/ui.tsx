// The kit. One file, because a design this small is easier to keep coherent
// when you can see all of it at once.
import { forwardRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, Loader2 } from 'lucide-react'
import { cn } from '@/lib/util'

// ---------------------------------------------------------------------------
// Surfaces

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={cn(
        'relative rounded-[var(--radius-panel)] border bg-[var(--skin-1)] ',
        'shadow-[var(--shadow-panel)]',
        padded && 'p-6',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function Tile({
  children,
  className,
  onClick,
  interactive,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
  interactive?: boolean
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'rounded-[var(--radius-tile)] border bg-[var(--skin-1)] p-4 text-left',
        (interactive || onClick) &&
          'transition duration-200 [transition-timing-function:var(--ease-out-soft)] hover:border-[var(--edge-strong)] hover:bg-[var(--skin-2)]',
        className,
      )}
    >
      {children}
    </Comp>
  )
}

export function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 max-w-prose text-[13px] text-[var(--fg-dim)]">{hint}</p>}
      </div>
      {action}
    </header>
  )
}

export function PageHeader({
  title,
  lede,
  action,
}: {
  title: string
  lede?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-7 flex items-start justify-between gap-6">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
        {lede && <p className="mt-1.5 max-w-[62ch] text-[14px] text-[var(--fg-dim)]">{lede}</p>}
      </div>
      {action && <div className="shrink-0 pt-1">{action}</div>}
    </header>
  )
}

// ---------------------------------------------------------------------------
// Controls

type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger'

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant
    busy?: boolean
    icon?: ReactNode
    size?: 'sm' | 'md' | 'lg'
  }
>(function Button(
  { variant = 'quiet', busy, icon, size = 'md', className, children, disabled, ...rest },
  ref,
) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      'bg-[var(--accent)] text-[var(--accent-ink)] font-semibold hover:bg-[var(--accent-bright)] shadow-[0_6px_20px_-8px_var(--accent-glow)]',
    ghost: 'border bg-transparent hover:bg-[var(--skin-2)] hover:border-[var(--edge-strong)]',
    quiet: 'border bg-[var(--skin-2)] hover:bg-[var(--skin-3)] hover:border-[var(--edge-strong)]',
    danger: 'border border-[var(--bad)]/40 bg-[var(--bad-skin)] text-[var(--bad)] hover:bg-[var(--bad)]/20',
  }
  const sizes = {
    sm: 'h-8 px-3 text-[13px] gap-1.5',
    md: 'h-9.5 px-4 text-[13.5px] gap-2',
    lg: 'h-11 px-5 text-[14.5px] gap-2',
  }
  return (
    <button
      ref={ref}
      disabled={disabled || busy}
      className={cn(
        'inline-flex shrink-0 items-center justify-center  whitespace-nowrap',
        'transition duration-150 [transition-timing-function:var(--ease-out-soft)]',
        'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45',
        sizes[size],
        styles[variant],
        className,
      )}
      {...rest}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  )
})

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        'flex items-start justify-between gap-6 py-3.5',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] text-[var(--fg-dim)]">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-[24px] w-[42px] shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-transparent bg-[var(--accent)]' : 'bg-[var(--skin-3)]',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-[left] duration-200 [transition-timing-function:var(--ease-out-soft)]',
            checked ? 'left-[21px]' : 'left-[2px]',
          )}
        />
      </button>
    </label>
  )
}

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string
  hint?: string
  children: ReactNode
  error?: string | null
}) {
  return (
    <label className="block py-3">
      <span className="block text-[13.5px] font-medium">{label}</span>
      {hint && <span className="mt-0.5 mb-2 block text-[12.5px] text-[var(--fg-dim)]">{hint}</span>}
      <span className={cn('block', !hint && 'mt-2')}>{children}</span>
      {error && <span className="mt-1.5 block text-[12.5px] text-[var(--bad)]">{error}</span>}
    </label>
  )
}

const inputBase =
  'w-full  border bg-[var(--skin-2)] px-3.5 py-2.5 text-[13.5px] text-[var(--fg)] ' +
  'placeholder:text-[var(--fg-faint)] transition-colors duration-150 ' +
  'hover:border-[var(--edge-strong)] focus:border-[var(--accent)] focus:outline-none'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(inputBase, className)} {...rest} />
  },
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(inputBase, 'resize-y leading-relaxed', className)} {...rest} />
})

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <span className={cn('relative block', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputBase, 'cursor-pointer appearance-none pr-9')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[var(--ink)] text-[var(--fg)]">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-faint)]"
      />
    </span>
  )
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  format?: (v: number) => string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <span className="flex items-center gap-4">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:size-[15px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_5px_rgba(0,0,0,0.5)]"
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, var(--skin-3) ${pct}%)`,
        }}
      />
      <span className="w-16 shrink-0 text-right font-mono text-[12.5px] text-[var(--fg-dim)] tabular-nums">
        {format ? format(value) : value}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// State, said three ways: a colour, a glyph, and words.

export type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'busy'

const toneVar: Record<Tone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  idle: 'var(--idle)',
  busy: 'var(--accent)',
}
const toneSkin: Record<Tone, string> = {
  ok: 'var(--ok-skin)',
  warn: 'var(--warn-skin)',
  bad: 'var(--bad-skin)',
  idle: 'var(--idle-skin)',
  busy: 'var(--accent-glow)',
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      {pulse && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-60"
          style={{ background: toneVar[tone] }}
        />
      )}
      <span className="relative size-2.5 rounded-full" style={{ background: toneVar[tone] }} />
    </span>
  )
}

export function Badge({
  tone = 'idle',
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium',
        className,
      )}
      style={{ background: toneSkin[tone], color: toneVar[tone] }}
    >
      {children}
    </span>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code className={cn('selectable font-mono text-[12.5px] text-[var(--fg-dim)]', className)}>
      {children}
    </code>
  )
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={done ? <Check size={14} /> : <Copy size={14} />}
      onClick={() => {
        void navigator.clipboard.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
    >
      {label === '' ? null : done ? 'Copied' : (label ?? 'Copy')}
    </Button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={16} className={cn('animate-spin text-[var(--fg-faint)]', className)} />
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-[var(--fg-faint)]">{icon}</div>}
      <div>
        <p className="text-[14px] font-medium">{title}</p>
        {body && <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-[var(--fg-dim)]">{body}</p>}
      </div>
      {action}
    </div>
  )
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-[var(--edge)]">{children}</div>
}
