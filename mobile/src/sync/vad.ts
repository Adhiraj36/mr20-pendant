/**
 * Phone-side speech detection, so silent recordings never upload at all.
 *
 * The pendant's own voice activation triggers on any noise, and most of what
 * it captures is nothing: paying to transfer and transcribe silence is the
 * single biggest waste in the pipeline. Each pulled file is decoded to PCM
 * (react-native-audio-api's decodeAudioData — native, fast) and scored with a
 * windowed-energy heuristic before anything is stored or uploaded.
 *
 * The bias is deliberate and conservative: deleting a real conversation is a
 * catastrophe, uploading a silent one merely costs pennies — Deepgram remains
 * the second opinion and the server-side archive flow still catches whatever
 * this lets through. A file is called silent only when the evidence is
 * overwhelming; anything ambiguous is treated as speech.
 *
 * The native module loads lazily: a dev client built before it was added
 * reports the analysis unavailable and every file uploads as before.
 */

import { decodeToPcm } from '../audio/decode';

export interface SpeechVerdict {
  /** False when the build lacks the decoder — treat as speech. */
  analyzed: boolean;
  /** Seconds of speech-like audio found. */
  speechSeconds: number;
  /** True only when the file is confidently silence. */
  silent: boolean;
}

const KEEP: SpeechVerdict = { analyzed: false, speechSeconds: 0, silent: false };

/** Below this much detected speech, the recording is noise. Conservative. */
const MIN_SPEECH_SECONDS = 0.75;

/** 30ms analysis windows: short enough to catch single words. */
const WINDOW_SECONDS = 0.03;

/**
 * Score PCM for speech-like activity. Pure, and exported for tests.
 *
 * RMS energy per window, against a noise floor taken from the file's own
 * quietest fifth — so a recording made next to a fan is judged against the
 * fan, not against digital silence. A window counts as speech when it rises
 * well above that floor AND above an absolute minimum that pure noise jitter
 * cannot reach.
 */
export function speechSecondsIn(pcm: Float32Array, sampleRate: number): number {
  const windowSize = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
  const windows = Math.floor(pcm.length / windowSize);
  if (windows < 4) return 0;

  const rms = new Float64Array(windows);
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    const start = w * windowSize;
    for (let i = start; i < start + windowSize; i++) {
      sum += pcm[i] * pcm[i];
    }
    rms[w] = Math.sqrt(sum / windowSize);
  }

  const sorted = Float64Array.from(rms).sort();
  const floor = sorted[Math.floor(windows * 0.2)];

  // 4x over the floor and at least -40 dBFS: speech at conversational
  // distance clears both easily; hiss, hum and handling noise do not.
  const threshold = Math.max(floor * 4, 0.01);

  let active = 0;
  for (let w = 0; w < windows; w++) {
    if (rms[w] > threshold) active++;
  }
  return active * WINDOW_SECONDS;
}

/** Analyze one pulled MP3. Never throws: any failure means "keep it". */
export async function analyzeSpeech(data: Uint8Array): Promise<SpeechVerdict> {
  try {
    const decoded = await decodeToPcm(data);
    if (!decoded) return KEEP;
    const speech = speechSecondsIn(decoded.pcm, decoded.sampleRate);
    return {
      analyzed: true,
      speechSeconds: speech,
      silent: speech < MIN_SPEECH_SECONDS,
    };
  } catch {
    // Undecodable audio is not proof of silence.
    return KEEP;
  }
}
