'use client'

import { useCallback, useEffect, useState } from 'react'

import { useStudio } from '@/store/studio'

interface CreditsState {
  configured: boolean
  credits: number | null
  loading: boolean
  error?: string
}

/**
 * Poll the account balance. Refreshes on mount, when a job completes, and on
 * a slow interval so a long session does not show a stale number.
 */
export function useCredits() {
  const [state, setState] = useState<CreditsState>({
    configured: true,
    credits: null,
    loading: true,
  })

  // Account-wide, not the gallery's count: a filter on screen must not stop
  // the balance updating when a run finishes outside it.
  const completedCount = useStudio((s) => s.totals?.succeeded ?? 0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/kie/credits', { cache: 'no-store' })
      const data = (await res.json()) as CreditsState & { error?: string }
      setState({
        configured: data.configured,
        credits: typeof data.credits === 'number' ? data.credits : null,
        loading: false,
        error: data.error,
      })
    } catch {
      setState((s) => ({ ...s, loading: false, error: 'Balance unavailable.' }))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, completedCount])

  useEffect(() => {
    const id = setInterval(() => void refresh(), 120_000)
    return () => clearInterval(id)
  }, [refresh])

  return { ...state, refresh }
}
