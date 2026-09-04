/**
 * Server-side generation reconciler.
 *
 * The browser used to own polling, which meant a generation only existed for
 * as long as its tab did: reload, and the job was orphaned mid-flight with the
 * credits already spent. This loop takes that job over. It runs whether or not
 * anyone is connected, so closing the laptop and coming back tomorrow shows a
 * finished result rather than a lost one.
 *
 * Safe on more than one instance: jobs are claimed with a lease and
 * `FOR UPDATE SKIP LOCKED`, so two containers never poll the same task.
 */

import 'server-only'

import { apiKeyForUser } from '@/lib/auth'
import {
  applyTaskResult,
  claimDueJobs,
  countPending,
  deferJob,
  failJob,
  failOrphanedJobs,
  failStalledChatJobs,
  type ClaimedJob,
} from '@/lib/jobs/store'
import { createLogger } from '@/lib/logger'
import { KIE_POLL_BUDGET, TokenBucket } from '@/lib/rate-limiter'
import { KieError, runWithApiKey } from './client'
import { KIE_CODE } from './types'
import { pollTask, type NormalizedTask } from './tasks'
import type { ModelApi } from './catalog'

const log = createLogger('reconcile')

/** How often the loop looks for due jobs. */
const TICK_MS = 1_000

/** Jobs claimed per tick. The token buckets throttle the actual requests. */
const BATCH = 12

/** A claim is released this long after it is taken, even if we crash. */
const LEASE_MS = 30_000

/**
 * When to give up on a task.
 *
 * Long video renders genuinely take ten minutes or more, so this is generous.
 * Past it the job is almost certainly stuck rather than slow, and leaving a
 * spinner forever is worse than saying so.
 */
const DEADLINE_MS = 45 * 60 * 1000

/** Consecutive upstream failures before a job is written off. */
const MAX_ERRORS = 8

/** A row inserted but never submitted is dead after this. */
const ORPHAN_AFTER_MS = 2 * 60 * 1000

/**
 * A text run is finished by a promise in one process, not by this loop, so a
 * restart mid-answer leaves nothing to write the result. Well past the
 * client's own five-minute timeout, so a slow reasoning model is never cut
 * off by the sweep rather than by its own deadline.
 */
const CHAT_STALL_AFTER_MS = 10 * 60 * 1000

/**
 * How long to wait before polling this job again.
 *
 * Tight at first, because a small image is often done in three seconds and
 * anything slower feels broken. Loosening with age keeps a ten-minute video
 * from spending the whole budget on questions with the same answer.
 *
 * Exported for the tests, which check the curve rather than the clock.
 */
export function nextPollDelay(ageMs: number): number {
  if (ageMs < 15_000) return 2_000
  if (ageMs < 60_000) return 4_000
  if (ageMs < 5 * 60_000) return 8_000
  return 15_000
}

/** Backoff after an upstream error, so a flapping API is not hammered. */
export function errorBackoff(errorCount: number): number {
  return Math.min(60_000, 3_000 * 2 ** Math.max(0, errorCount - 1))
}

/**
 * One bucket per account.
 *
 * Kie's limit is per API key, so a single shared budget would make one busy
 * user throttle everyone else on the instance for no reason.
 */
const buckets = new Map<string, TokenBucket>()

function bucketFor(userId: string): TokenBucket {
  let bucket = buckets.get(userId)
  if (!bucket) {
    bucket = new TokenBucket(KIE_POLL_BUDGET)
    buckets.set(userId, bucket)
  }
  return bucket
}

/** Consecutive failures per job. Process-local; the deadline is the backstop. */
const errorCounts = new Map<string, number>()

/**
 * A job deleted mid-streak never clears its own entry, so the map is trimmed
 * rather than left to grow for the life of the process. Losing a count only
 * costs a job one extra retry.
 */
function pruneErrorCounts(): void {
  if (errorCounts.size <= 500) return
  errorCounts.clear()
}

/**
 * Keys are looked up per poll, so a short cache saves a decrypt and a query
 * on every tick of every job.
 */
const keyCache = new Map<string, { key: string | null; readAt: number }>()
const KEY_TTL_MS = 60_000

async function keyFor(userId: string): Promise<string | null> {
  const cached = keyCache.get(userId)
  if (cached && Date.now() - cached.readAt < KEY_TTL_MS) return cached.key

  const key = await apiKeyForUser(userId)
  keyCache.set(userId, { key, readAt: Date.now() })
  return key
}

/** Forget a user's cached key, after they change or remove it. */
export function forgetCachedKey(userId: string): void {
  keyCache.delete(userId)
}

/* ────────────────────────────────────────────────────────────────────────────
 * One job
 * ──────────────────────────────────────────────────────────────────────────*/

async function reconcileOne(job: ClaimedJob): Promise<void> {
  const age = Date.now() - job.createdAt

  if (age > DEADLINE_MS) {
    await failJob(
      job.id,
      'Gave up after 45 minutes. The task may still finish on kie.ai, check the logs there.',
    )
    errorCounts.delete(job.id)
    log.warn('job passed its deadline', { jobId: job.id, taskId: job.taskId, model: job.modelId })
    return
  }

  const key = await keyFor(job.userId)
  if (!key) {
    // Nothing can be done for this job until a key comes back, and failing it
    // would throw away a result that is probably waiting upstream.
    await deferJob(job.id, Date.now() + 60_000)
    return
  }

  if (!job.taskId) {
    await deferJob(job.id, Date.now() + 5_000)
    return
  }

  let task: NormalizedTask
  try {
    task = await runWithApiKey(key, () =>
      pollTask(job.taskId as string, job.api as ModelApi, job.modelId),
    )
  } catch (err) {
    // A rejected key or an unknown task will not fix itself, so those end the
    // job now rather than retrying for three quarters of an hour.
    const fatal =
      err instanceof KieError &&
      (err.code === KIE_CODE.UNAUTHORIZED || err.code === KIE_CODE.NOT_FOUND)

    const count = (errorCounts.get(job.id) ?? 0) + 1
    errorCounts.set(job.id, count)

    if (fatal || count >= MAX_ERRORS) {
      const message =
        err instanceof Error ? err.message : 'Lost contact with the generation.'
      await failJob(job.id, message)
      errorCounts.delete(job.id)
      log.warn('job abandoned', {
        jobId: job.id,
        taskId: job.taskId,
        attempts: count,
        fatal,
        reason: message,
      })
      return
    }

    log.debug('poll failed, will retry', { jobId: job.id, attempt: count })
    await deferJob(job.id, Date.now() + errorBackoff(count))
    return
  }

  errorCounts.delete(job.id)
  await applyTaskResult(job.id, task, Date.now() + nextPollDelay(age))

  if (task.state === 'success' || task.state === 'fail') {
    log.info(task.state === 'success' ? 'finished' : 'failed upstream', {
      jobId: job.id,
      taskId: job.taskId,
      model: job.modelId,
      assets: task.assets.length,
      credits: task.creditsConsumed ?? undefined,
      seconds: Math.round(age / 1000),
      ...(task.state === 'fail' ? { reason: task.error } : {}),
    })
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The loop
 * ──────────────────────────────────────────────────────────────────────────*/

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false
let ticks = 0

async function tick(): Promise<void> {
  // Ticks never overlap. A slow upstream would otherwise stack them until the
  // process runs out of sockets.
  if (ticking) return
  ticking = true

  try {
    const claimed = await claimDueJobs(BATCH, LEASE_MS)
    if (!claimed.length) return

    // Each job is charged to its own account's budget, so one busy user
    // cannot throttle everyone else on the instance.
    const running: Promise<void>[] = []

    for (const job of claimed) {
      if (!bucketFor(job.userId).tryTake()) {
        // Out of budget: hand it back for the next tick rather than queueing
        // a request that would come back as a 429.
        running.push(deferJob(job.id, Date.now() + 1_500))
        continue
      }

      running.push(
        reconcileOne(job).catch((err) => {
          log.error('reconcile threw', { jobId: job.id, error: err })
          return deferJob(job.id, Date.now() + 10_000)
        }),
      )
    }

    await Promise.all(running)
  } catch (err) {
    // The database being briefly unreachable must not kill the loop.
    log.error('reconciler tick failed', { error: err })
  } finally {
    // Released before the sweep, deliberately: the sweep only touches rows
    // the claim query ignores, so there is no reason to hold polling up for
    // it.
    ticking = false

    // Roughly every two minutes, without a second timer.
    if (++ticks % 120 === 0) {
      await sweep()
      pruneErrorCounts()
    }
  }
}

/**
 * Start the loop.
 *
 * Idempotent, because Next's dev server re-runs module initialisation on edit
 * and two loops would double every poll.
 */
export function startReconciler(): void {
  if (timer) return

  timer = setInterval(() => void tick(), TICK_MS)
  // Not a reason to keep the process alive on its own.
  timer.unref?.()

  log.info('started', {
    tickMs: TICK_MS,
    batch: BATCH,
    deadlineMinutes: DEADLINE_MS / 60_000,
  })

  // Anything left mid-flight by the previous process is picked up on the
  // first tick, since the claim query only looks at what is due. What cannot
  // be picked up is closed here instead.
  void sweep()
    .then((closed) => countPending().then((pending) => ({ closed, pending })))
    .then(({ closed, pending }) => {
      if (pending || closed) {
        log.info('resuming after restart', { pending, closed })
      }
    })
    .catch((err) => log.warn('could not survey pending jobs at startup', { error: err }))
}

/** Close whatever no longer has anything carrying it forward. */
async function sweep(): Promise<number> {
  const [orphans, stalled] = await Promise.all([
    failOrphanedJobs(ORPHAN_AFTER_MS).catch(() => 0),
    failStalledChatJobs(CHAT_STALL_AFTER_MS).catch(() => 0),
  ])
  return orphans + stalled
}

export function stopReconciler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

/**
 * Ask for an immediate pass.
 *
 * Called right after a submission so the first poll does not wait out a full
 * tick, which is most of the perceived latency on a fast image model.
 */
export function nudge(): void {
  void tick()
}
