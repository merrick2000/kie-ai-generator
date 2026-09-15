import { NextResponse } from 'next/server'

import { callerIp, record } from '@/lib/activity'
import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { deleteOmniCharacter } from '@/lib/omni/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/** DELETE /api/omni/characters/:id. Local only: Kie documents no delete. */
async function handleDELETE(_req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const { id } = await context.params
  const gone = await deleteOmniCharacter(auth.user.id, id)
  if (!gone) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  await record({
    kind: 'character_deleted',
    userId: auth.user.id,
    email: auth.user.email,
    summary: gone.name ?? 'Unnamed character',
    meta: { character: id },
    ip: await callerIp(),
  })
  return NextResponse.json({ deleted: true })
}

export const DELETE = withLogging(handleDELETE)
