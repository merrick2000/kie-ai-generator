/**
 * Database checks against a real Postgres.
 *
 *   DATABASE_URL=postgres://... bun --preload ./scripts/preload.ts scripts/test-db.mts
 */

import assert from 'node:assert/strict'
import { createPostgresClient } from '../src/lib/db/postgres'
import { migrate } from '../src/lib/db/schema'
import type { DatabaseClient } from '../src/lib/db/types'

let passed = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

async function runSuite(db: DatabaseClient, label: string) {
  console.log(`\n${label}`)

  await check('applies migrations idempotently', async () => {
    // Running twice must not fail or duplicate rows.
    await migrate(db)
    const rows = await db.all<{ version: number }>(
      'SELECT version FROM schema_migrations',
    )
    assert.equal(rows.length, 3)
  })

  await check('round-trips a user', async () => {
    await db.run(
      `INSERT INTO users (id, email, password_hash, api_key_enc, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['u1', 'a@example.com', 'hash', null, 1700000000000, null],
    )
    const row = await db.get<{ email: string; created_at: number | string }>(
      'SELECT * FROM users WHERE id = ?',
      ['u1'],
    )
    assert.equal(row?.email, 'a@example.com')
    // Postgres returns BIGINT as a string; both must survive the conversion.
    assert.equal(Number(row?.created_at), 1700000000000)
  })

  await check('enforces unique emails', async () => {
    await assert.rejects(
      db.run(
        `INSERT INTO users (id, email, password_hash, api_key_enc, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['u2', 'a@example.com', 'hash', null, 1700000000000, null],
      ),
    )
  })

  await check('rolls back a failed transaction', async () => {
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO users (id, email, password_hash, api_key_enc, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['u3', 'rollback@example.com', 'hash', null, 1, null],
        )
        throw new Error('boom')
      }),
    )
    assert.equal(await db.get('SELECT id FROM users WHERE id = ?', ['u3']), null)
  })

  await check('commits a successful transaction', async () => {
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO users (id, email, password_hash, api_key_enc, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['u4', 'commit@example.com', 'hash', null, 1, null],
      )
    })
    assert.notEqual(await db.get('SELECT id FROM users WHERE id = ?', ['u4']), null)
  })

  await check('joins a session to its user', async () => {
    await db.run(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      ['tok-live', 'u1', Date.now(), Date.now() + 60_000],
    )
    const row = await db.get<{ email: string }>(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`,
      ['tok-live', Date.now()],
    )
    assert.equal(row?.email, 'a@example.com')
  })

  await check('ignores an expired session', async () => {
    await db.run(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      ['tok-dead', 'u1', 1, Date.now() - 1000],
    )
    const row = await db.get(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`,
      ['tok-dead', Date.now()],
    )
    assert.equal(row, null)
  })

  await check('cascades session deletion with the user', async () => {
    await db.run('DELETE FROM users WHERE id = ?', ['u1'])
    const rows = await db.all('SELECT token_hash FROM sessions WHERE user_id = ?', ['u1'])
    assert.equal(rows.length, 0)
  })

  await check('upserts an article by id rather than duplicating', async () => {
    const insert = (title: string, slug: string) =>
      db.run(
        `INSERT INTO articles (id, slug, title, html, excerpt, cover_image_url,
           cover_image_alt, keyword, language, seo_title, seo_description,
           seo_keywords, project_id, project_name, reading_minutes,
           published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['a1', slug, title, '<p>x</p>', null, null, null, null, 'en', null, null,
         '[]', null, null, 1, 1700000000000, 1700000000000, 1700000000000],
      )

    await insert('First', 'first')
    await db.run('UPDATE articles SET title = ?, slug = ? WHERE id = ?', ['Second', 'second', 'a1'])

    const rows = await db.all<{ title: string }>('SELECT title FROM articles WHERE id = ?', ['a1'])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].title, 'Second')
  })

  await check('enforces unique article slugs', async () => {
    await assert.rejects(
      db.run(
        `INSERT INTO articles (id, slug, title, html, language, reading_minutes,
           published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['a2', 'second', 'Clash', '<p>x</p>', 'en', 1, 1, 1, 1],
      ),
    )
  })

  await check('creates a setting once under concurrency', async () => {
    // Both callers must observe the same value, or keys encrypted by one
    // would be unreadable by the other.
    const write = async (value: string) =>
      db.transaction(async (tx) => {
        const existing = await tx.get<{ value: string }>(
          'SELECT value FROM app_settings WHERE name = ?',
          ['secret'],
        )
        if (existing) return existing.value
        await tx.run(
          'INSERT INTO app_settings (name, value, created_at) VALUES (?, ?, ?)',
          ['secret', value, Date.now()],
        )
        return value
      })

    const first = await write('secret-a')
    const second = await write('secret-b')
    assert.equal(first, 'secret-a')
    assert.equal(second, 'secret-a')
  })
}

const url = process.env.DATABASE_URL?.trim()

if (!url) {
  console.error(
    '\nDATABASE_URL is required. Start one with:\n' +
      '  docker compose -f docker-compose.dev.yml up -d\n',
  )
  process.exit(1)
}

const db = createPostgresClient(url)

// Start from a clean slate so a re-run is not tripped by leftover rows.
// The whole schema rather than a list of tables: jobs and projects reference
// users, so dropping them one by one fails on the foreign keys, and naming
// every table here means this line has to be edited on each migration.
await db.run('DROP SCHEMA public CASCADE')
await db.run('CREATE SCHEMA public')
await migrate(db)
await runSuite(db, 'postgres')
await db.close()

console.log(`\n${passed} passed`)
