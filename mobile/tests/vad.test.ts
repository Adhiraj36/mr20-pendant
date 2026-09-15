/**
 * The speech heuristic, against synthetic PCM.
 *
 * The bias under test is the safety property: silence and steady noise score
 * zero, and anything speech-shaped scores well past the discard threshold —
 * the catastrophic error is deleting a real conversation, not keeping noise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechSecondsIn } from '../src/sync/vad';

const RATE = 16_000;

function seconds(n: number): Float32Array {
  return new Float32Array(Math.round(RATE * n));
}

/** Uniform noise at a fixed amplitude. */
function noise(buffer: Float32Array, amplitude: number, from = 0, to = buffer.length): void {
  let seed = 42;
  for (let i = from; i < to; i++) {
    // Deterministic LCG: tests must not flake on Math.random.
    seed = (seed * 1664525 + 1013904223) >>> 0;
    buffer[i] = ((seed / 0xffffffff) * 2 - 1) * amplitude;
  }
}

/** A crude voiced burst: a 160 Hz tone with harmonics, speech-loud. */
function speechBurst(buffer: Float32Array, atSecond: number, lengthSeconds: number): void {
  const from = Math.round(atSecond * RATE);
  const to = Math.min(buffer.length, from + Math.round(lengthSeconds * RATE));
  for (let i = from; i < to; i++) {
    const t = i / RATE;
    buffer[i] =
      0.25 * Math.sin(2 * Math.PI * 160 * t) +
      0.12 * Math.sin(2 * Math.PI * 320 * t) +
      0.06 * Math.sin(2 * Math.PI * 640 * t);
  }
}

test('digital silence scores zero', () => {
  assert.equal(speechSecondsIn(seconds(30), RATE), 0);
});

test('steady room noise scores zero', () => {
  const pcm = seconds(30);
  noise(pcm, 0.004); // ~-48 dBFS hiss throughout
  assert.equal(speechSecondsIn(pcm, RATE), 0);
});

test('a short remark over noise clears the threshold', () => {
  const pcm = seconds(30);
  noise(pcm, 0.004);
  speechBurst(pcm, 12, 2); // two spoken seconds in half a minute
  const speech = speechSecondsIn(pcm, RATE);
  assert.ok(speech >= 1.5, `expected ~2s of speech, scored ${speech}`);
});

test('conversation against a running fan is still speech', () => {
  const pcm = seconds(20);
  noise(pcm, 0.02); // loud steady fan, above the absolute floor
  speechBurst(pcm, 3, 1.5);
  speechBurst(pcm, 9, 2.5);
  const speech = speechSecondsIn(pcm, RATE);
  assert.ok(speech >= 2, `expected ~4s of speech, scored ${speech}`);
});

test('a lone half-second thump stays below the discard line', () => {
  const pcm = seconds(30);
  noise(pcm, 0.004);
  speechBurst(pcm, 15, 0.4); // a door, a cough
  const speech = speechSecondsIn(pcm, RATE);
  assert.ok(speech < 0.75, `a thump must not count as conversation, scored ${speech}`);
});

// The resampler that guards Whisper against mis-rated PCM.
import { resampleTo16k } from '../src/audio/decode';

test('resample is identity at 16 kHz', () => {
  const pcm = new Float32Array([0.1, 0.2, 0.3]);
  assert.equal(resampleTo16k(pcm, 16000), pcm);
});

test('resample halves 32 kHz and preserves a tone shape', () => {
  const rate = 32000;
  const pcm = new Float32Array(rate); // 1s of a 100 Hz sine at 32 kHz
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * 100 * i) / rate);
  const out = resampleTo16k(pcm, rate);
  assert.equal(out.length, 16000);
  // The same waveform sampled at 16 kHz: spot-check a few phases.
  for (const i of [100, 4000, 12000]) {
    const expected = Math.sin((2 * Math.PI * 100 * i) / 16000);
    assert.ok(Math.abs(out[i] - expected) < 0.01, `sample ${i}: ${out[i]} vs ${expected}`);
  }
});
