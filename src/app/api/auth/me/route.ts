import { NextResponse } from 'next/server'

import { currentUser, signupsAllowed } from '@/lib/auth'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET, who is signed in. Returns `user: null` when nobody is. */
async function handleGET() {
  return NextResponse.json({
    user: await currentUser(),
    signupsAllowed: await signupsAllowed(),
  })
}

export const GET = withLogging(handleGET)
