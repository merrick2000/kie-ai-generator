import { NextResponse } from 'next/server'

import { callerIp, record } from '@/lib/activity'
import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { isWaiting, publicVoice, refreshVoice } from '@/lib/voices/flow'
import { deleteVoice, getVoice } from '@/lib/voices/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/** GET /api/voices/:id, advanced by one step if Kie has moved on. */
async function handleGET(_req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const voice = await getVoice(auth.user.id, id)
  if (!voice) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const current = isWaiting(voice)
    ? await refreshVoice(voice, { id: auth.user.id, email: auth.user.email })
    : voice
  return NextResponse.json({ voice: publicVoice(current) })
}

/**
 * DELETE /api/voices/:id
 *
 * Removes it here. Kie documents no way to delete a voice upstream, so the id
 * may stay valid there; what goes is this account's ability to pick it.
 */
async function handleDELETE(_req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const voice = await getVoice(auth.user.id, id)
  if (!voice || !(await deleteVoice(auth.user.id, id))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  await record({
    kind: 'voice_deleted',
    userId: auth.user.id,
    email: auth.user.email,
    summary: voice.name,
    meta: { voice: id },
    ip: await callerIp(),
  })

  return NextResponse.json({ deleted: true })
}

export const GET = withLogging(handleGET)
export const DELETE = withLogging(handleDELETE)
