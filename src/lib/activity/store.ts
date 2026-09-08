/**
 * The activity trail.
 *
 * The rest of the database records what *is*: which accounts exist, which
 * jobs are running. None of it records what *happened*, because state is
 * overwritten in place. `last_login_at` says somebody signed in, not that they
 * signed in eleven times this week, and nothing at all says a stranger spent
 * an evening guessing passwords.
 *
 * Generations are deliberately absent. The jobs table already holds every run
 * with its model, cost and outcome; writing a second copy here would create
 * two records of one fact, free to disagree the moment one of them is missed.
 * The admin feed reads both and interleaves them.
 */

import 'server-only'

import { getDb } from '@/lib/db'
import { createLogger } from '@/lib/logger'

const log = createLogger('activity')

/**
 * Events worth keeping.
 *
 * A closed union rather than a free string: the feed renders each kind with
 * its own wording and icon, so an unrecognised value would show up as a blank
 * row that nobody notices until they need it.
 */
export type ActivityKind =
  | 'signup'
  | 'signup_blocked'
  | 'signin'
  | 'signin_failed'
  | 'signout'
  | 'password_changed'
  | 'api_key_set'
  | 'api_key_cleared'
  | 'project_created'
  | 'project_deleted'
  | 'history_imported'
  | 'history_cleared'

export interface ActivityEvent {
  id: number
  at: number
  userId: string | null
  email: string | null
  kind: ActivityKind
  summary: string
  meta: Record<string, unknown>
  ip: string | null
}

interface ActivityRow {
  id: number | string
  at: number | string
  user_id: string | null
  email: string | null
  kind: string
  summary: string
  meta: string
  ip: string | null
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value)
}

function toEvent(row: ActivityRow): ActivityEvent {
  let meta: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(row.meta)
    if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>
  } catch {
    // A malformed blob is not worth losing the event over: the timestamp,
    // the actor and the kind are the parts anyone actually reads.
  }

  return {
    id: toNumber(row.id),
    at: toNumber(row.at),
    userId: row.user_id,
    email: row.email,
    kind: row.kind as ActivityKind,
    summary: row.summary,
    meta,
    ip: row.ip,
  }
}

export interface RecordInput {
  kind: ActivityKind
  userId?: string | null
  email?: string | null
  summary?: string
  meta?: Record<string, unknown>
  ip?: string | null
}

/**
 * Write one event.
 *
 * Never throws and never rejects. Recording that something happened must not
 * be able to stop it happening: a signup that fails because the audit insert
 * deadlocked is a far worse outcome than a gap in the feed.
 */
export async function record(input: RecordInput): Promise<void> {
  try {
    const db = await getDb()
    await db.run(
      `INSERT INTO activity (at, user_id, email, kind, summary, meta, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Date.now(),
        input.userId ?? null,
        input.email ?? null,
        input.kind,
        input.summary ?? '',
        JSON.stringify(input.meta ?? {}),
        input.ip ?? null,
      ],
    )
  } catch (err) {
    log.warn('could not record an event', { kind: input.kind, error: err })
  }
}

export interface ActivityQuery {
  limit?: number
  /** Keyset pagination: return events older than this id. */
  before?: number
  userId?: string
  kind?: ActivityKind
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function listActivity(query: ActivityQuery = {}): Promise<ActivityEvent[]> {
  const db = await getDb()

  const where: string[] = []
  const params: (string | number)[] = []

  if (query.before != null) {
    // Paged by id rather than by timestamp: two events in the same
    // millisecond would otherwise be returned again on the next page, or
    // skipped, depending on how the sort broke the tie.
    where.push('id < ?')
    params.push(query.before)
  }
  if (query.userId) {
    where.push('user_id = ?')
    params.push(query.userId)
  }
  if (query.kind) {
    where.push('kind = ?')
    params.push(query.kind)
  }

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  params.push(limit)

  const rows = await db.all<ActivityRow>(
    `SELECT id, at, user_id, email, kind, summary, meta, ip
       FROM activity
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?`,
    params,
  )

  return rows.map(toEvent)
}

/** How many of each kind happened since a given moment. */
export async function countByKind(since: number): Promise<Record<string, number>> {
  const db = await getDb()
  const rows = await db.all<{ kind: string; n: number | string }>(
    'SELECT kind, COUNT(*) AS n FROM activity WHERE at >= ? GROUP BY kind',
    [since],
  )

  const out: Record<string, number> = {}
  for (const row of rows) out[row.kind] = toNumber(row.n)
  return out
}

/**
 * Drop events past their useful life.
 *
 * An append-only table with nothing removing rows is a slow leak. Ninety days
 * is well past the point where "what did this account do" is still being
 * asked, and short enough that the table stays small enough to scan.
 */
export async function trimActivity(olderThanMs: number): Promise<number> {
  const db = await getDb()
  const cutoff = Date.now() - olderThanMs

  const row = await db.get<{ n: number | string }>(
    'SELECT COUNT(*) AS n FROM activity WHERE at < ?',
    [cutoff],
  )
  const removed = toNumber(row?.n ?? 0)
  if (removed === 0) return 0

  await db.run('DELETE FROM activity WHERE at < ?', [cutoff])
  log.info('trimmed old activity', { removed })
  return removed
}
