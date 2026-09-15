/**
 * The phone as the microphone, when no pendant is paired.
 *
 * What happens after the recording stops is deliberately **not new**: the
 * file is registered, uploaded to its presigned URL and confirmed, which is
 * the same three calls the sync engine makes for a pendant file. The cloud
 * pipeline keys off that contract — enhancement, both transcribers, the
 * merge, the summary, the tasks, the memory — so a phone recording becomes
 * a conversation by exactly the same road, and nothing downstream needs to
 * know which microphone it came from.
 *
 * One honest wrinkle, written down rather than hidden: iOS cannot encode mp3
 * from `AVAudioRecorder`, so this records **m4a/AAC**, while the upload URL
 * is signed for `audio/mpeg` and the object keeps the `.mp3` key the
 * processor's S3 trigger parses. The bytes are what they are; ffmpeg and
 * Deepgram both sniff the container rather than trusting the label, which is
 * why this works. Changing the signature would mean changing the key format
 * the pipeline is built around, which is a bigger and riskier thing than the
 * mislabel it would fix.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { api, uploadAudio } from '../api/client';
import * as library from '../sync/library';
import { installationId } from './installation';
import {
  captureName, elapsed, IDLE, shouldStop, tooShort, type Capture,
} from './model';
import { CAPTURE } from '../design/copy';

export interface PhoneCapture {
  capture: Capture;
  /** `04:12`, for the pill. */
  clock: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Clear a finished or failed capture back to nothing. */
  reset: () => void;
}

export function usePhoneCapture(onFiled?: () => void): PhoneCapture {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [capture, setCapture] = useState<Capture>(IDLE);
  const startedAt = useRef<Date | undefined>(undefined);
  const ticking = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const clearTick = () => {
    if (ticking.current) clearInterval(ticking.current);
    ticking.current = undefined;
  };
  useEffect(() => clearTick, []);

  /**
   * Stop, keep, and hand it to the account.
   *
   * Declared before `start` because the timer that enforces the length cap
   * has to be able to call it.
   */
  const stop = useCallback(async () => {
    clearTick();
    const began = startedAt.current;
    const seconds = recorder.currentTime;

    try {
      await recorder.stop();
    } catch {
      // A recorder that will not stop has already stopped, or was never
      // going. Either way the file is what matters next.
    }
    // `playsInSilentMode` is restated, not dropped: this call replaces the
    // whole mode, and omitting it here would hand the session back with
    // playback muted on any iPhone whose ringer switch is on silent — which
    // is the state the conversation you just recorded then refuses to play in.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
      .catch(() => undefined);

    const uri = recorder.uri;
    if (!uri || !began) {
      setCapture({ state: 'failed', seconds, error: CAPTURE.lost });
      return;
    }
    if (tooShort(seconds)) {
      // Too short to be a conversation: throw it away rather than spend a
      // pipeline run on a syllable, and say why.
      new File(uri).delete();
      setCapture({ state: 'failed', seconds, error: CAPTURE.tooShort });
      return;
    }

    setCapture({ state: 'saving', seconds });
    try {
      const { folder, file } = captureName(began);
      const size = new File(uri).size ?? 0;

      const { recording, uploadUrl } = await api.registerRecording({
        deviceFolder: folder,
        deviceFile: file,
        deviceMac: await installationId(),
        startedAt: began.toISOString(),
        durationSeconds: Math.round(seconds),
        sizeBytes: size,
      });

      // Filed under the same manifest the pendant's files use, so playback,
      // the upload retry and pruning all work for a phone recording without
      // a second code path. Moved rather than copied: an hour of audio does
      // not need to exist twice.
      const entry = await library
        .adopt(folder, file, uri, Math.round(seconds))
        .catch(() => undefined);
      const local = entry ? await library.fileUri(entry).catch(() => uri) : uri;

      if (uploadUrl) {
        await uploadAudio(uploadUrl, local ?? uri);
        await api.confirmUpload(recording.recordingId);
        await library.markUploaded(folder, file, recording.recordingId).catch(() => undefined);
      }

      setCapture({ state: 'done', seconds, recordingId: recording.recordingId });
      onFiled?.();
    } catch (err) {
      // The audio is still on the phone and still in the manifest, so the
      // ordinary upload flush will try again. This says so.
      setCapture({
        state: 'failed',
        seconds,
        error: err instanceof Error ? err.message : CAPTURE.uploadFailed,
      });
    }
  }, [recorder, onFiled]);

  const start = useCallback(async () => {
    setCapture({ state: 'arming', seconds: 0 });
    try {
      // Asked here, at the moment it is needed, and never at launch.
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setCapture({ state: 'failed', seconds: 0, error: CAPTURE.denied });
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = new Date();
      setCapture({ state: 'recording', seconds: 0 });

      clearTick();
      ticking.current = setInterval(() => {
        const seconds = recorder.currentTime;
        setCapture((was) => (was.state === 'recording' ? { ...was, seconds } : was));
        if (shouldStop(seconds)) void stop();
      }, 1000);
    } catch (err) {
      setCapture({
        state: 'failed',
        seconds: 0,
        error: err instanceof Error ? err.message : CAPTURE.couldNotStart,
      });
    }
  }, [recorder, stop]);

  /**
   * The app going away ends the recording.
   *
   * iOS suspends an app without the background-audio entitlement, and a
   * recorder that has been suspended produces a file that ends wherever the
   * system decided. Stopping deliberately keeps what was captured up to that
   * point instead of discovering the truncation later.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active' && capture.state === 'recording') void stop();
    });
    return () => sub.remove();
  }, [capture.state, stop]);

  return {
    capture,
    clock: elapsed(capture.seconds),
    start,
    stop,
    reset: () => setCapture(IDLE),
  };
}
