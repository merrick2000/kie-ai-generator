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
  {
    version: 4,
    name: 'activity',
    statements: [
      // What happened, as opposed to what exists.
      //
      // The other tables hold current state: who has an account, which jobs
      // are running. Neither can answer "who signed up this week" or "what
      // did this person do before they stopped coming back", because state is
      // overwritten and history is not kept anywhere.
      //
      // Runs are not written here. The jobs table already records every
      // generation with its model, cost and outcome, and duplicating that
      // would leave two versions of the same fact free to disagree. This
      // carries only the events that would otherwise vanish into stdout.
      `CREATE TABLE IF NOT EXISTS activity (
         id      BIGSERIAL PRIMARY KEY,
         at      BIGINT NOT NULL,

         -- No foreign key, deliberately. A failed sign-in has no account to
         -- point at, and deleting a user must not erase the record of what
         -- they did: an audit trail that disappears with its subject is not
         -- an audit trail. The email is denormalised for the same reason.
         user_id TEXT,
         email   TEXT,

         kind    TEXT NOT NULL,
         summary TEXT NOT NULL DEFAULT '',
         meta    TEXT NOT NULL DEFAULT '{}',
         ip      TEXT
       )`,

      // The feed reads newest first, and one person's history is read by id.
      `CREATE INDEX IF NOT EXISTS activity_at_idx ON activity(at DESC)`,
      `CREATE INDEX IF NOT EXISTS activity_user_idx ON activity(user_id, at DESC)`,
      `CREATE INDEX IF NOT EXISTS activity_kind_idx ON activity(kind, at DESC)`,
    ],
  },
  {
    version: 5,
    name: 'voices',
    statements: [
      // A cloned voice is not a job. A job is submitted once and polled to an
      // end; a voice is a reusable asset built across several calls with a
      // person in the middle, who has to read a phrase aloud before the last
      // step can run. That can take a minute or a day, so the state lives
      // here between steps rather than in a poll loop.
      `CREATE TABLE IF NOT EXISTS voices (
         id                 TEXT PRIMARY KEY,
         user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

         name               TEXT NOT NULL,
         description        TEXT,
         style              TEXT,
         language           TEXT NOT NULL DEFAULT 'en',
         singer_skill_level TEXT,

         -- The recording the voice is taken from, and the stretch of it used.
         source_url         TEXT NOT NULL,
         vocal_start_s      INTEGER NOT NULL,
         vocal_end_s        INTEGER NOT NULL,

         -- Step one: Kie listens to the source and writes a phrase for the
         -- owner of the voice to read back.
         phrase_task_id     TEXT,
         phrase             TEXT,

         -- Step two: the reading, and the task that turns it into a voice.
         verify_url         TEXT,
         create_task_id     TEXT,

         -- A regenerated phrase is polled under its own task, while the
         -- final step is still sent the original one: Kie's docs ask for "the
         -- original validation task ID" there.
         regenerate_task_id TEXT,

         -- The result: what Suno is given as a persona id.
         voice_id           TEXT,
         check_task_id      TEXT,
         available          BOOLEAN,

         status             TEXT NOT NULL,
         error              TEXT,

         -- When the account holder confirmed they own this voice or have
         -- permission to clone it. Not null: there is no voice without it.
         consent_at         BIGINT NOT NULL,

         created_at         BIGINT NOT NULL,
         updated_at         BIGINT NOT NULL
       )`,

      `CREATE INDEX IF NOT EXISTS voices_user_idx ON voices(user_id, created_at DESC)`,
    ],
  },
  {
    version: 6,
    name: 'omni_characters',
    statements: [
      // Gemini Omni hands back an id and keeps nothing browsable: there is no
      // endpoint to list or fetch a voice or a character. What this account
      // made is therefore only known here, and losing these rows loses the
      // ids with them.
      `CREATE TABLE IF NOT EXISTS omni_voices (
         id                TEXT PRIMARY KEY,
         user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         kie_audio_id      TEXT NOT NULL,
         name              TEXT NOT NULL,
         base_voice        TEXT NOT NULL,
         voice_description TEXT,
         example_dialogue  TEXT,
         created_at        BIGINT NOT NULL
       )`,

      `CREATE INDEX IF NOT EXISTS omni_voices_user_idx ON omni_voices(user_id, created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS omni_characters (
         id               TEXT PRIMARY KEY,
         user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         kie_character_id TEXT NOT NULL,
         name             TEXT,
         description      TEXT NOT NULL,
         image_url        TEXT NOT NULL,
         body_image_url   TEXT,
         -- JSON arrays: the local voice rows picked, and the Kie ids they
         -- stood for when the character was made.
         voice_ids        TEXT NOT NULL DEFAULT '[]',
         kie_audio_ids    TEXT NOT NULL DEFAULT '[]',
         created_at       BIGINT NOT NULL
       )`,

      `CREATE INDEX IF NOT EXISTS omni_characters_user_idx ON omni_characters(user_id, created_at DESC)`,
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
  activity: ['id', 'at', 'user_id', 'email', 'kind', 'summary', 'meta', 'ip'],
  voices: [
    'id', 'user_id', 'name', 'description', 'style', 'language',
    'singer_skill_level', 'source_url', 'vocal_start_s', 'vocal_end_s',
    'phrase_task_id', 'phrase', 'verify_url', 'create_task_id',
    'regenerate_task_id', 'voice_id', 'check_task_id', 'available', 'status',
    'error', 'consent_at', 'created_at', 'updated_at',
  ],
  omni_voices: [
    'id', 'user_id', 'kie_audio_id', 'name', 'base_voice', 'voice_description',
    'example_dialogue', 'created_at',
  ],
  omni_characters: [
    'id', 'user_id', 'kie_character_id', 'name', 'description', 'image_url',
    'body_image_url', 'voice_ids', 'kie_audio_ids', 'created_at',
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
