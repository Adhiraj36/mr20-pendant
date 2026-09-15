import { useAuth } from '@clerk/clerk-react'
import { useMemo } from 'react'
import { API_URL } from './env'

/**
 * What the API says when a request fails, thrown rather than returned so a
 * page can `catch` it beside a network failure without a second branch.
 */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body && typeof body.error === 'string' && body.error) return body.error
  } catch {
    // Not JSON, or no body. The status text is the best that is left.
  }
  return res.statusText || `Request failed with status ${res.status}`
}

/**
 * The authenticated API client.
 *
 * Every request carries the caller's Clerk session token as a bearer
 * token — never a cookie, so `credentials` is left at its default. A
 * non-2xx response throws `ApiError` rather than resolving with one, so a
 * page's `try`/`catch` is the one place that has to think about failure.
 */
export function useApi() {
  const { getToken } = useAuth()

  return useMemo(() => {
    async function request<T>(path: string, init?: RequestInit): Promise<T> {
      const token = await getToken()

      const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      })

      if (!res.ok) throw new ApiError(res.status, await readErrorMessage(res))
      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    }

    return {
      get: <T>(path: string) => request<T>(path),
      post: <T>(path: string, body?: unknown) =>
        request<T>(path, {
          method: 'POST',
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
    }
  }, [getToken])
}
