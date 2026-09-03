/**
 * Central poll scheduler.
 *
 * One timer drives every in-flight generation, instead of each job owning its
 * own. That matters at scale: with a timer per job, ten concurrent
 * generations at a 1.5s interval issue roughly 67 requests per 10 seconds,
 * well past Kie's limit of 20, and the whole set starts failing with 429s.
 *
 * Here every poll is spent from a shared token bucket, so adding jobs slows
 * each one down rather than breaking all of them.
 */

import { KIE_POLL_BUDGET, TokenBucket } from '@/lib/rate-limiter'

export interface PollTask {
  id: string
  /** Performs one poll. Resolves true when the task is finished. */
  poll: () => Promise<boolean>
  /** Called when the task exceeds its deadline. */
  onTimeout: () => void
  /** Called after too many consecutive failures. */
  onGiveUp: (error: Error) => void
  startedAt: number
}

interface TrackedTask extends PollTask {
  nextDueAt: number
  intervalMs: number
  errorStreak: number
  inFlight: boolean
}

/** Polling starts tight so quick image jobs feel immediate. */
const START_INTERVAL_MS = 1_500
const MAX_INTERVAL_MS = 8_000
const GROWTH = 1.25

const TIMEOUT_MS = 15 * 60 * 1000
const MAX_CONSECUTIVE_ERRORS = 5

/** How often the loop wakes to look for due tasks. */
const TICK_MS = 400

class PollScheduler {
  private tasks = new Map<string, TrackedTask>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly bucket = new TokenBucket(KIE_POLL_BUDGET)

  add(task: PollTask): void {
    this.tasks.set(task.id, {
      ...task,
      nextDueAt: Date.now() + START_INTERVAL_MS,
      intervalMs: START_INTERVAL_MS,
      errorStreak: 0,
      inFlight: false,
    })
    this.start()
  }

  remove(id: string): void {
    this.tasks.delete(id)
    if (this.tasks.size === 0) this.stop()
  }

  has(id: string): boolean {
    return this.tasks.has(id)
  }

  get size(): number {
    return this.tasks.size
  }

  private start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  private stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    const now = Date.now()

    // Oldest due first, so a long queue cannot starve the job that has been
    // waiting longest.
    const due = [...this.tasks.values()]
      .filter((t) => !t.inFlight && t.nextDueAt <= now)
      .sort((a, b) => a.nextDueAt - b.nextDueAt)

    for (const task of due) {
      if (now - task.startedAt > TIMEOUT_MS) {
        this.remove(task.id)
        task.onTimeout()
        continue
      }

      // Out of budget: leave the rest for a later tick rather than queueing
      // requests that will only come back as 429s.
      if (!this.bucket.tryTake()) break

      void this.run(task)
    }
  }

  private async run(task: TrackedTask): Promise<void> {
    task.inFlight = true

    try {
      const finished = await task.poll()
      task.errorStreak = 0

      if (finished) {
        this.remove(task.id)
        return
      }
    } catch (err) {
      task.errorStreak += 1

      if (task.errorStreak >= MAX_CONSECUTIVE_ERRORS) {
        this.remove(task.id)
        task.onGiveUp(err instanceof Error ? err : new Error('Lost contact with the task.'))
        return
      }
    } finally {
      task.inFlight = false
    }

    // Back off so a long render does not keep spending budget that a newly
    // submitted job could use.
    task.intervalMs = Math.min(MAX_INTERVAL_MS, task.intervalMs * GROWTH)
    task.nextDueAt = Date.now() + task.intervalMs
  }

  /** Drop every task. Used when the owning component unmounts. */
  clear(): void {
    this.tasks.clear()
    this.stop()
  }
}

/**
 * Shared across the app.
 *
 * A single instance is the point: two schedulers would each hold their own
 * budget and together exceed the limit.
 */
export const pollScheduler = new PollScheduler()
