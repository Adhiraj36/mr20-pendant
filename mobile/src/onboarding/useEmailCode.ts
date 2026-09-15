/**
 * Sign in with an email and a code, and nothing else.
 *
 * A port of the website's `web/src/lib/useEmailCode.ts` onto
 * `@clerk/clerk-expo`, deliberately kept line-for-line comparable so the two
 * cannot drift: same sign-in-then-sign-up fallback, same resend countdown,
 * same random password for an instance that insists on one.
 *
 * There is no sign-up here, and no sign-in either, as far as the person
 * typing is concerned: one address goes in, six digits come back. Whether
 * that address already had an account is Clerk's problem, answered by trying
 * the sign-in and falling through to a sign-up when it says the identifier
 * is unknown.
 *
 * The one substantive difference from the web is where the entropy comes
 * from: React Native has no `crypto.getRandomValues`, so the throwaway
 * password is `expo-crypto`'s. It is thirty-two bytes either way — a
 * password nobody will ever type still has to be a password nobody can
 * guess, because it is a second way into the account.
 */
import { useCallback, useEffect, useState } from 'react';
import { useClerk, useSignIn, useSignUp, isClerkAPIResponseError } from '@clerk/clerk-expo';
import * as Crypto from 'expo-crypto';

/** Long enough that a slow inbox is not a dead end, short enough to not feel stuck. */
const RESEND_AFTER = 30;

/** Deliberately loose. The address that counts is the one a code arrives at. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Which of Clerk's two objects is holding the code we just asked it to send.
 *
 * A sign-in and a sign-up are separate attempts with separate verify calls,
 * and whichever one sent the code is the one that has to finish. The
 * `emailAddressId` is what Clerk wants handed back to send the same code
 * again, so it is kept here rather than looked up a second time.
 */
type Sent = { kind: 'signIn'; emailAddressId: string } | { kind: 'signUp' };

/**
 * Clerk's way of saying it already knows this address.
 *
 * The one answer enumeration protection does **not** hide, because it is
 * given to somebody who has just proved they can reach the address — so it
 * is the signal the combined flow can actually be built on. `form_param_...`
 * variants are included because Clerk has reported the same fact under both
 * codes depending on which endpoint refused it.
 */
function identifierExists(error: unknown) {
  return (
    isClerkAPIResponseError(error) &&
    error.errors.some((e) =>
      e.code === 'form_identifier_exists'
      || e.code === 'form_identifier_exists__email_address'
      || e.code === 'identifier_already_signed_in')
  );
}

/**
 * The instance refusing to make accounts at all — sign-ups closed, a waitlist,
 * a bot check this client cannot answer.
 *
 * None of these are about the address that was typed, so none of them may
 * stop somebody who **already has an account** from signing in. They fall
 * through to the sign-in exactly as "that address is taken" does. Everything
 * else — an address the instance will not accept, a malformed one — is about
 * the address and is shown, because Clerk's own wording for those is better
 * than anything this file could write.
 */
function signUpsClosed(error: unknown) {
  return (
    isClerkAPIResponseError(error) &&
    error.errors.some((e) =>
      e.code === 'not_allowed_access'
      || e.code === 'sign_up_mode_restricted'
      || e.code === 'sign_up_mode_restricted_waitlist'
      || e.code.startsWith('captcha_'))
  );
}

/** Clerk's own wording wherever it has any; ours where it does not. */
function reason(error: unknown, fallback: string) {
  if (!isClerkAPIResponseError(error)) return fallback;
  const first = error.errors[0];
  return first?.longMessage || first?.message || fallback;
}

export interface EmailCode {
  code: string;
  setCode: (next: string) => void;
  /** True once a code is out and the six-digit field should be showing. */
  onCode: boolean;
  busy: boolean;
  error?: string;
  setError: (next: string | undefined) => void;
  /** Seconds left before another code may be asked for; 0 once it may. */
  wait: number;
  /** The address the code went to, for the line under the heading. */
  address?: string;
  /**
   * Sends one, and hands back what O2 needs to pick the attempt up — or
   * `null` when nothing was sent, with `error` already set. Returned rather
   * than read off state afterwards: the caller navigates on the next line,
   * before React has re-rendered anything.
   */
  send: (address: string) => Promise<EmailCodeResume | null>;
  resend: () => Promise<void>;
  verify: () => Promise<boolean>;
  restart: () => void;
}

/**
 * Where an attempt already in flight is picked up again.
 *
 * The address is asked for on A1 and the six digits are typed on O2, which
 * are two routes — so the little that is local to the hook (which of Clerk's
 * two objects sent the code, and the id it wants back for a resend) travels
 * between them as route params. Clerk's own `SignIn`/`SignUp` resources are
 * singletons on the client and are still open, so nothing else has to.
 */
export interface EmailCodeResume {
  kind: 'signIn' | 'signUp';
  emailAddressId?: string;
  address?: string;
}

export function useEmailCode(resume?: EmailCodeResume): EmailCode {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const clerk = useClerk();

  const [code, setCode] = useState('');
  const [sent, setSent] = useState<Sent | null>(() => {
    if (!resume) return null;
    if (resume.kind === 'signIn') {
      return resume.emailAddressId
        ? { kind: 'signIn', emailAddressId: resume.emailAddressId }
        : null;
    }
    return { kind: 'signUp' as const };
  });
  const [address, setAddress] = useState<string | undefined>(resume?.address);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sentAt, setSentAt] = useState(() => (resume ? Date.now() : 0));
  const [now, setNow] = useState(() => Date.now());

  // A countdown that stops counting. The tick reschedules itself off `now`,
  // so the wait costs one timer while it is running and none once it is up.
  const wait = sentAt ? Math.max(0, RESEND_AFTER - Math.floor((now - sentAt) / 1000)) : 0;
  useEffect(() => {
    if (wait === 0) return;
    const id = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(id);
  }, [wait, now]);

  const markSent = useCallback((next: Sent) => {
    setSent(next);
    setCode('');
    setSentAt(Date.now());
    setNow(Date.now());
  }, []);

  const send = useCallback(
    async (input: string) => {
      // The address is judged before Clerk is consulted, so a typo is still
      // answered in the half-second before Clerk has finished loading rather
      // than the button appearing to do nothing at all.
      const identifier = input.trim();
      if (!EMAIL.test(identifier)) {
        setError('That does not look like an email address.');
        return null;
      }
      if (!signIn || !signUp || busy) return null;

      setBusy(true);
      setError(undefined);
      try {
        // An account Clerk already knows signs in; one it does not is created
        // on the spot. Both paths end at the same six digits.
        //
        // **The sign-up is tried first, and that ordering is the whole point**
        // (round eight). The live instance has Clerk's *enumeration
        // protection* switched on, which means `signIn.create` with an address
        // Clerk has never seen does **not** fail with
        // `form_identifier_not_found` — it succeeds, hands back a phantom
        // `email_code` factor, and emails the person "there's no account
        // associated with this email address". So the old order sent every new
        // customer to six empty boxes waiting for a code that was never sent,
        // with nothing on the client able to tell the difference. Verified
        // against production: the address below got that exact email.
        //
        // Creating first inverts the ambiguity onto the answer Clerk *does*
        // give honestly — `form_identifier_exists` — which is what sends an
        // existing account down the sign-in path.
        const created = await signUp.create({ emailAddress: identifier })
          .then(() => true)
          .catch((e: unknown) => {
            // "Taken" is the answer that means sign in. So is "we are not
            // making accounts right now": whatever the instance's policy is,
            // it cannot be allowed to lock out an account that already exists.
            if (identifierExists(e) || signUpsClosed(e)) return false;
            throw e;
          });

        if (!created) {
          const attempt = await signIn.create({ identifier });
          const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === 'email_code');
          // The second look at `strategy` is for the type checker — `find`
          // cannot narrow the union it just searched — and it doubles as the
          // guard for an account that signs in some other way entirely.
          if (factor?.strategy !== 'email_code') {
            setError('This account does not sign in with an emailed code.');
            return null;
          }
          await signIn.prepareFirstFactor({
            strategy: 'email_code',
            emailAddressId: factor.emailAddressId,
          });
          setAddress(identifier);
          markSent({ kind: 'signIn', emailAddressId: factor.emailAddressId });
          return {
            kind: 'signIn' as const,
            emailAddressId: factor.emailAddressId,
            address: identifier,
          };
        }
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setAddress(identifier);
        markSent({ kind: 'signUp' });
        return { kind: 'signUp' as const, address: identifier };
      } catch (e) {
        setError(reason(e, 'We could not send a code just now. Try again.'));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [busy, markSent, signIn, signUp],
  );

  const resend = useCallback(async () => {
    if (!signIn || !signUp || !sent || busy || wait > 0) return;

    setBusy(true);
    setError(undefined);
    try {
      // Prepared again on the attempt that is already open, rather than
      // started from scratch — a resend should not lose the attempt the
      // first code belongs to.
      if (sent.kind === 'signIn') {
        await signIn.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: sent.emailAddressId,
        });
      } else {
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      }
      markSent(sent);
    } catch (e) {
      setError(reason(e, 'We could not send another code. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [busy, markSent, sent, signIn, signUp, wait]);

  const verify = useCallback(async () => {
    if (!signIn || !signUp || !sent || busy) return false;
    if (code.length !== 6) {
      setError('The code is six digits.');
      return false;
    }

    setBusy(true);
    setError(undefined);
    try {
      const done =
        sent.kind === 'signIn'
          ? await signIn.attemptFirstFactor({ strategy: 'email_code', code })
          : await signUp.attemptEmailAddressVerification({ code });

      // An instance can demand more than an email and a code — the
      // production one requires a password. Nobody buying a pendant should
      // have to invent one they will never type again (sign-in is by code),
      // so a required password is met with a random one; anything else the
      // instance wants is named, so the failure is never a mystery.
      let finished = done;
      if (
        sent.kind === 'signUp' &&
        finished.status === 'missing_requirements' &&
        signUp.missingFields.includes('password')
      ) {
        finished = await signUp.update({ password: randomPassword() });
      }
      if (finished.status !== 'complete' || !finished.createdSessionId) {
        const missing = sent.kind === 'signUp' ? signUp.missingFields.join(', ') : '';
        setError(
          missing
            ? `That code was right, but the account still needs: ${missing}.`
            : 'That code was right, but the account is not finished. Try another address.',
        );
        return false;
      }

      // What everything waiting on this hook is waiting for: from here the
      // session is live and the API client has a bearer token to send.
      await clerk.setActive({ session: finished.createdSessionId });
      return true;
    } catch (e) {
      setError(reason(e, 'That code did not work. Check it and try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, clerk, code, sent, signIn, signUp]);

  /** Back to the address, with the attempt it belonged to thrown away. */
  const restart = useCallback(() => {
    setSent(null);
    setCode('');
    setSentAt(0);
    setError(undefined);
  }, []);

  return {
    code,
    setCode,
    onCode: sent !== null,
    busy,
    error,
    setError,
    wait,
    address,
    send,
    resend,
    verify,
    restart,
  };
}

/**
 * A password nobody will ever type. Thirty-two bytes of real entropy from
 * the platform's own CSPRNG, base64, with a digit and a symbol so it clears
 * any complexity rule an instance might add later. Sign-in stays by email
 * code; this exists only because an instance may refuse to finish a sign-up
 * without one.
 */
function randomPassword(): string {
  const bytes = Crypto.getRandomBytes(32);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // `btoa` is polyfilled by @clerk/clerk-expo on Hermes.
  return btoa(binary).replace(/=+$/, '') + '7!';
}
