import { useCallback, useEffect, useState } from 'react'
import { useClerk, useSignIn, useSignUp } from '@clerk/clerk-react'
import { isClerkAPIResponseError } from '@clerk/clerk-react/errors'

/** Long enough that a slow inbox is not a dead end, short enough to not feel stuck. */
const RESEND_AFTER = 30

/** Deliberately loose. The address that counts is the one a code arrives at. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Which of Clerk's two objects is holding the code we just asked it to send.
 *
 * A sign-in and a sign-up are separate attempts with separate verify calls,
 * and whichever one sent the code is the one that has to finish. The
 * `emailAddressId` is what Clerk wants handed back to send the same code
 * again, so it is kept here rather than looked up a second time.
 */
type Sent = { kind: 'signIn'; emailAddressId: string } | { kind: 'signUp' }

/** Clerk's way of saying it has never seen this address before. */
/**
 * "That address already has an account", in the several ways Clerk says it.
 *
 * This is the answer the sign-up path is *listening* for, because it is the
 * one answer enumeration protection does not hide.
 */
function identifierExists(error: unknown) {
  return (
    isClerkAPIResponseError(error) &&
    error.errors.some((e) =>
      e.code === 'form_identifier_exists'
      || e.code === 'form_identifier_exists__email_address'
      || e.code === 'identifier_already_signed_in')
  )
}

/**
 * The instance refusing to make accounts at all — sign-ups closed, a
 * waitlist, a bot check this client cannot answer.
 *
 * None of these are about the address that was typed, so none of them may
 * stop somebody who **already has an account** from signing in.
 */
function signUpsClosed(error: unknown) {
  return (
    isClerkAPIResponseError(error) &&
    error.errors.some((e) =>
      e.code === 'not_allowed_access'
      || e.code === 'sign_up_mode_restricted'
      || e.code === 'sign_up_mode_restricted_waitlist'
      || e.code.startsWith('captcha_'))
  )
}

/** Clerk's own wording wherever it has any; ours where it does not. */
function reason(error: unknown, fallback: string) {
  if (!isClerkAPIResponseError(error)) return fallback
  const first = error.errors[0]
  return first?.longMessage || first?.message || fallback
}

/**
 * Sign in with an email and a code, and nothing else.
 *
 * There is no sign-up here, and no sign-in either, as far as the person
 * typing is concerned: one address goes in, six digits come back. Whether
 * that address already had an account is Clerk's problem, answered by
 * trying the sign-in and falling through to a sign-up when it says the
 * identifier is unknown. Somebody buying a pendant should not have to
 * decide which of two forms they are on.
 *
 * The hook owns the code, the attempt it belongs to, and the resend
 * countdown — everything that is the same wherever six digits are asked
 * for. The address itself belongs to the caller, because the two places
 * that ask for it are a card where it is the only field
 * (`components/checkout/SignInCard.tsx`) and a paysheet where it sits
 * between a phone number and a price (`sections/Pricing.tsx`).
 *
 * `send` and `verify` report whether they got anywhere, so a caller
 * driving stages can move on a `true` and stay where it is — with `error`
 * already set — on a `false`.
 */
export function useEmailCode() {
  const { signIn } = useSignIn()
  const { signUp } = useSignUp()
  const clerk = useClerk()

  const [code, setCode] = useState('')
  const [sent, setSent] = useState<Sent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [sentAt, setSentAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  // A countdown that stops counting. The tick reschedules itself off `now`,
  // so the wait costs one timer while it is running and none once it is up.
  const wait = sentAt ? Math.max(0, RESEND_AFTER - Math.floor((now - sentAt) / 1000)) : 0
  useEffect(() => {
    if (wait === 0) return
    const id = setTimeout(() => setNow(Date.now()), 1000)
    return () => clearTimeout(id)
  }, [wait, now])

  const markSent = useCallback((next: Sent) => {
    setSent(next)
    setCode('')
    setSentAt(Date.now())
    setNow(Date.now())
  }, [])

  const send = useCallback(
    async (address: string) => {
      // The address is judged before Clerk is consulted, so a typo is still
      // answered in the half-second before Clerk has finished loading rather
      // than the button appearing to do nothing at all.
      const identifier = address.trim()
      if (!EMAIL.test(identifier)) {
        setError('That does not look like an email address.')
        return false
      }
      if (!signIn || !signUp || busy) return false

      setBusy(true)
      setError(undefined)
      try {
        // An account Clerk already knows signs in; one it does not is created
        // on the spot. Both paths end at the same six digits.
        //
        // **The sign-up is tried first, and that ordering is the whole point**
        // (round eight). This instance has Clerk's *enumeration protection*
        // switched on, which means `signIn.create` with an address Clerk has
        // never seen does **not** fail with `form_identifier_not_found` — it
        // succeeds, hands back a phantom `email_code` factor, and emails the
        // person "there's no account associated with this email address". The
        // old order therefore sent every new customer to six empty boxes
        // waiting for a code that was never sent, with nothing on the client
        // able to tell the difference. Verified against production.
        //
        // Creating first inverts the ambiguity onto the answer Clerk *does*
        // give honestly — `form_identifier_exists` — which is what sends an
        // existing account down the sign-in path.
        const created = await signUp.create({ emailAddress: identifier })
          .then(() => true)
          .catch((e: unknown) => {
            // "Taken" means sign in. So does "we are not making accounts
            // right now": whatever the instance's policy is, it cannot lock
            // out an account that already exists.
            if (identifierExists(e) || signUpsClosed(e)) return false
            throw e
          })

        if (!created) {
          const attempt = await signIn.create({ identifier })
          const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === 'email_code')
          // The second look at `strategy` is for the type checker — `find`
          // cannot narrow the union it just searched — and it doubles as the
          // guard for an account that signs in some other way entirely.
          if (factor?.strategy !== 'email_code') {
            setError('This account does not sign in with an emailed code.')
            return false
          }
          await signIn.prepareFirstFactor({
            strategy: 'email_code',
            emailAddressId: factor.emailAddressId,
          })
          markSent({ kind: 'signIn', emailAddressId: factor.emailAddressId })
        } else {
          await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
          markSent({ kind: 'signUp' })
        }
        return true
      } catch (e) {
        setError(reason(e, 'We could not send a code just now. Try again.'))
        return false
      } finally {
        setBusy(false)
      }
    },
    [busy, markSent, signIn, signUp],
  )

  const resend = useCallback(async () => {
    if (!signIn || !signUp || !sent || busy || wait > 0) return

    setBusy(true)
    setError(undefined)
    try {
      // Prepared again on the attempt that is already open, rather than
      // started from scratch — a resend should not lose the attempt the
      // first code belongs to.
      if (sent.kind === 'signIn') {
        await signIn.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: sent.emailAddressId,
        })
      } else {
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      }
      markSent(sent)
    } catch (e) {
      setError(reason(e, 'We could not send another code. Try again.'))
    } finally {
      setBusy(false)
    }
  }, [busy, markSent, sent, signIn, signUp, wait])

  const verify = useCallback(async () => {
    if (!signIn || !signUp || !sent || busy) return false
    if (code.length !== 6) {
      setError('The code is six digits.')
      return false
    }

    setBusy(true)
    setError(undefined)
    try {
      let done =
        sent.kind === 'signIn'
          ? await signIn.attemptFirstFactor({ strategy: 'email_code', code })
          : await signUp.attemptEmailAddressVerification({ code })

      // An instance can demand more than an email and a code — the
      // production one requires a password. Nobody buying a pendant should
      // have to invent one they will never type again (sign-in is by code),
      // so a required password is met with a random one; anything else the
      // instance wants is named, so the failure is never a mystery.
      let finished = done
      if (
        sent.kind === 'signUp' &&
        finished.status === 'missing_requirements' &&
        signUp.missingFields.includes('password')
      ) {
        finished = await signUp.update({ password: randomPassword() })
      }
      if (finished.status !== 'complete' || !finished.createdSessionId) {
        const missing = sent.kind === 'signUp' ? signUp.missingFields.join(', ') : ''
        setError(
          missing
            ? `That code was right, but the account still needs: ${missing}.`
            : 'That code was right, but the account is not finished. Try another address.',
        )
        return false
      }
      done = finished

      // What everything waiting on this hook is waiting for: from here the
      // session is live and the API client has a bearer token to send.
      await clerk.setActive({ session: done.createdSessionId })
      return true
    } catch (e) {
      setError(reason(e, 'That code did not work. Check it and try again.'))
      return false
    } finally {
      setBusy(false)
    }
  }, [busy, clerk, code, sent, signIn, signUp])

  /** Back to the address, with the attempt it belonged to thrown away. */
  const restart = useCallback(() => {
    setSent(null)
    setCode('')
    setSentAt(0)
    setError(undefined)
  }, [])

  return {
    code,
    setCode,
    /** True once a code is out and the six-digit field should be showing. */
    onCode: sent !== null,
    busy,
    error,
    setError,
    /** Seconds left before another code may be asked for; 0 once it may. */
    wait,
    send,
    resend,
    verify,
    restart,
  }
}

/**
 * A password nobody will ever type. Thirty-two bytes of entropy, base64,
 * with a digit and a symbol so it clears any complexity rule an instance
 * might add later. Sign-in stays by email code.
 */
function randomPassword() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '') + '7!'
}
