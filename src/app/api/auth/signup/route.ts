import { NextResponse } from 'next/server'

import { signUp } from '@/lib/auth'
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

  const result = await signUp(body.email ?? '', body.password ?? '')

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, field: result.field },
      { status: 400 },
    )
  }

  return NextResponse.json({ user: result.user })
}

export const POST = withLogging(handlePOST)
