import { useEffect, useRef, useState, type RefObject } from 'react'
import { registerStage, setReducedMotion, subscribe } from './scroll'

/** Registers an element as a named scroll stage for the whole page to read. */
export function useStage<T extends HTMLElement>(id: string) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return registerStage(id, el)
  }, [id])
  return ref
}

/**
 * Runs a function every frame the page is moving, with the damped scroll
 * position. Write to the DOM inside it; do not set React state.
 */
export function useScrollFrame(fn: (y: number, vh: number) => void) {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => subscribe((y, vh) => latest.current(y, vh)), [])
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setReduced(query.matches)
      setReducedMotion(query.matches)
    }
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return reduced
}

/** Matches a media query, and keeps matching as the window changes. */
export function useMedia(query: string, fallback = false) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return fallback
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const mq = window.matchMedia(query)
    const sync = () => setMatches(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])

  return matches
}

/** True once the element has been seen. Fires once, then stops observing. */
export function useSeen(ref: RefObject<HTMLElement | null>, rootMargin = '0px 0px -20% 0px') {
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { rootMargin, threshold: 0.08 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, rootMargin])

  return seen
}

/** True while the element is on screen at all. Used to pause timed loops. */
export function useOnScreen(ref: RefObject<HTMLElement | null>, threshold = 0.4) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold,
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, threshold])

  return visible
}

/**
 * Whether this device should be asked to run the 3D scene at all.
 *
 * Spec §6.6: a failed WebGL context, four cores or fewer, four gigabytes or
 * less, or reduced motion. Any one of them and the poster is used instead.
 * Deliberately conservative — the page is complete without the canvas, and
 * a stuttering pendant is worse than a still one.
 */
export function useCanRender3D() {
  const reduced = usePrefersReducedMotion()
  const [able, setAble] = useState<boolean | null>(null)

  useEffect(() => {
    if (reduced) {
      setAble(false)
      return
    }
    // ?poster=1 in development: see what most phones see. The thresholds
    // below rule out the canvas on any device with four cores or four
    // gigabytes, which is most of them, and a desktop cannot otherwise
    // reach that path to check it.
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('poster') === '1') {
      setAble(false)
      return
    }

    const nav = navigator as Navigator & { deviceMemory?: number }
    if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4) {
      setAble(false)
      return
    }
    if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) {
      setAble(false)
      return
    }

    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      if (!gl) {
        setAble(false)
        return
      }
      // Release it immediately; this was only ever a capability probe.
      const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')
      lose?.loseContext()
      setAble(true)
    } catch {
      setAble(false)
    }
  }, [reduced])

  return able
}
