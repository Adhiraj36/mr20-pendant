import { useEffect, useState } from 'react'
import { API_URL } from './env'

/**
 * "X/100 people already bought", read once on mount.
 *
 * No session, no polling — GET /orders/count is public and the number
 * changes slowly enough that a page load is a fine cadence. `of` and
 * `count` both come from the server (backend/go/internal/api/orders.go),
 * which is also where the floor-of-36 / freeze-at-95 clamp lives, so a
 * fetch that never lands still shows the same 36/100 a signed-out visitor
 * on day one would have seen from the server.
 */
export function useOrderCount() {
  const [count, setCount] = useState(36)
  const [of, setOf] = useState(100)

  useEffect(() => {
    let cancelled = false

    fetch(`${API_URL}/orders/count`)
      .then((res) => (res.ok ? (res.json() as Promise<{ count: number; of: number }>) : null))
      .then((body) => {
        if (cancelled || !body) return
        setCount(body.count)
        setOf(body.of)
      })
      .catch(() => {
        // The fallback state above is already the right thing to show.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { count, of }
}
