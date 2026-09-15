import { useGLTF } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { TARGET_SIZE } from './rig'

export const MODEL_URL = '/models/pendant.glb'

/**
 * Meshopt on, Draco off.
 *
 * The export is meshopt-compressed (1.42 MB → 255 KB), and its decoder is
 * bundled with three-stdlib. drei would otherwise also configure a Draco
 * decoder from a Google CDN — harmless, since this file has no Draco in it,
 * but the site fetches nothing from anywhere it does not have to.
 */
const LOADER: [useDraco: false, useMeshopt: true] = [false, true]

/**
 * The material tune, and why it is not "materials as exported".
 *
 * The export gives the shell `metallic 0.92` over a base of #1A1A1C. For a
 * metal, base colour *is* reflectance: #1A1A1C is about 0.01 in linear
 * terms, so the shell returns roughly one per cent of whatever light
 * reaches it. That is not a dark object, it is an almost perfectly black
 * mirror, and no lighting rig brings it back — driving the panels bright
 * enough to lift the shell blows out the microphone mesh and the chamfers
 * long before the face reads as graphite.
 *
 * So the metal keeps its metalness and gets the reflectance that
 * bead-blasted anodised aluminium actually has. The numbers below aim at
 * the target the spec sets: lit faces around #3A3A3E, chamfers as thin
 * bright lines, and one soft highlight on the glass.
 *
 * The glass is the other change. At 0.05 roughness it is a mirror, and
 * what it mirrors is a 512px environment made of rectangular panels — so
 * it showed them as rectangles, hard edges and all. Blurring it slightly
 * turns those panels back into what they are meant to be: reflections.
 *
 * Spec: §6.1 ("tune only if the shell reads as pure black") and §6.2.
 */
const TUNING: Record<string, { color?: string; roughness?: number; metalness?: number }> = {
  'GLB Graphite': { color: '#4c4c52', roughness: 0.42, metalness: 0.9 },
  'GLB Edge': { color: '#6d6d75', roughness: 0.26, metalness: 0.9 },
  'GLB Glass': { color: '#191920', roughness: 0.3 },
  'GLB Tongue': { color: '#5a5a60', roughness: 0.4 },
  'GLB MicMesh': { color: '#6f6f76', roughness: 0.55 },
}

/**
 * The pendant itself: the export, normalised, with its own materials.
 *
 * Two things this component exists to get right.
 *
 * **Normalising.** The export is neither unit-scaled nor centred on its own
 * bounds, so every camera distance in `rig.ts` would be meaningless without
 * measuring it at load. The mesh is measured, centred and scaled so its
 * longest edge is TARGET_SIZE. Re-export the model at any size you like and
 * nothing here needs changing.
 *
 * **Cloning the materials.** `Object3D.clone()` copies the graph but keeps
 * references to the original materials. Without the clone below, any tuning
 * done here would write back into the cached GLTF and compound on every
 * remount — the shell would be a mirror by the third navigation. It is written down in
 * web/README.md too, because it was learned the expensive way.
 */
export function Pendant() {
  const { scene } = useGLTF(MODEL_URL, ...LOADER)

  const model = useMemo(() => {
    const root = scene.clone(true)

    const materials: THREE.Material[] = []
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const source = child.material as THREE.Material | THREE.Material[]
      if (Array.isArray(source)) {
        const cloned = source.map((m) => m.clone())
        materials.push(...cloned)
        child.material = cloned
      } else {
        const cloned = source.clone()
        materials.push(cloned)
        child.material = cloned
      }
      child.castShadow = true
      child.receiveShadow = false
    })

    // Applied after cloning, never before: writing these into the cached
    // GLTF would compound on every remount.
    for (const material of materials) {
      const tune = TUNING[material.name]
      if (!tune) continue
      const standard = material as THREE.MeshStandardMaterial
      if (tune.color) standard.color = new THREE.Color(tune.color)
      if (tune.roughness !== undefined) standard.roughness = tune.roughness
      if (tune.metalness !== undefined) standard.metalness = tune.metalness
      standard.needsUpdate = true
    }

    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const scale = TARGET_SIZE / (Math.max(size.x, size.y, size.z) || 1)

    // Centre inside a holder, then scale the holder: the offset is in the
    // export's own units, so it has to be applied before the scaling.
    const holder = new THREE.Group()
    root.position.sub(centre)
    holder.add(root)
    holder.scale.setScalar(scale)

    return { holder, materials }
  }, [scene])

  useEffect(() => () => model.materials.forEach((m) => m.dispose()), [model])

  return <primitive object={model.holder} />
}

useGLTF.preload(MODEL_URL, ...LOADER)
