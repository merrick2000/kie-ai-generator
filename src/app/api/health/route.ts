import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 *
 * Used by the container healthcheck and by any load balancer in front of it.
 *
 * It touches the database rather than just returning 200: an instance that
 * cannot reach Postgres can still serve HTML, but it cannot sign anyone in, so
 * reporting it as healthy would send traffic to a broken replica.
 */
export async function GET() {
  const startedAt = Date.now()

  try {
    const db = await getDb()
    await db.get('SELECT 1 AS ok')

    return NextResponse.json({
      status: 'ok',
      database: 'postgres',
      latencyMs: Date.now() - startedAt,
      version: process.env.GIT_HASH?.slice(0, 7) ?? 'dev',
    })
  } catch (err) {
    // The message can name a host or a user, so it goes to the logs only.
    console.error('[health] database check failed:', err)

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
