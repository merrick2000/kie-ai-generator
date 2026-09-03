import { NextResponse } from 'next/server'

import { changePassword } from '@/lib/auth'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePOST(req: Request) {
  let body: { currentPassword?: string; newPassword?: string }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const result = await changePassword(
    body.currentPassword ?? '',
    body.newPassword ?? '',
  )

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

export const POST = withLogging(handlePOST)
