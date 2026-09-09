'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { isRunning, jobLabel, type Job } from '@/lib/jobs/types'
import { truncate } from '@/lib/utils'
import { selectActiveCount, useStudio } from '@/store/studio'

/**
 * Tell people when a run finishes.
 *
 * A video can take ten minutes. Without this the only way to know it is done
 * is to keep the tab in front of you, which is the opposite of the point of
 * moving generations to the server.
 *
 * Three signals, in increasing order of interruption: the count in the tab
 * title, which is always there; a toast, for when you are looking; and a
 * system notification, only once someone has asked for one.
 */

const TITLE = 'Highfield, an AI generation studio'

export function useCompletionAlerts(): void {
  const jobs = useStudio((s) => s.jobs)
  const running = useStudio(selectActiveCount)

  /**
   * What each job's state was last time. The first pass only records: a
   * reload would otherwise announce every result in the gallery at once.
   */
  const seen = useRef<Map<string, Job['state']> | null>(null)

  useEffect(() => {
    const previous = seen.current
    const current = new Map(jobs.map((job) => [job.id, job.state]))

    if (previous) {
      for (const job of jobs) {
        const before = previous.get(job.id)
        // Only a transition, and only from a state that was still moving.
        if (!before || before === job.state || !isRunning({ state: before })) continue
        if (isRunning(job)) continue

        announce(job)
      }
    }

    seen.current = current
  }, [jobs])

  // The tab title carries the count, so a glance at the tab strip answers
  // "is it done yet" without switching to the window.
  useEffect(() => {
    document.title = running > 0 ? `(${running}) ${TITLE}` : TITLE
    return () => {
      document.title = TITLE
    }
  }, [running])
}

/**
 * How much of a prompt a toast is allowed to repeat.
 *
 * The description was the prompt, whole. A long one turned the toast into a
 * column of text from the top of the screen to the bottom, over the gallery it
 * was announcing. This is enough to recognise which run finished, which is all
 * a toast is for.
 */
const TOAST_CHARS = 110

/**
 * The line under a toast's title.
 *
 * Exported so the bound is something a test can hold rather than something
 * this file merely intends. A toast is a glance, not a document.
 */
export function alertDescription(job: Pick<Job, 'title' | 'promptPreview' | 'modelName' | 'state' | 'error'>): string {
  const label = jobLabel(job)
  return truncate(job.state === 'fail' ? (job.error ?? label) : label, TOAST_CHARS)
}

function announce(job: Job): void {
  const description = alertDescription(job)

  if (job.state === 'fail') {
    toast.error(`${job.modelName} failed`, { description, duration: 9_000 })
  } else {
    toast.success('Generation complete', { description })
  }

  // Only when the tab is not in front of them: a system notification for
  // something already on screen is noise.
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  if (!document.hidden) return

  try {
    const notification = new Notification(
      job.state === 'fail' ? `${job.modelName} failed` : `${job.modelName} finished`,
      {
        body: description,
        // One notification per job, so a batch of eight does not stack.
        tag: job.id,
        icon: '/icon.svg',
      },
    )

    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch {
    // Some browsers refuse to construct one outside a service worker. The
    // toast and the title have already done the job.
  }
}

/**
 * Ask for permission to notify.
 *
 * Called from a click, never on load: an unprompted permission dialog is the
 * fastest way to have someone deny it forever.
 */
export async function requestCompletionAlerts(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission !== 'default') return Notification.permission

  return Notification.requestPermission()
}
