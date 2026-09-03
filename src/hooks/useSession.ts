'use client'

import { useCallback, useEffect, useState } from 'react'

export interface AccountUser {
  id: string
  email: string
  hasApiKey: boolean
  createdAt: number
}

export interface SessionState {
  user: AccountUser | null
  /** Where the active Kie key comes from. */
  source: 'user' | 'env' | 'none'
  /** Masked form of the stored key. */
  masked: string | null
  /** The deployment also ships a key, used as a fallback. */
  envAvailable: boolean
  /** APP_SECRET is set, rather than a generated local secret. */
  secretFromEnv: boolean
  loading: boolean
}

const INITIAL: SessionState = {
  user: null,
  source: 'none',
  masked: null,
  envAvailable: false,
  secretFromEnv: false,
  loading: true,
}

/** The signed-in account and the state of its Kie.ai key. */
export function useSession() {
  const [state, setState] = useState<SessionState>(INITIAL)

  const refresh = useCallback(async () => {
    try {
      const [meRes, keyRes] = await Promise.all([
        fetch('/api/auth/me', { cache: 'no-store' }),
        fetch('/api/kie/session', { cache: 'no-store' }),
      ])

      const me = (await meRes.json()) as { user: AccountUser | null }
      // 401 here just means no session; the key fields stay at their defaults.
      const key = keyRes.ok
        ? ((await keyRes.json()) as Omit<SessionState, 'loading' | 'user'>)
        : null

      setState({
        user: me.user,
        source: key?.source ?? 'none',
        masked: key?.masked ?? null,
        envAvailable: key?.envAvailable ?? false,
        secretFromEnv: key?.secretFromEnv ?? false,
        loading: false,
      })
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Detach the Kie key but stay signed in. */
  const removeKey = useCallback(async () => {
    await fetch('/api/kie/session', { method: 'DELETE' })
    await refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    await refresh()
  }, [refresh])

  return { ...state, refresh, removeKey, signOut }
}
