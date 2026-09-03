import 'server-only'

import { Pool, type PoolClient } from 'pg'

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

/** Managed Postgres (Neon, Supabase, Heroku) requires TLS. */
function sslConfig(connectionString: string) {
  if (/\bsslmode=disable\b/.test(connectionString)) return undefined
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)
  if (local && !/\bsslmode=require\b/.test(connectionString)) return undefined
  // Managed providers commonly present a certificate the default trust store
  // does not chain to; the connection is still encrypted.
  return { rejectUnauthorized: false }
}

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
    console.error('[db] idle postgres client error:', err.message)
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
