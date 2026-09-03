import { NextResponse } from 'next/server'

import { signIn } from '@/lib/auth'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePOST(req: Request) {
  let body: { email?: string; password?: string }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const result = await signIn(body.email ?? '', body.password ?? '')

  if (!result.ok) {
    // 401 rather than 400: the credentials were well-formed but rejected.
    return NextResponse.json(
      { error: result.error, field: result.field },
      { status: 401 },
    )
  }

  return NextResponse.json({ user: result.user })
}

export const POST = withLogging(handlePOST)
