import { NextResponse } from 'next/server'

import { callerIp, record } from '@/lib/activity'
import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { deleteOmniVoice } from '@/lib/omni/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/**
 * DELETE /api/omni/voices/:id
 *
 * Local only: Kie documents no delete. Characters already made with this voice
 * keep it, since Kie bound it into them when they were created.
 */
async function handleDELETE(_req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const { id } = await context.params
  const gone = await deleteOmniVoice(auth.user.id, id)
  if (!gone) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  await record({
    kind: 'omni_voice_deleted',
    userId: auth.user.id,
    email: auth.user.email,
    summary: gone.name,
    meta: { voice: id },
    ip: await callerIp(),
  })
  return NextResponse.json({ deleted: true })
}

export const DELETE = withLogging(handleDELETE)
