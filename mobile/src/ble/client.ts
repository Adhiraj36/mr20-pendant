/**
 * MR20 pendant BLE client.
 *
 * A TypeScript port of mr20.py, which was worked out against real hardware.
 * The transport is react-native-ble-plx; everything protocol-shaped lives in
 * protocol.ts.
 */
// Types only, and deliberately so: these are erased at compile time, which is
// what lets this module be unit-tested outside React Native. Importing any
// runtime value from react-native or react-native-ble-plx here pulls their
// Flow-typed entry points into the test runner, where they fail to parse
// before a single test runs. Anything needed at runtime is required lazily.
import type { Device, Subscription, Characteristic, BleError } from 'react-native-ble-plx';
import {
  AUDIO_UUID, CMD_UUID, WRITE_UUID, SVC_UUID, DIALECTS,
  classify, DangerousCommandError,
  decodeBase64, encodeBase64, utf8ToBytes, decodeMessage,
  field, parseFileEntry, isSyncable,
  type DeviceInfo, type DeviceFile,
} from './protocol';

export interface ClientOptions {
  /**
   * Called for every reply, including unsolicited ones.
   *
   * The pendant announces state it changed on its own — pressing its physical
   * button emits DEV&STA&<file> or DEV&STO with no request behind it. Without
   * this the app's idea of whether it is recording goes stale.
   */
  onEvent?: (message: string) => void;
  /** Called for each chunk on the audio/bulk channel. */
  onAudio?: (chunk: Uint8Array) => void;
  /** Progress during a file pull: bytes received of bytes expected. */
  onProgress?: (received: number, expected: number) => void;
  /** Protocol tracing, off by default because a sync is thousands of lines. */
  verbose?: boolean;
}

/** This firmware ignores commands that arrive too close together. */
const COMMAND_GAP_MS = 120;

export class Mr20Error extends Error {}
export class TimeoutError extends Mr20Error {}

/** A message waiting to be claimed, or a claimant waiting for a message. */
type Waiter = { match: (msg: string) => boolean; resolve: (msg: string) => void };

/**
 * How often a transfer in flight is checked for completion. Short enough that
 * finishing is noticed promptly, long enough not to spin: the bytes arrive on
 * notifications either way, so this only paces the checking.
 */
const TRANSFER_POLL_MS = 150;

export class Mr20Client {
  private cmdPrefix = DIALECTS[0][0];
  private replyPrefix = DIALECTS[0][1];
  private writeWithResponse = true;

  private subscriptions: Subscription[] = [];
  private pending: string[] = [];
  private waiters: Waiter[] = [];

  /** When non-null, audio-channel notifications accumulate here. */
  private bulk: Uint8Array[] | null = null;
  private bulkBytes = 0;

  constructor(
    private device: Device,
    private options: ClientOptions = {},
  ) {}

  get id(): string {
    return this.device.id;
  }

  get name(): string {
    return this.device.name ?? this.device.localName ?? 'pendant';
  }

  /** Attach or replace the unsolicited-event handler. */
  setEventHandler(handler: (message: string) => void): void {
    this.options.onEvent = handler;
  }

  private log(...args: unknown[]) {
    if (this.options.verbose) console.log('[mr20]', ...args);
  }

  // -- connection ----------------------------------------------------------

  /** Discover characteristics, subscribe to both notify channels, find the dialect. */
  async open(): Promise<void> {
    await this.device.discoverAllServicesAndCharacteristics();

    // Android defaults to a 23-byte MTU, which would cap transfers at a crawl.
    // iOS negotiates on its own and rejects the call.
    try {
      await this.device.requestMTU(517);
    } catch {
      this.log('MTU request declined; the platform is negotiating it');
    }

    for (const service of await this.device.services()) {
      for (const char of await service.characteristics()) {
        if (char.uuid.toLowerCase() === WRITE_UUID) {
          this.writeWithResponse = char.isWritableWithResponse;
        }
      }
    }

    // Both notify characteristics live on the one vendor service.
    this.subscriptions.push(
      this.device.monitorCharacteristicForService(SVC_UUID, CMD_UUID, this.onCmdNotification),
      this.device.monitorCharacteristicForService(SVC_UUID, AUDIO_UUID, this.onAudioNotification),
    );

    await this.detectDialect();
  }

  async close(): Promise<void> {
    for (const sub of this.subscriptions) {
      try { sub.remove(); } catch { /* already gone */ }
    }
    this.subscriptions = [];
    this.waiters = [];
    this.pending = [];
    this.bulk = null;
  }

  private onCmdNotification = (error: BleError | null, char: Characteristic | null) => {
    if (error || !char?.value) return;
    const msg = decodeMessage(decodeBase64(char.value));
    if (!msg) return;
    this.log('<-', msg);

    this.options.onEvent?.(msg);

    // Hand it to the first waiter that wants it; otherwise hold it, because
    // replies routinely arrive before the caller starts waiting.
    const index = this.waiters.findIndex((w) => w.match(msg));
    if (index !== -1) {
      const [waiter] = this.waiters.splice(index, 1);
      waiter.resolve(msg);
    } else {
      this.pending.push(msg);
      // A sync produces thousands of messages; do not grow without bound.
      if (this.pending.length > 500) this.pending.splice(0, 250);
    }
  };

  private onAudioNotification = (error: BleError | null, char: Characteristic | null) => {
    if (error || !char?.value) return;
    const chunk = decodeBase64(char.value);
    if (this.bulk) {
      this.bulk.push(chunk);
      this.bulkBytes += chunk.length;
    }
    this.options.onAudio?.(chunk);
  };

  // -- protocol primitives -------------------------------------------------

  /** Reply prefix for a verb: 'FW' -> 'DEV&FW'. */
  private tag(verb: string): string {
    return `${this.replyPrefix}${verb}`;
  }

  /** Wait for a message matching a predicate, consuming anything already held. */
  private waitFor(match: (msg: string) => boolean, timeoutMs: number): Promise<string> {
    const index = this.pending.findIndex(match);
    if (index !== -1) return Promise.resolve(this.pending.splice(index, 1)[0]);

    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new TimeoutError('no matching reply from the pendant'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /**
   * Ask for a low-latency link while bulk data is moving.
   *
   * Throughput here is set by the connection interval, not the MTU — the MTU
   * is already 517 and the device sends one notification per interval, which
   * at Android's balanced ~50 ms is about the 35 kB/s we see. High priority
   * asks for ~11–15 ms instead, and the same one-packet-per-interval becomes
   * several times the bytes.
   *
   * Android only: iOS gives no say over connection parameters, so there the
   * peripheral's own preferences decide and this is a no-op. It costs battery
   * on both sides, so it is raised for a transfer and dropped afterwards.
   */
  async setFastLink(fast: boolean): Promise<void> {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { Platform } = require('react-native') as { Platform: { OS: string } };
    const { ConnectionPriority } = require('react-native-ble-plx') as {
      ConnectionPriority: { High: number; Balanced: number };
    };
    /* eslint-enable */
    if (Platform.OS !== 'android') return;
    try {
      await this.device.requestConnectionPriority(
        fast ? ConnectionPriority.High : ConnectionPriority.Balanced,
      );
    } catch {
      // Refused by the stack or the peripheral: the transfer still works, it
      // is simply no faster than it was.
      this.log('connection priority request declined');
    }
  }

  /** Write one command. Dangerous verbs are refused before they reach the wire. */
  async send(verb: string): Promise<void> {
    const reason = classify(verb);
    if (reason) throw new DangerousCommandError(verb, reason);
    await this.writeRaw(verb);
  }

  private async writeRaw(verb: string): Promise<void> {
    const command = `${this.cmdPrefix}${verb}`;
    this.log('->', command);
    const payload = encodeBase64(utf8ToBytes(command));
    if (this.writeWithResponse) {
      await this.device.writeCharacteristicWithResponseForService(SVC_UUID, WRITE_UUID, payload);
    } else {
      await this.device.writeCharacteristicWithoutResponseForService(SVC_UUID, WRITE_UUID, payload);
    }
  }

  /** Wait for the first reply matching any of these verbs. Others are skipped. */
  async expect(verbs: string[], timeoutMs = 6000): Promise<string> {
    const tags = verbs.map((v) => this.tag(v));
    return this.waitFor((msg) => tags.some((t) => msg.startsWith(t)), timeoutMs);
  }

  /**
   * Drop held messages matching these tags.
   *
   * A reply that arrived after its request timed out stays in `pending`, and
   * `waitFor` hands back a held message immediately — so the next request for
   * the same verb would be answered instantly with the *previous* state. That
   * is how a recording toggle ends up one step behind the device. A file pull
   * makes it routine: its end-marker wait times out once a second and every
   * unrelated reply piles up behind it.
   */
  private dropStale(tags: string[]): void {
    if (!this.pending.length) return;
    const kept = this.pending.filter((m) => !tags.some((t) => m.startsWith(t)));
    if (kept.length !== this.pending.length) {
      this.log(`discarded ${this.pending.length - kept.length} stale reply(s)`);
    }
    this.pending = kept;
  }

  /** Send, then wait for the reply. Returns null on timeout rather than throwing. */
  async ask(verb: string, replyVerbs?: string[], timeoutMs = 6000): Promise<string | null> {
    const tags = (replyVerbs ?? [verb]).map((v) => this.tag(v));
    // Answer this request with a reply to this request, not a stale one.
    this.dropStale(tags);
    await this.send(verb);
    try {
      return await this.expect(replyVerbs ?? [verb], timeoutMs);
    } catch (err) {
      if (err instanceof TimeoutError) return null;
      throw err;
    }
  }

  /** Gather repeated items until the terminating message arrives. */
  async collect(itemVerb: string, endVerb: string, timeoutMs = 30000): Promise<string[]> {
    const itemTag = this.tag(itemVerb);
    const endTag = this.tag(endVerb);
    const items: string[] = [];
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      let msg: string;
      try {
        // endTag is checked first: DIRS_SUM also starts with DIRS.
        msg = await this.waitFor((m) => m.startsWith(endTag) || m.startsWith(itemTag), left);
      } catch {
        break;
      }
      if (msg.startsWith(endTag)) break;
      items.push(msg);
    }
    return items;
  }

  /** Work out whether this build wants BLE&/DEV& or XS_BLE&/XS_DEV&. */
  private async detectDialect(): Promise<void> {
    for (const [cmdPrefix, replyPrefix] of DIALECTS) {
      this.pending = [];
      this.cmdPrefix = cmdPrefix;
      this.replyPrefix = replyPrefix;
      try {
        await this.writeRaw('FW');
        const reply = await this.waitFor((m) => m.startsWith(replyPrefix), 3000);
        if (reply.startsWith(`${replyPrefix}FW`)) {
          this.log(`dialect ${cmdPrefix}... / ${replyPrefix}...  firmware ${field(reply, 2)}`);
          return;
        }
      } catch {
        // Try the next dialect.
      }
    }
    // Fall back to the shipped-firmware form, which is what real units use.
    [this.cmdPrefix, this.replyPrefix] = DIALECTS[0];
    this.log('could not confirm the dialect; assuming', this.cmdPrefix);
  }

  // -- device queries ------------------------------------------------------

  /**
   * Read the device's telemetry.
   *
   * The commands are spaced out deliberately. This firmware drops requests that
   * arrive back to back — the same behaviour that forced a two second gap
   * between file transfers — and a dropped reply here is worse than a slow
   * read, because a missing STE answer used to be reported as "not recording".
   */
  async info(): Promise<DeviceInfo> {
    const step = async <T>(fn: () => Promise<T>): Promise<T> => {
      const value = await fn();
      await delay(COMMAND_GAP_MS);
      return value;
    };

    const fw = await step(() => this.ask('FW'));
    const wf = await step(() => this.ask('WF'));
    const mac = await step(() => this.ask('MAC'));
    const bat = await step(() => this.ask('BAT'));
    const spa = await step(() => this.ask('SPACE', ['SPA']));
    const ste = await step(() => this.ask('STE', ['STE'], 8000));
    const gt = await step(() => this.ask('GT', ['CT']));
    const wifis = await step(() => this.ask('WIFIS'));
    const usb = await step(() => this.ask('GET&USB', ['USB']));
    const mode = await this.ask('REC&SECEN', ['REC']);

    const num = (v: string | undefined) => (v === undefined ? undefined : Number(v) || 0);

    return {
      firmware: field(fw, 2),
      wifiFirmware: field(wf, 2),
      mac: field(mac, 2)?.toLowerCase(),
      batteryPercent: num(field(bat, 2)),
      freeMb: num(field(spa, 2)),
      totalMb: num(field(spa, 3)),
      // Unknown, not false, when the device did not answer.
      recording: ste === null ? undefined : field(ste, 2) === '1',
      deviceTime: field(gt, 2),
      wifiState: field(wifis, 2),
      usbFileMode: field(usb, 2),
      recordMode: field(mode, 2),
    };
  }

  /**
   * Whether the device is recording right now.
   *
   * Throws rather than guessing if it does not answer: callers use this to
   * decide whether to start or stop, and a wrong guess does the opposite of
   * what the user asked.
   */
  async isRecording(): Promise<boolean> {
    const reply = await this.ask('STE', ['STE'], 10000);
    if (reply === null) throw new Mr20Error('the pendant did not report its recording state');
    return field(reply, 2) === '1';
  }

  async batteryPercent(): Promise<number | undefined> {
    const v = field(await this.ask('BAT'), 2);
    return v === undefined ? undefined : Number(v) || 0;
  }

  /**
   * Start recording. Returns the filename the device chose, or undefined if it
   * never confirmed — in which case the caller must not assume it worked.
   */
  async startRecording(): Promise<string | undefined> {
    const reply = await this.ask('STA', ['STA'], 15000);
    // DEV&STA&<file> is the confirmation. No reply means no recording.
    return reply ? field(reply, 2) : undefined;
  }

  /** Stop and save. Returns whether the device confirmed with DEV&STO. */
  async stopRecording(): Promise<boolean> {
    return (await this.ask('STO', ['STO'], 15000)) !== null;
  }

  /** Buzz the haptic motor. The device sends no reply. */
  async shake(): Promise<void> {
    await this.send('SHAKE');
  }

  /**
   * Set the device clock, which is what names every recording. Worth doing on
   * every connect: the pendant has no RTC battery and drifts.
   */
  async setClock(when: Date = new Date()): Promise<void> {
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}` +
      `${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`;
    await this.ask(`T&${stamp}`, ['T'], 8000);
  }

  async listFolders(): Promise<string[]> {
    await this.send('LIST_DIRS');
    const items = await this.collect('DIRS&', 'DIRS_SUM', 25000);
    return items.map((m) => field(m, 2)).filter((d): d is string => !!d);
  }

  async listFiles(folder: string): Promise<DeviceFile[]> {
    await this.send(`LIST&${folder}`);
    const items = await this.collect('F&', 'LIST&', 40000);
    return items
      .map(parseFileEntry)
      .filter((f): f is DeviceFile => f !== null)
      .filter(isSyncable);
  }

  /** Every recording on the device, across all date folders. */
  async listAllFiles(): Promise<DeviceFile[]> {
    const files: DeviceFile[] = [];
    for (const folder of await this.listFolders()) {
      files.push(...(await this.listFiles(folder)));
    }
    return files;
  }

  /**
   * Delete one recording from the device's storage.
   *
   * D& sits on the DANGEROUS blocklist so nothing sends it casually; this is
   * the one deliberate path, meant only for files the backend has already
   * confirmed it holds. It bypasses the gate via writeRaw — the gate guards
   * ad-hoc sends, not this audited call.
   *
   * The reply is a bare DEV&D, and the matcher is exact because DEV&DIRS
   * shares the prefix: a startsWith would confuse a stale folder listing for
   * a confirmation.
   */
  async deleteFile(folder: string, name: string): Promise<boolean> {
    const tag = this.tag('D');
    await this.writeRaw(`D&${folder}&${name}`);
    try {
      await this.waitFor((m) => m === tag || m.startsWith(`${tag}&`), 8000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format the pendant's storage, erasing every recording on it, and clear
   * its pairing key.
   *
   * BLE&RESET sits on the DANGEROUS blocklist — one character from BLE&OFF —
   * so nothing sends it casually; this audited path exists only for the
   * device screen's danger zone, behind its double confirmation. The device
   * drops the link as part of the reset, so no reply is awaited: the
   * disconnect IS the acknowledgement.
   */
  async factoryReset(): Promise<void> {
    await this.writeRaw('BLE&RESET');
  }

  // -- wifi transfer control -------------------------------------------------

  /** Start the pendant's access point. Resolves once the device confirms. */
  async wifiOpen(): Promise<boolean> {
    const reply = await this.ask('WIFIO', ['WIFIO'], 10000);
    return reply !== null;
  }

  /** Stop the access point. Best effort — it also times itself out. */
  async wifiClose(): Promise<void> {
    await this.ask('WIFIC', ['WIFIC'], 5000).catch(() => undefined);
  }

  /**
   * The access point's own state, per WIFI_STATES.
   *
   * WIFIO is acknowledged when the device accepts the command, not when the
   * radio is up — the state machine has a distinct "starting" for the gap.
   */
  async wifiState(): Promise<string | undefined> {
    const reply = await this.ask('WIFIS');
    return field(reply, 2);
  }

  /** The AP's credentials, so the phone can join it. */
  async wifiCredentials(): Promise<{ ssid: string; password: string } | null> {
    const reply = await this.ask('WIFI', ['WIFI&'], 8000);
    if (!reply) return null;
    const ssid = field(reply, 2);
    const password = field(reply, 3);
    if (!ssid || !password) return null;
    return { ssid, password };
  }

  /**
   * Ask for a file over the WiFi socket instead of BLE.
   *
   * `have` is how many bytes the phone already holds — the device resumes from
   * there (instruction 2 in the vendor sheet). Returns the total file size the
   * device declared, or null if it could not open the file. The bytes arrive
   * on the TCP socket, not here.
   */
  async requestWifiFile(folder: string, name: string, have = 0): Promise<number | null> {
    const verb = have > 0 ? `W&${folder}&${name}&${have}` : `W&${folder}&${name}`;
    const reply = await this.ask(verb, ['W&'], 15000);
    if (!reply || reply.includes('ERR')) return null;
    const total = Number(field(reply, 2)) || 0;
    return total > 0 ? total : null;
  }

  /** Abort an in-flight transfer (BLE or WiFi alike). */
  async abortTransfer(): Promise<void> {
    await this.ask('SHUT', ['SHUT'], 3000).catch(() => undefined);
  }

  // -- file transfer -------------------------------------------------------

  /**
   * Pull one recording over BLE. Roughly 35 kB/s, so a 2.5 MB file is about a
   * minute.
   *
   * The caller must have stopped any in-progress recording first: file data and
   * the live stream share one notify channel, and downloading while recording
   * interleaves the two into a file that is longer than declared and contains
   * audio that was never part of the recording.
   */
  async pullFile(
    folder: string,
    name: string,
    options: {
      timeoutMs?: number;
      signal?: AbortSignal;
      /**
       * Per-transfer progress, which is what a caller pulling a queue of files
       * needs: the client-level handler cannot say which file it is reporting.
       */
      onProgress?: (received: number, expected: number) => void;
    } = {},
  ): Promise<Uint8Array> {
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    const report = options.onProgress ?? this.options.onProgress;

    this.bulk = [];
    this.bulkBytes = 0;
    try {
      await this.send(`U&${folder}&${name}`);
      const head = await this.expect(['U&'], 15000);
      if (head.includes('ERR')) {
        throw new Mr20Error(`the device could not open ${folder}/${name}`);
      }
      const expected = Number(field(head, 2)) || 0;
      if (!expected) throw new Mr20Error('the device declared a zero-length file');

      const deadline = Date.now() + timeoutMs;
      let lastBytes = -1;
      let lastProgressAt = Date.now();

      while (Date.now() < deadline) {
        if (options.signal?.aborted) throw new Mr20Error('transfer cancelled');
        if (this.bulkBytes >= expected) break;

        // DEV&OFF marks the end of a transfer that finished short. The wait
        // doubles as this loop's clock, so it is short on purpose: at a second
        // apart the completion check above ran once a second too, and every
        // file ended with up to a second of waiting after its last byte had
        // already arrived. Across a pass of eight recordings that was most of
        // a minute spent doing nothing.
        try {
          await this.waitFor((m) => m.startsWith(this.tag('OFF')), TRANSFER_POLL_MS);
          break;
        } catch {
          // No end marker yet; that is the normal case mid-transfer.
        }

        if (this.bulkBytes !== lastBytes) {
          lastBytes = this.bulkBytes;
          lastProgressAt = Date.now();
          report?.(this.bulkBytes, expected);
        } else if (Date.now() - lastProgressAt > 20000) {
          throw new Mr20Error(
            `transfer stalled at ${this.bulkBytes} of ${expected} bytes`,
          );
        }
      }

      let data = concat(this.bulk, this.bulkBytes);
      if (data.length < expected) {
        throw new Mr20Error(`incomplete transfer: ${data.length} of ${expected} bytes`);
      }
      if (data.length > expected) {
        // Anything past the declared length is another stream bleeding in.
        this.log(`trimming ${data.length - expected} stray bytes`);
        data = data.subarray(0, expected);
      }
      report?.(expected, expected);
      return data;
    } finally {
      this.bulk = null;
      this.bulkBytes = 0;
    }
  }

  /**
   * Stop an in-progress recording so downloads arrive clean.
   * Returns true if it was recording and should be restarted afterwards.
   */
  async pauseRecording(): Promise<boolean> {
    if (!(await this.isRecording())) return false;
    if (!(await this.stopRecording())) {
      // Unconfirmed stop: transfers would interleave with the live stream and
      // silently corrupt every file. Better to skip this pass.
      throw new Mr20Error('the pendant did not confirm it stopped recording');
    }
    await delay(1000);
    return true;
  }

  // -- live capture --------------------------------------------------------

  /** Route the audio channel to a callback. The device streams only while recording. */
  startLiveCapture(onAudio: (chunk: Uint8Array) => void): () => void {
    const previous = this.options.onAudio;
    this.options.onAudio = onAudio;
    return () => { this.options.onAudio = previous; };
  }
}

// -- helpers ---------------------------------------------------------------

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Join accumulated chunks in one pass rather than reallocating per notification. */
function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
