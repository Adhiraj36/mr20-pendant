/**
 * Recording with the phone, when there is no pendant.
 *
 * The pendant is the product: it sits on a chest, hears the room, and keeps
 * going with the phone in a pocket. The phone can do none of that. It can,
 * however, record a conversation you are already in, and somebody whose plan
 * entitles them to capture should not be locked out of their own product
 * while the hardware is in transit.
 *
 * So this is a lesser thing offered honestly, not a substitute pretending to
 * be the real one. The copy says the phone must stay awake and the app in
 * front; this file is the decisions behind that, kept pure so they can be
 * tested without a microphone.
 */

/** Where a phone recording is in its life. */
export type CaptureState =
  | 'idle'
  /** Permission asked, hardware being readied. */
  | 'arming'
  | 'recording'
  /** Stopped, and on its way to the account: write, register, upload. */
  | 'saving'
  | 'done'
  | 'failed';

export interface Capture {
  state: CaptureState;
  /** Seconds of audio so far. */
  seconds: number;
  /** Why it failed, in the words a person is shown. */
  error?: string;
  /** The recording it became, once the account has it. */
  recordingId?: string;
}

export const IDLE: Capture = { state: 'idle', seconds: 0 };

/**
 * Below this a recording is a slip of the thumb, not a conversation.
 *
 * Uploading it would cost a pipeline run and print a conversation with one
 * word in it, so the tap that ends it throws it away instead — and says so,
 * rather than failing silently and looking broken.
 */
export const MIN_SECONDS = 3;

/**
 * The longest single phone recording.
 *
 * Not a technical limit: a phone held awake for an hour is a flat battery,
 * and a recording that long is better as several. The screen warns before it
 * stops on its own.
 */
export const MAX_SECONDS = 60 * 60;

/** When to warn that it will stop by itself. */
export const WARN_SECONDS = MAX_SECONDS - 5 * 60;

export function canStart(input: {
  entitled: boolean;
  pendantPaired: boolean;
  state: CaptureState;
}): boolean {
  // The pendant wins whenever it is present: two microphones recording one
  // conversation is two transcripts of it, and a bill for both.
  if (input.pendantPaired) return false;
  if (!input.entitled) return false;
  return input.state === 'idle' || input.state === 'done' || input.state === 'failed';
}

/**
 * Whether the plan lets this person record with the phone.
 *
 * Two conditions, deliberately separate: the deployment offers it at all,
 * and this account has bought something. A plan of `none` has not.
 */
export function entitledToPhoneCapture(input: {
  phoneCaptureEnabled: boolean;
  tier: string;
}): boolean {
  return input.phoneCaptureEnabled && input.tier !== 'none';
}

/** `04:12`, the way a recording counts. */
export function elapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes < 60) return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Whether the recording should stop itself now. */
export function shouldStop(seconds: number): boolean {
  return seconds >= MAX_SECONDS;
}

/** Whether to say it is about to. */
export function nearingLimit(seconds: number): boolean {
  return seconds >= WARN_SECONDS && seconds < MAX_SECONDS;
}

/** Too short to be worth keeping. */
export function tooShort(seconds: number): boolean {
  return seconds < MIN_SECONDS;
}

/**
 * The name a phone recording is filed under.
 *
 * The pipeline keys on a folder and a file the way the pendant reports them,
 * so the phone borrows that shape rather than being a special case all the
 * way down: `PHONE` is the folder, and the file is the moment it started.
 * The API's `deviceMac` is the phone's own installation id.
 */
export function captureName(startedAt: Date): { folder: string; file: string } {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const stamp =
    `${startedAt.getFullYear()}${p(startedAt.getMonth() + 1)}${p(startedAt.getDate())}`
    + `-${p(startedAt.getHours())}${p(startedAt.getMinutes())}${p(startedAt.getSeconds())}`;
  return { folder: 'PHONE', file: `${stamp}.m4a` };
}
