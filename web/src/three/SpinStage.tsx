import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { Pendant } from './Pendant'
import { Rig } from './PendantScene'
import { FOV_DESKTOP } from './rig'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const remap = (v: number, a: number, b: number) => clamp01((v - a) / (b - a))

/**
 * The handover to the checkout.
 *
 * Pressing preorder does not cut to a form. The object spins up, rushes
 * the camera, and blows out into the checkout's paper — so the two halves
 * of the site are joined by the product rather than by a page load. Same
 * model, same lighting rig as the page behind it, on a canvas of its own
 * that exists only for the length of the transition.
 *
 * `progress` is a ref, written by the overlay's animation loop and read
 * here once a frame. Nothing about this passes through React state.
 */
export default function SpinStage({
  progress,
  onReady,
}: {
  progress: MutableRefObject<number>
  onReady: () => void
}) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: FOV_DESKTOP, near: 0.1, far: 50, position: [0, 0, 6.4] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.1
        gl.outputColorSpace = THREE.SRGBColorSpace
      }}
    >
      <Suspense fallback={null}>
        <Rig />
        <Spinner progress={progress} />
        <Ready onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}

function Spinner({ progress }: { progress: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)

  useFrame(() => {
    const t = clamp01(progress.current)

    // Two and a half turns, accelerating: slow enough at the start that the
    // first frames are still the hero's object, fast enough at the end that
    // it is a blur by the time the paper covers it.
    const yaw = 0.3 + Math.pow(t, 2.1) * Math.PI * 5

    // The rush. Held briefly so the spin reads first, then the camera comes
    // in on an ease-in and the object passes the reader — and it has to be
    // most of the way in before the paper arrives, or nobody sees it.
    const rush = Math.pow(remap(t, 0.16, 0.92), 1.9)

    camera.position.set(0.25 * (1 - rush), 0.12, 6.4 - 5.3 * rush)
    camera.lookAt(0, 0, 0)

    const el = group.current
    if (!el) return
    el.rotation.y = yaw
    el.rotation.x = -0.1 + 0.3 * rush
    el.scale.setScalar(0.9)
  })

  return (
    <group ref={group}>
      <Pendant />
    </group>
  )
}

function Ready({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    const id = requestAnimationFrame(onReady)
    return () => cancelAnimationFrame(id)
  }, [onReady])
  return null
}
