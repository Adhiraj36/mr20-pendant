/**
 * Shared MP3 → PCM decoding at 16 kHz mono — the rate the pendant records at
 * and the rate Whisper expects, so nothing downstream resamples.
 *
 * react-native-audio-api is loaded lazily: a build without it reports decoding
 * unavailable and callers degrade (VAD keeps files, transcription is offered
 * only when the decoder exists).
 */

export interface DecodedPcm {
  pcm: Float32Array;
  sampleRate: number;
}

interface AudioContextLike {
  decodeAudioData(data: ArrayBuffer): Promise<{
    sampleRate: number;
    getChannelData(channel: number): Float32Array;
  }>;
}

let context: AudioContextLike | null | undefined;

function ensureContext(): AudioContextLike | null {
  if (context !== undefined) return context ?? null;
  try {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { AudioContext } = require('react-native-audio-api');
    /* eslint-enable */
    // 16 kHz native: decodeAudioData resamples to the context's rate, so
    // pinning it here means every caller gets Whisper-ready PCM.
    context = AudioContext ? new AudioContext({ sampleRate: 16000 }) : null;
  } catch {
    context = null;
  }
  return context ?? null;
}

export function decodingAvailable(): boolean {
  return ensureContext() !== null;
}

/** Decode MP3 bytes to mono PCM. Returns null when the build lacks the decoder. */
export async function decodeToPcm(data: Uint8Array): Promise<DecodedPcm | null> {
  const ctx = ensureContext();
  if (!ctx) return null;
  // A fresh, unshared buffer: decodeAudioData may detach what it is given.
  const audio = await ctx.decodeAudioData(data.slice().buffer as ArrayBuffer);
  return { pcm: audio.getChannelData(0), sampleRate: audio.sampleRate };
}

/**
 * Decode to 16 kHz mono, whatever rate the platform's context actually runs
 * at. The context above ASKS for 16 kHz, but AudioContext may clamp to the
 * hardware rate — and PCM handed onward at the wrong rate plays ~3x slow,
 * which Whisper hears as rumble and labels [Music]. Trust the buffer's own
 * declared rate and resample when it disagrees.
 */
export async function decodeToPcm16k(data: Uint8Array): Promise<Float32Array | null> {
  const decoded = await decodeToPcm(data);
  if (!decoded) return null;
  return resampleTo16k(decoded.pcm, decoded.sampleRate);
}

/** Linear-interpolation resample. Exported for tests. */
export function resampleTo16k(pcm: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === 16000) return pcm;
  const ratio = sampleRate / 16000;
  const length = Math.floor(pcm.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, pcm.length - 1);
    const frac = pos - lo;
    out[i] = pcm[lo] * (1 - frac) + pcm[hi] * frac;
  }
  return out;
}
