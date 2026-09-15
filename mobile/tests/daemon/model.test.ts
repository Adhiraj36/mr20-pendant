/**
 * The pairing screen's two clocks.
 *
 * Both of them are the kind of thing that is wrong by a minute and nobody
 * notices until a laptop that has been shut for an hour is still described as
 * online. Asked here at fixed instants rather than by watching a simulator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ago, codeClock, codeGroups, codeLive, codeSecondsLeft, daemonBanner,
  daemonRowValue, offersPairing, presence, presenceLabel, presenceTone,
  sinceBeat, STALE_AFTER_SECONDS,
} from '../../src/daemon/model.ts';
import type { Daemon } from '../../src/api/daemons.ts';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const secondsAgo = (n: number) => new Date(NOW.getTime() - n * 1000).toISOString();

const machine = (over: Partial<Daemon> = {}): Daemon => ({
  daemonId: 'd1',
  userId: 'u1',
  name: 'Kartik’s MacBook',
  status: 'online',
  capabilities: ['claude-code'],
  registeredAt: NOW.toISOString(),
  online: true,
  ...over,
});

test('a machine that has never called home is not offline, it is unknown', () => {
  const d = machine({ lastHeartbeatAt: undefined });
  assert.equal(sinceBeat(d, NOW), undefined);
  assert.equal(presence(d, NOW), 'never');
  assert.equal(presenceLabel(d, NOW), 'NEVER CONNECTED');
});

test('three missed beats is the line between online and asleep', () => {
  const fresh = machine({ lastHeartbeatAt: secondsAgo(STALE_AFTER_SECONDS - 1) });
  const stale = machine({ lastHeartbeatAt: secondsAgo(STALE_AFTER_SECONDS + 1) });
  assert.equal(presence(fresh, NOW), 'online');
  assert.equal(presence(stale, NOW), 'offline');
});

test('a daemon that says it is offline is believed without waiting for the clock', () => {
  const d = machine({ status: 'offline', lastHeartbeatAt: secondsAgo(1) });
  assert.equal(presence(d, NOW), 'offline');
  // And it says how long ago, because "OFFLINE" alone answers nothing.
  assert.equal(presenceLabel(d, NOW), 'JUST NOW');
});

test('busy is its own state while the beat is fresh, and asleep once it is not', () => {
  assert.equal(presence(machine({ status: 'busy', lastHeartbeatAt: secondsAgo(5) }), NOW), 'busy');
  assert.equal(presenceLabel(machine({ status: 'busy', lastHeartbeatAt: secondsAgo(5) }), NOW), 'WORKING');
  assert.equal(presence(machine({ status: 'busy', lastHeartbeatAt: secondsAgo(600) }), NOW), 'offline');
});

test('an unparsable heartbeat is treated as no heartbeat, never as now', () => {
  const d = machine({ lastHeartbeatAt: 'the day before yesterday' });
  assert.equal(presence(d, NOW), 'never');
});

test('the age of a beat is coarse on purpose', () => {
  assert.equal(ago(0), 'JUST NOW');
  assert.equal(ago(59), 'JUST NOW');
  assert.equal(ago(60), '1 MIN AGO');
  assert.equal(ago(3599), '59 MIN AGO');
  assert.equal(ago(3600), '1 H AGO');
  assert.equal(ago(86_400), '1 D AGO');
});

test('presence carries a colour role, and only asleep is quiet', () => {
  assert.equal(presenceTone('online'), 'settled');
  assert.equal(presenceTone('busy'), 'stamp');
  assert.equal(presenceTone('offline'), 'faint');
  assert.equal(presenceTone('never'), 'faint');
});

test('the code counts down to zero and no further', () => {
  const expires = new Date(NOW.getTime() + 272_000).toISOString();
  assert.equal(codeSecondsLeft(expires, NOW), 272);
  assert.equal(codeClock(272), '4:32');
  assert.equal(codeClock(9), '0:09');
  assert.equal(codeLive(expires, NOW), true);

  const gone = new Date(NOW.getTime() - 1000).toISOString();
  assert.equal(codeSecondsLeft(gone, NOW), 0);
  assert.equal(codeLive(gone, NOW), false);
  assert.equal(codeClock(-5), '0:00');
});

test('a code with no expiry we can read is a code that has expired', () => {
  assert.equal(codeSecondsLeft('soon', NOW), 0);
  assert.equal(codeLive('soon', NOW), false);
});

test('six characters are read in two halves', () => {
  assert.deepEqual(codeGroups('K7QD2M'), ['K7Q', 'D2M']);
  assert.deepEqual(codeGroups('k7q-d2m'), ['K7Q', 'D2M']);
  assert.deepEqual(codeGroups('K7QD2M', 0), ['K7QD2M']);
  assert.deepEqual(codeGroups(''), []);
});

test('the settings row says what is working, not how many exist', () => {
  const up = machine({ daemonId: 'a', lastHeartbeatAt: secondsAgo(5) });
  const down = machine({ daemonId: 'b', lastHeartbeatAt: secondsAgo(9000) });
  assert.equal(daemonRowValue([], NOW), 'NONE PAIRED');
  assert.equal(daemonRowValue([up], NOW), '1 ONLINE');
  assert.equal(daemonRowValue([up, down], NOW), '1 ONLINE');
  assert.equal(daemonRowValue([down], NOW), 'ASLEEP');
  assert.equal(daemonRowValue([down, { ...down, daemonId: 'c' }], NOW), '2 ASLEEP');
});

test('pairing needs the surface and a backend that will mint a code', () => {
  // With execution down, POST /daemons/code answers 402 to everybody, so a
  // pairing button would open the plan chooser at people whose plan is fine.
  assert.equal(offersPairing({ daemon: false, execution: false }), false);
  assert.equal(offersPairing({ daemon: true, execution: false }), false);
  assert.equal(offersPairing({ daemon: false, execution: true }), false);
  assert.equal(offersPairing({ daemon: true, execution: true }), true);
});

// -- the banner on Home ----------------------------------------------------

const WORDS = { none: 'NOTHING PAIRED', pair: 'PAIR', asleep: 'ASLEEP', see: 'SEE' };
const banner = (over: Partial<Parameters<typeof daemonBanner>[0]>) => daemonBanner({
  enabled: true, loaded: true, daemons: [], approved: 1, now: NOW, words: WORDS, ...over,
});

test('nothing approved is nothing to say, however asleep the laptop is', () => {
  const asleep = machine({ lastHeartbeatAt: secondsAgo(9000) });
  assert.equal(banner({ approved: 0, daemons: [asleep] }), undefined);
});

test('approved work with no machine at all offers to pair one', () => {
  assert.deepEqual(banner({}), { label: WORDS.none, action: WORDS.pair });
});

test('approved work and a machine that is awake needs no banner', () => {
  const up = machine({ lastHeartbeatAt: secondsAgo(5) });
  assert.equal(banner({ daemons: [up] }), undefined);
});

test('approved work and every machine asleep is worth saying', () => {
  const down = machine({ lastHeartbeatAt: secondsAgo(9000) });
  assert.deepEqual(banner({ daemons: [down] }), { label: WORDS.asleep, action: WORDS.see });
});

test('one machine awake among several is enough', () => {
  const up = machine({ daemonId: 'a', lastHeartbeatAt: secondsAgo(5) });
  const down = machine({ daemonId: 'b', lastHeartbeatAt: secondsAgo(9000) });
  assert.equal(banner({ daemons: [up, down] }), undefined);
});

test('a list that has not been read yet decides nothing', () => {
  // "No machines" and "we have not asked" are different answers, and only
  // one of them should produce a banner offering to pair.
  assert.equal(banner({ loaded: false }), undefined);
});

test('the flag being off silences it entirely', () => {
  assert.equal(banner({ enabled: false }), undefined);
});
