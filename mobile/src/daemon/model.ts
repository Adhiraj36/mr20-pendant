/**
 * What the pairing screen says, decided away from React.
 *
 * Two clocks run this screen and both of them are the reason this file is
 * pure. A pairing code is worth typing for five minutes and the count has to
 * be right at the second; a machine is "online" only for as long as its last
 * heartbeat is recent, and the screen keeps that judgement alive while it
 * sits open rather than freezing whatever the list said when it loaded.
 *
 * The server answers `online` itself, and this agrees with it by using the
 * same rule — three missed beats — rather than trusting a boolean that was
 * true when the response was written and may not be a minute later.
 */
import type { Daemon, DaemonStatus } from '../api/daemons';

// The code's own display split lives in the kit next to `codeBoxes`, its
// mirror image, and is re-exported here so the screen has one import.
export { codeGroups } from '../design/kit/models';

/** The daemon is documented to beat every 30 seconds. */
export const HEARTBEAT_SECONDS = 30;

/**
 * Three missed beats before a machine is called offline. A laptop that is
 * merely busy compiling should not flicker on this screen.
 */
export const STALE_AFTER_SECONDS = 3 * HEARTBEAT_SECONDS;

/** How the screen talks about a machine. */
export type Presence =
  | 'online'
  /** Carrying out a task right now — its own word, and worth showing. */
  | 'busy'
  | 'offline'
  /** Paired, and has never once called home. */
  | 'never';

/** Only the fields presence is decided from, so a test needs no whole daemon. */
export interface Beat {
  status: DaemonStatus;
  lastHeartbeatAt?: string;
}

/** Seconds since the last heartbeat, or `undefined` if there has never been one. */
export function sinceBeat(d: Beat, now: Date): number | undefined {
  if (!d.lastHeartbeatAt) return undefined;
  const beat = Date.parse(d.lastHeartbeatAt);
  if (Number.isNaN(beat)) return undefined;
  return Math.max(0, Math.round((now.getTime() - beat) / 1000));
}

/**
 * Where a machine stands.
 *
 * A daemon that says "offline" is offline — that is a machine shutting down
 * politely and it should be believed. Everything else is the clock's answer,
 * because silence is the only thing an unplugged laptop can send.
 */
export function presence(d: Beat, now: Date): Presence {
  const since = sinceBeat(d, now);
  if (since === undefined) return 'never';
  if (d.status === 'offline') return 'offline';
  if (since > STALE_AFTER_SECONDS) return 'offline';
  return d.status === 'busy' ? 'busy' : 'online';
}

/** `4 MIN AGO` — coarse on purpose, because a second-by-second age is noise. */
export function ago(seconds: number): string {
  if (seconds < 60) return 'JUST NOW';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} H AGO`;
  return `${Math.floor(hours / 24)} D AGO`;
}

/** The right-hand value on a machine's row. */
export function presenceLabel(d: Beat, now: Date): string {
  const state = presence(d, now);
  if (state === 'online') return 'ONLINE';
  if (state === 'busy') return 'WORKING';
  if (state === 'never') return 'NEVER CONNECTED';
  const since = sinceBeat(d, now);
  return since === undefined ? 'OFFLINE' : ago(since);
}

/** The colour that value carries. Names a role; the kit maps it to a tone. */
export function presenceTone(state: Presence): 'settled' | 'stamp' | 'faint' {
  if (state === 'online') return 'settled';
  if (state === 'busy') return 'stamp';
  return 'faint';
}

// -- the pairing code ------------------------------------------------------

/** Seconds a code has left, floored at zero. */
export function codeSecondsLeft(expiresAt: string, now: Date): number {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

/** `4:32`, counting down. */
export function codeClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Whether the code on screen is still worth typing. */
export function codeLive(expiresAt: string, now: Date): boolean {
  return codeSecondsLeft(expiresAt, now) > 0;
}

// -- the settings row ------------------------------------------------------

/**
 * What the Settings row says on its right, without opening the screen.
 *
 * A count alone would be a worse answer than the state: two paired machines
 * that are both asleep is not "2 MACHINES", it is nothing working.
 */
export function daemonRowValue(daemons: Daemon[], now: Date): string {
  if (daemons.length === 0) return 'NONE PAIRED';
  const up = daemons.filter((d) => {
    const state = presence(d, now);
    return state === 'online' || state === 'busy';
  }).length;
  if (up > 0) return `${up} ONLINE`;
  return daemons.length === 1 ? 'ASLEEP' : `${daemons.length} ASLEEP`;
}

/**
 * Whether to offer pairing at all.
 *
 * Not a plan check — the price is the server's to enforce, and it answers 402
 * which the screen turns into the chooser. This is the two deployment flags:
 * the pairing surface, and whether the backend will mint a code for anybody.
 * With execution down, `POST /daemons/code` refuses every caller, so offering
 * the button would be offering a dead end.
 */
export function offersPairing(features: { daemon: boolean; execution: boolean }): boolean {
  return features.daemon && features.execution;
}

// -- the banner on Home ----------------------------------------------------

/** A banner, or the far more common nothing. */
export interface DaemonBanner {
  label: string;
  action: string;
}

/**
 * Whether Home should say anything about the laptop.
 *
 * Only ever when there is a reason: work that somebody approved and no
 * machine awake to take it. An account with nothing approved does not need
 * to be told its laptop is asleep — the laptop being asleep is the normal
 * state of a laptop, and a banner that is always there is furniture.
 */
export function daemonBanner(input: {
  enabled: boolean;
  /** False until the list has actually been read, so nothing is decided early. */
  loaded: boolean;
  daemons: Daemon[];
  /** How many tasks are approved and therefore waiting for a machine. */
  approved: number;
  now: Date;
  words: { none: string; pair: string; asleep: string; see: string };
}): DaemonBanner | undefined {
  if (!input.enabled || !input.loaded || input.approved <= 0) return undefined;
  if (input.daemons.length === 0) {
    return { label: input.words.none, action: input.words.pair };
  }
  const awake = input.daemons.some((d) => {
    const state = presence(d, input.now);
    return state === 'online' || state === 'busy';
  });
  return awake ? undefined : { label: input.words.asleep, action: input.words.see };
}
