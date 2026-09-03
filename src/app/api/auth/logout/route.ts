import { NextResponse } from 'next/server'

import { signOut } from '@/lib/auth'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePOST() {
  await signOut()
  return NextResponse.json({ ok: true })
}

export const POST = withLogging(handlePOST)
