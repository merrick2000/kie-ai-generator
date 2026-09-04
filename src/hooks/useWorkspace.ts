'use client'

import { useEffect } from 'react'

import { selectActiveCount, useStudio } from '@/store/studio'

/** While something is generating, the gallery has to keep up with it. */
const ACTIVE_MS = 2_000

/** Otherwise a slow heartbeat, enough to catch work started elsewhere. */
const IDLE_MS = 20_000

/**
 * Keep the studio in step with the server.
 *
 * Mounted once, at the top of the studio. There is no per-job tracking any
 * more: one loop asks what changed since the last answer, which is why a
 * reload no longer loses a generation and why two tabs, or two devices, show
 * the same thing.
 *
 * Polling stops entirely while the tab is hidden, and resumes with an
 * immediate sync when it comes back, so a laptop closed mid-render does not
 * spend the night making requests.
 */
export function useWorkspace(): void {
  const refresh = useStudio((s) => s.refresh)
  const sync = useStudio((s) => s.sync)
  const loadProjects = useStudio((s) => s.loadProjects)
  const loadUsage = useStudio((s) => s.loadUsage)
  const loadLibrary = useStudio((s) => s.loadLibrary)
  const activeCount = useStudio(selectActiveCount)

  // First paint: the full picture.
  useEffect(() => {
    void refresh()
    void loadProjects()
    void loadUsage()
    void loadLibrary()
  }, [refresh, loadProjects, loadUsage, loadLibrary])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    const start = () => {
      stop()
      if (document.hidden) return
      timer = setInterval(() => void sync(), activeCount > 0 ? ACTIVE_MS : IDLE_MS)
    }

    const onVisibility = () => {
      // Coming back is exactly when the answer is most likely to have
      // changed, so ask straight away rather than waiting out an interval.
      if (!document.hidden) void sync()
      start()
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [sync, activeCount])
}
