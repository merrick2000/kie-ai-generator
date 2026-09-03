import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { verifySchema } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('health')

/**
 * GET /api/health
 *
 * Used by the container healthcheck and by any load balancer in front of it.
 *
 * It touches the database rather than just returning 200: an instance that
 * cannot reach Postgres can still serve HTML, but it cannot sign anyone in, so
 * reporting it as healthy would send traffic to a broken replica.
 */
async function handleGET() {
  const startedAt = Date.now()

  try {
    const db = await getDb()
    await db.get('SELECT 1 AS ok')

    // Reachable is not the same as usable: a database missing a table answers
    // SELECT 1 happily and then fails every real query.
    const schema = await verifySchema(db)

    const body = {
      status: schema.ok ? 'ok' : 'degraded',
      database: 'postgres',
      schema: schema.ok
        ? 'ok'
        : {
            missingTables: schema.missingTables,
            missingColumns: schema.missingColumns,
          },
      latencyMs: Date.now() - startedAt,
      version: process.env.GIT_HASH?.slice(0, 7) ?? 'dev',
    }

    // 503 on a bad schema, so a load balancer takes the instance out rather
    // than sending it traffic it cannot serve.
    return NextResponse.json(body, { status: schema.ok ? 200 : 503 })
  } catch (err) {
    // The message can name a host or a user, so it goes to the logs only.
    log.error('database unreachable', { error: err, ms: Date.now() - startedAt })

    return NextResponse.json(
      {
        status: 'error',
        database: 'postgres',
        error: 'Database unavailable',
        latencyMs: Date.now() - startedAt,
      },
      { status: 503 },
    )
  }
}

export const GET = withLogging(handleGET)
