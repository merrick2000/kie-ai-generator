import 'server-only'

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

  for (const migration of MIGRATIONS) {
    if (done.has(migration.version)) continue

    await db.transaction(async (tx) => {
      for (const statement of migration.statements) {
        await tx.run(statement)
      }
      await tx.run(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, Date.now()],
      )
    })
  }
}
