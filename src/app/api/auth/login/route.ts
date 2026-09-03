import { NextResponse } from 'next/server'

import { signIn } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
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
