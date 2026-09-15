/**
 * Words the app shares between screens — app spec §7.
 *
 * The sync language in particular is written once here because three surfaces
 * say it: the Library's link panel (§2.6), the Pendant tab's status block
 * (§2.13) and the toasts. Anything only one screen says stays in that screen.
 *
 * Numbers and strings only — no React, no react-native — so the phase machine
 * below can be tested directly.
 */
import { formatBytes } from './tokens';

/**
 * The sync engine's phases, restated.
 *
 * `SyncProgress` lives in `src/sync/engine.ts`, which reaches the filesystem,
 * the BLE client and the API on the way in. Restating the eight names keeps
 * this module importable by the test runner; the screen passes the engine's
 * own value straight in, so a phase added there and not here stops compiling.
 */
export type SyncPhase =
  | 'listing' | 'pausing' | 'wifi' | 'pulling' | 'uploading' | 'resuming' | 'idle' | 'done';

/** What the engine reports, narrowed to the fields the copy uses. */
export interface SyncProgressLike {
  phase: SyncPhase;
  index?: number;
  total?: number;
  received?: number;
  expected?: number;
}

/** Spec §7, verbatim. Mono labels, so uppercase. */
export const SYNC_PHASE: Record<SyncPhase, string> = {
  listing: 'READING THE PENDANT',
  pausing: 'PAUSING RECORDING',
  wifi: 'SWITCHING TO PENDANT WIFI',
  pulling: 'PULLING',
  uploading: 'UPLOADING',
  resuming: 'RESUMING RECORDING',
  idle: '',
  done: 'UP TO DATE',
};

/** One phase that has happened, and whatever detail it last carried. */
export interface SyncStep {
  phase: SyncPhase;
  value?: string;
}

/** Structurally the `StatusRow` of `design/stage/StatusBlock`. */
export interface SyncRow {
  label: string;
  value?: string;
  ok?: boolean;
  live?: boolean;
}

/** `2 / 5 · 1.1 MB OF 2.5 MB` — only pulling has anything to count. */
function phaseValue(progress: SyncProgressLike): string | undefined {
  if (progress.phase !== 'pulling') return undefined;
  const parts: string[] = [];
  if (progress.index && progress.total) parts.push(`${progress.index} / ${progress.total}`);
  if (progress.received !== undefined && progress.expected) {
    parts.push(`${formatBytes(progress.received)} OF ${formatBytes(progress.expected)}`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Fold one progress report into the list of phases already seen.
 *
 * Rows arrive as phases complete and never leave, so a pass reads as a record
 * of what happened rather than a label that keeps changing. A phase that comes
 * round again — the engine switches to the pendant's WiFi once per file —
 * updates the row it already has rather than adding a second one.
 *
 * Returns the same array when nothing changed, so the screen re-renders only
 * when there is something new to read.
 */
export function advanceSync(steps: SyncStep[], progress?: SyncProgressLike): SyncStep[] {
  if (!progress) return steps;
  const { phase } = progress;
  // `done` is not a step: it is the closing `ok` row, and `idle` says nothing.
  if (phase === 'idle' || phase === 'done') return steps;

  const value = phaseValue(progress);
  const at = steps.findIndex((step) => step.phase === phase);
  if (at === -1) return [...steps, { phase, value }];
  if (steps[at].value === value) return steps;

  const next = steps.slice();
  next[at] = { phase, value };
  return next;
}

/**
 * The status block's rows (§2.13 step 4). `current` is the phase updating in
 * place; `doneAt` closes the pass with `UP TO DATE · 21:14` in gold.
 */
export function syncRows(steps: SyncStep[], current?: SyncPhase, doneAt?: string): SyncRow[] {
  const rows: SyncRow[] = steps.map((step) => ({
    label: SYNC_PHASE[step.phase],
    value: step.value,
    live: !doneAt && step.phase === current,
  }));
  if (doneAt) rows.push({ label: SYNC_PHASE.done, value: clockHM(doneAt), ok: true });
  return rows;
}

/** `21:14`, in the phone's own time. Never a locale's 12-hour form: this is a log. */
export function clockHM(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** The link chip's four readings (§2.13 step 1). */
export const LINK_LABEL = {
  linked: 'LINKED',
  linking: 'LINKING…',
  away: 'NOT IN RANGE',
  off: 'BLUETOOTH OFF',
} as const;

export type LinkReading = keyof typeof LINK_LABEL;

/**
 * Which of the four the pendant is in. The radio being off outranks
 * everything: it explains the other three, and offering "not in range" when
 * nothing can be in range is the app blaming the pendant for the phone.
 */
export function linkReading(
  { connected, connecting, btOn }: { connected: boolean; connecting: boolean; btOn: boolean },
): LinkReading {
  if (!btOn) return 'off';
  if (connected) return 'linked';
  if (connecting) return 'linking';
  return 'away';
}


// ===== T6 · the way in ======================================================
// Onboarding, the plan chooser, the pendant tab and settings. Round seven,
// plan §5. Everything a T6 screen says that is not a number off a device and
// not a string out of remote configuration lives here — the canvas' own
// words, typed once. Mono labels are already uppercase; sentences are not.

/** O1 — one claim, no carousel. */
export const WELCOME = {
  mark: 'LYZN',
  claim: "lyzn hears what you said you'd do, and then does it.",
  line:
    'Wear the pendant. It listens to your day, writes down what you promised, '
    + 'and keeps the proof.',
  primary: 'SET UP MY PENDANT',
  secondary: 'I ALREADY HAVE AN ACCOUNT',
} as const;

/** A1 — where "I already have an account" goes. */
export const SIGN_IN = {
  title: 'Welcome back.',
  line:
    'Sign in and your conversations, commitments and receipts are on this phone '
    + 'again. They were never anywhere you have to fetch them from.',
  apple: 'Continue with Apple',
  google: 'Continue with Google',
  or: 'OR WITH AN EMAILED CODE',
  emailPlaceholder: 'you@example.com',
  send: 'SEND ME A CODE',
  help: 'HELP',
  newHere: "I'M NEW HERE · SET UP A PENDANT",
  badEmail: 'That does not look like an email address.',
  failed: 'That did not work. Try again.',
  noteEyebrow: 'WHAT SIGNING IN DOES NOT DO',
  note: "It doesn't pull your recordings down from us. They are already yours.",
} as const;

/**
 * O2 — the code. The canvas says WhatsApp; the channel does not exist, so
 * the copy says email (`[WHATSAPP]`, plan §0).
 */
export const CODE = {
  title: 'Enter the code we sent you',
  /** `sentTo('nikhil@ghmev.in')`. */
  sentTo: (address: string) => `Sent to ${address}. That address is your account.`,
  verify: 'VERIFY',
  wrongEmail: 'WRONG EMAIL?',
  /** `resendIn(24)` → `RESEND IN 0:24`; zero seconds is the live link. */
  resendIn: (seconds: number) =>
    seconds > 0 ? `RESEND IN 0:${String(seconds).padStart(2, '0')}` : 'RESEND THE CODE',
  short: 'The code is six digits.',
  wrong: 'That code did not work. Check it and try again.',
} as const;

/** U1 / U2 — the chooser and the proof it prints. */
export const PLAN_COPY = {
  close: 'CLOSE ✕',
  /** The mono line over the price on a tier card. */
  today: 'DUE TODAY',
  full: 'FULL PRICE',
  /** `monthlyNote('₹499')` — Act Pro's disclosure, never charged in-app. */
  monthlyNote: (amount: string) =>
    `${amount} a month from activation, started on lyzn.ai — not here.`,
  reserve: 'RESERVE',
  phoneLabel: 'MOBILE NUMBER',
  phonePlaceholder: '10-digit mobile',
  badPhone: 'That needs to be a ten-digit Indian mobile number.',
  /** Faint, under an empty or half-typed box: why RESERVE is not pressable. */
  phoneNeeded: 'The order is confirmed on this number. RESERVE turns on once it is ten digits.',
  paying: 'OPENING CHECKOUT…',
  cancelled: 'Payment cancelled. Nothing was charged.',
  failed: 'That payment did not go through. Nothing was charged.',
  paidTitle: 'That is yours now.',
  /** `paidAt('09:41:58')`. */
  paidAt: (clock: string) => `PAID ${clock} ✓`,
  receiptLine:
    'Every finished job prints one of these. If there is no receipt, it did not happen.',
  continue: 'CONTINUE',
} as const;

/* ── Payment, taken in a browser ───────────────────────────────────────
   The sheet is Razorpay's own Checkout on lyzn.ai/pay, opened in an
   authentication session, because the native module cannot be linked into
   an iOS build (src/plan/razorpay.ts). The app therefore never sees a
   signature and never decides that a payment happened — it watches the
   order row the webhook writes. These are the lines for the endings that
   are not "paid": each one says what was charged, because that is the only
   question a person actually has at that moment.
   ──────────────────────────────────────────────────────────────────── */
export const PAY_COPY = {
  /** The window closed, the row has not changed, and it still might. */
  pending:
    'That may still be going through. If it lands you will get an email with '
    + 'the receipt, and your plan will be here waiting.',
  /** Razorpay told the backend the payment did not succeed. */
  failed: 'That payment did not go through. Nothing was charged.',
  /** No browser the OS would open, or one already in front of this one. */
  unavailable: 'The payment page would not open. Nothing was charged.',
  /** The created order came back without a reference — a backend fault. */
  noReference: 'That order could not be opened for payment. Nothing was charged.',
} as const;

/** O3 / O3b — the scan and the pendant that answered it. */
export const PAIR = {
  title: 'Hold the side key until the light blinks',
  /** `scanning(6)` → `SCANNING · 6S`. */
  scanning: (seconds: number) => `SCANNING · ${seconds}S`,
  pairAction: 'PAIR',
  notNow: "I DON'T HAVE IT WITH ME",
  photo: ['PHOTO · PENDANT', 'SIDE KEY AND LED'],
  photoNote: 'PLACEHOLDER · NEEDS REAL PRODUCT SHOT',
  weak: 'WEAK',
  unknown: 'Unknown device',
  pendantName: 'lyzn pendant',
  nothingFound: 'Nothing yet. Switch the pendant on and hold it within arm’s reach.',
  paired: 'PAIRED ✓',
  pairedTitle: 'Your pendant is on this account',
  pairedLine:
    "It isn't listening yet. Nothing gets captured until you turn it on, and "
    + "you'll always see it here when it is.",
  next: 'NEXT · THE LIGHT',
} as const;

/** O6 — three LED states, no legalese. */
export const LIGHT = {
  title: "When the light is on, it's listening",
  photo: ['PHOTO · PENDANT WORN', 'LED BESIDE USB-C, LIT'],
  photoNote: 'PLACEHOLDER · NEEDS REAL PRODUCT SHOT',
  states: [
    {
      dot: 'danger' as const,
      title: 'Light on — recording',
      line: "Anyone in the room can see it. That's on purpose.",
    },
    {
      dot: 'ring' as const,
      title: 'Light out — nothing is heard',
      line: 'Hold the side key for two seconds. No audio, no transcript, nothing queued.',
    },
    {
      dot: 'stamp' as const,
      title: 'Blinking — handing over to your phone',
      line: 'Only ever to a phone signed in as you, over Bluetooth.',
    },
  ],
  understood: 'I UNDERSTAND THE LIGHT',
} as const;

/** O7 — the first receipt prints as the welcome. */
export const READY = {
  title: "Set up. Here's your first receipt.",
  slipQuote: 'Account set up.',
  line: 'Every finished job prints one of these. If there is no receipt, it did not happen.',
  start: 'START LISTENING',
  /** Asked here, not at launch: the first thing worth being told about exists now. */
  notifyTitle: 'Tell me when a conversation is ready',
  notifyLine:
    'One notification when a conversation has been written up, and one when you '
    + 'have said you would do something. Nothing else.',
} as const;

/** P1 / P2 / P3 — the pendant tab. */
export const PENDANT = {
  screenTitle: 'Pendant',
  battery: 'BATTERY',
  storage: 'ON-DEVICE STORAGE',
  firmware: (version: string) => `Firmware ${version}`,
  upToDate: 'UP TO DATE ✓',
  check: 'CHECK',
  pause: 'PAUSE LISTENING',
  resume: 'START LISTENING',
  unpair: 'UNPAIR THIS PENDANT',
  syncNow: 'SYNC NOW',
  syncing: 'SYNCING…',
  stop: 'STOP',
  settings: 'SETTINGS',
  none: 'No pendant paired.',
  noneLine: 'Pair yours and it starts pulling conversations off it by itself.',
  pairAction: 'PAIR A PENDANT',
  /** P2 — out of range. */
  awayBanner: 'PENDANT OUT OF RANGE · STILL RECORDING',
  awayTitle: 'It’s still recording. It just can’t reach your phone.',
  awayLine:
    'Everything goes to the pendant’s own storage and syncs the moment you’re back '
    + 'in Bluetooth range. Nothing is lost.',
  awayEyebrow: 'WAITING ON THE PENDANT',
  unsynced: 'UNSYNCED AUDIO',
  roomLeft: 'ROOM LEFT',
  awayFooter: ['BRING YOUR PHONE WITHIN ABOUT 10 M', 'SYNC STARTS BY ITSELF'],
  /** P3 — out of room. */
  fullBanner: 'PENDANT STORAGE FULL · RECORDING STOPPED',
  fullTitle: 'The pendant is out of room, so it has stopped recording.',
  fullLine: 'Nothing has been deleted — it stopped instead of overwriting.',
  fullHow: 'TO GET IT RECORDING AGAIN',
  fullSyncTitle: 'Sync it now',
  fullSyncLine: 'Keep the pendant near this phone. Space frees as it goes.',
  fullFooter: ['SET AUTO-SYNC ON IN SETTINGS', 'AND THIS WON’T HAPPEN AGAIN'],
  freeNone: '0 MB FREE',
  /** Round seven additions: the states the canvas draws but T6 had not reached. */
  noneMeta: 'NOTHING PAIRED',
  noneEyebrow: 'PENDANT · NONE',
  recordingDetail: (name?: string) => (name ? `${name} · listening` : 'Listening'),
  nothingWaiting: 'NOTHING WAITING',
  reconnect: 'TRY THE LINK AGAIN',
  firmwareUnknown: 'Firmware — not read yet',
  /** `SYNC NOW · 11 H` when the wait is known, plain when it is not. */
  syncNowFor: (waiting?: string) => (waiting ? `SYNC NOW · ${waiting}` : 'SYNC NOW'),
  listeningToast: 'Listening.',
  pausedToast: 'Paused. Nothing is being heard.',
  pauseFailed: 'The pendant did not answer.',
  syncedToast: (pulled: number) =>
    pulled === 0 ? 'Nothing new to pull.' : `Pulled ${pulled} recording${pulled === 1 ? '' : 's'}.`,
  syncFailed: 'The sync stopped early.',
  /**
   * Round eight: letting go of the link on purpose.
   *
   * The store has always had `disconnect()` — it is what suppresses the
   * auto-reconnect so walking away is a decision rather than a fault — and
   * no screen offered it, so the only way to drop a link was to unpair.
   */
  disconnect: 'DISCONNECT',
  disconnected: 'Disconnected. It keeps recording to its own storage.',
  syncNowShort: 'SYNC NOW',
} as const;

/** SET — the settings screen. */
export const SETTINGS = {
  screenTitle: 'Settings',
  back: 'HOME',
  you: 'YOU',
  permissions: 'WHAT LYZN MAY DO',
  devices: 'DEVICES',
  record: 'YOUR RECORD',
  appearance: 'APPEARANCE',
  account: 'Account',
  name: 'Your name',
  ink: 'Ink',
  gates: 'Approval gates',
  pendant: 'Pendant',
  daemon: 'Laptop daemon',
  autoSync: 'Sync by itself',
  autoSyncOn: 'ON ITS OWN',
  autoSyncOff: 'UNTIL YOU PRESS SYNC',
  transcripts: 'Keep transcripts',
  audio: 'Keep audio',
  categories: 'Categories',
  exportAll: 'Export everything',
  exportValue: 'TRANSCRIPTS · RECEIPTS',
  freeSpace: 'Free up pendant space',
  erase: 'Erase the pendant',
  signOut: 'Sign out',
  deleteAll: 'Delete everything',
  deleteValue: 'CAN’T BE UNDONE',
  deleteConfirmTitle: 'Delete everything?',
  deleteConfirmLine:
    'Every recording, transcript, commitment and receipt on this account is '
    + 'destroyed, and the audio cached on this phone with it. This cannot be undone.',
  deleteFinalTitle: 'Last chance',
  deleteFinalLine:
    'This is the button that does it. You will be signed out when it finishes.',
  deleteFinal: 'DELETE EVERYTHING',
  keep: 'KEEP MY RECORD',
  /* Round seven: the rows and the confirmations as the screen actually asks them. */
  done: 'DONE',
  cancel: 'Cancel',
  namePlaceholder: 'What people call you',
  nameSaved: 'Saved.',
  nameFailed: 'That did not save.',
  accountUnknown: 'SIGNED IN',
  planNone: 'CHOOSE ONE',
  planRow: 'Plan',
  gatesValue: '3 ASK FIRST',
  whatsapp: 'WhatsApp number',
  whatsappValue: 'NOT SET UP',
  pendantNone: 'NONE PAIRED',
  cache: 'Clear audio kept on this phone',
  cacheTitle: 'Clear the audio on this phone?',
  cacheLine:
    'The recordings themselves stay on your account. This only frees the copies '
    + 'this phone is holding, and they are fetched again when you play one.',
  cacheConfirm: 'CLEAR IT',
  cacheCleared: 'Cleared.',
  cacheFailed: 'Could not clear it.',
  danger: 'CANNOT BE TAKEN BACK',
  unpairRow: 'Unpair this pendant',
  unpairTitle: 'Unpair this pendant?',
  unpairLine:
    'Everything already pulled off it stays on your account. The pendant keeps '
    + 'recording to its own storage until you pair it with something.',
  unpairConfirm: 'UNPAIR',
  unpaired: 'Unpaired.',
  unpairFailed: 'Could not unpair it.',
  eraseTitle: 'Erase the pendant?',
  eraseLine:
    'Every file still on the device is destroyed, including anything this phone '
    + 'has not pulled yet.',
  eraseNext: 'CONTINUE',
  eraseFinalTitle: 'Last chance',
  eraseFinalLine: 'This is the button that wipes it. Nothing on the device survives.',
  eraseConfirm: 'ERASE IT',
  keepIt: 'KEEP IT',
  erased: 'Erased.',
  eraseFailed: 'The pendant refused.',
  freed: (count: number) =>
    count === 0 ? 'Nothing to free.' : `Freed ${count} file${count === 1 ? '' : 's'}.`,
  freeFailed: 'Could not free space.',
  signOutTitle: 'Sign out?',
  signOutLine: 'Your recordings stay on your account. Signing back in re-links them.',
  /**
   * Round eight — `DELETE EVERYTHING`, and what it can honestly promise.
   *
   * There is no account-deletion endpoint on the backend (audited: the API
   * has `DELETE /recordings/:id` and `DELETE /chats/:id` and nothing that
   * closes an account), so the row deletes the record and says so. It does
   * **not** claim to delete the account, and it does not sign you out —
   * promising either would be promising a call that does not exist.
   */
  deleteAllValue: 'EVERY CONVERSATION',
  deleteAllTitle: 'Delete every conversation?',
  /**
   * What it deletes, and — just as important — what it does not.
   *
   * Verified against the live API rather than assumed: `DELETE
   * /recordings/:id` takes the recording, its audio and its transcript, and
   * does not cascade to the tasks it produced; there is no way to delete a
   * task at all, only to dismiss one, and a receipt is deliberately
   * undeletable. So the sentence names the three and stops.
   */
  deleteAllLine:
    'Every recording, its audio and its transcript go, and every Ask lyzn '
    + 'thread, and the audio cached on this phone. What they left behind stays: '
    + 'the commitments in TASKS, and the receipts — a receipt is the record '
    + 'that something happened. Your account itself stays; email support to '
    + 'close it.',
  deleteAllNext: 'CONTINUE',
  deleteAllFinalTitle: 'Last chance',
  deleteAllFinalLine: 'This is the button that does it. It cannot be undone.',
  deleteAllConfirm: 'DELETE IT ALL',
  deleteAllProgress: (done: number, total: number) => `Deleting ${done} of ${total}…`,
  deleteAllDone: (deleted: number, failed: number) => (failed
    ? `Deleted ${deleted}. ${failed} would not delete.`
    : deleted === 0
      ? 'There was nothing to delete.'
      : `Deleted ${deleted}. Nothing is left.`),
  deleteAllFailed: 'That did not finish.',
} as const;


/* >>> T7 — home, conversations, ask lyzn (round seven) ---------------------
 *
 * Every word these four screens say that is not data. Written here because
 * the canvas is the specification for it, and a sentence that lives inside
 * JSX is a sentence nobody reviews.
 */

/** Home — canvas H1, S3. */
export const HOME = {
  title: 'Today',
  segments: { conversations: 'CONVERSATIONS', tasks: 'TASKS', receipts: 'RECEIPTS' },
  review: 'REVIEW',
  /** The banners, which are states rather than screens (canvas S1, P2, P3). */
  outOfRange: 'PENDANT OUT OF RANGE · STILL RECORDING',
  storageFull: 'PENDANT STORAGE FULL · RECORDING STOPPED',
  storageLow: 'PENDANT STORAGE NEARLY FULL',
  connect: 'CONNECT',
  sync: 'SYNC',
  /**
   * The laptop, and only when it matters. A banner that says a laptop is
   * asleep while nothing is waiting for it is furniture; these appear when
   * work has been approved and no machine is awake to take it.
   */
  daemonAsleep: 'WORK IS APPROVED AND THE LAPTOP IS ASLEEP',
  daemonFix: 'SEE',
  daemonNone: 'NOTHING IS PAIRED TO DO THE WORK YOU APPROVED',
  daemonPair: 'PAIR A LAPTOP',
  recording: 'RECORDING',
  select: 'SELECT',
  selectDone: 'DONE',
  all: 'ALL',
  archive: 'ARCHIVE',
  empty: {
    conversations: {
      eyebrow: 'CONVERSATIONS · EMPTY',
      statement: 'Put the pendant on and talk to somebody.',
      line: 'Your first conversation shows up here about a minute after it ends.',
    },
    unpaired: {
      eyebrow: 'NO PENDANT PAIRED',
      statement: 'Nothing is listening yet.',
      line: 'Pair yours and it starts pulling conversations off it by itself.',
      action: 'PAIR A PENDANT',
    },
    filtered: {
      eyebrow: 'NOTHING IN THIS FILTER',
      statement: 'Nothing here in this one yet.',
      line: 'Move a conversation into it and it shows up.',
    },
    archive: {
      eyebrow: 'ARCHIVE · EMPTY',
      statement: 'Nothing has been archived.',
      line: 'A recording with no speech in it lands here for thirty days.',
    },
  },
  /**
   * Round eight: what a screen says when the account could not be reached.
   *
   * The rule is that the list is still on screen — whatever was last loaded
   * is still true, it is only no longer fresh — so this is a banner over
   * what there is, never a screen instead of it.
   */
  offline: 'COULD NOT REACH YOUR ACCOUNT',
  retry: 'RETRY',
  deleteFailed: (n: number) =>
    `${n} ${n === 1 ? 'conversation' : 'conversations'} would not delete`,
  moveFailed: (n: number) => `${n} would not move`,
} as const;

/** The conversation detail — canvas C1, C2. */
export const CONVERSATION = {
  back: 'TODAY',
  rename: 'RENAME',
  exportLabel: 'EXPORT',
  deleteLabel: 'DELETE',
  untitled: 'Untitled conversation',
  transcript: 'TRANSCRIPT',
  /** C1: while the pendant is still making this one. */
  capturing: 'STILL RECORDING',
  capturingLine: 'Nothing is lost. The transcript is written once it ends.',
  transcribing: 'TRANSCRIBING',
  transcribingLine: 'Splitting by speaker. You can already listen.',
  queued: 'QUEUED',
  queuedLine: 'Transcription starts in a moment. You can already listen.',
  onPhone: 'ON PHONE',
  onPhoneLine: 'Waiting to upload.',
  noSpeech: 'NO SPEECH',
  noSpeechLine: 'Nothing was said, so this moved to the archive. Playable for 30 days.',
  failed: 'FAILED',
  failedLine: 'That did not work.',
  retry: 'TRY TRANSCRIBING AGAIN',
  enhanced: 'ENHANCED',
  original: 'ORIGINAL',
  enhancedNote: 'NOISE AND SILENCE REMOVED',
  originalNote: 'EXACTLY AS THE PENDANT HEARD IT',
  askLyzn: 'ASK LYZN',
  noSpeechFound: 'No speech was found in this recording.',
  couldNotOpen: 'Could not open this conversation.',
  /** The speaker sheet, and the one honest thing a rename can promise. */
  speakers: 'SPEAKERS',
  nameSpeaker: 'Name this speaker.',
  nameSpeakerLine: 'Applies to every line this voice says here.',
  renamed: 'Memory will be re-filed with the names',
  savedOnPhone: 'TICKS SAVED ON THIS PHONE',
  deleteTitle: 'Delete this conversation?',
  deleteBody:
    'The audio and the transcript are deleted from your account. The pendant may still hold its own copy.',
  /** Round eight: the player's two jumps, and the failure that offers a way out. */
  back15: '−15',
  forward15: '+15',
  tryAgain: 'TRY AGAIN',
  /**
   * The commitments card reads the tasks API now, so a row is a task and
   * tapping it opens the task. The line under the card says where the ticks
   * live, which is no longer this phone.
   */
  openTask: 'OPEN',
  commitmentsFromTasks: 'TAP A COMMITMENT TO OPEN IT',
} as const;

/** The Ask sheet over one conversation — canvas C4. */
export const ASK_SHEET = {
  title: 'ASK LYZN',
  close: 'CLOSE ✕',
  placeholder: 'Ask about this conversation…',
  scope: 'This conversation only',
  suggestions: ['What did I agree to?', 'What is still open?'],
} as const;

/** The Ask lyzn tab — canvas L1, L2, L3. */
export const ASK_LYZN = {
  /** What holding an answer does. Said to a screen reader, not on screen. */
  shareHint: 'hold to share this answer',
  backToThreads: 'back to your threads',
  title: 'Ask lyzn',
  placeholder: 'Ask about anything you have said…',
  action: 'ASK',
  /** The composer's paperclip. Two sources, because a phone has two. */
  attachTitle: 'Add to this question',
  attachPhoto: 'Photo',
  attachFile: 'File',
  empty: {
    eyebrow: 'NOTHING ASKED YET',
    statement: 'Ask me what you promised, to whom, and when.',
    line: 'I only know what your pendant heard. I do not read your mail, your files or your messages.',
  },
  tryThese: 'TRY ONE OF THESE',
  suggestions: [
    'What did I promise Ravi this week?',
    'Anything still open from Monday?',
    'What did we decide about the LED?',
  ],
  thinking: 'THINKING',
  /**
   * The canvas says `ON YOUR MAC · NOTHING SENT ANYWHERE`, which describes a
   * laptop daemon that does not exist. The answer is composed from this
   * account's own memory and nothing else, and that is what the line says
   * instead (`[DAEMON]`).
   */
  ground: 'ON LYZN · YOUR OWN MEMORY ONLY',
  recent: 'RECENT',
  failed: 'That did not go through. Tap to try again.',
  /** Round eight: the thread list is a request too, and it can fail. */
  couldNotLoad: 'COULD NOT LOAD WHAT YOU ASKED BEFORE',
  retry: 'RETRY',
  deleteBody: 'The thread is deleted. What lyzn learned from it stays in your memory.',
  locked: {
    eyebrow: 'ASK LYZN IS PART OF EXECUTION',
    statement: 'Answering takes more than listening.',
    line: 'Your conversations are all here and searchable by hand. Asking questions of them is part of the Act tier.',
    action: 'SEE THE PLANS',
    browse: 'OR BROWSE CONVERSATIONS BY DAY',
  },
} as const;
/* <<< T7 ------------------------------------------------------------------ */


// ─── T8 · tasks and receipts ──────────────────────────────────────────────
// Canvas T0, T0b, T1–T5, R1, R2, D1, D2, S3. Every string the two segments
// and the three screens say, in one place, because the same sentence has to
// be the same sentence on Home and on the detail behind it.
//
// The tier decides the words, not the layout: with `features.execution` off
// nothing can act, so no line may promise that anything will happen. That is
// why several of these are functions of `execution` rather than constants —
// a screen that had to choose between two literals would eventually choose
// the wrong one.

/** Both segments, and the two screens under them. */
export const TASKS_COPY = {
  /** Canvas T0, the red line above the list, when there is nothing to count. */
  segmentEmptyEyebrow: 'TASKS · EMPTY',
  segmentEmptyStatement: "You haven't promised anybody anything today.",
  /** Capture: it waits for you to do it. Execution: it waits for your yes. */
  segmentEmptyLine: (execution: boolean) => execution
    ? 'When you do, it lands here in yellow and waits for your yes.'
    : 'When you do, it lands here in yellow and waits for you to do it.',

  /** The eyebrow over the settled block — canvas D1. */
  settled: 'SETTLED',

  /** Canvas T0's ink strip. The price is remote config's, so it is not here. */
  upsellEyebrow: 'LYZN CAN DO ALL THREE',
  upsellLine: 'Add execution',

  /** The card's own actions. */
  markDone: 'MARK DONE',
  dismiss: 'DISMISS',
  edit: 'EDIT',
  approve: 'APPROVE',
  approveFailed: 'That did not go through.',
  /** The blocked card's button — opens the task so you can answer its question. */
  answer: 'ANSWER',
  /* The compose sheet: a task that was asked for rather than overheard. Its
     confirmation says only that the task was sent, because the machine that
     has to be awake to take it is Home's banner to talk about (`daemonNone`)
     and it already does, the moment an approved task exists. */
  writeOne: 'WRITE ONE FOR THE LAPTOP',
  composeTitle: 'FOR THE LAPTOP',
  composePlaceholder: 'pull main and run the tests',
  composeSend: 'SEND TO LAPTOP',
  composeSending: 'SENDING…',
  composeSent: 'Sent. Your laptop takes it on its next check.',
  composeFailed: 'That did not send.',
  tryAgain: 'TRY AGAIN',
  dropIt: 'DROP IT',

  /** Canvas T2. */
  because: 'BECAUSE YOU SAID',
  whatWillHappen: 'WHAT WILL HAPPEN',
  exactMessage: 'THE EXACT MESSAGE',
  ifYouDoNothing: 'IF YOU DO NOTHING',
  /**
   * The canvas' answer names a WhatsApp digest, which does not exist
   * (`[WHATSAPP]`), and an execution path, which is off (`[EXECUTION]`). Both
   * tiers get the true answer for the tier they are on.
   */
  ifYouDoNothingBody: (execution: boolean) => execution
    ? 'It stays here. lyzn will not send anything on its own — it waits for your yes, and it waits as long as it takes.'
    : 'It stays here until you have done it and marked it done. lyzn heard you promise this and wrote it down; acting on it is still yours.',

  /** A task parked on a question mid-execution. */
  question: 'THIS NEEDS AN ANSWER',
  answerPlaceholder: 'type your answer',
  sendAnswer: 'SEND ANSWER',
  answerSending: 'SENDING…',
  answerSent: 'Sent. Your laptop picks it up on its next check.',
  answerFailed: 'That did not send.',
  answerWaiting: 'ANSWER SENT · WAITING ON YOUR LAPTOP',

  /** Canvas T5 — the failed detail. */
  whatHappened: 'WHAT HAPPENED, PLAINLY',
  whatYouCanDo: 'WHAT YOU CAN DO',
  failedFallback: 'It stopped before it went through. Nothing was sent and nothing was charged.',

  /** Canvas T3, the editor. */
  editing: 'EDITING',
  original: 'ORIGINAL',
  originalNote: 'What this said before you changed it.',
  save: 'SAVE',
  saveAndSend: 'SAVE & SEND',
  saveWithoutSending: 'SAVE WITHOUT SENDING',
  /** The backend trims a task to 400 characters, so the counter counts to it. */
  textLimit: 400,

  /**
   * Round eight: what the segment says when `GET /tasks` did not answer,
   * and the one word that asks it again. A list that could not be read is
   * not an empty list, and only one of the two has a retry.
   */
  couldNotLoad: 'COULD NOT LOAD YOUR TASKS',
  retry: 'RETRY',
  loadMore: 'LOAD MORE',
  loading: 'LOADING…',
  /** Failures, named. A toast that says "something went wrong" says nothing. */
  doneFailed: 'That would not mark done',
  dismissFailed: 'That would not dismiss',
  editFailed: 'That would not save',
} as const;

export const RECEIPTS_COPY = {
  /** Canvas R2. */
  title: 'Receipts',
  effort: 'YOUR EFFORT SAVED',

  /** Canvas R1 / D2. */
  from: 'FROM',
  share: 'SHARE THE SLIP',
  more: '···',
  copyAsText: 'COPY AS TEXT',
  openConversation: 'OPEN THE CONVERSATION',
  /** Why there is no delete on that menu, said out loud. */
  noDelete: 'A receipt is not deleted. It is the record that this happened.',

  /** Canvas S3's empty, for an account that has finished nothing yet. */
  emptyEyebrow: 'RECEIPTS · EMPTY',
  emptyStatement: "Nothing has been finished yet, so there's nothing to print.",
  emptyLine: (execution: boolean) => execution
    ? 'Approve or finish a task and the first receipt prints itself.'
    : 'Mark a task done and the first receipt prints itself.',

  /** Canvas T0b — the greyed example, on the Capture tier. */
  exampleStamp: 'EXAMPLE',
  exampleEyebrow: 'THIS IS WHAT IT LOOKS LIKE · WHEN A PROMISE IS KEPT',
  exampleBody: (execution: boolean) => execution
    ? 'Approve or finish a task and the first receipt prints itself.'
    : 'Right now lyzn hears your promises and lists them. Mark one done and the first receipt prints itself.',
  exampleAction: 'SEE WHAT EXECUTION ADDS',

  /** Round eight: the roll pages, and says so when it cannot. */
  couldNotLoad: 'COULD NOT LOAD THE ROLL',
  retry: 'RETRY',
  loadMore: 'LOAD MORE',
  loading: 'LOADING…',
  notHere: 'That receipt is not here.',
  looking: 'Finding it…',
} as const;

/**
 * `APPROVE`, `APPROVE BOTH`, `APPROVE ALL` — canvas T1 says "both" at two,
 * which is the kind of thing a person notices and a template does not.
 */
export function approveLabel(n: number): string {
  if (n <= 1) return TASKS_COPY.approve;
  if (n === 2) return 'APPROVE BOTH';
  return 'APPROVE ALL';
}

/**
 * The unlock sheet a 402 raises — canvas U1, reduced to the shape a sheet
 * can hold. The price and the feature list are remote config's (T6 owns the
 * chooser), so this says what it knows and hands over to that screen.
 */
export const UNLOCK_COPY = {
  title: 'EXECUTION',
  statement: 'These would already be done.',
  line: 'Execution is what lets lyzn act on the promises it hears — drafting, sending, ordering, on your own machine, and never without your yes.',
  action: 'SEE WHAT EXECUTION ADDS',
  dismiss: 'NOT NOW',
} as const;

// ─── end T8 ───────────────────────────────────────────────────────────────

/**
 * Categories — how conversations are filed. Reached from Settings.
 *
 * The delete confirmation names the category and says what survives it,
 * because "Delete?" over a list is a question about the wrong thing: the
 * conversations are what a person is actually worried about.
 */
export const CATEGORIES = {
  back: 'SETTINGS',
  title: 'Categories',
  line: 'How conversations are filed. Renaming one keeps everything already in it.',
  namePlaceholder: 'Name',
  removeLabel: (name: string) => `remove ${name.toLowerCase()}`,
  none: 'NONE YET',
  addEyebrow: 'ADD ONE',
  addPlaceholder: 'Site visits, Family, Vendors…',
  add: 'ADD',
  save: 'SAVE',
  saved: 'Saved.',
  saveFailed: 'That did not save.',
  cancel: 'Cancel',
  delete: 'DELETE',
  deleteTitle: (name: string) => `Delete “${name}”?`,
  deleteLine:
    'The conversations filed under it stay exactly where they are — they just '
    + 'stop being filed under anything.',
} as const;

/**
 * Recording with the phone, for somebody whose plan includes capture but
 * whose pendant is not in their hand.
 *
 * The copy does not claim parity with the pendant, because there is none: a
 * phone recording needs the phone awake and this app in front of you. Saying
 * so plainly is better than a person discovering it when a conversation they
 * thought was being kept turns out to be four seconds long.
 */
export const CAPTURE = {
  eyebrow: 'NO PENDANT · RECORD ON THIS PHONE',
  statement: 'Record with your phone until the pendant arrives.',
  line:
    'Everything after the recording is the same — it is transcribed, summarised '
    + 'and remembered exactly as the pendant’s conversations are. The difference '
    + 'is here: the phone has to stay awake with lyzn in front, and the recording '
    + 'ends if you leave the app.',
  start: 'START RECORDING',
  stop: 'STOP AND KEEP IT',
  recording: 'RECORDING ON THIS PHONE',
  saving: 'KEEPING IT…',
  savingLine: 'Uploading, then it goes through the same pipeline as the pendant.',
  done: 'KEPT',
  doneLine: 'It will appear on Home in about a minute, once it has been written up.',
  again: 'RECORD ANOTHER',
  nearingLimit: 'THIS RECORDING WILL STOP ITSELF SOON',
  denied: 'lyzn needs the microphone to record. You can turn it on in Settings.',
  tooShort: 'That was too short to keep — hold a conversation and try again.',
  lost: 'The recording did not survive. Nothing was kept.',
  uploadFailed: 'Kept on this phone. It will upload by itself when the network allows.',
  couldNotStart: 'The microphone would not start.',
} as const;

/**
 * The laptop daemon — the pairing screen behind Settings → Laptop daemon.
 *
 * The words carry one idea the product depends on: LYZN hears the promise and
 * a machine you own keeps it. Nothing here suggests the cloud does the work,
 * because it does not — the shell, the files and the signed-in accounts are
 * on the laptop, and that is the whole reason this pairing exists.
 */
export const DAEMON = {
  screenTitle: 'Laptop daemon',
  back: 'SETTINGS',

  machines: 'PAIRED MACHINES',
  emptyStatement: 'Nothing is doing the work yet.',
  emptyLine:
    'lyzn notices what you promised and writes it down. Keeping it takes a '
    + 'shell, your files and the accounts you are already signed in to — all of '
    + 'which are on your laptop, not here. Pair one and it does the work you '
    + 'approve.',

  pair: 'PAIR A LAPTOP',
  pairAnother: 'PAIR ANOTHER',

  codeEyebrow: 'TYPE THIS ON THE LAPTOP',
  codeLine:
    'On the laptop, open KARMAX and pair it with lyzn. These six characters are '
    + 'good for one machine, once.',
  codeExpires: (clock: string) => `EXPIRES IN ${clock}`,
  codeExpired: 'That code has expired.',
  codeAgain: 'GET ANOTHER CODE',
  waiting: 'WAITING FOR THE LAPTOP',
  paired: 'Paired.',
  cancel: 'CANCEL',

  /** What the machine will actually do, said once, on the screen that pairs it. */
  howEyebrow: 'WHAT IT DOES',
  howLine:
    'Every couple of minutes it asks what you have approved, takes one task, '
    + 'carries it out with your own coding harness, and posts back what '
    + 'happened so lyzn can print the receipt.',
  howNever: 'It is never handed anything you have not approved.',

  capabilitiesNone: 'NOTHING REPORTED',
  unpairTitle: 'Unpair this machine?',
  unpairLine:
    'Its token stops working immediately and it is handed no more work. The '
    + 'receipts it already printed stay on your account. Pairing it again takes '
    + 'a new code.',
  unpairConfirm: 'UNPAIR',
  unpaired: 'Unpaired.',
  unpairFailed: 'That did not unpair.',
  codeFailed: 'Could not get a code.',
  listFailed: 'Could not read your machines.',
  retry: 'TRY AGAIN',
} as const;
