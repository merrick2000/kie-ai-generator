import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/admin'
import { currentUser, signupsAllowed } from '@/lib/auth'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET, who is signed in. Returns `user: null` when nobody is. */
async function handleGET() {
  const user = await currentUser()

  return NextResponse.json({
    user,
    signupsAllowed: await signupsAllowed(),
    // Decides whether the link to /admin is drawn. The page and its endpoints
    // each check again on their own: this only saves the owner from having to
    // remember a URL, it is not what keeps anyone else out.
    isAdmin: user ? await isAdmin(user) : false,
  })
}

export const GET = withLogging(handleGET)
