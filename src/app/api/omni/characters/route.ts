import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { createCharacter, publicOmniCharacter } from '@/lib/omni/flow'
import { listOmniCharacters } from '@/lib/omni/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/omni/characters, this account's characters. */
async function handleGET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const characters = await listOmniCharacters(auth.user.id)
  return NextResponse.json({ characters: characters.map(publicOmniCharacter) })
}

/** POST /api/omni/characters, `{ name?, description, portraitUrl, bodyUrl?, voiceIds? }`. */
async function handlePOST(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const result = await createCharacter(
    { id: auth.user.id, email: auth.user.email },
    {
      name: body.name,
      description: body.description,
      portraitUrl: body.portraitUrl,
      bodyUrl: body.bodyUrl,
      voiceIds: body.voiceIds,
    },
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ character: publicOmniCharacter(result.value) }, { status: 201 })
}

export const GET = withLogging(handleGET)
export const POST = withLogging(handlePOST)
