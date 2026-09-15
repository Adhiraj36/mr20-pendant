import { useState } from 'react'
import { Button } from '@/components/Button'
import { Field, TextControl } from '@/components/checkout/Fields'
import { useEmailCode } from '@/lib/useEmailCode'

/**
 * Sign in with an email and a code, and nothing else.
 *
 * Clerk's `<SignIn/>` is a whole second design system — its own type, its
 * own buttons, its own idea of a card — dropped into the middle of ours.
 * This is the same authentication through Clerk's headless hooks, wearing
 * the checkout's own `Field`, `TextControl` and `Button` instead.
 *
 * The authentication itself lives in `useEmailCode`, which the pricing
 * section's paysheet asks for the same six digits with; this card is the
 * checkout's way of drawing it.
 */
export function SignInCard({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail)
  const { code, setCode, onCode, busy, error, wait, send, resend, verify, restart } = useEmailCode()

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void (onCode ? verify() : send(email))
      }}
      className="flex flex-col gap-5"
    >
      {/* Once the code is out, the address stops being editable and becomes
          the same locked row the signed-in form uses — changing it here means
          starting over, which is exactly what `Change` does. */}
      <Field
        label="Email"
        error={onCode ? undefined : error}
        locked={onCode ? { value: email, onChange: restart } : undefined}
      >
        {(props) => (
          <TextControl
            {...props}
            value={email}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="rounded-none"
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>

      {onCode && (
        <Field label="Code" error={error} hint="Six digits, good for ten minutes.">
          {(props) => (
            <TextControl
              {...props}
              value={code}
              // The only thing to do on this screen, so it is where the
              // cursor goes the moment the screen exists.
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="rounded-none font-mono tracking-[0.4em] tabular-nums"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          )}
        </Field>
      )}

      <div className="flex flex-col items-start gap-3">
        <Button type="submit" full disabled={busy}>
          {busy ? (onCode ? 'Checking' : 'Sending') : onCode ? 'Sign in' : 'Send code'}
        </Button>

        {onCode && (
          // Offered late on purpose. A resend button live from the first
          // second gets pressed before the first email has landed, and then
          // there are two codes and only one of them works.
          <button
            type="button"
            disabled={busy || wait > 0}
            onClick={() => void resend()}
            className="link text-[13px] text-tone-muted disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
          >
            {wait > 0 ? `Send another code in ${wait}s` : 'Send another code'}
          </button>
        )}
      </div>
    </form>
  )
}
