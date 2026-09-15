import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { createVoice, publicOmniVoice } from '@/lib/omni/flow'
import { listOmniVoices } from '@/lib/omni/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/omni/voices, this account's designed voices. */
async function handleGET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const voices = await listOmniVoices(auth.user.id)
  return NextResponse.json({ voices: voices.map(publicOmniVoice) })
}

/** POST /api/omni/voices, `{ baseVoice, name, voiceDescription?, exampleDialogue? }`. */
async function handlePOST(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const result = await createVoice(
    { id: auth.user.id, email: auth.user.email },
    {
      baseVoice: body.baseVoice,
      name: body.name,
      voiceDescription: body.voiceDescription,
      exampleDialogue: body.exampleDialogue,
    },
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ voice: publicOmniVoice(result.value) }, { status: 201 })
}

export const GET = withLogging(handleGET)
export const POST = withLogging(handlePOST)
