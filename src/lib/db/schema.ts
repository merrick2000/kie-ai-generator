import 'server-only'

import { createLogger } from '@/lib/logger'
import type { DatabaseClient } from './types'

/**
 * Schema and migrations.
 *
 * Applied in order at startup, each inside its own transaction, so a failure
 * halfway leaves nothing applied and no row claiming it was.
 *
 * Timestamps are stored as epoch milliseconds in BIGINT rather than
 * `timestamptz`: the app already thinks in `Date.now()`, and this avoids a
 * conversion layer whose only job would be to reintroduce timezone questions.
 */

const log = createLogger('db')

interface Migration {
  version: number
  name: string
  statements: string[]
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'accounts',
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
         id            TEXT PRIMARY KEY,
         email         TEXT NOT NULL UNIQUE,
         password_hash TEXT NOT NULL,
         api_key_enc   TEXT,
         created_at    BIGINT NOT NULL,
         last_login_at BIGINT
       )`,

      `CREATE TABLE IF NOT EXISTS sessions (
         token_hash TEXT PRIMARY KEY,
         user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         created_at BIGINT NOT NULL,
         expires_at BIGINT NOT NULL
       )`,

      // Sign-out deletes by user; expiry sweeps scan by expires_at.
      `CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)`,

      `CREATE TABLE IF NOT EXISTS app_settings (
         name       TEXT PRIMARY KEY,
         value      TEXT NOT NULL,
         created_at BIGINT NOT NULL
       )`,
    ],
  },
  {
    version: 2,
    name: 'articles',
    statements: [
      `CREATE TABLE IF NOT EXISTS articles (
         -- The upstream article id. Resending the same article updates the
         -- existing row rather than creating a duplicate.
         id               TEXT PRIMARY KEY,
         slug             TEXT NOT NULL UNIQUE,
         title            TEXT NOT NULL,
         html             TEXT NOT NULL,
         excerpt          TEXT,
         cover_image_url  TEXT,
         cover_image_alt  TEXT,
         keyword          TEXT,
         language         TEXT NOT NULL DEFAULT 'en',
         seo_title        TEXT,
         seo_description  TEXT,
         seo_keywords     TEXT,
         project_id       TEXT,
         project_name     TEXT,
         reading_minutes  INTEGER NOT NULL DEFAULT 1,
         published_at     BIGINT NOT NULL,
         created_at       BIGINT NOT NULL,
         updated_at       BIGINT NOT NULL
       )`,

      // The listing is ordered by publication date, newest first.
      `CREATE INDEX IF NOT EXISTS articles_published_at_idx
         ON articles(published_at DESC)`,
    ],
  },
  {
    version: 3,
    name: 'workspace',
    statements: [
      // A project is a folder with its own defaults. Everything a user makes
      // belongs to one, or to none, which reads as "Unfiled".
      `CREATE TABLE IF NOT EXISTS projects (
         id          TEXT PRIMARY KEY,
         user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         name        TEXT NOT NULL,
         description TEXT,
         color       TEXT,
         -- Free-form defaults applied to a new run inside this project:
         -- model, aspect ratio, a prompt prefix or suffix. Stored as JSON so
         -- adding a knob is not a migration.
         settings    TEXT NOT NULL DEFAULT '{}',
         archived    BOOLEAN NOT NULL DEFAULT FALSE,
         created_at  BIGINT NOT NULL,
         updated_at  BIGINT NOT NULL
       )`,

      `CREATE INDEX IF NOT EXISTS projects_user_idx
         ON projects(user_id, archived, updated_at DESC)`,

      // Jobs live here rather than in the browser so a generation survives a
      // reload, a closed tab and a different device. The server keeps polling
      // whether or not anyone is watching.
      `CREATE TABLE IF NOT EXISTS jobs (
         id                 TEXT PRIMARY KEY,
         user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,

         -- Null between insert and the upstream accepting the submission, and
         -- for chat models, which answer in the same request.
         task_id            TEXT,
         api                TEXT NOT NULL,
         -- The model the user picked. History stays attached to this one even
         -- when a reference routes the request to a sibling slug.
         model_id           TEXT NOT NULL,
         -- What was actually submitted, when routing changed it.
         submitted_model_id TEXT,
         model_name         TEXT NOT NULL,
         category           TEXT NOT NULL,
         output             TEXT NOT NULL,

         -- User-given name, overriding the prompt in listings.
         title              TEXT,
         prompt_preview     TEXT NOT NULL DEFAULT '',
         values_json        TEXT NOT NULL DEFAULT '{}',

         state              TEXT NOT NULL,
         progress           INTEGER NOT NULL DEFAULT 0,
         assets_json        TEXT NOT NULL DEFAULT '[]',
         text               TEXT,
         error              TEXT,
         favorite           BOOLEAN NOT NULL DEFAULT FALSE,

         credits_consumed   DOUBLE PRECISION,
         cost_time_ms       BIGINT,

         created_at         BIGINT NOT NULL,
         updated_at         BIGINT NOT NULL,
         completed_at       BIGINT,

         -- Reconciler bookkeeping. next_poll_at paces one job; lease_until
         -- stops two instances polling the same job in the same second.
         next_poll_at       BIGINT NOT NULL DEFAULT 0,
         lease_until        BIGINT NOT NULL DEFAULT 0,
         poll_attempts      INTEGER NOT NULL DEFAULT 0
       )`,

      // The gallery reads one user's work newest first.
      `CREATE INDEX IF NOT EXISTS jobs_user_created_idx
         ON jobs(user_id, created_at DESC)`,

      `CREATE INDEX IF NOT EXISTS jobs_project_idx
         ON jobs(project_id, created_at DESC)`,

      // The reconciler's hot query: unfinished jobs that are due.
      `CREATE INDEX IF NOT EXISTS jobs_pending_idx
         ON jobs(next_poll_at)
         WHERE state NOT IN ('success', 'fail')`,

      // Incremental sync sends only what changed since the client last asked.
      `CREATE INDEX IF NOT EXISTS jobs_user_updated_idx
         ON jobs(user_id, updated_at DESC)`,
    ],
  },
]

export async function migrate(db: DatabaseClient): Promise<void> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    BIGINT PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at BIGINT NOT NULL
     )`,
  )

  const applied = await db.all<{ version: number | string }>(
    'SELECT version FROM schema_migrations',
  )
  const done = new Set(applied.map((row) => Number(row.version)))

  const pending = MIGRATIONS.filter((m) => !done.has(m.version))

  // Says at a glance whether the schema this build expects is actually
  // present. A missing table is otherwise only discovered when a request
  // fails, which is the worst moment to learn it.
  log.info('schema', {
    applied: MIGRATIONS.length - pending.length,
    total: MIGRATIONS.length,
    pending: pending.map((m) => m.name).join(',') || undefined,
  })

  for (const migration of pending) {
    await db.transaction(async (tx) => {
      for (const statement of migration.statements) {
        await tx.run(statement)
      }
      await tx.run(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, Date.now()],
      )
    })

    log.info('migration applied', { version: migration.version, name: migration.name })
  }

  const report = await verifySchema(db)

  if (report.ok) {
    log.info('schema verified', { tables: report.tables })
  } else {
    // Loud, because every affected request will fail later with a much less
    // helpful message.
    log.error('SCHEMA MISMATCH: the database is missing what this build needs', {
      missingTables: report.missingTables.join(',') || undefined,
      missingColumns: report.missingColumns.join(',') || undefined,
      hint: 'Restore a current dump, or drop schema_migrations to force a rebuild on an empty database.',
    })
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Verification
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * What the running code needs to exist.
 *
 * The migration table records intent; this checks reality. They diverge when a
 * migration is marked applied but partially failed, when a database is
 * restored from an older dump, or when someone edits the schema by hand. Each
 * case surfaces later as a query failing mid-request, which is the worst place
 * to discover it.
 *
 * Only columns the code actually reads or writes are listed, so adding an
 * unrelated column upstream does not raise a false alarm.
 */
const REQUIRED: Record<string, string[]> = {
  users: ['id', 'email', 'password_hash', 'api_key_enc', 'created_at', 'last_login_at'],
  sessions: ['token_hash', 'user_id', 'created_at', 'expires_at'],
  app_settings: ['name', 'value', 'created_at'],
  articles: [
    'id', 'slug', 'title', 'html', 'excerpt', 'cover_image_url', 'cover_image_alt',
    'keyword', 'language', 'seo_title', 'seo_description', 'seo_keywords',
    'project_id', 'project_name', 'reading_minutes', 'published_at',
    'created_at', 'updated_at',
  ],
  projects: [
    'id', 'user_id', 'name', 'description', 'color', 'settings', 'archived',
    'created_at', 'updated_at',
  ],
  jobs: [
    'id', 'user_id', 'project_id', 'task_id', 'api', 'model_id',
    'submitted_model_id', 'model_name', 'category', 'output', 'title',
    'prompt_preview', 'values_json', 'state', 'progress', 'assets_json',
    'text', 'error', 'favorite', 'credits_consumed', 'cost_time_ms',
    'created_at', 'updated_at', 'completed_at', 'next_poll_at',
    'lease_until', 'poll_attempts',
  ],
}

export interface SchemaReport {
  ok: boolean
  /** Tables the code needs that are not there at all. */
  missingTables: string[]
  /** Columns missing from tables that do exist, as "table.column". */
  missingColumns: string[]
  tables: number
}

export async function verifySchema(db: DatabaseClient): Promise<SchemaReport> {
  const rows = await db.all<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  )

  const present = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!present.has(row.table_name)) present.set(row.table_name, new Set())
    present.get(row.table_name)!.add(row.column_name)
  }

  const missingTables: string[] = []
  const missingColumns: string[] = []

  for (const [table, columns] of Object.entries(REQUIRED)) {
    const found = present.get(table)
    if (!found) {
      missingTables.push(table)
      continue
    }
    for (const column of columns) {
      if (!found.has(column)) missingColumns.push(`${table}.${column}`)
    }
  }

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    missingTables,
    missingColumns,
    tables: present.size,
  }
}
