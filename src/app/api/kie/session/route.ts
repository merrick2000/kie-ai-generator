import { NextResponse } from 'next/server'

import { clearApiKey, currentUser, setApiKey } from '@/lib/auth'
import { secretFromEnv } from '@/lib/auth/store'
import { keySource, verifyKey } from '@/lib/kie/client'
import { maskKey } from '@/lib/kie/session-crypto'
import { currentApiKey } from '@/lib/auth'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET, the signed-in user's key status. Never returns the key itself. */
async function handleGET() {
  const user = await currentUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const key = await currentApiKey()

  return NextResponse.json({
    source: await keySource(),
    // Enough to recognise the key in use, never enough to reuse it.
    masked: key ? maskKey(key) : null,
    envAvailable: Boolean(process.env.KIE_API_KEY?.trim()),
    secretFromEnv: secretFromEnv(),
  })
}

/**
 * POST, validate a key against Kie.ai and attach it to the account.
 *
 * Validating before storing means a typo surfaces here rather than on the
 * user's first generation.
 */
async function handlePOST(req: Request) {
  const user = await currentUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let key: string | undefined
  try {
    ;({ key } = (await req.json()) as { key?: string })
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!key?.trim()) {
    return NextResponse.json({ error: 'Enter an API key.' }, { status: 400 })
  }

  const result = await verifyKey(key)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  await setApiKey(key)

  return NextResponse.json({
    ok: true,
    credits: result.credits,
    masked: maskKey(key.trim()),
    source: 'user' as const,
  })
}

/** DELETE, detach the key from the account. */
async function handleDELETE() {
  const user = await currentUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  await clearApiKey()
  return NextResponse.json({ ok: true, source: await keySource() })
}

export const GET = withLogging(handleGET)
export const POST = withLogging(handlePOST)
export const DELETE = withLogging(handleDELETE)
