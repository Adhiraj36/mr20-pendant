import { useCallback, useEffect, useRef, useState } from 'react'
import type { DaemonStatus, Settings } from '@shared/types'

/** A promise, with the three states a screen actually has to render. */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fn()
      .then((v) => {
        if (!alive.current) return
        setData(v)
        setError(null)
      })
      .catch((e: Error) => {
        if (!alive.current) return
        setError(e.message)
      })
      .finally(() => {
        if (alive.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) }
}

/** The daemon's state, kept live by the main process rather than polled. */
export function useDaemon(): DaemonStatus | null {
  const [status, setStatus] = useState<DaemonStatus | null>(null)
  useEffect(() => {
    void window.karmax.daemon.status().then(setStatus)
    return window.karmax.daemon.onChange(setStatus)
  }, [])
  return status
}

/** Settings, with a save that reflects what the file now says rather than what
 *  the form hoped it would say. */
export function useSettings(): {
  settings: Settings | null
  save: (patch: Parameters<typeof window.karmax.config.patch>[0]) => Promise<void>
  reload: () => Promise<void>
  saving: boolean
} {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    setSettings(await window.karmax.config.settings())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(async (patch: Parameters<typeof window.karmax.config.patch>[0]) => {
    setSaving(true)
    try {
      setSettings(await window.karmax.config.patch(patch))
    } finally {
      setSaving(false)
    }
  }, [])

  return { settings, save, reload, saving }
}

/** Debounce a value — used so a text field saves as you stop typing rather
 *  than on every keystroke. */
export function useDebounced<T>(value: T, ms = 600): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** True after the first render, so an effect can tell "the user changed this"
 *  from "the form just loaded". */
export function useMounted(): boolean {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])
  return mounted.current
}
