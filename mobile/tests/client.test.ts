/**
 * Request/reply behaviour of the BLE client, against a fake peripheral.
 *
 * These exist because of a real bug: a reply that arrived after its request had
 * timed out stayed in the pending queue, and the next request for the same verb
 * was answered instantly with that stale message. On screen it looked like the
 * recording toggle was inverted — the label always described the previous state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mr20Client } from '../src/ble/client';
import { encodeBase64, utf8ToBytes } from '../src/ble/protocol';

type Listener = (error: unknown, characteristic: { value: string } | null) => void;

/** Minimal stand-in for a react-native-ble-plx Device. */
class FakeDevice {
  id = 'fake-pendant';
  name = 'YLF20_d830';
  localName = 'YLF20_d830';

  written: string[] = [];
  /** Wall-clock time of each write, for asserting the pacing between commands. */
  writeTimes: number[] = [];
  private listeners = new Map<string, Listener>();

  async discoverAllServicesAndCharacteristics() { return this; }
  async requestMTU() { return this; }
  async services() {
    return [{
      characteristics: async () => [
        { uuid: '001120a2-2233-4455-6677-88995a5b5c5d', isWritableWithResponse: true },
      ],
    }];
  }

  monitorCharacteristicForService(_svc: string, char: string, listener: Listener) {
    this.listeners.set(char, listener);
    return { remove: () => this.listeners.delete(char) };
  }

  async writeCharacteristicWithResponseForService(_s: string, _c: string, valueBase64: string) {
    // Decode what the client actually put on the wire.
    const bytes = Buffer.from(valueBase64, 'base64').toString('utf8');
    this.written.push(bytes);
    this.writeTimes.push(Date.now());
    return this;
  }
  async writeCharacteristicWithoutResponseForService(s: string, c: string, v: string) {
    return this.writeCharacteristicWithResponseForService(s, c, v);
  }

  /** Push a reply up the command notify channel. */
  reply(message: string) {
    const listener = this.listeners.get('001120a3-2233-4455-6677-88995a5b5c5d');
    listener?.(null, { value: encodeBase64(utf8ToBytes(message)) });
  }
}

/** Build a client whose dialect probe is already satisfied. */
async function connected() {
  const device = new FakeDevice();
  const client = new Mr20Client(device as never);

  const opening = client.open();
  // open() probes with BLE&FW and waits for DEV&FW.
  await new Promise((r) => setTimeout(r, 10));
  device.reply('DEV&FW&V1.2');
  await opening;

  device.written.length = 0;
  device.writeTimes.length = 0;
  return { device, client };
}

test('a reply that arrives after its request timed out never answers the next one', async () => {
  const { device, client } = await connected();

  // First poll: the device is recording, but the reply is late.
  const first = client.ask('STE', ['STE'], 60);
  assert.equal(await first, null, 'the slow request should time out');

  // The stale answer lands now, describing the OLD state.
  device.reply('DEV&STE&1');
  await new Promise((r) => setTimeout(r, 5));

  // The user stops the recording. The next poll must reflect that, not the
  // stale DEV&STE&1 still sitting in the queue.
  const second = client.ask('STE', ['STE'], 200);
  await new Promise((r) => setTimeout(r, 10));
  device.reply('DEV&STE&0');

  assert.equal(await second, 'DEV&STE&0', 'must use the fresh reply, not the stale one');
});

test('isRecording reports the device state after a stale reply', async () => {
  const { device, client } = await connected();

  const timedOut = client.ask('STE', ['STE'], 60);
  await timedOut;
  device.reply('DEV&STE&1'); // stale: says recording
  await new Promise((r) => setTimeout(r, 5));

  const check = client.isRecording();
  await new Promise((r) => setTimeout(r, 10));
  device.reply('DEV&STE&0'); // fresh: says stopped

  assert.equal(await check, false, 'isRecording must not report the stale state');
});

test('startRecording returns the filename the device confirmed', async () => {
  const { device, client } = await connected();

  const started = client.startRecording();
  await new Promise((r) => setTimeout(r, 10));
  device.reply('DEV&STA&2026-08-19 18-34-09');

  assert.equal(await started, '2026-08-19 18-34-09');
});

test('startRecording reports failure when the device never confirms', async () => {
  const { client } = await connected();
  // No reply at all. The caller must not assume the pendant is recording.
  assert.equal(await client.startRecording(), undefined);
});

test('stopRecording distinguishes confirmed from unanswered', async () => {
  const { device, client } = await connected();

  const stopping = client.stopRecording();
  await new Promise((r) => setTimeout(r, 10));
  device.reply('DEV&STO');
  assert.equal(await stopping, true);

  assert.equal(await client.stopRecording(), false, 'no reply means not confirmed');
});

test('pauseRecording refuses to continue if the stop was not confirmed', async () => {
  const { device, client } = await connected();

  const paused = client.pauseRecording();
  await new Promise((r) => setTimeout(r, 10));
  device.reply('DEV&STE&1');   // yes, recording
  // ...and then never confirms the stop.

  // Downloading while it is still recording interleaves the live stream into
  // every file, so this must throw rather than proceed.
  await assert.rejects(paused, /did not confirm it stopped/);
});

test('a dropped STE reply reports unknown, never "not recording"', async () => {
  const { device, client } = await connected();

  // Answer everything info() asks for EXCEPT the recording state, which is
  // what happens when the device drops a request that arrived too quickly.
  const replies: Record<string, string> = {
    'BLE&FW': 'DEV&FW&V1.2',
    'BLE&WF': 'DEV&WF&V0001',
    'BLE&MAC': 'DEV&MAC&50c0f013d830',
    'BLE&BAT': 'DEV&BAT&98',
    'BLE&SPACE': 'DEV&SPA&007655&007661',
    'BLE&GT': 'DEV&CT&20260820103000',
    'BLE&WIFIS': 'DEV&WIFIS&0',
    'BLE&GET&USB': 'DEV&USB&1',
    'BLE&REC&SECEN': 'DEV&REC&CALL',
  };

  const seen = new Set<number>();
  const pump = setInterval(() => {
    device.written.forEach((cmd, i) => {
      if (seen.has(i)) return;
      seen.add(i);
      const reply = replies[cmd];
      if (reply) setTimeout(() => device.reply(reply), 2);
    });
  }, 3);

  const info = await client.info();
  clearInterval(pump);

  // Reporting false here is what silently switched the recording toggle off
  // while the pendant was still recording.
  assert.equal(info.recording, undefined, 'an unanswered STE must be unknown, not false');
  assert.equal(info.batteryPercent, 98, 'the answered fields still come through');
});

test('info() spaces its commands out instead of firing them back to back', async () => {
  const { device, client } = await connected();

  // Answer immediately, so the only thing separating writes is the deliberate
  // pacing rather than a reply timeout.
  const replies: Record<string, string> = {
    'BLE&FW': 'DEV&FW&V1.2', 'BLE&WF': 'DEV&WF&V0001',
    'BLE&MAC': 'DEV&MAC&50c0f013d830', 'BLE&BAT': 'DEV&BAT&98',
    'BLE&SPACE': 'DEV&SPA&007655&007661', 'BLE&STE': 'DEV&STE&1',
    'BLE&GT': 'DEV&CT&20260820103000', 'BLE&WIFIS': 'DEV&WIFIS&0',
    'BLE&GET&USB': 'DEV&USB&1', 'BLE&REC&SECEN': 'DEV&REC&CALL',
  };
  const seen = new Set<number>();
  const pump = setInterval(() => {
    device.written.forEach((cmd, i) => {
      if (seen.has(i)) return;
      seen.add(i);
      const reply = replies[cmd];
      if (reply) setTimeout(() => device.reply(reply), 1);
    });
  }, 2);

  await client.info();
  clearInterval(pump);

  assert.equal(device.written.length, 10, 'all ten reads are issued');

  // This firmware ignores commands that arrive together — the same behaviour
  // that forced a gap between file transfers.
  const gaps = device.writeTimes.slice(1).map((t, i) => t - device.writeTimes[i]);
  const tooTight = gaps.filter((g) => g < 50);
  assert.equal(
    tooTight.length, 0,
    `every command needs breathing room; ${tooTight.length} arrived back to back (${gaps.join(',')}ms)`,
  );
});

test('isRecording refuses to guess when the device does not answer', async () => {
  const { client } = await connected();
  // Returning false here would make the toggle start a recording that is
  // already running, which is exactly the inverted behaviour users saw.
  await assert.rejects(client.isRecording(), /did not report its recording state/);
});

test('dangerous commands never reach the wire', async () => {
  const { device, client } = await connected();

  await assert.rejects(client.send('BLE&RESET'), /formats the device/);
  await assert.rejects(client.send('D&2026-08-19&file'), /deletes/);
  await assert.rejects(client.send('STATUS'), /stops an in-progress recording/);

  assert.deepEqual(device.written, [], 'nothing should have been written');
});

test('safe commands are written with the detected dialect prefix', async () => {
  const { device, client } = await connected();

  await client.send('STA');
  await client.send('LIST&2026-08-19');

  assert.deepEqual(device.written, ['BLE&STA', 'BLE&LIST&2026-08-19']);
});
