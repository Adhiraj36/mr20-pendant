/**
 * The pendant itself, rendered from its own geometry — app spec §5.1–§5.4.
 *
 * Geometry rather than footage because the scene clears to transparent: the
 * object sits on whatever ground the screen is, rather than carrying a baked
 * black rectangle with it.
 *
 * GL was tried here once before and abandoned, for a good reason: a context
 * that never arrives looks exactly like a render that stalled, and neither is
 * distinguishable from a user's description. So this component reports failure
 * rather than hiding it — `onUnavailable` fires with a reason if the context,
 * the asset or the first frame does not arrive, and the caller falls back to
 * the poster and the video.
 *
 * Where it stands comes from `three/rig.ts`; this file only applies it. There
 * is no `spinning` prop and no spin: the pendant drifts and it dollies, and
 * that is the whole of its movement (§5.3, §6).
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { GLView } from 'expo-gl';
import type { SharedValue } from 'react-native-reanimated';
// Imported up front, not with import() at the point of use. A dynamic import
// becomes its own async chunk, and a chunk fetched by a client whose module
// ids have moved on — which is every Fast Refresh — resolves to an empty
// namespace rather than an error. `new THREE.WebGLRenderer` then throws
// "undefined cannot be used as a constructor" and the pendant silently falls
// back to the video on every reload after an edit. Paying three's parse at
// startup is the cheaper half of that trade.
import * as THREE from 'three';
import { loadGlbScene } from '../three/glb';
import {
  EXPOSURE, FAR, FOV, NEAR, POSES, TARGET_SIZE,
  followK, followPose, idle, mixPose, poseFor, smoothstep,
  type LitState, type PendantState, type Pose,
} from '../three/rig';

/**
 * Two deadlines, because "GL is broken" and "the bundler is slow" look the
 * same from here and only the first is worth falling back over.
 *
 * A context that never arrives means GL is unavailable — that is a real
 * failure and it shows up quickly. Once the context IS in hand, GL works, and
 * everything after it is loading: three, the loader, and the model. In a
 * release build those are in the bundle and on the filesystem; in development
 * they come over Wi-Fi from Metro, which is a different order of magnitude and
 * emphatically not a reason to give up on the model.
 */
const CONTEXT_TIMEOUT_MS = 10_000;
const FIRST_FRAME_TIMEOUT_MS = 45_000;

/**
 * After the app comes back, how long to wait before deciding the render loop
 * did not come back with it. Frames resume on their own within a frame or two
 * if the context survived.
 */
const RESUME_GRACE_MS = 700;
/** How many times to rebuild the surface before handing over to the video. */
const MAX_ATTEMPTS = 2;

/**
 * The material tune (spec §5.1), ported from `web/src/three/Pendant.tsx`.
 *
 * The export gives the shell metalness 0.92 over a base of #1A1A1C. For a
 * metal, base colour *is* reflectance: #1A1A1C is about 0.01 in linear terms,
 * so the shell returns roughly one per cent of whatever light reaches it —
 * an almost perfect black mirror that no rig brings back. These are the
 * reflectances bead-blasted anodised aluminium actually has, and the metalness
 * stays where the export put it. The previous cap of 0.2 here is why the shell
 * used to read as plastic.
 */
const TUNING: Record<string, { color: string; roughness: number; metalness?: number }> = {
  'GLB Graphite': { color: '#4c4c52', roughness: 0.42, metalness: 0.9 },
  'GLB Edge': { color: '#6d6d75', roughness: 0.26, metalness: 0.9 },
  'GLB Glass': { color: '#191920', roughness: 0.3 },
  'GLB Tongue': { color: '#5a5a60', roughness: 0.4 },
  'GLB MicMesh': { color: '#6f6f76', roughness: 0.55 },
};

/**
 * The room, as five emissive panels (spec §5.2) — the site's own lightformers
 * from `web/src/three/PendantScene.tsx`. Two soft sources for the flat front,
 * three narrow rims to draw the chamfers as lines. Widen a rim and it stops
 * being an edge and becomes a slab across the face.
 *
 * drei aims every lightformer at the origin; position is what places them, so
 * each panel here is built and then told to look at (0, 0, 0).
 */
const ROOM_COLOUR = 0x16161b;
const LIGHTFORMERS: {
  form: 'circle' | 'rect'; color: string; intensity: number;
  position: [number, number, number]; size: [number, number];
}[] = [
  { form: 'circle', color: '#fff6ea', intensity: 0.62, position: [2.4, 3.2, 5], size: [11, 11] },
  { form: 'circle', color: '#eaf0f8', intensity: 0.4, position: [-3.2, 2, 4.6], size: [7, 7] },
  { form: 'rect', color: '#e8ecf2', intensity: 7, position: [3.6, 0.4, -1.8], size: [0.5, 6] },
  { form: 'rect', color: '#eef1f6', intensity: 5, position: [0, 3.4, -1.8], size: [6, 0.5] },
  { form: 'rect', color: '#dfe4ec', intensity: 3, position: [-2, -3.2, 1.4], size: [5, 0.5] },
];

/** The mic's place in normalised model space, when the node cannot be found. */
const MIC_FALLBACK: [number, number, number] = [0, 0.63, 0.5];

/**
 * three refuses any context that is `instanceof WebGLRenderingContext`, having
 * dropped WebGL 1 in r163. expo-gl's WebGL 2 context inherits from
 * WebGLRenderingContext — a deviation from the browser, where the two
 * interfaces are unrelated — so a perfectly good WebGL 2 context trips that
 * check. That check is the constructor's only use of the global, so hiding the
 * global across the call is enough, and three gets the real context rather
 * than some copy of it.
 */
function withoutWebGL1Global<T>(build: () => T): T {
  const globals = globalThis as any;
  const saved = globals.WebGLRenderingContext;
  globals.WebGLRenderingContext = undefined;
  try {
    return build();
  } finally {
    globals.WebGLRenderingContext = saved;
  }
}

/** three drives a canvas; expo-gl has none, so give it the parts it touches. */
function canvasShim(width: number, height: number) {
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => null,
  };
}

/** The five panels on their dark room, as a scene PMREM can be run over. */
function buildRoom(): THREE.Scene {
  const room = new THREE.Scene();
  room.background = new THREE.Color(ROOM_COLOUR);
  for (const panel of LIGHTFORMERS) {
    const geometry =
      panel.form === 'circle'
        ? new THREE.CircleGeometry(0.5, 24)
        : new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      // drei folds a lightformer's intensity into its colour and leaves the
      // panel out of tone mapping; the probe is what gets tone-mapped, later.
      color: new THREE.Color(panel.color).multiplyScalar(panel.intensity),
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...panel.position);
    mesh.scale.set(panel.size[0], panel.size[1], 1);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  }
  return room;
}

/** Everything the room allocated, once its probe has been generated. */
function disposeRoom(room: THREE.Scene) {
  room.traverse((node: any) => {
    if (!node.isMesh) return;
    node.geometry?.dispose?.();
    node.material?.dispose?.();
  });
}

export interface DotChannel {
  /** Points from the stage's left edge. */
  x: SharedValue<number>;
  /** Points from the stage's top edge. */
  y: SharedValue<number>;
  /** 1 while the mic projects inside the stage, 0 otherwise. */
  visible: SharedValue<number>;
}

export function PendantModel({
  state,
  dolly,
  recording = false,
  lights,
  dot,
  onFirstFrame,
  onUnavailable,
  style,
}: {
  /** Which of §5.3's four rows the object is in. */
  state: PendantState;
  /**
   * Scroll progress 0..1 that dollies Hero → Material (§5.5). A ref rather
   * than a `SharedValue` because the render loop runs on the JS thread and
   * reads it there, once a frame, which is what M7 asks for.
   */
  dolly?: { current: number } | null;
  /** Draws the recording dot over the mic (§5.4). */
  recording?: boolean;
  /** Written each frame: the state's lights, which the host applies as opacity. */
  lights?: SharedValue<number>;
  /** Written each frame: where the mic lands in the stage (§5.4). */
  dot?: DotChannel;
  /** The first frame reached the layer — the host fades the GL view in (§5.6). */
  onFirstFrame?: () => void;
  onUnavailable?: (reason: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  /** Read inside the render loop, which outlives every render that set them. */
  const stateRef = useRef<PendantState>(state);
  stateRef.current = state;
  const dollyRef = useRef(dolly);
  dollyRef.current = dolly;
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const lightsRef = useRef(lights);
  lightsRef.current = lights;
  const dotRef = useRef(dot);
  dotRef.current = dot;

  const rendered = useRef(false);
  const alive = useRef(true);
  const failed = useRef(false);
  const report = useRef(onUnavailable);
  report.current = onUnavailable;
  const firstFrame = useRef(onFirstFrame);
  firstFrame.current = onFirstFrame;
  /** Counts frames actually drawn — the evidence that the loop is still alive. */
  const frames = useRef(0);
  /** The view's size in points, for turning a projection into a dot position. */
  const size = useRef({ width: 0, height: 0 });

  /**
   * Rebuilding the surface. iOS is free to throw away GL resources while the
   * app is away, and a context that comes back empty cannot be repaired in
   * place: the next call throws, the requestAnimationFrame chain ends, and the
   * layer holds its last frame — a pendant that looks fine and never moves
   * again. Changing the key mounts a fresh GLView, which is the only real
   * recovery, and the scene reloads in well under a second.
   */
  const [attempt, setAttempt] = useState(0);
  const newest = useRef(0);
  newest.current = attempt;
  const rebuild = (why: string) => {
    if (attempt + 1 >= MAX_ATTEMPTS) {
      giveUp(why);
      return;
    }
    rendered.current = false;
    setAttempt((n) => n + 1);
  };

  /** Reported once: the fallback takes over and there is nothing more to say. */
  const giveUp = (reason: string) => {
    if (failed.current) return;
    failed.current = true;
    report.current?.(reason);
  };

  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armDeadline = (ms: number, reason: string) => {
    if (deadline.current) clearTimeout(deadline.current);
    deadline.current = setTimeout(() => {
      if (rendered.current) return;
      // Time spent in the background does not count. GLView does not create a
      // context while the app is away, so a user who steps into Settings for
      // ten seconds would come back to the video having "failed" a deadline
      // that was never theirs to meet.
      if (AppState.currentState !== 'active') {
        armDeadline(ms, reason);
        return;
      }
      giveUp(reason);
    }, ms);
  };

  useEffect(() => {
    // Set, not just cleared on the way out. Leaving this to its initial value
    // means any second run of this effect — a development double-invoke, a
    // dependency added later — kills the render loop for the lifetime of the
    // component with no way back.
    alive.current = true;
    armDeadline(CONTEXT_TIMEOUT_MS, 'no GL context');
    return () => {
      alive.current = false;
      if (deadline.current) clearTimeout(deadline.current);
    };
    // giveUp and rebuild reach their callbacks through refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !rendered.current) return;
      const before = frames.current;
      setTimeout(() => {
        // Frames would have resumed by now if the context survived being away.
        if (alive.current && frames.current === before) rebuild('context lost while away');
      }, RESUME_GRACE_MS);
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <GLView
      key={attempt}
      style={[styles.canvas, style]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        size.current = { width, height };
      }}
      // No multisampling. expo-gl resolves an MSAA default framebuffer with a
      // second blit, and that path does not survive three's render — the frame
      // lands in the framebuffer and never reaches the layer. The buffer is
      // already three times the view's size in points, which is enough
      // supersampling for edges this size.
      msaaSamples={0}
      onContextCreate={async (gl) => {
        // Which build of the surface this is. A rebuild mounts a new GLView
        // while this component stays put, so the previous loop is still
        // scheduled and still holds a context that is being torn down.
        const mine = attempt;
        try {
          if (!(gl as any).supportsWebGL2) {
            giveUp('WebGL 2 unavailable on this device');
            return;
          }
          // GL answered, so the rest is loading, not capability.
          armDeadline(FIRST_FRAME_TIMEOUT_MS, 'context arrived but no frame followed');

          const started = Date.now();
          const stage = (what: string) => {
            if (__DEV__) console.log('[PendantModel]', what, Date.now() - started + 'ms');
          };

          const width = gl.drawingBufferWidth;
          const height = gl.drawingBufferHeight;

          const renderer = withoutWebGL1Global(() => new THREE.WebGLRenderer({
            canvas: canvasShim(width, height) as any,
            context: gl as any,
          }));
          // expo-gl sizes its own drawing buffer from the native view and
          // offers no device-pixel-ratio knob, so §5.1's "DPR ≤ 1.5" cannot be
          // applied here: the buffer is whatever the platform made it, and
          // three is told to use all of it rather than a corner of it.
          renderer.setPixelRatio(1);
          renderer.setSize(width, height, false);
          // Transparent: the screen behind the pendant is the background.
          renderer.setClearColor(0x000000, 0);
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = EXPOSURE;

          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(FOV, width / height, NEAR, FAR);

          /**
           * The directional fallback (§5.2), re-tuned for exposure 1.1. It is
           * mounted first and removed if the probe below succeeds: rendering
           * the first frame is worth more than rendering it perfectly, and
           * PMREM is the one step here that has been measured in seconds.
           */
          const fallbackLights = new THREE.Group();
          // Warm sky over the room's own ground.
          fallbackLights.add(new THREE.HemisphereLight(0xfff6ea, ROOM_COLOUR, 3.4));
          const key = new THREE.DirectionalLight(0xfff6ea, 4.6);
          key.position.set(2.4, 3.2, 5);
          fallbackLights.add(key);
          const fill = new THREE.DirectionalLight(0xeaf0f8, 2.6);
          fill.position.set(-3.2, 2, 4.6);
          fallbackLights.add(fill);
          // Weak on purpose: a directional lights every face turned towards
          // it, so anything stronger stops being an edge highlight and becomes
          // a lit panel each time the pendant comes round.
          const rim = new THREE.DirectionalLight(0xe8ecf2, 1.8);
          rim.position.set(3.6, 0.4, -1.8);
          fallbackLights.add(rim);
          const low = new THREE.DirectionalLight(0xdfe4ec, 1.2);
          low.position.set(-2, -3.2, 1.4);
          fallbackLights.add(low);
          scene.add(fallbackLights);

          const source = await loadGlbScene(require('../../assets/pendant.glb'));
          stage('model loaded');

          /**
           * One feature set is one compiled shader, and this GPU compiles
           * slowly: every material becomes a `MeshStandardMaterial`, which is
           * also what §5.1 allows. Each mesh gets its own instance, so nothing
           * here can write back into a material another mount is using.
           */
          source.traverse((node: any) => {
            if (!node.isMesh) return;
            const original = node.material;
            const tune = TUNING[original?.name ?? ''];
            node.material = new THREE.MeshStandardMaterial({
              color: tune ? new THREE.Color(tune.color) : original.color,
              roughness: tune ? tune.roughness : original.roughness ?? 1,
              metalness: tune?.metalness ?? original.metalness ?? 1,
              // The export marks every material double-sided, and its shells
              // are thin enough that back-face culling drops most of them.
              side: THREE.DoubleSide,
            });
            node.material.name = original?.name ?? '';
            original?.dispose?.();
          });

          /**
           * Normalising and posing belong in different frames. The centring
           * offset is in the export's own units so it goes on the model; the
           * normalising scale goes on a group around it; the pose's own scale
           * goes on the pivot. Collapsing them would shrink the geometry while
           * leaving the offset full size.
           */
          const box = new THREE.Box3().setFromObject(source);
          const extent = box.getSize(new THREE.Vector3());
          const longest = Math.max(extent.x, extent.y, extent.z) || 1;
          source.position.sub(box.getCenter(new THREE.Vector3()));

          const norm = new THREE.Group();
          norm.scale.setScalar(TARGET_SIZE / longest);
          norm.add(source);

          const yawGroup = new THREE.Group();
          yawGroup.add(norm);
          const pitchGroup = new THREE.Group();
          pitchGroup.add(yawGroup);
          const pivot = new THREE.Group();
          pivot.add(pitchGroup);
          scene.add(pivot);

          /**
           * Where the recording dot goes (§5.4): the centre of the MicMesh
           * node, resolved once into normalised model space so the frame loop
           * only has to project a point rather than measure a bounding box.
           */
          const micAnchor = new THREE.Object3D();
          const micNode = source.getObjectByName('Pendant_MicMesh');
          if (micNode) {
            pivot.updateMatrixWorld(true);
            const centre = new THREE.Vector3();
            new THREE.Box3().setFromObject(micNode).getCenter(centre);
            micAnchor.position.copy(norm.worldToLocal(centre));
          } else {
            micAnchor.position.set(...MIC_FALLBACK);
          }
          norm.add(micAnchor);

          // Reused every frame; allocating these inside the loop is what makes
          // a render loop garbage.
          const camPos = new THREE.Vector3();
          const camTarget = new THREE.Vector3();
          const forward = new THREE.Vector3();
          const right = new THREE.Vector3();
          const up = new THREE.Vector3();
          const offset = new THREE.Vector3();
          const projected = new THREE.Vector3();
          const WORLD_UP = new THREE.Vector3(0, 1, 0);

          /** The last lit state, so Dark knows which pose it is dimming. */
          let lit: LitState = stateRef.current === 'dark' ? 'hero' : stateRef.current;
          /** Starts at its target: a state is where the object is, not where it eases in from. */
          let pose: Pose = targetPose();
          let lastLights = -1;
          let last = 0;
          let elapsed = 0;

          function targetPose(): Pose {
            const wanted = stateRef.current;
            if (wanted !== 'dark') lit = wanted;
            const base = poseFor(wanted, lit);
            const scrub = dollyRef.current;
            // The dolly is Hero → Material and nothing else: Pair has no
            // scroll behind it, and Dark keeps whichever pose it dimmed —
            // so only the lights survive from `base` when it applies.
            if (!scrub || lit !== 'hero') return base;
            return {
              ...mixPose(POSES.hero, POSES.material, smoothstep(scrub.current)),
              lights: base.lights,
            };
          }

          /**
           * The probe (§5.2). Attempted once, after the first frame is on the
           * layer: it is the better rig, but it is synchronous and has been
           * measured in seconds on this GL stack, so it must never be what
           * stands between a mounted screen and a visible pendant.
           */
          let probeTried = false;
          const tryEnvironment = () => {
            if (probeTried || !alive.current || newest.current !== mine) return;
            probeTried = true;
            const room = buildRoom();
            const pmrem = new THREE.PMREMGenerator(renderer);
            try {
              const at = Date.now();
              const probe = pmrem.fromScene(room, 0, NEAR, FAR);
              if (!probe?.texture) throw new Error('PMREM produced no texture');
              scene.environment = probe.texture;
              scene.remove(fallbackLights);
              stage(`environment ready in ${Date.now() - at}ms`);
            } catch (err) {
              // Explicitly, and out loud: a silent fallback to directionals is
              // indistinguishable from never having tried (§9, "Three").
              console.warn('[PendantModel] PMREM room failed, keeping directionals:', err);
            } finally {
              pmrem.dispose();
              disposeRoom(room);
            }
          };

          const draw = (now: number) => {
            if (!alive.current || newest.current !== mine) return;
            requestAnimationFrame(draw);
            // Clamped: returning from the background hands us one enormous
            // delta, which would fling the object across its whole transition.
            const deltaMs = last ? Math.min(now - last, 50) : 0;
            last = now;
            elapsed += deltaMs / 1000;

            try {
              pose = followPose(pose, targetPose(), followK(deltaMs));

              // Place the camera, then pan it in its own screen plane so the
              // model's centre lands on the state's anchor. Panning rather
              // than rotating keeps the product's perspective identical
              // wherever it sits in the stage: only the framing moves.
              camPos.set(pose.cam[0], pose.cam[1], pose.cam[2]);
              camTarget.set(pose.target[0], pose.target[1], pose.target[2]);
              forward.copy(camTarget).sub(camPos);
              const distance = forward.length() || 1;
              forward.divideScalar(distance);
              right.crossVectors(forward, WORLD_UP);
              if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
              right.normalize();
              up.crossVectors(right, forward).normalize();

              const frameH = 2 * distance * Math.tan((FOV * Math.PI) / 360);
              const frameW = frameH * (width / Math.max(1, height));
              offset
                .copy(right).multiplyScalar(-(pose.anchor[0] - 0.5) * frameW)
                .addScaledVector(up, (pose.anchor[1] - 0.5) * frameH);

              camera.position.copy(camPos).add(offset);
              camera.lookAt(camTarget.add(offset));

              const drift = idle(elapsed);
              pivot.position.y = drift.float;
              pivot.scale.setScalar(pose.scale);
              pitchGroup.rotation.x = pose.pitch;
              yawGroup.rotation.y = pose.yaw + drift.yaw;

              renderer.toneMappingExposure = EXPOSURE * pose.lights;
              const channel = lightsRef.current;
              if (channel && Math.abs(pose.lights - lastLights) > 0.001) {
                lastLights = pose.lights;
                channel.value = pose.lights;
              }

              renderer.render(scene, camera);

              // After the render, so the world matrices the projection reads
              // are this frame's rather than the last one's.
              const dotChannel = dotRef.current;
              if (dotChannel) {
                if (recordingRef.current && size.current.width > 0) {
                  micAnchor.getWorldPosition(projected).project(camera);
                  const x = (projected.x * 0.5 + 0.5) * size.current.width;
                  const y = (-projected.y * 0.5 + 0.5) * size.current.height;
                  const inside =
                    projected.z < 1 &&
                    x >= 0 && x <= size.current.width &&
                    y >= 0 && y <= size.current.height;
                  dotChannel.x.value = x;
                  dotChannel.y.value = y;
                  dotChannel.visible.value = inside ? 1 : 0;
                } else if (dotChannel.visible.value !== 0) {
                  dotChannel.visible.value = 0;
                }
              }

              // Hand expo-gl back the state its present expects, then wait for
              // the queue to drain before asking for the frame.
              //
              // expo-gl records GL calls into a batch and replays them on its own
              // thread; presenting is a glBlitFramebuffer out of the default
              // framebuffer, so it needs that framebuffer bound and the colour
              // mask open. The blocking flush is the part that is easy to miss:
              // with a batch as large as a scene render, endFrameEXP's redraw
              // flag does not reliably survive to the flush that would act on it,
              // and every frame lands complete in the framebuffer and never
              // reaches the layer — indistinguishable, from the outside, from GL
              // failing outright. Draining first also stops the batch growing
              // faster than the GL thread can replay it.
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.colorMask(true, true, true, true);
              gl.flushEXP();
              gl.endFrameEXP();
              frames.current++;
              if (!rendered.current) {
                rendered.current = true;
                stage('first frame, programs=' + renderer.info.programs?.length);
                firstFrame.current?.();
                // Next macrotask, not this one: the frame just drawn has to
                // reach the layer before the probe takes the thread.
                setTimeout(tryEnvironment, 0);
              }
            } catch (err) {
              // A frame that throws — a context torn down underneath us is the
              // usual reason — would otherwise end the requestAnimationFrame
              // chain here and leave the last frame frozen on screen with
              // nothing said about it.
              rebuild((err as Error)?.message ?? 'render failed');
            }
          };
          requestAnimationFrame(draw);
        } catch (err) {
          // A missing context, an asset that will not load, a loader that
          // throws: all the same to the viewer, and all recoverable by the
          // poster and the video that used to be here.
          giveUp((err as Error)?.message ?? String(err));
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: 'transparent' },
});
