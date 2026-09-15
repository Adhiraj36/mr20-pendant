/**
 * The pendant's rig and the words the sync pass says — app spec §5 and §7.
 *
 * Both are pure on purpose: where the object stands and what a phase is called
 * are the two parts of the Pendant tab that can be wrong without anything
 * crashing, so they are pinned here rather than described.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DARK_LIGHTS, EXPOSURE, FAR, FOV, NEAR, POSES, TARGET_SIZE,
  dollyProgress, followK, followPose, idle, mixPose, poseFor, shortestAngle, smoothstep,
} from '../../src/three/rig';
import {
  LINK_LABEL, SYNC_PHASE, advanceSync, clockHM, linkReading, syncRows,
  type SyncStep,
} from '../../src/design/copy';

// -- the states ------------------------------------------------------------

/** Spec §5.3's table. A drift here is a drift in every screen that shows it. */
test('the three lit states are the spec table, verbatim', () => {
  assert.deepEqual(POSES.hero, {
    cam: [0.35, 0.2, 6.4], target: [0, 0, 0],
    yaw: 0.28, pitch: -0.1, scale: 0.72, anchor: [0.5, 0.5], lights: 1,
  });
  assert.deepEqual(POSES.material, {
    cam: [0.35, 0.6, 6.2], target: [0, 0.15, 0.1],
    yaw: 0.32, pitch: -0.3, scale: 0.72, anchor: [0.5, 0.42], lights: 1,
  });
  assert.deepEqual(POSES.pair, {
    cam: [0, 0, 6.4], target: [0, 0, 0],
    yaw: 0, pitch: -0.06, scale: 0.62, anchor: [0.5, 0.5], lights: 1,
  });
});

test('the lens and the normalised size are the spec’s', () => {
  assert.equal(FOV, 32);
  assert.equal(NEAR, 0.1);
  assert.equal(FAR, 50);
  assert.equal(EXPOSURE, 1.1);
  assert.equal(TARGET_SIZE, 1.9);
});

test('dark keeps the pose it is dimming and only drops the lights', () => {
  const dark = poseFor('dark', 'material');
  assert.deepEqual(dark.cam, POSES.material.cam);
  assert.equal(dark.yaw, POSES.material.yaw);
  assert.equal(dark.lights, DARK_LIGHTS);
  assert.equal(DARK_LIGHTS, 0.55);
  // And a lit state is itself, untouched.
  assert.deepEqual(poseFor('hero', 'hero'), POSES.hero);
});

// -- the follower ----------------------------------------------------------

test('mixing lands on each end', () => {
  assert.deepEqual(mixPose(POSES.hero, POSES.material, 0), POSES.hero);
  // Yaw arrives by its shortest signed delta rather than a plain lerp, so the
  // far end is exact to within the addition's own rounding, not bit-identical.
  const end = mixPose(POSES.hero, POSES.material, 1);
  assert.deepEqual(end.cam, POSES.material.cam);
  assert.deepEqual(end.target, POSES.material.target);
  assert.deepEqual(end.anchor, POSES.material.anchor);
  assert.equal(end.pitch, POSES.material.pitch);
  assert.equal(end.scale, POSES.material.scale);
  assert.equal(end.lights, POSES.material.lights);
  assert.ok(Math.abs(end.yaw - POSES.material.yaw) < 1e-12);
});

test('yaw takes the short way round', () => {
  // Three degrees short of a full turn is three degrees back, not 357 forward.
  const nearly = Math.PI * 2 - 0.05;
  assert.ok(Math.abs(shortestAngle(0, nearly) + 0.05) < 1e-12);
  assert.ok(Math.abs(shortestAngle(nearly, 0) - 0.05) < 1e-12);
  assert.ok(Math.abs(shortestAngle(0, 3)) <= Math.PI);
});

test('the follower settles, and settles at the same rate whatever the frame rate', () => {
  // k = 1 - 0.8^(dt / 16.7): one 60 Hz frame closes a fifth of the gap.
  assert.ok(Math.abs(followK(16.7) - 0.2) < 1e-9);
  assert.equal(followK(0), 0);

  // 700 ms of 60 Hz frames, which is M6's transition, is effectively arrival.
  let pose = POSES.hero;
  for (let i = 0; i < 42; i++) pose = followPose(pose, POSES.material, followK(16.7));
  assert.ok(Math.abs(pose.pitch - POSES.material.pitch) < 1e-3);

  // Two half-frames go as far as one whole one.
  const once = followK(33.4);
  const twice = 1 - (1 - followK(16.7)) ** 2;
  assert.ok(Math.abs(once - twice) < 1e-9);
});

// -- the dolly -------------------------------------------------------------

test('the dolly reaches Material when 60% of the stage has gone', () => {
  assert.equal(dollyProgress(0, 400), 0);
  assert.equal(dollyProgress(120, 400), 0.5);
  assert.equal(dollyProgress(240, 400), 1);
  assert.equal(dollyProgress(4000, 400), 1);
  // A rubber-band overscroll hands us a negative offset.
  assert.equal(dollyProgress(-80, 400), 0);
});

test('smoothstep is flat at both ends and half-way in the middle', () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(0.5), 0.5);
  assert.ok(smoothstep(0.1) < 0.1 && smoothstep(0.9) > 0.9);
});

// -- the idle --------------------------------------------------------------

test('the idle drifts and never spins', () => {
  assert.deepEqual(idle(0), { float: 0, yaw: 0 });
  // Quarter of the float's six-second period: its full 0.02.
  assert.ok(Math.abs(idle(1.5).float - 0.02) < 1e-12);
  // Quarter of the yaw's nine: its full 0.03.
  assert.ok(Math.abs(idle(2.25).yaw - 0.03) < 1e-12);
  // Whatever the time, neither ever leaves its own small window.
  for (let t = 0; t < 30; t += 0.37) {
    assert.ok(Math.abs(idle(t).float) <= 0.02 + 1e-12);
    assert.ok(Math.abs(idle(t).yaw) <= 0.03 + 1e-12);
  }
});

// -- the sync pass, as words -----------------------------------------------

test('the phase names are §7’s, verbatim', () => {
  assert.equal(SYNC_PHASE.listing, 'READING THE PENDANT');
  assert.equal(SYNC_PHASE.pausing, 'PAUSING RECORDING');
  assert.equal(SYNC_PHASE.wifi, 'SWITCHING TO PENDANT WIFI');
  assert.equal(SYNC_PHASE.pulling, 'PULLING');
  assert.equal(SYNC_PHASE.uploading, 'UPLOADING');
  assert.equal(SYNC_PHASE.resuming, 'RESUMING RECORDING');
  assert.equal(SYNC_PHASE.done, 'UP TO DATE');
});

test('phases arrive in order and a repeat updates its own row', () => {
  let steps: SyncStep[] = [];
  steps = advanceSync(steps, { phase: 'listing' });
  steps = advanceSync(steps, { phase: 'pausing' });
  steps = advanceSync(steps, { phase: 'wifi' });
  steps = advanceSync(steps, { phase: 'pulling', index: 1, total: 5 });
  // The engine switches to the pendant's WiFi once per file: the second visit
  // must not add a second row.
  steps = advanceSync(steps, { phase: 'wifi' });
  steps = advanceSync(steps, { phase: 'pulling', index: 2, total: 5, received: 1_153_434, expected: 2_621_440 });

  assert.deepEqual(steps.map((s) => s.phase), ['listing', 'pausing', 'wifi', 'pulling']);
  assert.equal(steps[3].value, '2 / 5 · 1.1 MB OF 2.5 MB');
});

test('an unchanged report is the same array, so nothing re-renders', () => {
  const steps = advanceSync([], { phase: 'pulling', index: 1, total: 2 });
  assert.equal(advanceSync(steps, { phase: 'pulling', index: 1, total: 2 }), steps);
  assert.equal(advanceSync(steps, undefined), steps);
  // Neither of these is a step: one says nothing, the other is the gold row.
  assert.equal(advanceSync(steps, { phase: 'idle' }), steps);
  assert.equal(advanceSync(steps, { phase: 'done' }), steps);
});

test('the running phase is live, and a finished pass ends in gold', () => {
  const steps = advanceSync(advanceSync([], { phase: 'listing' }), { phase: 'uploading' });

  const running = syncRows(steps, 'uploading');
  assert.deepEqual(running.map((r) => r.live), [false, true]);
  assert.ok(running.every((r) => !r.ok));

  const finished = syncRows(steps, undefined, new Date(2026, 8, 7, 21, 14).toISOString());
  assert.equal(finished.length, 3);
  assert.deepEqual(finished[2], { label: 'UP TO DATE', value: '21:14', ok: true });
  // Nothing is still updating once the pass is over.
  assert.ok(finished.every((r) => !r.live));
});

test('the clock is 24 hour, and a bad date says nothing', () => {
  assert.equal(clockHM(new Date(2026, 8, 7, 9, 5).toISOString()), '09:05');
  assert.equal(clockHM('not a date'), '');
});

// -- the link chip ---------------------------------------------------------

test('a dead radio outranks every other reading', () => {
  assert.equal(linkReading({ connected: true, connecting: false, btOn: false }), 'off');
  assert.equal(linkReading({ connected: true, connecting: false, btOn: true }), 'linked');
  assert.equal(linkReading({ connected: false, connecting: true, btOn: true }), 'linking');
  assert.equal(linkReading({ connected: false, connecting: false, btOn: true }), 'away');
  assert.equal(LINK_LABEL.away, 'NOT IN RANGE');
  assert.equal(LINK_LABEL.off, 'BLUETOOTH OFF');
});
