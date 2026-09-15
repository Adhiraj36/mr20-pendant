/**
 * WiFi file transfer: the fast path for big recordings.
 *
 * The pendant hosts an access point; the phone joins it, opens a TCP socket to
 * 192.168.200.1:8475, asks for the file over BLE (W&dir&name), and the bytes
 * arrive on the socket — ending with a five-byte marker that is not part of
 * the file. BLE stays connected throughout: the AP closes itself the moment
 * the BLE link drops, and also after 30 s with no client.
 *
 * The cost is real: joining the pendant's AP takes the phone off its own
 * network, so nothing here touches the backend, and uploads run only after
 * the session is closed and normal connectivity returns. That is why the
 * engine reserves this path for files where BLE's ~35 kB/s actually hurts.
 *
 * Both native modules (react-native-wifi-reborn, react-native-tcp-socket) are
 * loaded lazily: a dev client built before they were added simply reports the
 * path unavailable and every transfer falls back to BLE.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import type { Mr20Client } from '../ble/client';
import { WIFI_SOCKET_HOST, WIFI_SOCKET_PORT, WIFI_END_MARKER, WIFI_STATES } from '../ble/protocol';

/**
 * WiFi transfer is off.
 *
 * The path is finished and the code below is not the problem: the ordering bug
 * that broke every transfer — opening the socket before sending W&, when the
 * pendant only starts listening in response to it — is fixed here, as is the
 * join, which was racing the access point's own startup. What is unresolved is
 * that a real device still would not complete a transfer, and chasing it costs
 * more than it currently returns: BLE moves a 3 MB recording in about ninety
 * seconds and never fails.
 *
 * Flip this to true to pick the work back up. Nothing else needs changing —
 * everything downstream already treats an unavailable WiFi path as normal and
 * falls through to BLE, which is exactly what made the breakage so quiet in
 * the first place.
 *
 * Worth doing first, when that day comes: run tools/wifistaprobe.py against the
 * device. If the firmware turns out to support joining a network of ours, the
 * QR-shared-credentials route is a better design than the access point, and
 * this file becomes the fallback rather than the main path.
 */
const WIFI_TRANSFER_ENABLED = false;

/** Files below this ride BLE; above it, the AP dance pays for itself. */
export const WIFI_MIN_BYTES = 3 * 1024 * 1024;

/** How long to wait for the pendant's TCP socket before giving up on it. */
const CONNECT_TIMEOUT_MS = 10_000;
/** How long a silent socket is tolerated once bytes could be flowing. */
const STALL_TIMEOUT_MS = 20_000;
/**
 * A breath after the join before trusting the interface.
 *
 * connectToProtectedSSID resolves when the association completes, which is a
 * moment before the route is usable — connecting too eagerly fails on an
 * interface that is about to work.
 */
const SETTLE_AFTER_JOIN_MS = 1_200;

/**
 * The whole join has to fit inside the window the access point gives itself.
 *
 * The AP closes after 30 s with no client, so waiting for the radio and then
 * joining are not independent budgets: spend too long on the first and the
 * second is racing a shutdown. These are sized to finish inside it with room
 * to spare, and the join gets whatever the wait did not use.
 */
const AP_WINDOW_MS = 28_000;
/** Never leave the join less than this, however slow the radio was. */
const MIN_JOIN_MS = 10_000;

/** How long to let the access point come up before giving up on it. */
const AP_READY_TIMEOUT_MS = 8_000;
const AP_POLL_MS = 600;
/** States that mean the radio is up and joinable: connected, or on with no client. */
const AP_READY = new Set(['1', '2']);
/** States that mean it is not coming up: off, and auto-closed. */
const AP_DEAD = new Set(['0', '7']);

/**
 * Wait for the pendant's radio, not just for it to accept the command.
 *
 * WIFIO is acknowledged the moment the device takes the instruction, which is
 * a second or more before the access point is actually broadcasting — the
 * state machine names that gap "starting". Joining in that window fails with
 * iOS reporting only "Unable to connect to <ssid>", because from its side the
 * network genuinely is not there yet.
 */
async function waitForAccessPoint(client: Mr20Client): Promise<string> {
  const deadline = Date.now() + AP_READY_TIMEOUT_MS;
  let last: string | undefined;

  while (Date.now() < deadline) {
    last = await client.wifiState().catch(() => undefined);
    if (last && AP_READY.has(last)) return WIFI_STATES[last] ?? last;
    if (last && AP_DEAD.has(last)) {
      throw new WifiSessionError(`the pendant's WiFi is ${WIFI_STATES[last] ?? last}`);
    }
    await new Promise((resolve) => setTimeout(resolve, AP_POLL_MS));
  }
  throw new WifiSessionError(
    `the pendant's WiFi never came up (last state: ${last ? WIFI_STATES[last] ?? last : 'no answer'})`,
  );
}

interface WifiModules {
  WifiManager: {
    connectToProtectedSSID(ssid: string, password: string, isWEP: boolean, isHidden: boolean): Promise<void>;
    disconnectFromSSID(ssid: string): Promise<void>;
  };
  TcpSocket: {
    createConnection(
      options: {
        host: string;
        port: number;
        interface?: 'wifi' | 'cellular' | 'ethernet';
        connectTimeout?: number;
      },
      onConnect: () => void,
    ): {
      on(event: 'data', cb: (data: Uint8Array | string) => void): void;
      on(event: 'error', cb: (err: Error) => void): void;
      on(event: 'close', cb: () => void): void;
      destroy(): void;
    };
  };
}

/** Lazily loaded, or null when the dev client predates the native modules. */
function loadModules(): WifiModules | null {
  try {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const wifi = require('react-native-wifi-reborn');
    const tcp = require('react-native-tcp-socket');
    /* eslint-enable */
    // The two packages disagree about their own shape: wifi-reborn hangs
    // everything off `default`, while tcp-socket exports createConnection and
    // friends at the top level and has no `default` at all. Reading `.default`
    // from both left TcpSocket undefined, which this function reported as
    // "no WiFi support in this build" — indistinguishable from the native
    // modules genuinely being absent, and true of every build regardless.
    const WifiManager = wifi?.default ?? wifi;
    const TcpSocket = tcp?.default ?? tcp;
    if (!WifiManager?.connectToProtectedSSID || !TcpSocket?.createConnection) return null;
    return { WifiManager, TcpSocket };
  } catch {
    return null;
  }
}

export function wifiTransferAvailable(): boolean {
  if (!WIFI_TRANSFER_ENABLED) return false;
  return loadModules() !== null;
}

/** Android gates WiFi joins behind location; iOS needs no runtime ask. */
async function ensurePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Fast transfers',
      message: 'Android requires location access to join the pendant’s WiFi for fast audio transfers.',
      buttonPositive: 'Allow',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export class WifiSessionError extends Error {}

/**
 * Why the pendant's socket might not answer once its WiFi has been joined.
 *
 * On iOS the likeliest cause is not the pendant at all: reaching an address on
 * the local network needs the user's consent, the prompt appears only on the
 * first attempt, and once refused every connection afterwards fails exactly
 * like a device that is not listening. There is no API to read that setting,
 * so the only honest thing is to name it.
 */
/** Whether the bytes received so far end in the transfer's end marker. */
function endsWithMarker(chunks: Uint8Array[], received: number): boolean {
  if (received < WIFI_END_MARKER.length) return false;
  // Walk backwards through the chunks rather than joining them: this runs on
  // every packet, and the tail is only five bytes.
  const tail = new Uint8Array(WIFI_END_MARKER.length);
  let need = WIFI_END_MARKER.length;
  for (let i = chunks.length - 1; i >= 0 && need > 0; i--) {
    const chunk = chunks[i];
    const take = Math.min(need, chunk.length);
    tail.set(chunk.subarray(chunk.length - take), need - take);
    need -= take;
  }
  return bytesEqual(tail, WIFI_END_MARKER);
}

function unreachableMessage(): string {
  const where = `${WIFI_SOCKET_HOST}:${WIFI_SOCKET_PORT}`;
  return Platform.OS === 'ios'
    ? `joined the pendant WiFi but nothing answered at ${where} — check Settings › Lyzn AI › Local Network is on`
    : `joined the pendant WiFi but nothing answered at ${where}`;
}

/**
 * One AP session: joined once, pulls many files, then leaves cleanly.
 * Construct via WifiSession.open; always close() in a finally.
 */
export class WifiSession {
  private constructor(
    private readonly client: Mr20Client,
    private readonly modules: WifiModules,
    private readonly ssid: string,
  ) {}

  static async open(client: Mr20Client): Promise<WifiSession> {
    const modules = loadModules();
    if (!modules) throw new WifiSessionError('this build has no WiFi transfer support');
    if (!(await ensurePermission())) throw new WifiSessionError('location permission was declined');

    if (!(await client.wifiOpen())) {
      throw new WifiSessionError('the pendant did not confirm its WiFi is on');
    }
    const windowOpened = Date.now();
    let apState: string;
    try {
      apState = await waitForAccessPoint(client);
    } catch (err) {
      await client.wifiClose();
      throw err;
    }
    const creds = await client.wifiCredentials();
    if (!creds) {
      await client.wifiClose();
      throw new WifiSessionError('the pendant did not share its WiFi credentials');
    }

    try {
      const remaining = AP_WINDOW_MS - (Date.now() - windowOpened);
      await withTimeout(
        modules.WifiManager.connectToProtectedSSID(creds.ssid, creds.password, false, false),
        Math.max(MIN_JOIN_MS, remaining),
        'joining the pendant WiFi timed out',
      );
    } catch (err) {
      await client.wifiClose();
      // The AP state is in the message on purpose: iOS reports only "Unable
      // to connect to <ssid>" whether the network was absent, the passphrase
      // was wrong, or the app was in the background. Knowing the radio was up
      // and joinable at the moment we asked rules out the first of those.
      throw err instanceof WifiSessionError
        ? err
        : new WifiSessionError(
            `could not join the pendant WiFi (${creds.ssid}, radio ${apState}): ${(err as Error).message}`,
          );
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_AFTER_JOIN_MS));
    return new WifiSession(client, modules, creds.ssid);
  }

  /**
   * Pull one file over the socket. Returns the file bytes, end marker
   * stripped and length verified against what the device declared.
   */
  async pull(
    folder: string,
    name: string,
    options: { signal?: AbortSignal; onProgress?: (received: number, expected: number) => void } = {},
  ): Promise<Uint8Array> {
    const { TcpSocket } = this.modules;

    // Ask first, connect second.
    //
    // This is the order the pendant actually wants, and getting it backwards
    // is silent: the device opens its listener in response to W&, so a socket
    // opened before the request knocks on a port that is not there yet and
    // waits out the timeout. The vendor's own tooling requests the file, reads
    // the size off the BLE reply, and only then connects — which is also why
    // the size is known here before a byte arrives, rather than turning up
    // mid-stream.
    const declared = await this.client.requestWifiFile(folder, name);
    if (declared === null) {
      throw new WifiSessionError(`the device could not open ${folder}/${name}`);
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      const expected = declared;
      let received = 0;
      let settled = false;
      let connected = false;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;

      const socket = TcpSocket.createConnection(
        {
          host: WIFI_SOCKET_HOST,
          port: WIFI_SOCKET_PORT,
          // Android will happily open this socket over cellular, where
          // 192.168.200.1 is nobody, and then wait for a reply that cannot
          // come. Pinning it to WiFi is the fix; iOS ignores the option and
          // routes by the directly-connected subnet instead.
          interface: 'wifi',
          // Without this the connect blocks indefinitely, so a pendant that
          // never brought its socket up looked identical to a transfer that
          // started and stopped.
          connectTimeout: CONNECT_TIMEOUT_MS,
        },
        () => {
          connected = true;
        },
      );

      const cleanup = () => {
        if (stallTimer) clearTimeout(stallTimer);
        try { socket.destroy(); } catch { /* already gone */ }
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        // Tell the device to stop pushing, or it keeps the socket hostage.
        this.client.abortTransfer().catch(() => undefined);
        reject(err);
      };
      const bumpStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(
          () =>
            fail(
              new WifiSessionError(
                connected
                  ? `transfer stalled at ${received} of ${expected || 'unknown'} bytes`
                  : unreachableMessage(),
              ),
            ),
          STALL_TIMEOUT_MS,
        );
      };
      bumpStall();

      socket.on('error', (err) => fail(new WifiSessionError(`wifi socket: ${err.message}`)));
      socket.on('close', () => {
        if (!settled) fail(new WifiSessionError('the wifi socket closed mid-transfer'));
      });

      socket.on('data', (data) => {
        if (settled) return;
        if (options.signal?.aborted) {
          fail(new WifiSessionError('transfer cancelled'));
          return;
        }
        const chunk = typeof data === 'string' ? utf8Bytes(data) : new Uint8Array(data);
        chunks.push(chunk);
        received += chunk.length;
        bumpStall();
        if (expected) options.onProgress?.(Math.min(received, expected), expected);

        // Done when the declared length plus the five-byte end marker has
        // arrived — or as soon as the stream ends with that marker, which is
        // how the vendor's own tooling decides and covers a device whose
        // declared size is a few bytes out. The marker is verified either way:
        // a short stream that happens to stop must not pass for a whole file.
        const enough = received >= expected + WIFI_END_MARKER.length;
        if (enough || endsWithMarker(chunks, received)) {
          const all = concat(chunks, received);
          const tail = all.slice(all.length - WIFI_END_MARKER.length);
          if (!bytesEqual(tail, WIFI_END_MARKER)) {
            fail(new WifiSessionError('the transfer ended without its end marker'));
            return;
          }
          const file = all.slice(0, all.length - WIFI_END_MARKER.length);
          if (file.length !== expected) {
            fail(new WifiSessionError(`expected ${expected} bytes, received ${file.length}`));
            return;
          }
          settled = true;
          cleanup();
          resolve(file);
        }
      });
    });
  }

  /** Leave the AP and switch it off. Safe to call twice. */
  async close(): Promise<void> {
    await this.client.wifiClose();
    await this.modules.WifiManager.disconnectFromSSID(this.ssid).catch(() => undefined);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WifiSessionError(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Binary-safe only for latin1-shaped strings the socket may hand back. */
function utf8Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
