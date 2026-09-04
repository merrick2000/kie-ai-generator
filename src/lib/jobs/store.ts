/**
 * Job storage.
 *
 * Generations used to live in the browser's IndexedDB, which made a reload
 * fatal: the only thing tracking a running task was the tab that started it,
 * so closing it lost the result and the credits already spent on it.
 *
 * They live here instead. The row is the truth, the server keeps polling for
 * it, and a browser is only ever a view onto that.
 */

import 'server-only'

import { randomBytes } from 'node:crypto'

import { getDb, type SqlValue } from '@/lib/db'
import type { ModelCategory } from '@/lib/kie/catalog'
import type { NormalizedTask, TaskAsset } from '@/lib/kie/tasks'
import type { KieTaskState } from '@/lib/kie/types'
import { createLogger } from '@/lib/logger'
export type { Job, JobApi } from './types'
import type { Job, JobApi } from './types'

const log = createLogger('jobs')

export function newJobId(): string {
  return randomBytes(12).toString('base64url')
}

/* ────────────────────────────────────────────────────────────────────────────
 * Row mapping
 * ──────────────────────────────────────────────────────────────────────────*/

interface JobRow {
  id: string
  user_id: string
  project_id: string | null
  task_id: string | null
  api: string
  model_id: string
  submitted_model_id: string | null
  model_name: string
  category: string
  output: string
  title: string | null
  prompt_preview: string
  values_json: string
  state: string
  progress: number | string
  assets_json: string
  text: string | null
  error: string | null
  favorite: boolean
  credits_consumed: number | string | null
  cost_time_ms: number | string | null
  created_at: number | string
  updated_at: number | string
  completed_at: number | string | null
  next_poll_at: number | string
  poll_attempts: number | string
}

/** Postgres hands back BIGINT and NUMERIC as strings to protect precision. */
function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a JSON column without letting one malformed row break a whole
 * listing. A job whose values failed to parse is still worth showing.
 */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    api: row.api as JobApi,
    modelId: row.model_id,
    submittedModelId: row.submitted_model_id,
    modelName: row.model_name,
    category: row.category as ModelCategory,
    output: row.output as Job['output'],
    title: row.title,
    promptPreview: row.prompt_preview,
    values: parseJson<Record<string, unknown>>(row.values_json, {}),
    state: row.state as KieTaskState,
    progress: num(row.progress) ?? 0,
    assets: parseJson<TaskAsset[]>(row.assets_json, []),
    text: row.text,
    error: row.error,
    favorite: Boolean(row.favorite),
    creditsConsumed: num(row.credits_consumed),
    costTimeMs: num(row.cost_time_ms),
    createdAt: num(row.created_at) ?? 0,
    updatedAt: num(row.updated_at) ?? 0,
    completedAt: num(row.completed_at),
  }
}

/** Every column, in one place, so a listing and a claim return the same shape. */
const COLUMNS = `id, user_id, project_id, task_id, api, model_id,
  submitted_model_id, model_name, category, output, title, prompt_preview,
  values_json, state, progress, assets_json, text, error, favorite,
  credits_consumed, cost_time_ms, created_at, updated_at, completed_at,
  next_poll_at, poll_attempts`

/* ────────────────────────────────────────────────────────────────────────────
 * Writing
 * ──────────────────────────────────────────────────────────────────────────*/

export interface NewJob {
  userId: string
  projectId: string | null
  api: JobApi
  modelId: string
  submittedModelId: string | null
  modelName: string
  category: ModelCategory
  output: Job['output']
  promptPreview: string
  values: Record<string, unknown>
}

/**
 * Record a submission before it leaves for Kie.
 *
 * Inserting first, submitting second: a job that was accepted upstream but
 * never written down is a charge nobody can account for, which is the one
 * failure worth designing against.
 */
export async function insertJob(input: NewJob): Promise<Job> {
  const db = await getDb()
  const now = Date.now()
  const id = newJobId()

  await db.run(
    `INSERT INTO jobs (
       id, user_id, project_id, task_id, api, model_id, submitted_model_id,
       model_name, category, output, title, prompt_preview, values_json,
       state, progress, assets_json, favorite, created_at, updated_at,
       next_poll_at
     ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'waiting', 2, '[]', FALSE, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.projectId,
      input.api,
      input.modelId,
      input.submittedModelId,
      input.modelName,
      input.category,
      input.output,
      input.promptPreview.slice(0, 2000),
      JSON.stringify(input.values),
      now,
      now,
      // Not pollable until a task id exists.
      Number.MAX_SAFE_INTEGER,
    ],
  )

  const job = await getJobById(id)
  if (!job) throw new Error('Job vanished immediately after insert.')
  return job
}

/** Attach the upstream task id and open the job for polling. */
export async function attachTask(
  id: string,
  taskId: string,
  firstPollAt: number,
): Promise<void> {
  const db = await getDb()
  await db.run(
    `UPDATE jobs
        SET task_id = ?, state = 'queuing', progress = 8,
            updated_at = ?, next_poll_at = ?
      WHERE id = ?`,
    [taskId, Date.now(), firstPollAt, id],
  )
}

/**
 * Write a poll result onto the job.
 *
 * Guarded on the job not already being finished: a callback and a poll can
 * land in either order, and the second must not reopen a job the first
 * closed, or overwrite its assets with an empty list.
 */
export async function applyTaskResult(
  id: string,
  task: NormalizedTask,
  nextPollAt: number,
): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  const finished = task.state === 'success' || task.state === 'fail'

  await db.run(
    `UPDATE jobs
        SET state = ?,
            progress = ?,
            assets_json = CASE WHEN ? = '[]' THEN assets_json ELSE ? END,
            text = COALESCE(?, text),
            error = ?,
            credits_consumed = COALESCE(?, credits_consumed),
            cost_time_ms = COALESCE(?, cost_time_ms),
            completed_at = CASE WHEN ? THEN COALESCE(completed_at, ?) ELSE completed_at END,
            updated_at = ?,
            next_poll_at = ?,
            lease_until = 0
      WHERE id = ? AND state NOT IN ('success', 'fail')`,
    [
      task.state,
      Math.max(0, Math.min(100, Math.round(task.progress))),
      JSON.stringify(task.assets),
      JSON.stringify(task.assets),
      task.text ?? null,
      task.error ?? null,
      task.creditsConsumed ?? null,
      task.costTimeMs ?? null,
      finished,
      task.completedAt ?? now,
      now,
      finished ? Number.MAX_SAFE_INTEGER : nextPollAt,
      id,
    ],
  )
}

/** Close a job as failed. Also guarded, for the same reason. */
export async function failJob(id: string, error: string): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  await db.run(
    `UPDATE jobs
        SET state = 'fail', progress = 100, error = ?, completed_at = ?,
            updated_at = ?, next_poll_at = ?, lease_until = 0
      WHERE id = ? AND state NOT IN ('success', 'fail')`,
    [error.slice(0, 500), now, now, Number.MAX_SAFE_INTEGER, id],
  )
}

/** Finish a chat job, which answers in the request rather than via a task. */
export async function completeText(
  id: string,
  text: string,
  creditsConsumed: number | null,
  costTimeMs: number | null,
): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  await db.run(
    `UPDATE jobs
        SET state = 'success', progress = 100, text = ?, credits_consumed = ?,
            cost_time_ms = ?, completed_at = ?, updated_at = ?,
            next_poll_at = ?, lease_until = 0
      WHERE id = ? AND state NOT IN ('success', 'fail')`,
    [text, creditsConsumed, costTimeMs, now, now, Number.MAX_SAFE_INTEGER, id],
  )
}

/** Move a chat job into its working state so the UI stops saying "queued". */
export async function markGenerating(id: string): Promise<void> {
  const db = await getDb()
  await db.run(
    `UPDATE jobs SET state = 'generating', progress = 40, updated_at = ?
      WHERE id = ? AND state NOT IN ('success', 'fail')`,
    [Date.now(), id],
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────────*/

async function getJobById(id: string): Promise<Job | null> {
  const db = await getDb()
  const row = await db.get<JobRow>(`SELECT ${COLUMNS} FROM jobs WHERE id = ?`, [id])
  return row ? toJob(row) : null
}

/** Scoped to the owner, so an id from another account reads as missing. */
export async function getJob(userId: string, id: string): Promise<Job | null> {
  const db = await getDb()
  const row = await db.get<JobRow>(
    `SELECT ${COLUMNS} FROM jobs WHERE id = ? AND user_id = ?`,
    [id, userId],
  )
  return row ? toJob(row) : null
}

export interface JobQuery {
  /** null means "unfiled", undefined means "any project". */
  projectId?: string | null
  category?: ModelCategory
  /** 'running' | 'success' | 'fail' */
  status?: 'running' | 'success' | 'fail'
  favorite?: boolean
  /** Matched against the title, the prompt and the model name. */
  search?: string
  modelId?: string
  /** Only rows touched after this, for incremental sync. */
  updatedSince?: number
  sort?: 'newest' | 'oldest' | 'cost'
  limit?: number
  offset?: number
}

const MAX_LIMIT = 500

export async function listJobs(userId: string, query: JobQuery = {}): Promise<Job[]> {
  const db = await getDb()
  const where: string[] = ['user_id = ?']
  const params: SqlValue[] = [userId]

  if (query.projectId !== undefined) {
    if (query.projectId === null) where.push('project_id IS NULL')
    else {
      where.push('project_id = ?')
      params.push(query.projectId)
    }
  }
  if (query.category) {
    where.push('category = ?')
    params.push(query.category)
  }
  if (query.status === 'running') where.push(`state NOT IN ('success', 'fail')`)
  else if (query.status) {
    where.push('state = ?')
    params.push(query.status)
  }
  if (query.favorite) where.push('favorite = TRUE')
  if (query.modelId) {
    where.push('model_id = ?')
    params.push(query.modelId)
  }
  if (query.updatedSince) {
    where.push('updated_at > ?')
    params.push(query.updatedSince)
  }
  if (query.search?.trim()) {
    // ILIKE rather than a text-search index: a studio's history is thousands
    // of rows, not millions, and a substring match is what people expect from
    // a search box over their own prompts.
    where.push(
      `(prompt_preview ILIKE ? OR COALESCE(title, '') ILIKE ? OR model_name ILIKE ?)`,
    )
    // Escaped so a prompt containing % or _ searches for those characters
    // rather than turning into a wildcard.
    const like = `%${query.search.trim().replace(/[%_\\]/g, '\\$&')}%`
    params.push(like, like, like)
  }

  const order =
    query.sort === 'oldest'
      ? 'created_at ASC'
      : query.sort === 'cost'
        ? 'credits_consumed DESC NULLS LAST, created_at DESC'
        : 'created_at DESC'

  const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? 200))
  params.push(limit, Math.max(0, query.offset ?? 0))

  const rows = await db.all<JobRow>(
    `SELECT ${COLUMNS} FROM jobs
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
    params,
  )

  return rows.map(toJob)
}

/** Everything still in flight, so a client can resume tracking on load. */
export async function listRunningJobs(userId: string): Promise<Job[]> {
  return listJobs(userId, { status: 'running', limit: 100 })
}

/**
 * The newest change on this account, regardless of any filter.
 *
 * The sync loop's mark has to come from here rather than from the rows a
 * filtered read happened to return. Otherwise a search that excludes the most
 * recently touched job leaves the mark behind it, the next sync keeps
 * returning that job as something the view has never seen, and the client
 * refreshes on every tick forever.
 */
export async function latestUpdatedAt(userId: string): Promise<number> {
  const db = await getDb()
  const row = await db.get<{ latest: number | string | null }>(
    'SELECT MAX(updated_at) AS latest FROM jobs WHERE user_id = ?',
    [userId],
  )
  return num(row?.latest ?? null) ?? 0
}

/* ────────────────────────────────────────────────────────────────────────────
 * Editing
 * ──────────────────────────────────────────────────────────────────────────*/

export interface JobPatch {
  title?: string | null
  favorite?: boolean
  projectId?: string | null
}

export async function patchJob(
  userId: string,
  id: string,
  patch: JobPatch,
): Promise<Job | null> {
  const sets: string[] = []
  const params: SqlValue[] = []

  if (patch.title !== undefined) {
    sets.push('title = ?')
    params.push(patch.title === null ? null : patch.title.trim().slice(0, 200) || null)
  }
  if (patch.favorite !== undefined) {
    sets.push('favorite = ?')
    params.push(patch.favorite)
  }
  if (patch.projectId !== undefined) {
    sets.push('project_id = ?')
    params.push(patch.projectId)
  }

  if (!sets.length) return getJob(userId, id)

  sets.push('updated_at = ?')
  params.push(Date.now(), id, userId)

  const db = await getDb()
  await db.run(
    `UPDATE jobs SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    params,
  )
  return getJob(userId, id)
}

export async function deleteJob(userId: string, id: string): Promise<void> {
  const db = await getDb()
  await db.run('DELETE FROM jobs WHERE id = ? AND user_id = ?', [id, userId])
}

/**
 * Sweep finished jobs.
 *
 * Pinned results are the user's explicit "keep this", so they survive. So do
 * running jobs: deleting one would abandon a task that is still being paid
 * for upstream.
 */
export async function clearJobs(
  userId: string,
  options: { projectId?: string | null } = {},
): Promise<number> {
  const db = await getDb()
  const where = ['user_id = ?', 'favorite = FALSE', `state IN ('success', 'fail')`]
  const params: SqlValue[] = [userId]

  if (options.projectId !== undefined) {
    if (options.projectId === null) where.push('project_id IS NULL')
    else {
      where.push('project_id = ?')
      params.push(options.projectId)
    }
  }

  const doomed = await db.all<{ id: string }>(
    `SELECT id FROM jobs WHERE ${where.join(' AND ')}`,
    params,
  )
  if (!doomed.length) return 0

  await db.run(`DELETE FROM jobs WHERE ${where.join(' AND ')}`, params)
  log.info('cleared history', { userId, removed: doomed.length })
  return doomed.length
}

/* ────────────────────────────────────────────────────────────────────────────
 * The reconciler's queue
 * ──────────────────────────────────────────────────────────────────────────*/

export interface ClaimedJob extends Job {
  userId: string
  pollAttempts: number
}

/**
 * Take ownership of jobs that are due for a poll.
 *
 * `FOR UPDATE SKIP LOCKED` plus a lease is what makes this safe to run on
 * more than one instance: two containers polling the same task would double
 * the request rate against a limit that is already the binding constraint.
 */
export async function claimDueJobs(limit: number, leaseMs: number): Promise<ClaimedJob[]> {
  const db = await getDb()
  const now = Date.now()

  const rows = await db.all<JobRow & { user_id: string }>(
    `UPDATE jobs
        SET lease_until = ?, poll_attempts = poll_attempts + 1
      WHERE id IN (
        SELECT id FROM jobs
         WHERE state NOT IN ('success', 'fail')
           AND task_id IS NOT NULL
           AND next_poll_at <= ?
           AND lease_until <= ?
         ORDER BY next_poll_at ASC
         LIMIT ?
         FOR UPDATE SKIP LOCKED
      )
      RETURNING ${COLUMNS}`,
    [now + leaseMs, now, now, Math.max(1, limit)],
  )

  return rows.map((row) => ({
    ...toJob(row),
    userId: row.user_id,
    pollAttempts: num(row.poll_attempts) ?? 0,
  }))
}

/**
 * Bring a job's next poll forward to now.
 *
 * Kie's callback says a task is finished, but the callback body is a
 * different shape per transport and can arrive out of order. Rather than
 * decode it a second time, this makes the reconciler ask the authoritative
 * endpoint immediately, which turns a webhook into latency saved rather than
 * a parallel source of truth to keep in sync.
 */
export async function expediteByTaskId(taskId: string): Promise<boolean> {
  const db = await getDb()
  const rows = await db.all<{ id: string }>(
    `UPDATE jobs
        SET next_poll_at = 0, lease_until = 0
      WHERE task_id = ? AND state NOT IN ('success', 'fail')
      RETURNING id`,
    [taskId],
  )
  return rows.length > 0
}

/** Push a job's next poll out without changing its state. */
export async function deferJob(id: string, nextPollAt: number): Promise<void> {
  const db = await getDb()
  await db.run(
    'UPDATE jobs SET next_poll_at = ?, lease_until = 0 WHERE id = ?',
    [nextPollAt, id],
  )
}

/** How many jobs are waiting on the reconciler right now. */
export async function countPending(): Promise<number> {
  const db = await getDb()
  const row = await db.get<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM jobs WHERE state NOT IN ('success', 'fail')`,
  )
  return num(row?.n) ?? 0
}

/**
 * Close jobs that were never submitted.
 *
 * A row inserted just before the process died has no task id and nothing will
 * ever poll it, so it would sit at "queued" until the end of time.
 */
export async function failOrphanedJobs(olderThanMs: number): Promise<number> {
  const db = await getDb()
  const cutoff = Date.now() - olderThanMs

  const rows = await db.all<{ id: string }>(
    `UPDATE jobs
        SET state = 'fail', progress = 100, completed_at = ?, updated_at = ?,
            error = 'The server restarted before this run was submitted. Nothing was charged.'
      WHERE task_id IS NULL
        AND api <> 'chat'
        AND state NOT IN ('success', 'fail')
        AND created_at < ?
      RETURNING id`,
    [Date.now(), Date.now(), cutoff],
  )

  if (rows.length) log.warn('closed jobs that were never submitted', { count: rows.length })
  return rows.length
}

/**
 * Close text runs that nothing is carrying any more.
 *
 * A language model answers inside the request that started it, so its job is
 * finished by a promise held in one process rather than by the reconciler. If
 * that process restarts mid-answer, nothing is left to write the result and
 * the job would spin forever.
 *
 * Kept well past the client's own five-minute timeout, so a slow reasoning
 * model is never cut off by this.
 */
export async function failStalledChatJobs(olderThanMs: number): Promise<number> {
  const db = await getDb()
  const now = Date.now()

  const rows = await db.all<{ id: string }>(
    `UPDATE jobs
        SET state = 'fail', progress = 100, completed_at = ?, updated_at = ?,
            error = 'The server restarted while the model was answering. Try again.'
      WHERE api = 'chat'
        AND state NOT IN ('success', 'fail')
        AND created_at < ?
      RETURNING id`,
    [now, now, now - olderThanMs],
  )

  if (rows.length) log.warn('closed text runs left by a restart', { count: rows.length })
  return rows.length
}

/* ────────────────────────────────────────────────────────────────────────────
 * Usage statistics
 * ──────────────────────────────────────────────────────────────────────────*/

export interface ModelUsage {
  modelId: string
  modelName: string
  category: ModelCategory
  runs: number
  succeeded: number
  failed: number
  credits: number
  /** Cheapest and dearest charge seen, since options move the price. */
  minCredits: number | null
  maxCredits: number | null
  /** Mean wall-clock time of the successful runs, in ms. */
  avgMs: number | null
  lastUsedAt: number
  favorites: number
}

/**
 * What this account actually leans on.
 *
 * Fifty-odd models is too many to choose from cold. Ranking them by what has
 * already worked here turns the catalog into a shortlist.
 */
export async function modelUsage(userId: string): Promise<ModelUsage[]> {
  const db = await getDb()

  const rows = await db.all<{
    model_id: string
    model_name: string
    category: string
    runs: number | string
    succeeded: number | string
    failed: number | string
    credits: number | string | null
    min_credits: number | string | null
    max_credits: number | string | null
    avg_ms: number | string | null
    last_used_at: number | string
    favorites: number | string
  }>(
    `SELECT model_id,
            MAX(model_name)  AS model_name,
            MAX(category)    AS category,
            COUNT(*)         AS runs,
            COUNT(*) FILTER (WHERE state = 'success') AS succeeded,
            COUNT(*) FILTER (WHERE state = 'fail')    AS failed,
            COALESCE(SUM(credits_consumed), 0)        AS credits,
            MIN(credits_consumed) FILTER (WHERE credits_consumed > 0) AS min_credits,
            MAX(credits_consumed) FILTER (WHERE credits_consumed > 0) AS max_credits,
            AVG(cost_time_ms) FILTER (WHERE state = 'success') AS avg_ms,
            MAX(created_at)  AS last_used_at,
            COUNT(*) FILTER (WHERE favorite)          AS favorites
       FROM jobs
      WHERE user_id = ?
      GROUP BY model_id
      ORDER BY runs DESC`,
    [userId],
  )

  return rows.map((row) => ({
    modelId: row.model_id,
    modelName: row.model_name,
    category: row.category as ModelCategory,
    runs: num(row.runs) ?? 0,
    succeeded: num(row.succeeded) ?? 0,
    failed: num(row.failed) ?? 0,
    credits: num(row.credits) ?? 0,
    minCredits: num(row.min_credits),
    maxCredits: num(row.max_credits),
    avgMs: num(row.avg_ms),
    lastUsedAt: num(row.last_used_at) ?? 0,
    favorites: num(row.favorites) ?? 0,
  }))
}

export interface UsageTotals {
  runs: number
  succeeded: number
  failed: number
  running: number
  credits: number
  /** Distinct models this account has actually run. */
  models: number
}

export async function usageTotals(userId: string): Promise<UsageTotals> {
  const db = await getDb()
  const row = await db.get<{
    runs: number | string
    succeeded: number | string
    failed: number | string
    running: number | string
    credits: number | string | null
    models: number | string
  }>(
    `SELECT COUNT(*) AS runs,
            COUNT(*) FILTER (WHERE state = 'success') AS succeeded,
            COUNT(*) FILTER (WHERE state = 'fail')    AS failed,
            COUNT(*) FILTER (WHERE state NOT IN ('success', 'fail')) AS running,
            COALESCE(SUM(credits_consumed), 0)        AS credits,
            COUNT(DISTINCT model_id)                  AS models
       FROM jobs WHERE user_id = ?`,
    [userId],
  )

  return {
    runs: num(row?.runs) ?? 0,
    succeeded: num(row?.succeeded) ?? 0,
    failed: num(row?.failed) ?? 0,
    running: num(row?.running) ?? 0,
    credits: num(row?.credits) ?? 0,
    models: num(row?.models) ?? 0,
  }
}

/** Per-project counters, shown beside each project in the switcher. */
export async function projectCounts(
  userId: string,
): Promise<Record<string, { runs: number; running: number; credits: number }>> {
  const db = await getDb()
  const rows = await db.all<{
    project_id: string | null
    runs: number | string
    running: number | string
    credits: number | string | null
  }>(
    `SELECT project_id,
            COUNT(*) AS runs,
            COUNT(*) FILTER (WHERE state NOT IN ('success', 'fail')) AS running,
            COALESCE(SUM(credits_consumed), 0) AS credits
       FROM jobs WHERE user_id = ?
      GROUP BY project_id`,
    [userId],
  )

  const out: Record<string, { runs: number; running: number; credits: number }> = {}
  for (const row of rows) {
    // Unfiled work needs a key too, and null cannot be one.
    out[row.project_id ?? 'unfiled'] = {
      runs: num(row.runs) ?? 0,
      running: num(row.running) ?? 0,
      credits: num(row.credits) ?? 0,
    }
  }
  return out
}
