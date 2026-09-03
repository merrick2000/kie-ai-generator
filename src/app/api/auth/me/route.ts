import { NextResponse } from 'next/server'

import { currentUser, signupsAllowed } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET, who is signed in. Returns `user: null` when nobody is. */
export async function GET() {
  return NextResponse.json({
    user: await currentUser(),
    signupsAllowed: await signupsAllowed(),
  })
}
