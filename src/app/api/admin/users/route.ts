import { NextResponse } from 'next/server'

import { withLogging } from '@/lib/api-logging'
import { listUsers } from '@/lib/admin'
import { requireAdmin } from '@/lib/admin/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/users
 *
 * Every account with what it has done. No password hashes and no API keys,
 * encrypted or otherwise: this endpoint answers "who is using this", and
 * neither of those is part of the answer.
 */
async function handleGET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  return NextResponse.json({ users: await listUsers() })
}

export const GET = withLogging(handleGET)
