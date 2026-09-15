import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { PendantScene } from './PendantScene'
import { FOV_DESKTOP, type RigState } from './rig'

/**
 * The WebGL half of the pendant, kept behind a lazy import.
 *
 * Everything that touches three.js lives on this side of the boundary —
 * the canvas element, the renderer settings, the scene — so the landing
 * page's own bundle never pulls a megabyte of 3D in just to decide whether
 * it can use it. `PendantCanvas` imports this only once it knows the
 * device can run it.
 */
export default function PendantStage({
  mobile,
  active,
  onOpacity,
  onReady,
  override,
}: {
  mobile: boolean
  active: boolean
  onOpacity: (value: number) => void
  onReady: (canvas: HTMLCanvasElement) => void
  override?: RigState
}) {
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      /* The object is a hard-edged square against a plain ground, which is
         the worst case for a jagged silhouette: there is no texture or
         detail for the eye to lose the staircase in. So the phone gets
         multisampling too, and enough device pixels to put it on — capped
         at 1.5 it was rendering below a 2× screen and being scaled up,
         which is the same staircase again with a blur over it. What pays
         for both is that this canvas draws one small object in front of a
         256px environment, and stops entirely (`frameloop="never"`) for the
         four sections where it is not on screen. */
      dpr={mobile ? [1, 2] : [1, 1.75]}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: FOV_DESKTOP, near: 0.1, far: 50, position: [0, 0, 6.4] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.1
        gl.outputColorSpace = THREE.SRGBColorSpace
      }}
    >
      <Suspense fallback={null}>
        <PendantScene mobile={mobile} onOpacity={onOpacity} override={override} />
        <Ready onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}

/**
 * Fires once the model has finished loading, because it is a sibling of the
 * thing that suspends: React cannot mount this until the pendant is there.
 */
function Ready({ onReady }: { onReady: (canvas: HTMLCanvasElement) => void }) {
  useEffect(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-engine]')
    const id = requestAnimationFrame(() => {
      if (canvas) onReady(canvas)
    })
    return () => cancelAnimationFrame(id)
  }, [onReady])
  return null
}
