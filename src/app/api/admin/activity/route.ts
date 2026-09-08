import { NextResponse } from 'next/server'

import { listActivity, type ActivityKind } from '@/lib/activity'
import { withLogging } from '@/lib/api-logging'
import { listRuns } from '@/lib/admin'
import { requireAdmin } from '@/lib/admin/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/activity
 *
 * The feed. Two sources, returned separately rather than pre-merged: runs
 * come from the jobs table so their state is live, events come from the
 * activity trail and never change. Interleaving them by timestamp is the
 * browser's job, and doing it there keeps each side paginated on its own key.
 *
 * ?userId= narrows both to one account, ?limit= caps each side.
 */
async function handleGET(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const params = new URL(req.url).searchParams
  const userId = params.get('userId') ?? undefined
  const kind = (params.get('kind') as ActivityKind | null) ?? undefined
  const limit = Number(params.get('limit')) || 60

  const [events, runs] = await Promise.all([
    listActivity({ userId, kind, limit }),
    // A kind filter is about events, so asking for one means runs are not
    // what is being looked for.
    kind ? Promise.resolve([]) : listRuns({ limit, userId }),
  ])

  return NextResponse.json({ events, runs })
}

export const GET = withLogging(handleGET)
