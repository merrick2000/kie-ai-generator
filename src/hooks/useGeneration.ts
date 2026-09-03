'use client'

import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { getModel } from '@/lib/kie/catalog'
import { validate } from '@/lib/kie/fields'
import type { NormalizedTask } from '@/lib/kie/tasks'
import { truncate } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import type { Job } from '@/store/types'

/**
 * Polling cadence.
 *
 * Kie allows 20 requests / 10s per account, and generations run from ~10s to
 * several minutes. Polling starts tight so quick image jobs feel instant, then
 * backs off so a long video render does not burn the rate limit.
 */
const POLL_START_MS = 1_500
const POLL_MAX_MS = 8_000
const POLL_GROWTH = 1.25
const TIMEOUT_MS = 15 * 60 * 1000

/** Consecutive network failures tolerated before a job is marked failed. */
const MAX_CONSECUTIVE_ERRORS = 5

interface SubmitResponse {
  taskId: string
  api: 'market' | 'veo' | 'suno'
  modelId: string
}

export function useGeneration() {
  const addJob = useStudio((s) => s.addJob)
  const updateJob = useStudio((s) => s.updateJob)
  const applyTask = useStudio((s) => s.applyTask)
  const failJob = useStudio((s) => s.failJob)

  /** Timers keyed by job id, so unmount and cancel can clear them. */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const stopPolling = useCallback((jobId: string) => {
    const timer = timers.current.get(jobId)
    if (timer) clearTimeout(timer)
    timers.current.delete(jobId)
  }, [])

  const poll = useCallback(
    (job: Job, taskId: string, api: string, modelId: string) => {
      const startedAt = Date.now()
      let delay = POLL_START_MS
      let errorStreak = 0

      const tick = async () => {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          failJob(job.id, 'Timed out after 15 minutes. Check kie.ai/logs for the task.')
          stopPolling(job.id)
          return
        }

        try {
          const params = new URLSearchParams({ taskId, api, modelId })
          const res = await fetch(`/api/kie/status?${params}`, { cache: 'no-store' })
          const data = (await res.json()) as NormalizedTask & { error?: string }

          if (!res.ok) throw new Error(data.error || `Status check failed (${res.status}).`)

          errorStreak = 0
          applyTask(job.id, data)

          if (data.state === 'success') {
            stopPolling(job.id)
            toast.success('Generation complete', {
              description: truncate(job.promptPreview || job.modelName, 60),
            })
            return
          }

          if (data.state === 'fail') {
            stopPolling(job.id)
            toast.error('Generation failed', { description: data.error })
            return
          }
        } catch (err) {
          errorStreak += 1
          if (errorStreak >= MAX_CONSECUTIVE_ERRORS) {
            const message = err instanceof Error ? err.message : 'Lost contact with the task.'
            failJob(job.id, message)
            stopPolling(job.id)
            toast.error('Generation failed', { description: message })
            return
          }
          // Transient failure, fall through and retry on the next tick.
        }

        delay = Math.min(POLL_MAX_MS, delay * POLL_GROWTH)
        timers.current.set(job.id, setTimeout(tick, delay))
      }

      timers.current.set(job.id, setTimeout(tick, POLL_START_MS))
    },
    [applyTask, failJob, stopPolling],
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
      toast.error('Check the form', { description: errors[0] })
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

      const data = (await res.json()) as SubmitResponse & { error?: string }

      if (!res.ok || !data.taskId) {
        throw new Error(data.error || `Submission failed (${res.status}).`)
      }

      updateJob(job.id, { taskId: data.taskId, state: 'queuing', progress: 8 })
      poll(job, data.taskId, data.api, model.id)
      return job
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Submission failed.'
      failJob(job.id, message)
      toast.error('Could not start generation', { description: message })
      return null
    }
  }, [addJob, failJob, poll, updateJob])

  const cancel = useCallback(
    (jobId: string) => {
      stopPolling(jobId)
      // Kie has no cancel endpoint: this stops local tracking only, and the
      // task still runs (and bills) upstream.
      failJob(jobId, 'Stopped tracking. The task may still complete on kie.ai.')
    },
    [failJob, stopPolling],
  )

  // Clear every pending timer when the hook's owner unmounts.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  return { generate, cancel }
}
