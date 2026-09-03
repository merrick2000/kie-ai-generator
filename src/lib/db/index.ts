import 'server-only'

import { createLogger } from '@/lib/logger'
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
  const log = createLogger('boot')
  const url = connectionString()

  // Host and database only. The password lives in this string, so it is never
  // logged whole.
  let target = 'postgres'
  try {
    const parsed = new URL(url)
    target = `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`
  } catch {
    // Unparseable strings still connect; the label is cosmetic.
  }

  // Which optional features are actually configured. Answers "why did the
  // webhook 503" or "why is there no cost showing" without a code read.
  log.info('starting', {
    database: target,
    ssl: /sslmode=/.test(url) ? new URL(url).searchParams.get('sslmode') : 'off',
    // These hold a status, never a value, but the redactor filters by key
    // name, so they are named to say what they are rather than what they
    // guard. `webhookToken` would have been censored into uselessness.
    articleWebhook: process.env.ARTICLE_WEBHOOK_SECRET?.trim() ? 'configured' : 'DISABLED',
    webhookAuth: process.env.ARTICLE_WEBHOOK_TOKEN?.trim() ? 'bearer required' : 'signature only',
    keyEncryption: process.env.APP_SECRET?.trim() ? 'from env' : 'generated',
    fallbackKieKey: process.env.KIE_API_KEY?.trim() ? 'set' : 'none',
    publicUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || 'not set',
    signups: process.env.SIGNUPS_ENABLED?.trim().toLowerCase() === 'false' ? 'closed' : 'open',
  })

  const client = createPostgresClient(url)
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
