import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { isWaiting, publicVoice, refreshVoice, startVoice } from '@/lib/voices/flow'
import { listVoices } from '@/lib/voices/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/voices
 *
 * The account's voices, each advanced by one step if Kie has moved on.
 * `?ready=1` returns only the ones Suno can use, for the composer's picker.
 */
async function handleGET(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const readyOnly = new URL(req.url).searchParams.get('ready') === '1'
  const actor = { id: auth.user.id, email: auth.user.email }

  const voices = await Promise.all(
    (await listVoices(auth.user.id)).map((voice) =>
      // The picker only needs what is already usable, so it does not pay for
      // polling voices still halfway through.
      !readyOnly && isWaiting(voice) ? refreshVoice(voice, actor) : voice,
    ),
  )

  const shown = readyOnly ? voices.filter((v) => v.status === 'ready' && v.voiceId) : voices
  return NextResponse.json({ voices: shown.map(publicVoice) })
}

/** POST /api/voices, step one: a recording in, a phrase requested. */
async function handlePOST(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const result = await startVoice(
    { id: auth.user.id, email: auth.user.email },
    {
      name: body.name,
      sourceUrl: body.sourceUrl,
      startS: body.startS,
      endS: body.endS,
      language: body.language,
      description: body.description,
      style: body.style,
      singerSkillLevel: body.singerSkillLevel,
      consent: body.consent,
    },
  )

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ voice: publicVoice(result.voice) }, { status: 201 })
}

export const GET = withLogging(handleGET)
export const POST = withLogging(handlePOST)
