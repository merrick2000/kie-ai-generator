import 'server-only'

import { createPostgresClient } from './postgres'
import { migrate } from './schema'
import type { DatabaseClient } from './types'

export type { DatabaseClient, SqlValue } from './types'

/**
 * Connection string.
 *
 * Required: there is no local fallback, so a misconfigured deployment fails
 * loudly at the first query instead of quietly writing to a file that
 * disappears on the next redeploy.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL?.trim()

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Highfield needs a Postgres database. ' +
        'For local development: docker compose -f docker-compose.dev.yml up -d',
    )
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      `DATABASE_URL must be a postgres:// connection string, got "${url.slice(0, 12)}…"`,
    )
  }
  return url
}

/** True when a database is configured, without throwing. */
export function isConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim()
  return Boolean(url && /^postgres(ql)?:\/\//.test(url))
}

/**
 * The process-wide client.
 *
 * Cached on globalThis so Next's dev-mode module reloading does not open a new
 * pool on every edit.
 */
declare global {
  // eslint-disable-next-line no-var
  var __highfieldDb: Promise<DatabaseClient> | undefined
}

async function connect(): Promise<DatabaseClient> {
  const client = createPostgresClient(connectionString())
  await migrate(client)
  return client
}

export function getDb(): Promise<DatabaseClient> {
  if (!globalThis.__highfieldDb) {
    globalThis.__highfieldDb = connect().catch((err) => {
      // Clear the cache so the next request retries rather than being stuck
      // with a permanently rejected promise.
      globalThis.__highfieldDb = undefined
      throw err
    })
  }
  return globalThis.__highfieldDb
}
