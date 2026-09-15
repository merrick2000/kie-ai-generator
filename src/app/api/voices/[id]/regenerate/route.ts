import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { publicVoice, regeneratePhrase } from '@/lib/voices/flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/** POST /api/voices/:id/regenerate, a new phrase when the last one expired. */
async function handlePOST(_req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const result = await regeneratePhrase({ id: auth.user.id, email: auth.user.email }, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ voice: publicVoice(result.voice) })
}

export const POST = withLogging(handlePOST)
