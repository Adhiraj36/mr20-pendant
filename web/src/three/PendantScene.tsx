import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { crossProgress, pinProgress, scrollY, viewport } from '@/lib/scroll'
import { Pendant } from './Pendant'
import { heroAnchorFor } from './heroAnchor'
import { preorderAnchorFor } from './preorderAnchor'
import { storyAnchorFor } from './storyAnchor'
import {
  FOV_DESKTOP,
  FOV_MOBILE,
  HERO_HEIGHT_VH,
  HERO_HEIGHT_VH_MOBILE,
  idle,
  timeline,
  type RigState,
} from './rig'

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * The lighting rig.
 *
 * No HDRI, so there is no environment-map fetch on a page whose whole point
 * is arriving fast. The shell is 0.92 metallic and therefore has almost no
 * diffuse term: it does not so much get lit as reflect whatever is in its
 * mirror direction. That is why this is a set of studio panels rather than
 * point lights, and why two rules matter more than the numbers:
 *
 *   - **drei aims every lightformer at the origin.** Their `rotation` props
 *     are overridden. Position is what actually places them.
 *   - **A wide bright panel becomes a white slab across the face.** The
 *     chamfer highlights have to come from narrow strips, and the fill on
 *     the camera side has to stay weak — it exists only so the flat glass
 *     front is not a hole.
 */
export function Rig() {
  return (
    <Environment resolution={256} frames={1}>
      {/* 256 is enough. The front panel is blurred by its own roughness
          and the shell is rougher still, so a larger cubemap costs a
          noticeable slice of the first second and shows nothing for it. */}
      {/* The room: dark, so the underside of the object has somewhere dark
          to fall away into. Everything that reads as light comes from the
          panels below. */}
      <color attach="background" args={['#16161b']} />

      {/* ── The two soft sources ──
          The front of the pendant is a low-roughness panel, which means it
          does not get lit so much as it shows what is in front of it. Both
          of these are large and round for that reason: a small or square
          source reflects as a small square, and the face reads as a screen
          with a sticker on it. Large and round, they reflect as a gradient,
          which is what a photograph of this object looks like.

          They are also placed on opposite sides of the camera axis on
          purpose. The hero turns the pendant one way and the final view
          turns it the other, so a single key would light one of them and
          leave the other's face black. */}
      <Lightformer form="circle" intensity={0.62} color="#fff6ea" position={[2.4, 3.2, 5]} scale={[11, 11, 1]} />
      <Lightformer form="circle" intensity={0.4} color="#eaf0f8" position={[-3.2, 2, 4.6]} scale={[7, 7, 1]} />

      {/* ── The three rims ──
          Narrow on purpose. These draw the chamfers as lines; widen any of
          them and it stops being an edge and becomes a slab across the
          face. */}
      <Lightformer form="rect" intensity={7} color="#e8ecf2" position={[3.6, 0.4, -1.8]} scale={[0.5, 6, 1]} />
      <Lightformer form="rect" intensity={5} color="#eef1f6" position={[0, 3.4, -1.8]} scale={[6, 0.5, 1]} />
      <Lightformer form="rect" intensity={3} color="#dfe4ec" position={[-2, -3.2, 1.4]} scale={[5, 0.5, 1]} />
    </Environment>
  )
}

type PendantSceneProps = {
  mobile: boolean
  /** Called with the canvas opacity every frame, so the DOM can follow. */
  onOpacity?: (value: number) => void
  /**
   * Ignores the scroll and holds one state instead. Used only by the
   * poster renderer, which needs a deterministic frame — the idle float is
   * frozen too, so two runs produce the same image.
   */
  override?: RigState
}

/**
 * The driver: reads the page's scroll clock, asks `rig.ts` where the model
 * should be, and puts it there.
 *
 * Nothing in here sets React state. The scroll position arrives as a number
 * and leaves as a matrix; the only thing that escapes to the DOM is the
 * canvas opacity, and that is written to a style property directly.
 */
export function PendantScene({ mobile, onOpacity, override }: PendantSceneProps) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)

  const root = useRef<THREE.Group>(null)
  const pitchGroup = useRef<THREE.Group>(null)
  const yawGroup = useRef<THREE.Group>(null)
  const shadow = useRef<THREE.Group>(null)

  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 })

  const fov = mobile ? FOV_MOBILE : FOV_DESKTOP
  useEffect(() => {
    camera.fov = fov
    camera.near = 0.1
    camera.far = 50
    camera.updateProjectionMatrix()
  }, [camera, fov])

  // Cursor parallax, desktop only. The rig decides how much of it applies;
  // in every state but the last, that is none.
  useEffect(() => {
    if (mobile || !window.matchMedia('(pointer: fine)').matches) return
    const onMove = (event: PointerEvent) => {
      pointer.current.tx = (event.clientX / window.innerWidth) * 2 - 1
      pointer.current.ty = (event.clientY / window.innerHeight) * 2 - 1
    }
    const onLeave = () => {
      pointer.current.tx = 0
      pointer.current.ty = 0
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [mobile])

  useFrame((state, delta) => {
    const y = scrollY()
    const vh = viewport().h || window.innerHeight

    const rig: RigState =
      override ??
      timeline({
        hero: pinProgress('hero', y, vh),
        handoff: pinProgress('hero', y, vh),
        story: pinProgress('story', y, vh),
        preorder: crossProgress('preorder', y, vh),
        mobile,
        storyAnchor: storyAnchorFor(mobile ? HERO_HEIGHT_VH_MOBILE : HERO_HEIGHT_VH),
      heroAnchor: heroAnchorFor(mobile ? HERO_HEIGHT_VH_MOBILE : HERO_HEIGHT_VH),
      preorderAnchor: preorderAnchorFor(mobile ? HERO_HEIGHT_VH_MOBILE : HERO_HEIGHT_VH),
      })

    // ── Camera ──
    // Place the camera, then pan it in its own screen plane so the model's
    // centre lands on the state's anchor. Panning rather than rotating is
    // what keeps the product's perspective identical wherever it sits on
    // the page: only the framing moves, never the lens.
    const pos = new THREE.Vector3(...rig.cam)
    const target = new THREE.Vector3(...rig.target)
    const dir = target.clone().sub(pos)
    const distance = dir.length() || 1
    dir.divideScalar(distance)

    const right = new THREE.Vector3().crossVectors(dir, WORLD_UP)
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    right.normalize()
    const up = new THREE.Vector3().crossVectors(right, dir).normalize()

    const frameH = 2 * distance * Math.tan((camera.fov * Math.PI) / 360)
    const frameW = frameH * (size.width / Math.max(1, size.height))

    const offset = right
      .clone()
      .multiplyScalar(-(rig.anchor[0] - 0.5) * frameW)
      .add(up.clone().multiplyScalar((rig.anchor[1] - 0.5) * frameH))

    camera.position.copy(pos).add(offset)
    camera.lookAt(target.clone().add(offset))

    // ── Model ──
    const drift = override ? { float: 0, yaw: 0 } : idle(state.clock.elapsedTime)

    if (mobile) {
      pointer.current.x = 0
      pointer.current.y = 0
    } else {
      // Damped so the object follows the cursor rather than tracking it.
      const k = 1 - Math.pow(1 - 0.06, delta * 60)
      pointer.current.x += (pointer.current.tx - pointer.current.x) * k
      pointer.current.y += (pointer.current.ty - pointer.current.y) * k
    }

    if (root.current) {
      root.current.position.set(0, drift.float, 0)
      root.current.scale.setScalar(rig.scale)
      root.current.visible = rig.opacity > 0.004
    }
    if (pitchGroup.current) {
      pitchGroup.current.rotation.x = rig.pitch + pointer.current.y * 0.06 * rig.parallax
    }
    if (yawGroup.current) {
      yawGroup.current.rotation.y = rig.yaw + drift.yaw + pointer.current.x * 0.1 * rig.parallax
    }
    if (shadow.current) {
      shadow.current.visible = rig.shadow > 0.01
    }

    onOpacity?.(rig.opacity)
  })

  return (
    <>
      <Rig />
      <group ref={root}>
        <group ref={pitchGroup}>
          <group ref={yawGroup}>
            <Pendant />
          </group>
        </group>

        {/* Kept out of the pitch group so the ground stays the ground. */}
        <group ref={shadow}>
          {/* Softer and browner than it was on ink. Black at 0.35 sat
              invisibly on a dark ground; on paper the same shadow reads as
              a hard grey wedge lying across the page, so it is lifted to
              the paper's own warmth and blurred until it is a weight under
              the object rather than a shape beside it. */}
          <ContactShadows
            position={[0, -1.15, 0]}
            opacity={0.18}
            scale={5.5}
            blur={4}
            far={2.2}
            resolution={128}
            color="#2A2622"
          />
        </group>
      </group>
    </>
  )
}
