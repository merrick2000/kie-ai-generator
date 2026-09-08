/**
 * The admin view.
 *
 * One instance, a handful of accounts, and no way until now to answer the
 * plainest questions about it: who signed up, when were they last here, what
 * are they running, and is anything failing. The logs hold most of it, but a
 * log is a place to confirm a suspicion, not a place to form one.
 *
 * Everything here is read-only aggregation over tables that already exist,
 * plus the activity trail. Nothing in this module writes.
 */

import 'server-only'

import { getDb } from '@/lib/db'
import { labelFor } from '@/lib/activity/labels'
import { normalizeEmail } from '@/lib/auth/passwords'
import type { CurrentUser } from '@/lib/auth'

/* ────────────────────────────────────────────────────────────────────────────
 * Who is allowed in
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * `ADMIN_EMAILS` is the answer when it is set, a comma-separated list.
 *
 * When it is not, the oldest account is the admin. That is not a security
 * model so much as a bootstrap: the person who installed the instance is the
 * person who created the first account on it, and an admin page nobody can
 * reach until they redeploy with an environment variable is an admin page
 * nobody uses. Setting the variable overrides the fallback entirely, which is
 * what a real deployment should do.
 */
function configuredAdmins(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean)
}

/** The id of the first account created, or null on an empty instance. */
async function firstUserId(): Promise<string | null> {
  const db = await getDb()
  // Ties broken by id so the answer is stable if two accounts somehow share a
  // creation millisecond. An admin that changes between two page loads would
  // be worse than a slightly arbitrary one.
  const row = await db.get<{ id: string }>(
    'SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1',
  )
  return row?.id ?? null
}

export async function isAdmin(user: CurrentUser): Promise<boolean> {
  const allowed = configuredAdmins()
  if (allowed.length > 0) return allowed.includes(normalizeEmail(user.email))

  return user.id === (await firstUserId())
}

/** How the admin was decided, so the page can say so rather than imply it. */
export async function adminMode(): Promise<'configured' | 'first-account'> {
  return configuredAdmins().length > 0 ? 'configured' : 'first-account'
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shapes
 * ──────────────────────────────────────────────────────────────────────────*/

export interface AdminOverview {
  users: { total: number; newDay: number; newWeek: number; activeWeek: number }
  runs: {
    total: number
    day: number
    week: number
    running: number
    failedDay: number
    /** Successes over attempts in the last week, 0 to 1, or null if none. */
    successRateWeek: number | null
  }
  spend: { totalCredits: number; dayCredits: number; weekCredits: number }
  security: { failedSigninsDay: number; activeSessions: number }
  topModels: { modelId: string; name: string; runs: number; credits: number }[]
  /** Runs per day for the last fortnight, oldest first. */
  daily: { day: string; runs: number; credits: number }[]
}

export interface AdminUser {
  id: string
  email: string
  createdAt: number
  lastLoginAt: number | null
  hasApiKey: boolean
  runs: number
  failedRuns: number
  credits: number
  lastRunAt: number | null
  /** The most recent thing they did, whatever kind of thing it was. */
  lastSeenAt: number | null
  lastAction: string
  projects: number
}

/* ────────────────────────────────────────────────────────────────────────────
 * Queries
 * ──────────────────────────────────────────────────────────────────────────*/

const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY

function num(value: number | string | null | undefined): number {
  if (value == null) return 0
  return typeof value === 'number' ? value : Number(value)
}

function maybe(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export async function overview(): Promise<AdminOverview> {
  const db = await getDb()
  const now = Date.now()
  const dayAgo = now - DAY
  const weekAgo = now - WEEK

  // One round trip each, run together. Separate statements rather than one
  // heroic query: each is readable on its own and Postgres plans them better
  // than it plans a pile of correlated subqueries.
  const [users, runs, spend, sessions, failedSignins, top, daily] = await Promise.all([
    db.get<{ total: string; new_day: string; new_week: string }>(
      `SELECT COUNT(*)                                        AS total,
              COUNT(*) FILTER (WHERE created_at >= ?)         AS new_day,
              COUNT(*) FILTER (WHERE created_at >= ?)         AS new_week
         FROM users`,
      [dayAgo, weekAgo],
    ),

    db.get<{
      total: string
      day: string
      week: string
      running: string
      failed_day: string
      week_success: string
      week_finished: string
      active_week: string
    }>(
      `SELECT COUNT(*)                                                    AS total,
              COUNT(*) FILTER (WHERE created_at >= ?)                     AS day,
              COUNT(*) FILTER (WHERE created_at >= ?)                     AS week,
              COUNT(*) FILTER (WHERE state NOT IN ('success', 'fail'))    AS running,
              COUNT(*) FILTER (WHERE state = 'fail' AND created_at >= ?)  AS failed_day,
              COUNT(*) FILTER (WHERE state = 'success' AND created_at >= ?) AS week_success,
              COUNT(*) FILTER (WHERE state IN ('success','fail') AND created_at >= ?) AS week_finished,
              COUNT(DISTINCT user_id) FILTER (WHERE created_at >= ?)      AS active_week
         FROM jobs`,
      [dayAgo, weekAgo, dayAgo, weekAgo, weekAgo, weekAgo],
    ),

    db.get<{ total: string; day: string; week: string }>(
      `SELECT COALESCE(SUM(credits_consumed), 0)                                   AS total,
              COALESCE(SUM(credits_consumed) FILTER (WHERE created_at >= ?), 0)    AS day,
              COALESCE(SUM(credits_consumed) FILTER (WHERE created_at >= ?), 0)    AS week
         FROM jobs`,
      [dayAgo, weekAgo],
    ),

    db.get<{ n: string }>('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', [now]),

    db.get<{ n: string }>(
      "SELECT COUNT(*) AS n FROM activity WHERE kind = 'signin_failed' AND at >= ?",
      [dayAgo],
    ),

    db.all<{ model_id: string; name: string; runs: string; credits: string }>(
      `SELECT model_id,
              MAX(model_name)                    AS name,
              COUNT(*)                           AS runs,
              COALESCE(SUM(credits_consumed), 0) AS credits
         FROM jobs
        WHERE created_at >= ?
        GROUP BY model_id
        ORDER BY runs DESC
        LIMIT 8`,
      [weekAgo],
    ),

    // Bucketed in SQL rather than in JS: sending a fortnight of rows back to
    // count them here would grow with usage for no reason.
    db.all<{ day: string; runs: string; credits: string }>(
      `SELECT to_char(to_timestamp(created_at / 1000.0), 'YYYY-MM-DD') AS day,
              COUNT(*)                                                 AS runs,
              COALESCE(SUM(credits_consumed), 0)                       AS credits
         FROM jobs
        WHERE created_at >= ?
        GROUP BY day
        ORDER BY day ASC`,
      [now - 14 * DAY],
    ),
  ])

  const weekFinished = num(runs?.week_finished)

  return {
    users: {
      total: num(users?.total),
      newDay: num(users?.new_day),
      newWeek: num(users?.new_week),
      activeWeek: num(runs?.active_week),
    },
    runs: {
      total: num(runs?.total),
      day: num(runs?.day),
      week: num(runs?.week),
      running: num(runs?.running),
      failedDay: num(runs?.failed_day),
      successRateWeek: weekFinished > 0 ? num(runs?.week_success) / weekFinished : null,
    },
    spend: {
      totalCredits: num(spend?.total),
      dayCredits: num(spend?.day),
      weekCredits: num(spend?.week),
    },
    security: {
      failedSigninsDay: num(failedSignins?.n),
      activeSessions: num(sessions?.n),
    },
    topModels: top.map((row) => ({
      modelId: row.model_id,
      name: row.name,
      runs: num(row.runs),
      credits: num(row.credits),
    })),
    daily: daily.map((row) => ({
      day: row.day,
      runs: num(row.runs),
      credits: num(row.credits),
    })),
  }
}

/**
 * Everyone with an account, and the last thing each of them did.
 *
 * "Last thing" spans three sources, because no single one of them is the
 * answer: someone can sign in and generate nothing, generate through a session
 * opened last week without signing in again, or create a project and leave.
 * The latest of the three is what "last seen" has to mean.
 */
export async function listUsers(): Promise<AdminUser[]> {
  const db = await getDb()

  const [rows, lastEvents, projects] = await Promise.all([
    db.all<{
      id: string
      email: string
      created_at: string
      last_login_at: string | null
      has_key: boolean
      runs: string
      failed_runs: string
      credits: string
      last_run_at: string | null
    }>(
      `SELECT u.id,
              u.email,
              u.created_at,
              u.last_login_at,
              (u.api_key_enc IS NOT NULL)                       AS has_key,
              COUNT(j.id)                                       AS runs,
              COUNT(j.id) FILTER (WHERE j.state = 'fail')       AS failed_runs,
              COALESCE(SUM(j.credits_consumed), 0)              AS credits,
              MAX(j.created_at)                                 AS last_run_at
         FROM users u
         LEFT JOIN jobs j ON j.user_id = u.id
        GROUP BY u.id, u.email, u.created_at, u.last_login_at, u.api_key_enc
        ORDER BY u.created_at DESC`,
    ),

    // DISTINCT ON is the cheap way to take one row per user: Postgres reads
    // the index in the ORDER BY's direction and stops at the first of each.
    db.all<{ user_id: string; at: string; kind: string }>(
      `SELECT DISTINCT ON (user_id) user_id, at, kind
         FROM activity
        WHERE user_id IS NOT NULL
        ORDER BY user_id, at DESC`,
    ),

    db.all<{ user_id: string; n: string }>(
      'SELECT user_id, COUNT(*) AS n FROM projects WHERE archived = FALSE GROUP BY user_id',
    ),
  ])

  const lastByUser = new Map(lastEvents.map((row) => [row.user_id, row]))
  const projectsByUser = new Map(projects.map((row) => [row.user_id, num(row.n)]))

  return rows.map((row) => {
    const event = lastByUser.get(row.id)
    const lastLogin = maybe(row.last_login_at)
    const lastRun = maybe(row.last_run_at)
    const lastEvent = event ? num(event.at) : null

    const candidates: { at: number; label: string }[] = []
    if (lastLogin != null) candidates.push({ at: lastLogin, label: 'signed in' })
    if (lastRun != null) candidates.push({ at: lastRun, label: 'started a run' })
    if (lastEvent != null) candidates.push({ at: lastEvent, label: labelFor(event!.kind) })

    candidates.sort((a, b) => b.at - a.at)
    const latest = candidates[0]

    return {
      id: row.id,
      email: row.email,
      createdAt: num(row.created_at),
      lastLoginAt: lastLogin,
      hasApiKey: Boolean(row.has_key),
      runs: num(row.runs),
      failedRuns: num(row.failed_runs),
      credits: num(row.credits),
      lastRunAt: lastRun,
      lastSeenAt: latest?.at ?? null,
      lastAction: latest?.label ?? 'never signed in',
      projects: projectsByUser.get(row.id) ?? 0,
    }
  })
}

/* ────────────────────────────────────────────────────────────────────────────
 * The feed
 * ──────────────────────────────────────────────────────────────────────────*/

export interface AdminRun {
  id: string
  at: number
  userId: string
  email: string | null
  modelId: string
  modelName: string
  category: string
  output: string
  state: string
  prompt: string
  credits: number | null
  error: string | null
  completedAt: number | null
}

/**
 * Recent generations across every account.
 *
 * Read straight from the jobs table rather than from the activity trail, so a
 * run that is still going shows its live state instead of the state it had at
 * the moment somebody logged it.
 */
export interface RunQuery {
  limit?: number
  /** Keyset pagination: runs started before this timestamp. */
  before?: number
  userId?: string
}

export async function listRuns(query: RunQuery = {}): Promise<AdminRun[]> {
  const db = await getDb()
  const capped = Math.min(Math.max(query.limit ?? 60, 1), 200)

  const where: string[] = []
  const params: (string | number)[] = []

  if (query.before != null) {
    where.push('j.created_at < ?')
    params.push(query.before)
  }
  if (query.userId) {
    where.push('j.user_id = ?')
    params.push(query.userId)
  }
  params.push(capped)

  const rows = await db.all<{
    id: string
    created_at: string
    user_id: string
    email: string | null
    model_id: string
    model_name: string
    category: string
    output: string
    state: string
    prompt_preview: string
    credits_consumed: number | string | null
    error: string | null
    completed_at: string | null
  }>(
    `SELECT j.id, j.created_at, j.user_id, u.email, j.model_id, j.model_name,
            j.category, j.output, j.state, j.prompt_preview,
            j.credits_consumed, j.error, j.completed_at
       FROM jobs j
       LEFT JOIN users u ON u.id = j.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY j.created_at DESC
      LIMIT ?`,
    params,
  )

  return rows.map((row) => ({
    id: row.id,
    at: num(row.created_at),
    userId: row.user_id,
    email: row.email,
    modelId: row.model_id,
    modelName: row.model_name,
    category: row.category,
    output: row.output,
    state: row.state,
    // Trimmed here rather than in the browser: a full prompt per row would
    // make the response many times larger than the part anyone reads.
    prompt: row.prompt_preview.slice(0, 160),
    credits: maybe(row.credits_consumed),
    error: row.error,
    completedAt: maybe(row.completed_at),
  }))
}

export { labelFor }
