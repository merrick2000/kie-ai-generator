import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { modelUsage, usageTotals } from '@/lib/jobs/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/stats/models
 *
 * What this account actually uses.
 *
 * Fifty-odd models is too many to choose between from a cold start, and the
 * catalog's own idea of what is good says nothing about what works here. This
 * ranks them by evidence: runs, how many succeeded, what they cost and how
 * long they took.
 */
async function handleGET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const [models, totals] = await Promise.all([
    modelUsage(auth.user.id),
    usageTotals(auth.user.id),
  ])

  return NextResponse.json({ models, totals })
}

export const GET = withLogging(handleGET)
