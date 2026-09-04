'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

import { importLegacyHistory } from '@/lib/jobs/legacy'
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
  const setValues = useStudio((s) => s.setValues)
  const selectModel = useStudio((s) => s.selectModel)
  const activeCount = useStudio(selectActiveCount)

  /**
   * First paint: bring across anything this browser was still holding, then
   * read the account.
   *
   * The import runs before the first refresh so the gallery is never drawn
   * empty for someone whose whole history is a moment away from arriving.
   */
  useEffect(() => {
    let cancelled = false

    const start = async () => {
      try {
        const outcome = await importLegacyHistory()

        if (outcome && !cancelled) {
          if (outcome.imported > 0) {
            toast.success(
              `Moved ${outcome.imported} earlier generation${outcome.imported === 1 ? '' : 's'} into ${outcome.projectName}`,
              {
                description:
                  'They were stored in this browser. They now live with your account, so they follow you to any device.',
                duration: 9_000,
              },
            )
          }

          // The composer draft came from the same record, and losing what was
          // half typed would be its own small annoyance.
          const { modelId, formsByModel } = outcome.draft
          if (modelId) selectModel(modelId)
          if (modelId && formsByModel?.[modelId]) setValues(formsByModel[modelId])
        }
      } catch {
        // The import is best-effort: the old record is never deleted, so a
        // failure here costs nothing but a retry on the next load.
      }

      if (cancelled) return

      void refresh()
      void loadProjects()
      void loadUsage()
      void loadLibrary()
    }

    void start()
    return () => {
      cancelled = true
    }
  }, [refresh, loadProjects, loadUsage, loadLibrary, selectModel, setValues])

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
