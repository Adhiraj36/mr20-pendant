/**
 * App state: auth, the paired pendant, its BLE link, and sync.
 *
 * The BLE client is a live object with subscriptions, so it is held outside the
 * reactive state and only its observable facts are published to the UI.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Device } from 'react-native-ble-plx';
import { Mr20Client } from '../ble/client';
import {
  connect as bleConnect, disconnect as bleDisconnect, reconnect, onDisconnected, onAdapterState,
} from '../ble/manager';
import { verbOf, type DeviceInfo } from '../ble/protocol';
import { api, ApiError, type Category, type PairedDevice, type Recording } from '../api/client';
import { useTasks } from './tasks';
import { fetchPlan, type Plan } from '../api/plan';
import { fetchAppConfig, cachedAppConfig } from '../api/appConfig';
import { fixturesOn } from '../dev/fixtures';
import { DEFAULT_APP_CONFIG, type AppConfig } from '../plan/config';
import { resolvePlan, type ClerkPlanMetadata, type PlanResolution } from '../plan/resolve';
import {
  pushBatterySample, type BatterySample,
} from '../pendant/model';
import { requestSignOut } from '../api/auth';
import { syncAll, uploadPending, freeUpSpace, type CleanupResult, type SyncProgress, type SyncResult } from '../sync/engine';

const emptySync = (): SyncResult => ({
  pulled: 0, uploaded: 0, skipped: 0, failed: 0, discarded: 0, bytes: 0, errors: [],
});

/**
 * A failure, in words a banner can carry.
 *
 * Not "something went wrong": the request that timed out and the request the
 * server refused are different problems with different answers, and the one
 * thing the screen can do about either is say which it was.
 */
const describe = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : 'could not be reached';
import * as library from '../sync/library';

export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'syncing';

/** Live objects, deliberately outside the store: they are not renderable. */
let client: Mr20Client | null = null;
let device: Device | null = null;
let abort: AbortController | null = null;
let unsubscribeDisconnect: (() => void) | null = null;
let statePoll: ReturnType<typeof setInterval> | null = null;
let idleSyncTimer: ReturnType<typeof setInterval> | null = null;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let adapterUnsub: (() => void) | null = null;
let reconnectAttempt = 0;
/** Set while the user deliberately disconnected, to suppress auto-reconnect. */
let userDisconnected = false;

/**
 * The pendant records to its own storage and its physical button changes state
 * without telling anyone. Poll often enough that the toggle never lies for long,
 * rarely enough that it does not compete with a transfer for the link.
 */
const STATE_POLL_MS = 8000;
/**
 * Re-sync on a quiet link. When nothing is new a pass is only a file listing,
 * and the pendant segments by utterance — so conversations keep landing in the
 * library while the app just sits open, not only at connect time.
 */
const IDLE_SYNC_MS = 5 * 60_000;
/**
 * How long after a recording ends before pulling it. The device needs a moment
 * to close the file, and the gap absorbs a stop that is immediately followed by
 * more speech re-triggering voice activation.
 */
const AUTO_SYNC_DELAY_MS = 5000;
/** Backoff for an unexpected drop: 2s, 4s, 8s... capped. */
const reconnectDelay = (attempt: number) => Math.min(2000 * 2 ** attempt, 60_000);

/**
 * Where the volatile facts became durable — round seven.
 *
 * `lastSyncAt` used to live only in memory, so the Pendant tab said "NOT YET"
 * every cold start on an account that had been syncing for weeks. The
 * battery trail is what makes `≈5H LEFT` derivable at all (see
 * `pendant/model.ts`), and it is worthless if it starts empty on every
 * launch. Both are small enough to write on every change.
 */
const LAST_SYNC_KEY = 'lyzn.lastSyncAt';
const BATTERY_TRAIL_KEY = 'lyzn.battery';
/** Set the moment O7 is finished, so the flow is never walked twice. */
export const ONBOARDED_KEY = 'lyzn.onboarded';
/**
 * Set when somebody closes the chooser without buying, so the price list is
 * offered once and is not a toll gate on every cold start.
 */
export const PLAN_ASKED_KEY = 'lyzn.planAsked';

export const activeClient = () => client;

interface AppState {
  // auth
  ready: boolean;
  signedIn: boolean;
  email?: string;
  /** The user's chosen name and avatar, loaded from the account. */
  profile?: { name?: string; avatarUrl?: string };
  /**
   * What this account bought on lyzn.ai. Cached here rather than fetched by
   * the Profile screen into its own state, so re-entering the screen shows
   * the slip immediately and the refresh happens behind it (R14: a receipt
   * that is already known is not arriving, and must not print itself again).
   */
  plan?: Plan;
  /**
   * Clerk's `publicMetadata`, pushed in from the React tree by the bridge in
   * `_layout.tsx`. It is the instant answer: it is already in memory when a
   * session restores, minutes before `GET /plan` completes on a cold
   * network, and `resolvePlan` prefers the API the moment that arrives.
   */
  clerkPlan?: ClerkPlanMetadata;
  /**
   * True once `GET /plan` has been attempted, whether or not it answered.
   * The launch gate waits for it: routing on "no plan" before anyone has
   * asked would put the chooser in front of a paying customer on every cold
   * start, for as long as the request takes.
   */
  planChecked: boolean;
  /**
   * Remote configuration — prices, chooser copy, feature flags. Starts as
   * the built-in defaults so no screen has to render a "loading" state for
   * it, then becomes the cached document and then the fetched one.
   */
  appConfig: AppConfig;
  /** True once the pairing flow has been walked to its end (O7). Persisted. */
  onboarded: boolean;
  /**
   * True once the chooser has been shown and left without a purchase.
   * Persisted, and cleared on sign-out with the rest of the account's marks.
   *
   * It is the difference between offering a plan and demanding one: the gate
   * puts the chooser in front of a new account once, and after that a person
   * with no plan gets into the app like anybody else and finds the chooser
   * where it is asked for — Settings, a locked surface, the unlock sheet.
   */
  planAsked: boolean;

  // device
  paired?: PairedDevice;
  link: LinkState;
  info?: DeviceInfo;
  linkError?: string;
  /** False while the phone's Bluetooth adapter is off — nothing can connect. */
  btOn: boolean;
  /**
   * What the user last asked recording to be. A sync pass stops and restarts
   * recording as a side effect; this is how it knows whether restarting is
   * honouring the user or overriding them.
   */
  recordIntent: 'on' | 'off';

  // sync
  progress?: SyncProgress;
  lastSync?: SyncResult;
  /** Persisted since round seven: it survives a cold start. */
  lastSyncAt?: string;
  /**
   * Battery readings over time, oldest first. The only thing that makes
   * `≈5H LEFT` an estimate rather than a guess — see `pendant/model.ts`.
   */
  batteryTrail: BatterySample[];
  /**
   * Whether syncing happens by itself (on connect, after a recording stops,
   * on the idle timer, and the periodic upload flush). Off means nothing
   * moves until the user says "Sync now". Persisted.
   */
  autoSync: boolean;

  // library
  recordings: Recording[];
  loadingRecordings: boolean;
  /**
   * Why the last `GET /recordings` did not answer, when it did not.
   *
   * The list used to swallow its own failure, which left Home showing an
   * empty card that says "nothing yet" to somebody whose network is simply
   * down. Home draws a banner off this and offers the retry (round eight).
   */
  recordingsError?: string;
  /** Opaque backend cursor; undefined once the last page arrived. */
  recordingsCursor?: string;
  loadingMoreRecordings: boolean;
  categories: Category[];

  bootstrap: () => Promise<void>;
  /** Clerk's verdict, pushed in from the React tree. */
  applyAuth: (signedIn: boolean, email?: string) => Promise<void>;
  setSignedIn: (email?: string) => Promise<void>;
  loadProfile: () => Promise<void>;
  loadPlan: () => Promise<void>;
  /** Clerk's verdict on what was bought, pushed in from the React tree. */
  applyClerkPlan: (metadata: ClerkPlanMetadata | undefined) => void;
  /** `GET /config`, cached. Safe to call on every launch and every focus. */
  loadAppConfig: () => Promise<void>;
  /** O7 is finished; the launch gate stops routing into onboarding. */
  completeOnboarding: () => Promise<void>;
  /** The chooser was closed without a purchase; the gate stops opening it. */
  skipChooser: () => Promise<void>;
  signOut: () => Promise<void>;

  pair: (peripheralId: string) => Promise<PairedDevice>;
  unpair: () => Promise<void>;
  connect: (options?: { sync?: boolean }) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshInfo: () => Promise<void>;

  sync: () => Promise<SyncResult>;
  cancelSync: () => void;
  setAutoSync: (on: boolean) => Promise<void>;
  /** Delete from the pendant everything the backend has confirmed it holds. */
  cleanupDevice: (onProgress?: (done: number, total: number, freed: number) => void) => Promise<CleanupResult>;
  /** Format the pendant: every recording on it is erased. The link drops. */
  factoryResetDevice: () => Promise<void>;

  startRecording: () => Promise<string>;
  stopRecording: () => Promise<void>;
  /** Flip recording based on what the device says right now. Returns the new state. */
  toggleRecording: () => Promise<boolean>;
  shake: () => Promise<void>;

  loadRecordings: () => Promise<void>;
  loadMoreRecordings: () => Promise<void>;
  /**
   * Batch delete, optimistically: the rows go now and any that the server
   * refused come back exactly where they were. `failed` names them so the
   * toast can say what did not go through rather than a bare count.
   */
  deleteRecordings: (ids: string[]) => Promise<{ deleted: number; failed: string[] }>;
  /** Batch categorize ("" clears). Returns how many were moved and which failed. */
  categorizeRecordings: (
    ids: string[], categoryId: string | null,
  ) => Promise<{ moved: number; failed: string[] }>;
  /**
   * Destroy this account's record: every recording, every thread, and the
   * audio this phone is holding.
   *
   * There is no account-deletion endpoint — the backend has no `DELETE
   * /account` (round eight audit) — so this is the per-recording delete in a
   * loop, which is what the row can honestly promise. `onProgress` is what
   * lets the screen count it out loud rather than freeze on an alert.
   *
   * It stops where the API stops. `DELETE /recordings/:id` does not cascade
   * to the tasks a recording produced, there is no `DELETE /tasks/:id` at
   * all, and a receipt is undeletable by design — so the commitments and the
   * receipts survive, and the confirmation says so before it asks.
   */
  deleteEverything: (
    onProgress?: (done: number, total: number) => void,
  ) => Promise<{ deleted: number; failed: number }>;
  loadCategories: () => Promise<void>;
  saveCategories: (categories: Category[]) => Promise<void>;
  setCategory: (recordingId: string, categoryId: string | null) => Promise<void>;
}

/**
 * Everything that must happen once a link is live: listen for state the device
 * changes on its own, notice when the link drops, and keep the recording flag
 * honest.
 */
function attachLink(set: (partial: Partial<AppState>) => void, get: () => AppState) {
  if (!client || !device) return;

  // The pendant announces what its own button did. Without this the recording
  // toggle keeps showing whatever the app last set, which reads as inverted.
  client.setEventHandler((message) => {
    const verb = verbOf(message);
    if (verb.startsWith('STA&')) {
      set({ info: { ...(get().info ?? {}), recording: true } });
    } else if (verb.startsWith('STO')) {
      set({ info: { ...(get().info ?? {}), recording: false } });
      // A recording just closed — voice activation timed out, the button was
      // pressed, or the user stopped it here. Whichever it was, there is now a
      // finished file on the device; pull it while the link is idle. Syncing's
      // own pause is excluded because the link is not 'connected' then.
      scheduleAutoSync(get);
    } else if (verb.startsWith('DISK&ERR')) {
      set({ linkError: 'The pendant storage is full; it cannot record until files are freed.' });
    }
  });

  // Belt and braces: not every firmware emits an event for a button press, so
  // poll while idle. Skipped during a sync, which owns the link.
  if (statePoll) clearInterval(statePoll);
  statePoll = setInterval(async () => {
    const active = client;
    if (!active || get().link !== 'connected') return;
    try {
      const recording = await active.isRecording();
      const previous = get().info?.recording;
      if (recording !== previous) {
        set({ info: { ...(get().info ?? {}), recording } });
        // The poll catching a stop means the event was missed; same response.
        if (previous === true && !recording) scheduleAutoSync(get);
      }
    } catch {
      // Unanswered poll: leave the last known state alone. The disconnect
      // handler covers a link that is actually gone.
    }
  }, STATE_POLL_MS);

  // The link staying up should be enough for the library to stay current.
  if (idleSyncTimer) clearInterval(idleSyncTimer);
  idleSyncTimer = setInterval(() => {
    if (!get().autoSync) return;
    if (get().link !== 'connected') return;
    get().sync().catch(() => undefined);
  }, IDLE_SYNC_MS);

  if (unsubscribeDisconnect) unsubscribeDisconnect();
  unsubscribeDisconnect = onDisconnected(device, () => {
    set({ link: 'disconnected', progress: undefined });
    stopLinkTimers();
    client = null;
    device = null;
    // Walking out of range should not mean the app is dead until you notice.
    // A dead radio is different: the adapter watcher reconnects the moment
    // Bluetooth comes back, so no timer is needed for that case.
    if (!userDisconnected && get().btOn) scheduleReconnect(get);
  });
}

function stopLinkTimers() {
  if (statePoll) { clearInterval(statePoll); statePoll = null; }
  if (idleSyncTimer) { clearInterval(idleSyncTimer); idleSyncTimer = null; }
  if (autoSyncTimer) { clearTimeout(autoSyncTimer); autoSyncTimer = null; }
  if (unsubscribeDisconnect) { unsubscribeDisconnect(); unsubscribeDisconnect = null; }
}

/** Debounced "a recording just finished, go and get it". */
function scheduleAutoSync(get: () => AppState) {
  if (!get().autoSync) return;
  if (get().link !== 'connected') return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    if (get().link !== 'connected') return;
    get().sync().catch(() => undefined);
  }, AUTO_SYNC_DELAY_MS);
}

function scheduleReconnect(get: () => AppState) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = reconnectDelay(reconnectAttempt++);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    const { paired, link, btOn } = get();
    if (!paired || link !== 'disconnected' || userDisconnected || !btOn) return;
    // connect() reschedules on failure itself, so no catch-chain is needed.
    get().connect({ sync: true }).catch(() => undefined);
  }, delay);
}

/** Called when the app returns to the foreground, or on launch. */
export function ensureConnected(): void {
  const { paired, link, btOn } = useApp.getState();
  if (!paired || link !== 'disconnected' || userDisconnected || !btOn) return;
  reconnectAttempt = 0;
  useApp.getState().connect({ sync: true }).catch(() => undefined);
}

/**
 * React to the Bluetooth adapter itself. When it goes away every live object
 * above it is already dead; when it comes back, waiting out a backoff timer
 * the user cannot see would just look broken.
 */
function watchAdapter(set: (partial: Partial<AppState>) => void, get: () => AppState) {
  if (adapterUnsub) return;
  adapterUnsub = onAdapterState((poweredOn) => {
    if (poweredOn === get().btOn) return;
    set({ btOn: poweredOn });

    if (!poweredOn) {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      stopLinkTimers();
      client = null;
      device = null;
      set({ link: 'disconnected', progress: undefined, linkError: 'Bluetooth is off' });
      return;
    }

    set({ linkError: undefined });
    reconnectAttempt = 0;
    const { paired, link } = get();
    if (paired && link === 'disconnected' && !userDisconnected) {
      get().connect({ sync: true }).catch(() => undefined);
    }
  });
}

/**
 * File one battery reading against the clock.
 *
 * This is the whole source of `≈5H LEFT`. The device reports a percentage
 * and nothing else — no voltage, no runtime — so the only honest way to say
 * how long is left is to watch how fast it falls. Written through to disk on
 * every reading because the trail is worthless if it starts empty at each
 * launch, and `pushBatterySample` keeps it to two dozen entries.
 */
function recordBattery(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  percent: number | undefined,
): void {
  if (percent === undefined) return;
  const next = pushBatterySample(get().batteryTrail, { at: Date.now(), percent });
  if (next === get().batteryTrail) return;
  set({ batteryTrail: next });
  AsyncStorage.setItem(BATTERY_TRAIL_KEY, JSON.stringify(next)).catch(() => undefined);
}

/**
 * The plan, as the app should act on it: the API's answer when there is one,
 * Clerk's the rest of the time, and `needsChooser` when there is neither.
 *
 * A function over the state rather than a field in it, so there is no second
 * copy to keep in step — the two inputs already live in the store.
 */
export function planOf(state: AppState): PlanResolution {
  return resolvePlan(state.clerkPlan, state.plan, state.appConfig);
}

/**
 * One document, two stores.
 *
 * `/config` decides both what this store holds and whether the tasks screens
 * may offer APPROVE at all. Until round eight the tasks store kept its own
 * frozen `{ execution: false }` and nothing ever wrote to it, so flipping
 * the flag on the server changed the settings screen and left the task cards
 * behind. Written in one place so the two cannot disagree.
 */
function applyConfig(set: (partial: Partial<AppState>) => void, config: AppConfig): void {
  set({ appConfig: config });
  useTasks.getState().setFeatures({ execution: config.features.execution });
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  signedIn: false,
  appConfig: DEFAULT_APP_CONFIG,
  onboarded: false,
  planAsked: false,
  planChecked: false,
  link: 'disconnected',
  btOn: true,
  recordIntent: 'on',
  autoSync: true,
  batteryTrail: [],
  recordings: [],
  loadingRecordings: false,
  loadingMoreRecordings: false,
  categories: [],

  // -- auth ----------------------------------------------------------------

  // Preferences only. Whether anyone is signed in is Clerk's answer, not a
  // stored token's, and it arrives through `applyAuth` once Clerk has loaded.
  //
  // `ready` is deliberately NOT set here. It means "we know whether you are
  // signed in", and the launch gate routes on it — setting it before Clerk has
  // answered sends a signed-in user to the welcome screen, and by the time the
  // real answer arrives the gate has unmounted and nothing routes again.
  bootstrap: async () => {
    AsyncStorage.getItem('pendant.autosync')
      .then((raw) => { if (raw === 'off') set({ autoSync: false }); })
      .catch(() => undefined);

    // The three durable facts. Each is independent, each is optional, and a
    // failure to read any of them is the default rather than a failed boot.
    AsyncStorage.multiGet([LAST_SYNC_KEY, BATTERY_TRAIL_KEY, ONBOARDED_KEY, PLAN_ASKED_KEY])
      .then((pairs) => {
        const read = new Map(pairs);
        const lastSyncAt = read.get(LAST_SYNC_KEY) ?? undefined;
        if (lastSyncAt) set({ lastSyncAt });
        if (read.get(ONBOARDED_KEY) === 'yes') set({ onboarded: true });
        if (read.get(PLAN_ASKED_KEY) === 'yes') set({ planAsked: true });
        const trail = read.get(BATTERY_TRAIL_KEY);
        if (trail) {
          try {
            const parsed = JSON.parse(trail);
            if (Array.isArray(parsed)) set({ batteryTrail: parsed as BatterySample[] });
          } catch {
            // A truncated write. An empty trail only costs the estimate.
          }
        }
      })
      .catch(() => undefined);

    // The cached configuration first — it is on disk and it decides what the
    // chooser and settings even contain — then the network behind it.
    cachedAppConfig()
      .then((config) => { if (config) applyConfig(set, config); })
      .catch(() => undefined);
    get().loadAppConfig().catch(() => undefined);
  },

  loadAppConfig: async () => {
    const { config } = await fetchAppConfig();
    applyConfig(set, config);
  },

  applyClerkPlan: (metadata) => {
    set({ clerkPlan: metadata });
  },

  completeOnboarding: async () => {
    set({ onboarded: true });
    await AsyncStorage.setItem(ONBOARDED_KEY, 'yes').catch(() => undefined);
  },

  // The flag is set before the write is awaited, deliberately: the screen
  // that calls this routes back through the gate on the next line, and the
  // gate has to read the new answer, not the stored one.
  skipChooser: async () => {
    set({ planAsked: true });
    await AsyncStorage.setItem(PLAN_ASKED_KEY, 'yes').catch(() => undefined);
  },

  /**
   * Clerk has settled. Bring the account's world up, or tear it down.
   *
   * Called on every change rather than once at launch: a session can end while
   * the app is open — expired, or revoked from another device — and the app
   * has to stop acting like somebody is signed in when that happens.
   */
  applyAuth: async (signedIn, email) => {
    // A fixture session is not overwritten by Clerk's answer. A simulator
    // has no session, so Clerk resolves to "signed out" a moment after a
    // screenshot pass has seeded one, and every route would fall back to
    // the welcome screen. Development only; `fixturesOn()` is false in any
    // build that did not switch them on, and dead code in a release one.
    if (__DEV__ && fixturesOn() && get().signedIn) return;
    if (!signedIn) {
      // `ready` goes true here too: "signed out" is an answer, and without it
      // the launch gate waits forever on a splash screen.
      set({
        signedIn: false, email: undefined, paired: undefined, info: undefined,
        plan: undefined, clerkPlan: undefined, ready: true,
      });
      return;
    }
    const alreadyUp = get().signedIn && get().email === email;
    set({ signedIn: true, email, ready: true });
    if (alreadyUp) return;

    // The launch gate routes on the plan, so it is fetched here rather than
    // by whichever screen happens to want it. `loadPlan` swallows its own
    // failures; the gate falls back to Clerk's metadata until it lands.
    get().loadPlan().catch(() => undefined);

    try {
      const { devices } = await api.listDevices();
      set({ paired: devices[0] });
    } catch {
      // Offline start: the app still works against the local library.
    }

    // A paired pendant should just be there when the app opens, the way
    // headphones are. No tap required. Watching the adapter is deferred to
    // this point because instantiating the BLE manager is what triggers the
    // iOS permission prompt — a fresh install must not ask on the splash
    // screen, before onboarding has said why.
    if (get().paired) {
      userDisconnected = false;
      watchAdapter(set, get);
      get().connect({ sync: true }).catch(() => undefined);
    }
  },

  loadProfile: async () => {
    try {
      const profile = await api.getProfile();
      set({ profile });
    } catch {
      // Offline or fresh account: the email-derived fallback stands in.
    }
  },

  loadPlan: async () => {
    try {
      set({ plan: await fetchPlan() });
    } catch {
      // Offline, or the endpoint is not deployed yet: keep whatever was
      // last known. An entitlement that cannot be read is not an
      // entitlement that was withdrawn, so nothing is cleared here.
    } finally {
      // Asked, either way. The gate is waiting on this and not on an answer.
      set({ planChecked: true });
    }
  },

  setSignedIn: async (email) => {
    set({ signedIn: true, email });
    const { devices } = await api.listDevices().catch(() => ({ devices: [] as PairedDevice[] }));
    set({ paired: devices[0] });
  },

  /**
   * Sign out, and mean it.
   *
   * Everything before the `finally` is tidying — a radio to drop, a cache to
   * delete, a flag to forget — and not one of it may decide whether the
   * session ends. It used to: an unguarded `disconnect()` on a phone whose
   * pendant had wandered off, or a `clearLibrary()` that could not delete a
   * file, threw before the state was cleared, and the person was left signed
   * in and standing inside the app with the button apparently doing nothing.
   * So the account is torn down in a `finally`, and the tidying is allowed to
   * fail one piece at a time.
   */
  signOut: async () => {
    userDisconnected = true;
    try {
      await get().disconnect().catch(() => undefined);
      await requestSignOut();
      // The local audio cache belongs to the account that pulled it.
      await library.clearLibrary().catch(() => undefined);
      // The onboarding flag and the battery trail belong to the account that
      // was signed in, not to the phone: the next person to sign in here walks
      // the pairing flow from the top and starts their own trail.
      await AsyncStorage.multiRemove([
        ONBOARDED_KEY, PLAN_ASKED_KEY, BATTERY_TRAIL_KEY, LAST_SYNC_KEY,
      ]).catch(() => undefined);
    } finally {
      set({
        signedIn: false, email: undefined, paired: undefined, recordings: [],
        info: undefined, profile: undefined, plan: undefined, clerkPlan: undefined,
        onboarded: false, planAsked: false, batteryTrail: [], lastSyncAt: undefined,
        recordingsError: undefined, recordingsCursor: undefined,
      });
      // The tasks and the receipts belong to the account that was signed in.
      // Leaving them would show the next person somebody else's promises.
      useTasks.getState().reset();
      // …and the flags come straight back from the configuration this store
      // already holds, so the reset does not silently downgrade the tier.
      useTasks.getState().setFeatures({ execution: get().appConfig.features.execution });
    }
  },

  // -- pairing -------------------------------------------------------------

  pair: async (peripheralId) => {
    // The pairing screen has already raised the permission prompts, so the
    // adapter can be watched from here on.
    watchAdapter(set, get);
    set({ link: 'connecting', linkError: undefined });
    try {
      device = await bleConnect(peripheralId);
      client = new Mr20Client(device);
      await client.open();

      const info = await client.info();
      if (!info.mac) throw new Error('the pendant did not report its MAC address');

      // The device has no RTC battery and its clock names every recording.
      await client.setClock();

      // Same confirmation as on reconnect: the pendant buzzes in your hand the
      // moment it is bound to this phone.
      client.shake().catch(() => undefined);

      const paired = await api.pairDevice({
        mac: info.mac,
        peripheralId,
        name: client.name,
        firmware: info.firmware,
        wifiFirmware: info.wifiFirmware,
        batteryPercent: info.batteryPercent,
        freeMb: info.freeMb,
        totalMb: info.totalMb,
      });

      set({ paired, info, link: 'connected' });
      recordBattery(set, get, info.batteryPercent);
      reconnectAttempt = 0;
      userDisconnected = false;
      attachLink(set, get);
      return paired;
    } catch (err) {
      set({ link: 'disconnected', linkError: (err as Error).message });
      throw err;
    }
  },

  unpair: async () => {
    const { paired } = get();
    userDisconnected = true;
    await get().disconnect();
    if (paired) await api.unpairDevice(paired.mac).catch(() => undefined);
    // The next pendant starts from the default: always capturing.
    set({ paired: undefined, info: undefined, recordIntent: 'on' });
  },

  // -- link ----------------------------------------------------------------

  connect: async ({ sync = true } = {}) => {
    // Auto-sync off means connecting is just connecting.
    if (!get().autoSync) sync = false;
    const { paired, link, btOn } = get();
    if (!paired) throw new Error('no pendant is paired');
    // Already connected, connecting, or syncing: there is nothing to do, and
    // building a second client over the same live device would leak the first
    // one's subscriptions and double every event.
    if (link !== 'disconnected') return;
    if (!btOn) throw new Error('Bluetooth is switched off');

    set({ link: 'connecting', linkError: undefined });
    try {
      device = await reconnect(paired.peripheralId, { name: paired.name });
      if (!device) throw new Error('the pendant did not answer; is it in range and switched on?');

      // The scan fallback can find the pendant under a fresh platform id.
      // Adopt it, and let the backend record catch up in the background.
      if (device.id !== paired.peripheralId) {
        set({ paired: { ...paired, peripheralId: device.id } });
        api.pairDevice({ mac: paired.mac, peripheralId: device.id, name: paired.name })
          .catch(() => undefined);
      }

      client = new Mr20Client(device);
      await client.open();
      await client.setClock();

      const info = await client.info();
      set({ info, link: 'connected' });
      recordBattery(set, get, info.batteryPercent);
      reconnectAttempt = 0;
      userDisconnected = false;
      attachLink(set, get);

      // Let the pendant announce itself. The haptic is the confirmation that
      // the link is real — the device answering in the physical world, not just
      // a label changing on screen. It sends no reply, so this is fire and
      // forget and must never hold up or fail the connect.
      client.shake().catch(() => undefined);

      api
        .updateTelemetry(paired.mac, {
          batteryPercent: info.batteryPercent,
          freeMb: info.freeMb,
          totalMb: info.totalMb,
          firmware: info.firmware,
        })
        .catch(() => undefined);

      // The pendant records to its own storage whether or not the phone is
      // there, so the useful thing to do on connect is collect what it has and
      // make sure it is still recording. A sync that fails must not report the
      // connection itself as failed — the link is up either way.
      if (sync) await get().sync().catch(() => undefined);
    } catch (err) {
      set({ link: 'disconnected', linkError: (err as Error).message });
      // "Come back in range and it is there" has to survive a failed attempt:
      // keep trying quietly unless the user or the radio says otherwise.
      if (!userDisconnected && get().btOn) scheduleReconnect(get);
      throw err;
    }
  },

  disconnect: async () => {
    // Deliberate: do not immediately reconnect behind the user's back.
    userDisconnected = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    abort?.abort();
    abort = null;
    stopLinkTimers();
    if (client) await client.close().catch(() => undefined);
    if (device) await bleDisconnect(device.id).catch(() => undefined);
    client = null;
    device = null;
    set({ link: 'disconnected', progress: undefined });
  },

  refreshInfo: async () => {
    if (!client) return;
    const fresh = await client.info();
    set((state) => ({
      info: {
        ...fresh,
        // A dropped STE reply comes back undefined. Keep what we already knew
        // rather than letting a lost packet flip the recording switch off.
        recording: fresh.recording ?? state.info?.recording,
      },
    }));
    recordBattery(set, get, fresh.batteryPercent);
  },

  // -- sync ----------------------------------------------------------------

  sync: async () => {
    const { paired, link } = get();
    if (!paired) throw new Error('no pendant is paired');
    if (!client) throw new Error('not connected to the pendant');
    // A second press must not start a second pass over the same BLE link.
    if (link === 'syncing') return get().lastSync ?? emptySync();

    abort = new AbortController();
    set({ link: 'syncing', progress: { phase: 'listing' }, linkError: undefined });

    try {
      const result = await syncAll(client, {
        mac: paired.mac,
        signal: abort.signal,
        onProgress: (progress) => set({ progress }),
      });

      const at = new Date().toISOString();
      set({ lastSync: result, lastSyncAt: at });
      // Durable, so the Pendant tab does not read "NOTHING SYNCED YET" on
      // every cold start of an account that has been syncing for weeks.
      AsyncStorage.setItem(LAST_SYNC_KEY, at).catch(() => undefined);

      // Make sure the pendant is capturing again before we let go of it —
      // unless the user explicitly switched recording off, in which case
      // restarting it here would override them five minutes after the fact.
      // The local copy matters: the link can drop during the awaits, and the
      // disconnect handler nulls the module-level client under our feet.
      const active = client;
      if (get().recordIntent === 'on' && active) {
        // An unanswered STE is treated as "already recording": starting a
        // recording the user did not ask for is worse than missing a restart
        // the next pass will catch.
        const recording = await active.isRecording().catch(() => true);
        if (!recording) await active.startRecording().catch(() => undefined);
      }
      await get().refreshInfo().catch(() => undefined);
      await get().loadRecordings();
      // The list is fresh and the pendant is still in hand: the best moment to
      // clear whatever the server has since judged to be silence. Deferred so
      // the sync is reported complete first — this is housekeeping, and a
      // failure here must not read as a failed sync.
      setTimeout(() => { void purgeStale(get); }, 0);
      return result;
    } catch (err) {
      set({ linkError: (err as Error).message });
      throw err;
    } finally {
      // Whatever happened, the link is no longer syncing. Doing this in the
      // finally is what stops a thrown error leaving the button spinning.
      abort = null;
      set({
        link: client ? 'connected' : 'disconnected',
        progress: undefined,
      });
    }
  },

  cancelSync: () => {
    abort?.abort();
  },

  setAutoSync: async (on) => {
    set({ autoSync: on });
    await AsyncStorage.setItem('pendant.autosync', on ? 'on' : 'off').catch(() => undefined);
  },

  factoryResetDevice: async () => {
    if (!client) throw new Error('not connected to the pendant');
    if (get().link === 'syncing') throw new Error('wait for the sync to finish first');

    // The reset drops the BLE link and clears the pairing key on the device;
    // suppress the auto-reconnect scramble and let the user re-link when
    // they are ready.
    userDisconnected = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    // The reset reboots the device the moment it lands, which routinely kills
    // the BLE write's own acknowledgement — a throw here is the reset
    // WORKING, not failing, so it must not surface as an error.
    await client.factoryReset().catch(() => undefined);
    stopLinkTimers();
    if (client) await client.close().catch(() => undefined);
    if (device) await bleDisconnect(device.id).catch(() => undefined);
    client = null;
    device = null;
    set({ link: 'disconnected', progress: undefined, info: undefined });
  },

  cleanupDevice: async (onProgress) => {
    const { paired, link, recordings, recordIntent } = get();
    if (!paired) throw new Error('no pendant is paired');
    if (!client) throw new Error('not connected to the pendant');
    if (link === 'syncing') throw new Error('wait for the sync to finish first');

    // Safe means the backend confirmed it: transcribed, or archived as
    // no-speech. Anything else on the device is not ours to remove.
    const confirmed = new Set(
      recordings
        .filter((r) => r.status === 'ready' || r.status === 'archived')
        .map((r) => `${r.deviceFolder}/${r.deviceFile}`),
    );

    const result = await freeUpSpace(client, confirmed, {
      onProgress,
      // Do not restart a recording the user explicitly switched off.
      passive: recordIntent === 'off',
    });
    await get().refreshInfo().catch(() => undefined);
    return result;
  },

  // -- device control ------------------------------------------------------

  startRecording: async () => {
    if (!client) throw new Error('not connected');
    const file = await client.startRecording();
    if (!file) throw new Error('the pendant did not confirm it started recording');

    // Reflect the device's own confirmation immediately. Waiting on a fresh
    // info() round trip left the button labelled with the previous state, so
    // the next press did the opposite of what it said.
    set((state) => ({
      recordIntent: 'on',
      info: state.info ? { ...state.info, recording: true } : state.info,
    }));
    // Then reconcile the rest of the telemetry in the background.
    get().refreshInfo().catch(() => undefined);
    return file;
  },

  stopRecording: async () => {
    if (!client) throw new Error('not connected');
    if (!(await client.stopRecording())) {
      throw new Error('the pendant did not confirm it stopped recording');
    }
    set((state) => ({
      recordIntent: 'off',
      info: state.info ? { ...state.info, recording: false } : state.info,
    }));
    get().refreshInfo().catch(() => undefined);
  },

  /**
   * The only way the UI should change recording state.
   *
   * It asks the pendant what it is doing *right now* and acts on that answer,
   * rather than on a cached flag. The cache can be wrong for reasons the app
   * cannot prevent: the device has a physical record button, a sync stops and
   * restarts recording, and a dropped link means missed events. Deciding from
   * a stale flag is what made this control appear inverted — pressing it did
   * the opposite of what the label said.
   */
  toggleRecording: async () => {
    const active = client;
    if (!active) throw new Error('not connected');

    const recordingNow = await active.isRecording();

    if (recordingNow) {
      if (!(await active.stopRecording())) {
        throw new Error('the pendant did not confirm it stopped recording');
      }
    } else if (!(await active.startRecording())) {
      throw new Error('the pendant did not confirm it started recording');
    }

    const next = !recordingNow;
    set((state) => ({
      recordIntent: next ? 'on' : 'off',
      info: state.info ? { ...state.info, recording: next } : state.info,
    }));
    get().refreshInfo().catch(() => undefined);
    return next;
  },

  shake: async () => {
    if (!client) throw new Error('not connected');
    await client.shake();
  },

  // -- library -------------------------------------------------------------

  loadRecordings: async () => {
    set({ loadingRecordings: true });
    try {
      const { recordings, cursor } = await api.listRecordings();
      set({ recordings, recordingsCursor: cursor, recordingsError: undefined });
      // The backend now tells us what it has finished with; drop the phone's
      // local copies of those. This is the automatic form of the manual "Clear
      // transcribed audio" button, and it also covers the end of a sync pass,
      // which finishes by calling this.
      await pruneReadyLocal(recordings);
    } catch (err) {
      // Keep whatever list is already on screen, and say what could not be
      // reached — an empty list and an unreachable list are not the same
      // thing, and only one of them has a retry.
      set({ recordingsError: describe(err) });
    } finally {
      set({ loadingRecordings: false });
    }
  },

  loadMoreRecordings: async () => {
    const { recordingsCursor, loadingMoreRecordings, loadingRecordings } = get();
    if (!recordingsCursor || loadingMoreRecordings || loadingRecordings) return;
    set({ loadingMoreRecordings: true });
    try {
      const { recordings, cursor } = await api.listRecordings(recordingsCursor);
      set((state) => {
        // A refresh may have raced this page in; dedupe on id so a row can
        // never appear twice however the calls interleave.
        const seen = new Set(state.recordings.map((r) => r.recordingId));
        return {
          recordings: [...state.recordings, ...recordings.filter((r) => !seen.has(r.recordingId))],
          recordingsCursor: cursor,
        };
      });
    } catch {
      // The cursor stays; scrolling again retries.
    } finally {
      set({ loadingMoreRecordings: false });
    }
  },

  deleteRecordings: async (ids) => {
    // Optimistic: the rows go the moment the alert is confirmed. What the
    // server refuses is put back where it was, in order, rather than the
    // whole list being refetched — a reload would also undo a rename or a
    // categorisation that landed while the deletes were in flight.
    const before = get().recordings;
    const wanted = new Set(ids);
    set({ recordings: before.filter((r) => !wanted.has(r.recordingId)) });

    const failed: string[] = [];
    for (const id of ids) {
      try {
        await api.deleteRecording(id);
      } catch (err) {
        // A row that is already gone is a row that is deleted, whoever did
        // it. Anything else genuinely failed and has to come back.
        if (!(err instanceof ApiError && err.status === 404)) failed.push(id);
      }
    }

    if (failed.length) {
      const gone = new Set(ids.filter((id) => !failed.includes(id)));
      set({ recordings: before.filter((r) => !gone.has(r.recordingId)) });
    }
    return { deleted: ids.length - failed.length, failed };
  },

  categorizeRecordings: async (ids, categoryId) => {
    const before = get().recordings;
    set({
      recordings: before.map((r) =>
        ids.includes(r.recordingId) ? { ...r, categoryId } : r),
    });

    const failed: string[] = [];
    for (const id of ids) {
      try {
        await api.patchRecording(id, { categoryId });
      } catch {
        failed.push(id);
      }
    }

    // Only the rows that failed roll back, and only to the category they
    // had. Everything that landed keeps its new one.
    if (failed.length) {
      const wasCategory = new Map(before.map((r) => [r.recordingId, r.categoryId]));
      set((state) => ({
        recordings: state.recordings.map((r) =>
          failed.includes(r.recordingId)
            ? { ...r, categoryId: wasCategory.get(r.recordingId) ?? null }
            : r),
      }));
    }
    return { moved: ids.length - failed.length, failed };
  },

  deleteEverything: async (onProgress) => {
    // Every page first, because the loop below deletes what it is reading
    // and a cursor into a shrinking list cannot be trusted.
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const answer = await api.listRecordings(cursor);
      ids.push(...answer.recordings.map((r) => r.recordingId));
      if (!answer.cursor) break;
      cursor = answer.cursor;
    }

    let deleted = 0;
    let failed = 0;
    for (const [index, id] of ids.entries()) {
      try {
        await api.deleteRecording(id);
        deleted += 1;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) deleted += 1;
        else failed += 1;
      }
      onProgress?.(index + 1, ids.length);
      set((state) => ({
        recordings: state.recordings.filter((r) => r.recordingId !== id),
      }));
    }

    // The threads are the other half of the record. Best effort: a chat that
    // will not delete must not stop the recordings that already did.
    try {
      let chatCursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const answer = await api.getChats(chatCursor);
        for (const chat of answer.chats) await api.deleteChat(chat.id).catch(() => undefined);
        if (!answer.cursor) break;
        chatCursor = answer.cursor;
      }
    } catch {
      // Leave it; the recordings are what the row promised first.
    }

    await library.clearLibrary().catch(() => undefined);
    set({ recordings: [], recordingsCursor: undefined });
    return { deleted, failed };
  },

  loadCategories: async () => {
    try {
      const { categories } = await api.getCategories();
      set({ categories });
    } catch {
      // Keep whatever set is already loaded; the UI degrades to "no chips".
    }
  },

  saveCategories: async (categories) => {
    const { categories: saved } = await api.putCategories(categories);
    set({ categories: saved });
    // Renames and deletions change what recording rows should display.
    await get().loadRecordings();
  },

  setCategory: async (recordingId, categoryId) => {
    // Optimistic: a category tap should feel instant, and the rollback path
    // is simply reloading the truth.
    set((state) => ({
      recordings: state.recordings.map((r) =>
        r.recordingId === recordingId ? { ...r, categoryId } : r,
      ),
    }));
    try {
      await api.patchRecording(recordingId, { categoryId });
    } catch (err) {
      await get().loadRecordings();
      throw err;
    }
  },
}));

/**
 * Free the phone's local copy of any recording the backend has finished with.
 *
 * `ready` (transcribed) and `archived` (kept as no-speech) are the two states
 * that mean the audio, or its transcript, is safe server-side and playback
 * streams from the account — so the local file is pure cache and can go. Every
 * earlier state is left on disk on purpose: `pending`/`uploaded`/`processing`
 * may still need the local file to (re-)upload — including the grown-file
 * replacement path in the sync engine — and `failed` needs it to retry.
 *
 * pruneUploaded keeps each manifest entry (with its uploadedAt), which is what
 * stops a pruned file from being re-pulled off the pendant. Deleting an
 * already-pruned file is a no-op, so this is safe to run after every load.
 */
/**
 * Recordings the backend heard no speech in are dead weight everywhere: they
 * will never be read, and they are the bulk of what a worn pendant captures.
 * Once the server has marked one, its copies on the pendant and on the phone
 * are deleted without waiting to be asked.
 *
 * Only files belonging to the paired pendant are touched, and only ones the
 * server has already judged — the device is never asked to delete something
 * the account has not accounted for. The library keeps its manifest entry, so
 * a deleted file is never mistaken for one that was missed and pulled again.
 */
async function purgeStale(get: () => AppState): Promise<void> {
  const { paired, recordings, link, recordIntent } = get();
  if (!paired || !client || link !== 'connected') return;

  const stale = new Set(
    recordings
      .filter((r) => r.status === 'archived' && r.deviceMac === paired.mac)
      .map((r) => `${r.deviceFolder}/${r.deviceFile}`),
  );
  if (stale.size === 0) return;

  try {
    const result = await freeUpSpace(client, stale, {
      // Do not restart a recording the user explicitly switched off.
      passive: recordIntent === 'off',
    });
    if (result.deleted) {
      console.log(`[sync] cleared ${result.deleted} silent recording(s) from the pendant`);
      await get().refreshInfo().catch(() => undefined);
    }
  } catch {
    // The pendant may have gone out of range; the next pass tries again.
  }
}

async function pruneReadyLocal(recordings: Recording[]): Promise<void> {
  // 'archived' is the no-speech verdict: those local copies go too, and for
  // the same reason — the account holds whatever is worth holding.
  const readyIds = new Set(
    recordings
      .filter((r) => r.status === 'ready' || r.status === 'archived')
      .map((r) => r.recordingId),
  );
  if (readyIds.size === 0) return;
  await library.pruneUploaded(readyIds).catch(() => undefined);
}

/** In-flight flush, so foreground + interval + focus triggers never overlap. */
let flushing: Promise<void> | null = null;

/**
 * Retry uploads that a previous session left behind, with no BLE link needed.
 * Entries that failed recently are skipped until their backoff expires
 * (see library.pendingUploads); a user-driven sync pass bypasses that.
 */
export function flushUploads(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const { paired, autoSync } = useApp.getState();
    if (!paired || !autoSync) return;
    const result = await uploadPending(paired.mac);
    if (result.uploaded > 0) await useApp.getState().loadRecordings();
  })().finally(() => { flushing = null; });
  return flushing;
}
