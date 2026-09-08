import { NextResponse } from 'next/server'

import { withLogging } from '@/lib/api-logging'
import { adminMode, overview } from '@/lib/admin'
import { requireAdmin } from '@/lib/admin/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/overview
 *
 * The numbers at the top of the admin page: accounts, runs, spend, and the
 * two counts worth knowing without being asked, which are jobs failing today
 * and sign-ins being refused today.
 */
async function handleGET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  return NextResponse.json({
    overview: await overview(),
    mode: await adminMode(),
  })
}

export const GET = withLogging(handleGET)
