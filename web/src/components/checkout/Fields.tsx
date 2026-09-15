import { useId, type ComponentProps, type ReactNode } from 'react'
import { INDIAN_STATES } from '@/data/pricing'
import { cn } from '@/lib/utils'

/**
 * Label, control and message, wired together by id.
 *
 * The control arrives as a render prop rather than being a fixed input, so
 * a select and a text field share one layout and one error treatment. A
 * checkout with two field styles reads as two different forms.
 */
export function Field({
  label,
  error,
  hint,
  className,
  locked,
  dataField,
  children,
}: {
  label: string
  error?: string
  hint?: string
  className?: string
  /**
   * Shows the value as text with a `Change` ghost link instead of a
   * control — the buyer's name and email, once Clerk has already supplied
   * them. `error` and `hint` still render underneath: a locked field is not
   * exempt from validation, just from typing.
   */
  locked?: { value: string; onChange: () => void }
  /**
   * Mirrors the `data-field` a control would otherwise carry, so a locked
   * field is still something `showAll()` can find and send focus to on
   * submit rather than silently doing nothing.
   */
  dataField?: string
  children: (props: {
    id: string
    'aria-invalid': boolean
    'aria-describedby': string | undefined
  }) => ReactNode
}) {
  const id = useId()
  const messageId = error || hint ? `${id}-message` : undefined

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="label-sm text-tone-muted">
        {label}
      </label>

      {locked ? (
        <div
          id={id}
          data-field={dataField}
          className="control flex items-center justify-between gap-4"
        >
          <span className="truncate text-[15px]">{locked.value}</span>
          <button
            type="button"
            onClick={locked.onChange}
            className="link shrink-0 text-[13px] text-tone-muted"
          >
            Change
          </button>
        </div>
      ) : (
        children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': messageId })
      )}

      {(error || hint) && (
        <p
          id={messageId}
          className={cn('text-[13px] leading-snug', error ? 'text-danger' : 'text-tone-faint')}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

export function TextControl(props: ComponentProps<'input'>) {
  return <input {...props} className={cn('control', props.className)} />
}

export function SelectControl({ children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select {...props} className={cn('control cursor-pointer appearance-none pr-11', props.className)}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 8"
        className="pointer-events-none absolute top-1/2 right-4 w-3 -translate-y-1/2 text-tone-muted"
      >
        <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  )
}

export function StateSelect({
  value,
  onChange,
  ...props
}: ComponentProps<'select'> & { value: string }) {
  return (
    <SelectControl value={value} onChange={onChange} {...props}>
      <option value="">Choose a state</option>
      {INDIAN_STATES.map((state) => (
        <option key={state} value={state}>
          {state}
        </option>
      ))}
    </SelectControl>
  )
}

/** A checkbox that looks like the rest of the page rather than like the OS. */
export function CheckboxField({
  checked,
  onChange,
  children,
  id,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  children: ReactNode
  id?: string
}) {
  const generated = useId()
  const inputId = id ?? generated

  return (
    <div className="flex items-start gap-3">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer appearance-none border border-tone-line-2 bg-tone-panel checked:border-transparent checked:bg-tone-inv-bg"
        style={{
          backgroundImage: checked
            ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2 4.8 8.5 9.5 3.8' fill='none' stroke='%23F3F1EC' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")"
            : undefined,
          backgroundSize: '12px',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <label htmlFor={inputId} className="cursor-pointer text-[15px] leading-snug text-tone-muted">
        {children}
      </label>
    </div>
  )
}
