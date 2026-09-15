/**
 * The one rule about a mobile number, kept somewhere a test can reach it.
 *
 * Nothing in this file imports React Native, Expo or the API client, for the
 * same reason `checkout.ts` does not: the interesting behaviour of a form is
 * exactly the part you want to assert about without a simulator.
 *
 * The rule is the backend's own (`orders.go`): ten digits starting 6–9, once
 * a country code or a trunk zero has been taken off. The chooser's field, the
 * line underneath it and whether RESERVE is pressable at all are three
 * readings of that one answer — `mobileState` — so they cannot disagree about
 * whether a number is good.
 */

/** Ten digits, however they were typed. `+91 98490 44417` → `9849044417`. */
export function mobileDigits(input: string): string {
  const digits = input.replace(/\D/g, '');
  // A number pasted with its country code is still the same number.
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** The backend's own rule: ten digits, starting 6–9. */
export function isMobile(input: string): boolean {
  return /^[6-9]\d{9}$/.test(mobileDigits(input));
}

/**
 * What has been typed so far, as the screen has to treat it.
 *
 * `partial` is the state that keeps a half-typed number from being called
 * wrong while it is still being typed: red belongs under a number that
 * cannot become right, not under one that is four digits in. `empty` is not
 * an error either — an untouched box has done nothing wrong; it is simply
 * not something RESERVE can be pressed on top of.
 */
export type MobileState = 'empty' | 'partial' | 'invalid' | 'ok';

export function mobileState(input: string): MobileState {
  const digits = mobileDigits(input);
  if (digits.length === 0) return 'empty';
  if (isMobile(input)) return 'ok';
  // Ten digits is the whole length, so anything shorter could still become a
  // number. Anything at or past it — a bad first digit, an eleventh digit —
  // already is not one.
  return digits.length < 10 ? 'partial' : 'invalid';
}

/** Nothing may be sent, and nothing may be paid for, until this is true. */
export function canReserve(input: string): boolean {
  return mobileState(input) === 'ok';
}

/**
 * What a phone number is allowed to be made of, applied as it is typed.
 *
 * `phone-pad` already withholds the letters on iOS, but an Android keyboard,
 * a hardware one and a paste do not — and a box that quietly accepts
 * `call me: 98490 44417` and then calls it invalid is a worse field than one
 * that never took the words in the first place. Spaces, `+`, dashes and
 * brackets survive, because they are how people write their own number.
 */
export function cleanMobile(input: string): string {
  return input.replace(/[^\d+()\s-]/g, '');
}
