import 'server-only'

import { Pool, type PoolClient } from 'pg'

import { createLogger } from '@/lib/logger'

import type { DatabaseClient, SqlValue } from './types'

/**
 * Rewrite `?` placeholders to Postgres positional parameters.
 *
 * Keeps call sites free of hand-numbered `$1, $2`, which drift as soon as a
 * clause is inserted in the middle of a query.
 */
function toPositional(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

/**
 * TLS settings, taken from the connection string.
 *
 * `sslmode` is the libpq convention every Postgres provider already documents,
 * so it is read rather than guessed. An earlier version inferred TLS from the
 * hostname, treating anything that was not localhost as a managed provider.
 * That breaks the most common self-hosted setup: a Postgres container reached
 * by its service name on a private Docker network speaks no TLS, and the
 * connection failed with "The server does not support SSL connections".
 *
 * Default is off. A database on a private network does not need TLS, and a
 * managed provider always hands you a URL that says `sslmode=require`.
 *
 * `DATABASE_SSL` overrides the URL when you cannot edit it.
 */
function sslConfig(connectionString: string) {
  const override = process.env.DATABASE_SSL?.trim().toLowerCase()
  const mode = override || readSslMode(connectionString) || 'disable'

  switch (mode) {
    // Encrypt, but accept a certificate the default trust store cannot chain
    // to. This is what managed providers expect, and it is what `require`
    // means in libpq: protect the traffic, do not verify the identity.
    case 'require':
    case 'no-verify':
    case 'true':
      return { rejectUnauthorized: false }

    // Verify the certificate as well. Needs a CA the runtime already trusts.
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true }

    // `prefer` means "TLS if available, plaintext otherwise". node-postgres
    // cannot negotiate that, and silently downgrading would be worse than
    // being predictable, so it is treated as off.
    default:
      return undefined
  }
}

function readSslMode(connectionString: string): string | null {
  try {
    return new URL(connectionString).searchParams.get('sslmode')?.toLowerCase() ?? null
  } catch {
    // Fall back to a scan when the string is not a parseable URL.
    return /[?&]sslmode=([a-z-]+)/i.exec(connectionString)?.[1]?.toLowerCase() ?? null
  }
}

const log = createLogger('db')

export function createPostgresClient(connectionString: string): DatabaseClient {
  const pool = new Pool({
    connectionString,
    ssl: sslConfig(connectionString),
    // Serverless platforms open a pool per instance, so keep each one small.
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  // A broken idle connection must not take the process down.
  pool.on('error', (err) => {
    log.error('idle client error', { error: err })
  })

  /** `client` is set inside a transaction so every statement shares it. */
  const wrap = (client: PoolClient | null): DatabaseClient => {
    const run = async (sql: string, params: SqlValue[]) => {
      const text = toPositional(sql)
      if (client) return client.query(text, params)
      return pool.query(text, params)
    }

    return {
      async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
        return (await run(sql, params)).rows as T[]
      },

      async get<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
        return ((await run(sql, params)).rows[0] as T | undefined) ?? null
      },

      async run(sql: string, params: SqlValue[] = []): Promise<void> {
        await run(sql, params)
      },

      async transaction<T>(fn: (tx: DatabaseClient) => Promise<T>): Promise<T> {
        if (client) return fn(wrap(client))

        const connection = await pool.connect()
        try {
          await connection.query('BEGIN')
          const result = await fn(wrap(connection))
          await connection.query('COMMIT')
          return result
        } catch (err) {
          await connection.query('ROLLBACK').catch(() => {})
          throw err
        } finally {
          connection.release()
        }
      },

      async close(): Promise<void> {
        if (!client) await pool.end()
      },
    }
  }

  return wrap(null)
}
