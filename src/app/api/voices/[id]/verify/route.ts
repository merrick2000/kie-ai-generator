import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { publicVoice, verifyVoice } from '@/lib/voices/flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/** POST /api/voices/:id/verify, step two: `{ "verifyUrl": "https://…" }`. */
async function handlePOST(req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: { verifyUrl?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { id } = await context.params
  const result = await verifyVoice({ id: auth.user.id, email: auth.user.email }, id, body.verifyUrl)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ voice: publicVoice(result.voice) })
}

export const POST = withLogging(handlePOST)
