import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { countClearable } from '@/lib/jobs/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/jobs/clearable?projectId=…
 *
 * How many results DELETE /api/jobs would remove.
 *
 * Its own endpoint rather than a flag on the delete, because a DELETE that
 * sometimes does not delete is a trap for the next person reading it. The
 * count is what the confirmation shows, and it comes from the same clauses
 * the sweep itself uses, so the number offered and the number taken cannot
 * disagree.
 */
async function handleGET(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const project = new URL(req.url).searchParams.get('projectId')

  const count = await countClearable(auth.user.id, {
    projectId: project === 'unfiled' ? null : project || undefined,
  })

  return NextResponse.json({ count })
}

export const GET = withLogging(handleGET)
