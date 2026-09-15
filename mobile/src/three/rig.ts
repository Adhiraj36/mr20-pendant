/**
 * Where the pendant stands — app spec §5.3 and §5.5.
 *
 * Four states, one damped follower, two idle drifts. Nothing here touches
 * three, React or react-native: the render loop asks this module where the
 * object should be and then puts it there, which is also what makes the
 * numbers testable without a GL context.
 *
 * The scene these serve is the website's, ported: `web/src/three/rig.ts`
 * normalises to the same TARGET_SIZE and drifts with the same two periods,
 * so the object reads identically on the page and in the app.
 */

/** A state that carries a pose of its own. `dark` only dims one of these. */
export type LitState = 'hero' | 'material' | 'pair';
export type PendantState = LitState | 'dark';

export interface Pose {
  /** Camera position, world units. */
  cam: readonly [number, number, number];
  /** What the camera looks at. */
  target: readonly [number, number, number];
  /** About Y. */
  yaw: number;
  /** About X. */
  pitch: number;
  /** Relative to the normalised model, whose longest edge is TARGET_SIZE. */
  scale: number;
  /** Where the model's centre lands in its stage, as fractions from the top left. */
  anchor: readonly [number, number];
  /** Multiplies both the tone-mapping exposure and the host view's opacity. */
  lights: number;
}

/** The model is scaled so its longest edge is this, whatever it was exported at. */
export const TARGET_SIZE = 1.9;

export const FOV = 32;
export const NEAR = 0.1;
export const FAR = 50;

/** Base exposure. The rig multiplies it by the state's `lights` (§5.3). */
export const EXPOSURE = 1.1;

/** Dark's one difference from the state it dims. */
export const DARK_LIGHTS = 0.55;

/** Spec §5.3, verbatim. */
export const POSES: Record<LitState, Pose> = {
  hero: {
    cam: [0.35, 0.2, 6.4], target: [0, 0, 0],
    yaw: 0.28, pitch: -0.1, scale: 0.72, anchor: [0.5, 0.5], lights: 1,
  },
  material: {
    cam: [0.35, 0.6, 6.2], target: [0, 0.15, 0.1],
    yaw: 0.32, pitch: -0.3, scale: 0.72, anchor: [0.5, 0.42], lights: 1,
  },
  pair: {
    cam: [0, 0, 6.4], target: [0, 0, 0],
    yaw: 0, pitch: -0.06, scale: 0.62, anchor: [0.5, 0.5], lights: 1,
  },
};

/**
 * The pose a state asks for.
 *
 * Dark is "as the current state" with the lights down, so it needs to be told
 * which lit state it is dimming — the caller keeps the last one it was in.
 */
export function poseFor(state: PendantState, lit: LitState): Pose {
  if (state !== 'dark') return POSES[state];
  return { ...POSES[lit], lights: DARK_LIGHTS };
}

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const lerp3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/**
 * The signed way from one angle to another, never the long way round.
 *
 * Yaw accumulates while the object turns, and a plain difference is what makes
 * a settle unwind as several fast revolutions backwards.
 */
export function shortestAngle(from: number, to: number): number {
  const turn = Math.PI * 2;
  return (((to - from + Math.PI) % turn) + turn) % turn - Math.PI;
}

/** Every field, linearly; yaw the short way round (§5.3). */
export function mixPose(a: Pose, b: Pose, t: number): Pose {
  return {
    cam: lerp3(a.cam, b.cam, t),
    target: lerp3(a.target, b.target, t),
    yaw: a.yaw + shortestAngle(a.yaw, b.yaw) * t,
    pitch: lerp(a.pitch, b.pitch, t),
    scale: lerp(a.scale, b.scale, t),
    anchor: [lerp(a.anchor[0], b.anchor[0], t), lerp(a.anchor[1], b.anchor[1], t)],
    lights: lerp(a.lights, b.lights, t),
  };
}

/** The site's own ease for a scrubbed transition. */
export const smoothstep = (t: number) => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};

/**
 * The damped follower's step for a frame of `dt` milliseconds (§5.3).
 *
 * Written against a 60 Hz frame so the object settles at the same rate on a
 * 120 Hz screen and after a long frame — a plain constant would make the
 * follower faster the more often it runs.
 */
export const followK = (dtMs: number) => 1 - Math.pow(0.8, dtMs / 16.7);

/** One field, one step towards its target. */
export const follow = (current: number, target: number, k: number) =>
  current + (target - current) * k;

/** Every field of the pose, one step. Equivalent to `mixPose(current, target, k)`. */
export const followPose = (current: Pose, target: Pose, k: number) => mixPose(current, target, k);

/**
 * The Pendant tab's scroll dolly (§5.5): Hero over the stage, Material by the
 * time 60% of it has scrolled away.
 */
export const dollyProgress = (scrollY: number, stageHeight: number) =>
  clamp01(scrollY / Math.max(1, stageHeight * 0.6));

/**
 * The drift that stops the object being a photograph. Never a spin: the
 * spinning pendant is gone from every screen (§5.3, §6).
 */
export function idle(seconds: number): { float: number; yaw: number } {
  return {
    float: Math.sin(seconds * ((Math.PI * 2) / 6)) * 0.02,
    yaw: Math.sin(seconds * ((Math.PI * 2) / 9)) * 0.03,
  };
}
