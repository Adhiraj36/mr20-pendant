/**
 * The pendant, on screen — app spec §5.3 and §5.6.
 *
 * Three layers, in the order they arrive. The **poster** shows immediately, so
 * a screen is never blank waiting for a GPU. The **model** fades in over 600 ms
 * once its first frame reaches the layer; if that takes more than four seconds
 * the poster keeps the stage and no spinner appears. If GL reports that it
 * cannot deliver at all, the **clip** takes over — the same keyed footage as
 * before, but held on its front-facing frame, because the spin is gone from
 * every version of this object (§5.3, §6).
 *
 * "Lights" is one number: it multiplies the render's exposure and this view's
 * opacity together, so a pendant that is out of reach dims and recedes rather
 * than being labelled unreachable twice.
 *
 * Under reduce motion there is no GL at all: the poster is the picture, and
 * the recording dot sits still on it (§5.6).
 */
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, {
  useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { colors } from '../design/tokens';
import { dur, ease, timing, useReducedMotionFlag } from '../design/motion';
import { PendantModel, type DotChannel } from './PendantModel';
import { DARK_LIGHTS, type PendantState } from '../three/rig';

const POSTER = require('../../assets/pendant-poster.png');
const CLIP = require('../../assets/pendant.mp4');

/**
 * Where the clip faces the camera squarely, measured off the asset: the turn
 * starts three-quarters on and comes round to the flat front at 0.8 s.
 */
const FRONT_FRAME_SECONDS = 0.8;

/**
 * Where the mic sits on that frame, as fractions of the square stage —
 * measured on the front frame, which is what §5.4 asks for. (The section's own
 * figure, 62% / 38%, does not land on this clip: the two mic ports are left of
 * centre and just below the middle. Measurement wins over the transcription.)
 */
const MIC_ON_STILL: readonly [number, number] = [0.31, 0.46];

/** Long enough to decide the model is not coming; short enough not to be a wait. */
const POSTER_HOLD_MS = 4000;
/** The model's fade-in, once its first frame is on the layer (§5.6). */
const REVEAL_MS = 600;

/** 6 × 6, radius 3, the one place `signal` fills anything at all (§5.4). */
const DOT = 6;

export function PendantVisual({
  state,
  dolly,
  recording = false,
  style,
}: {
  /** Which of §5.3's four rows the object stands in. */
  state: PendantState;
  /** Scroll progress 0..1 that dollies Hero → Material on the Pendant tab (§5.5). */
  dolly?: { current: number } | null;
  recording?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotionFlag();
  /** GL said it cannot deliver; the clip is the answer. */
  const [modelFailed, setModelFailed] = useState(false);
  /** The model's first frame never arrived in time — the poster keeps the stage. */
  const [posterHeld, setPosterHeld] = useState(false);

  /** Whether the render loop is the thing on screen, and therefore the writer. */
  const live = !reduced && !modelFailed && !posterHeld;

  /** The model's layer: 0 until its first frame, then 1 (§5.6). */
  const reveal = useSharedValue(0);
  /** The still beneath it — the poster, or the clip once GL has given up. */
  const still = useSharedValue(1);
  const lights = useSharedValue(state === 'dark' ? DARK_LIGHTS : 1);
  const dot: DotChannel = {
    x: useSharedValue(0),
    y: useSharedValue(0),
    visible: useSharedValue(0),
  };

  /**
   * The lights, when nothing is rendering.
   *
   * With GL up, the render loop's own follower owns this value — one settle,
   * shared by the exposure and this view's opacity. Without it there is no
   * loop, so the transition M6 describes is timed here instead.
   */
  useEffect(() => {
    if (live) return;
    const target = state === 'dark' ? DARK_LIGHTS : 1;
    lights.value = reduced ? target : withTiming(target, timing(dur.slow));
  }, [live, state, reduced, lights]);

  /**
   * The hold: after this, a late first frame no longer earns the stage.
   *
   * Skipped in development, where the model arrives over Wi-Fi from Metro —
   * which is why this component's own first-frame deadline is 45 s there.
   * Holding the poster after four seconds would mean never seeing the model
   * while working on it; a shipped build reads it off the filesystem, and
   * four seconds there is a real verdict.
   */
  useEffect(() => {
    if (!live || __DEV__) return;
    const timer = setTimeout(() => {
      if (reveal.value === 0) setPosterHeld(true);
    }, POSTER_HOLD_MS);
    return () => clearTimeout(timer);
  }, [live, reveal]);

  /** Nothing is rendering any more: whatever the still is, it takes the stage. */
  useEffect(() => {
    if (live) return;
    reveal.value = 0;
    still.value = reduced ? 1 : withTiming(1, timing(REVEAL_MS));
  }, [live, reduced, reveal, still]);

  const showModel = live;
  const showClip = modelFailed && !reduced;

  const lightsStyle = useAnimatedStyle(() => ({ opacity: lights.value }));
  const revealStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));
  const stillStyle = useAnimatedStyle(() => ({ opacity: still.value }));

  return (
    <View style={[styles.host, style]} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, lightsStyle]}>
        {/* The still. Square, because both the poster and the footage are —
            the model, which carries its own alpha, is free to bleed. */}
        <View style={styles.stillRow}>
          <Animated.View style={[styles.square, showClip && styles.keyed, stillStyle]}>
            {showClip ? (
              <PendantClip />
            ) : (
              <Image source={POSTER} style={styles.fill} resizeMode="contain" />
            )}
            {!showModel ? (
              <RecordingDot
                recording={recording}
                reduced={reduced}
                style={{
                  left: `${MIC_ON_STILL[0] * 100}%`,
                  top: `${MIC_ON_STILL[1] * 100}%`,
                }}
              />
            ) : null}
          </Animated.View>
        </View>

        {showModel ? (
          <Animated.View style={[StyleSheet.absoluteFill, revealStyle]}>
            <PendantModel
              state={state}
              dolly={dolly}
              recording={recording}
              lights={lights}
              dot={dot}
              onFirstFrame={() => {
                reveal.value = withTiming(1, timing(REVEAL_MS));
                still.value = withTiming(0, timing(REVEAL_MS));
              }}
              onUnavailable={(reason) => {
                // Say why. A silent fallback to the clip is indistinguishable
                // from the model never having been tried.
                console.warn('[PendantModel] falling back to the clip:', reason);
                setModelFailed(true);
              }}
            />
          </Animated.View>
        ) : null}

        {showModel ? <ProjectedDot dot={dot} recording={recording} reduced={reduced} /> : null}
      </Animated.View>
    </View>
  );
}

/**
 * The clip, on one frame.
 *
 * Kept muted, unlooped and paused: this is a photograph the platform happens
 * to decode as video. The edge feather that used to sit over it was for the
 * turn's zoomed-in passage, which a still on the front frame never reaches —
 * the commented block below records why it existed, since the day the clip is
 * played again is the day it is needed again.
 */
function PendantClip() {
  const player = useVideoPlayer(CLIP, (p) => {
    p.loop = false;
    p.muted = true;
    p.pause();
  });

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status !== 'readyToPlay') return;
      // Seeking before the source is ready is a no-op on both platforms, which
      // is how the clip used to land on its first frame instead of its front one.
      player.currentTime = FRONT_FRAME_SECONDS;
      player.pause();
    });
    return () => subscription.remove();
  }, [player]);

  return (
    <VideoView
      player={player}
      style={styles.fill}
      contentFit="cover"
      // Decorative: no controls, no fullscreen gesture.
      nativeControls={false}
      // Android defaults to a SurfaceView, which draws in its own window layer
      // *above* sibling views regardless of z-order — that is why the clip's
      // black frame used to paint over the rest of the screen. A TextureView
      // composites in the normal hierarchy and honours opacity and blending.
      surfaceType="textureView"
    />
  );
}

/** The dot at a fixed place on a still, for the poster and the clip. */
function RecordingDot({
  recording, reduced, style,
}: {
  recording: boolean;
  reduced: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = usePulse(recording, reduced);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  if (!recording) return null;
  return <Animated.View accessibilityLabel="Recording" style={[styles.dot, style, animated]} />;
}

/** The dot over the mic the render loop projected this frame (§5.4). */
function ProjectedDot({
  dot, recording, reduced,
}: {
  dot: DotChannel;
  recording: boolean;
  reduced: boolean;
}) {
  const pulse = usePulse(recording, reduced);
  const animated = useAnimatedStyle(() => ({
    // Hidden when the mic projects outside the stage, rather than clamped to
    // its edge — a dot on the rim would claim the mic is somewhere it is not.
    opacity: dot.visible.value * pulse.value,
    transform: [
      { translateX: dot.x.value - DOT / 2 },
      { translateY: dot.y.value - DOT / 2 },
    ],
  }));
  if (!recording) return null;
  return (
    <Animated.View
      accessibilityLabel="Recording"
      style={[styles.dot, styles.dotOrigin, animated]}
    />
  );
}

/** 0.5 → 1 → 0.5 over 1.8 s, and still under reduce motion (§5.4, §5.6). */
function usePulse(recording: boolean, reduced: boolean) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!recording || reduced) {
      opacity.value = 1;
      return;
    }
    opacity.value = 0.5;
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: ease.inOut }),
      -1,
      true,
    );
  }, [recording, reduced, opacity]);
  return opacity;
}

const styles = StyleSheet.create({
  host: { width: '100%', aspectRatio: 1.5, alignItems: 'center', justifyContent: 'center' },
  stillRow: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
  },
  // Square, matching the 1080² footage and the poster, sized by the host's
  // height. When the view's aspect ratio equals the source's, contain, cover
  // and fill all agree and no scaling policy can crop the frame — which the
  // Android TextureView path was doing in a wide stage, cutting the pendant's
  // lowest poses off the bottom despite contentFit="contain".
  square: { height: '100%', aspectRatio: 1 },
  // The clip only. Screen blending turns its baked black surround transparent,
  // so the ground shows through instead of a rectangle sitting on top — the
  // footage was keyed onto black precisely so this works. The poster carries
  // its own alpha and must never be blended: it would wash the shell out.
  keyed: { mixBlendMode: 'screen' },
  fill: { width: '100%', height: '100%', backgroundColor: 'transparent' },
  dot: {
    position: 'absolute',
    width: DOT, height: DOT, borderRadius: DOT / 2,
    backgroundColor: colors.signal,
    // The dot is placed by its centre; both hosts translate it back by half.
    marginLeft: -DOT / 2, marginTop: -DOT / 2,
  },
  // The projected dot is moved by transform, so it starts at the origin and
  // carries no centring margin of its own.
  dotOrigin: { left: 0, top: 0, marginLeft: 0, marginTop: 0 },
});
