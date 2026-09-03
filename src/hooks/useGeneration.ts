'use client'

import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'

import { getModel } from '@/lib/kie/catalog'
import { explainError, explainTaskFailure, type FriendlyError } from '@/lib/kie/errors'
import { validate } from '@/lib/kie/fields'
import { pollScheduler } from '@/lib/kie/poll-scheduler'
import type { NormalizedTask } from '@/lib/kie/tasks'
import { truncate } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import type { Job } from '@/store/types'

interface SubmitResponse {
  taskId: string
  api: 'market' | 'veo' | 'suno'
  modelId: string
}

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

export function useGeneration() {
  const addJob = useStudio((s) => s.addJob)
  const updateJob = useStudio((s) => s.updateJob)
  const applyTask = useStudio((s) => s.applyTask)
  const failJob = useStudio((s) => s.failJob)

  /**
   * Hand a submitted job to the shared scheduler.
   *
   * The scheduler owns the timing and the request budget; this only says what
   * a single poll does and how to interpret the outcome.
   */
  const track = useCallback(
    (job: Job, taskId: string, api: string, modelId: string) => {
      pollScheduler.add({
        id: job.id,
        startedAt: Date.now(),

        poll: async () => {
          const params = new URLSearchParams({ taskId, api, modelId })
          const res = await fetch(`/api/kie/status?${params}`, { cache: 'no-store' })
          const data = (await res.json()) as NormalizedTask & {
            error?: string
            code?: number
          }

          if (!res.ok) {
            const explained = explainError(res.status, data.code, data.error)
            // A transient upstream problem should not end the job; the
            // scheduler retries until the error streak runs out.
            if (explained.retryable) throw new Error(explained.message)

            failJob(job.id, explained.message)
            reportError('Generation failed', explained)
            return true
          }

          applyTask(job.id, data)

          if (data.state === 'success') {
            toast.success('Generation complete', {
              description: truncate(job.promptPreview || job.modelName, 60),
            })
            return true
          }

          if (data.state === 'fail') {
            const explained = explainTaskFailure(data.error)
            failJob(job.id, explained.message)
            reportError('Generation failed', explained)
            return true
          }

          return false
        },

        onTimeout: () => {
          failJob(job.id, 'Timed out after 15 minutes. Check kie.ai/logs for the task.')
          toast.error('Generation timed out', {
            description: 'It may still finish on kie.ai. Check the logs there.',
          })
        },

        onGiveUp: (error) => {
          failJob(job.id, error.message)
          toast.error('Lost contact with the generation', { description: error.message })
        },
      })
    },
    [applyTask, failJob],
  )

  const generate = useCallback(async (): Promise<Job | null> => {
    const state = useStudio.getState()
    const model = getModel(state.modelId)

    if (!model) {
      toast.error('No model selected.')
      return null
    }

    const values = state.currentValues()
    const errors = validate(model.fields, values)

    if (errors.length) {
      toast.error('Check the form', {
        description: errors.length > 1 ? `${errors[0]} (+${errors.length - 1} more)` : errors[0],
      })
      return null
    }

    const promptSource =
      (values.prompt as string) || (values.text as string) || (values.title as string) || ''

    const job = addJob({
      taskId: null,
      api: model.api,
      modelId: model.id,
      modelName: model.name,
      values: { ...values },
      promptPreview: promptSource.trim(),
      output: model.output,
      state: 'waiting',
      progress: 2,
      assets: [],
    })

    try {
      const res = await fetch('/api/kie/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: model.id, values }),
      })

      const data = (await res.json()) as SubmitResponse & { error?: string; code?: number }

      if (!res.ok || !data.taskId) {
        const explained = explainError(res.status, data.code, data.error)
        failJob(job.id, explained.message)
        reportError('Could not start generation', explained)
        return null
      }

      updateJob(job.id, { taskId: data.taskId, state: 'queuing', progress: 8 })
      track(job, data.taskId, data.api, model.id)
      return job
    } catch {
      const message = 'Could not reach the server. Check your connection.'
      failJob(job.id, message)
      toast.error('Could not start generation', { description: message })
      return null
    }
  }, [addJob, failJob, track, updateJob])

  const cancel = useCallback(
    (jobId: string) => {
      pollScheduler.remove(jobId)
      // Kie has no cancel endpoint: this stops local tracking only, and the
      // task still runs, and still bills, upstream.
      failJob(jobId, 'Stopped tracking. The task may still complete on kie.ai.')
    },
    [failJob],
  )

  // The scheduler outlives any single component, so nothing is torn down here.
  // Tasks remove themselves when they finish, time out, or are cancelled.
  useEffect(() => undefined, [])

  return { generate, cancel, activePolls: pollScheduler.size }
}
