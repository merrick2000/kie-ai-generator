'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'

import { getModel } from '@/lib/kie/catalog'
import { explainError, type FriendlyError } from '@/lib/kie/errors'
import { validate } from '@/lib/kie/fields'
import type { Job } from '@/lib/jobs/types'
import { useStudio } from '@/store/studio'

const TOP_UP_URL = 'https://kie.ai/billing'

/** Surface a failure with its next step attached, so the toast is useful. */
function reportError(title: string, error: FriendlyError): void {
  const description = error.hint ? `${error.message} ${error.hint}` : error.message

  if (error.action.kind === 'top-up') {
    toast.error(title, {
      description,
      duration: 10_000,
      action: {
        label: 'Top up',
        onClick: () => window.open(TOP_UP_URL, '_blank', 'noopener,noreferrer'),
      },
    })
    return
  }

  toast.error(title, { description, duration: error.retryable ? 6_000 : 9_000 })
}

/**
 * Starting a generation.
 *
 * Short, now that the server owns what happens next. This validates, posts,
 * and lets the sync loop deliver the outcome. Nothing here has to survive the
 * component unmounting, because nothing here is tracking anything.
 */
export function useGeneration() {
  const refresh = useStudio((s) => s.refresh)

  const generate = useCallback(async (): Promise<Job | null> => {
    const state = useStudio.getState()
    const model = getModel(state.modelId)

    if (!model) {
      toast.error('No model selected.')
      return null
    }

    const values = state.currentValues()

    // Checked here as well as on the server: catching a missing field before
    // the request means an instant answer instead of a round trip.
    const errors = validate(model.fields, values)
    if (errors.length) {
      toast.error('Check the form', {
        description: errors.length > 1 ? `${errors[0]} (+${errors.length - 1} more)` : errors[0],
      })
      return null
    }

    try {
      const res = await fetch('/api/kie/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model.id,
          values,
          projectId: state.activeProjectId,
        }),
      })

      const data = (await res.json()) as {
        job?: Job
        error?: string
        code?: number
      }

      if (!res.ok || !data.job) {
        const explained = explainError(res.status, data.code, data.error)
        reportError('Could not start generation', explained)
        // The server records a failed job even when the submission is
        // refused, so the attempt is visible rather than silently dropped.
        void refresh()
        return null
      }

      // Shows the new card immediately; the sync loop takes it from there.
      await refresh()
      return data.job
    } catch {
      const message = 'Could not reach the server. Check your connection.'
      toast.error('Could not start generation', { description: message })
      return null
    }
  }, [refresh])

  /**
   * Stop following a job.
   *
   * Kie has no cancel endpoint, so this only removes it from view. The task
   * still runs, and still bills, upstream, which the confirmation says.
   */
  const cancel = useCallback(async (jobId: string) => {
    await useStudio.getState().removeJob(jobId)
    toast.message('Removed from the gallery', {
      description: 'Kie has no cancel endpoint, so the task still runs and still bills there.',
    })
  }, [])

  return { generate, cancel }
}
