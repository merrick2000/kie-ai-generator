import { createHmac, timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

import { WEBHOOK_HEADERS, type KieCallbackPayload } from '@/lib/kie/types'
import { recordCallback } from '@/lib/kie/callback-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Reject callbacks whose timestamp is further than this from now. */
const MAX_SKEW_SECONDS = 5 * 60

/**
 * POST /api/kie/callback
 *
 * Kie POSTs here when a task finishes, signing the request with
 * base64(HMAC-SHA256(`${taskId}.${timestamp}`)) under your webhook key.
 *
 * The studio polls regardless, so this endpoint is an optimisation: it lets a
 * result land the instant it is ready instead of on the next poll tick.
 */
export async function POST(req: Request) {
  const raw = await req.text()

  let payload: KieCallbackPayload
  try {
    payload = JSON.parse(raw) as KieCallbackPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const taskId = payload.taskId ?? payload.data?.task_id ?? payload.data?.taskId
  if (!taskId) {
    return NextResponse.json({ error: 'Missing taskId.' }, { status: 400 })
  }

  const secret = process.env.KIE_WEBHOOK_HMAC_KEY?.trim()

  if (secret) {
    const timestamp = req.headers.get(WEBHOOK_HEADERS.TIMESTAMP)
    const signature = req.headers.get(WEBHOOK_HEADERS.SIGNATURE)

    if (!timestamp || !signature) {
      return NextResponse.json({ error: 'Missing signature headers.' }, { status: 401 })
    }

    // Bound replay of a captured, validly-signed callback.
    const skew = Math.abs(Date.now() / 1000 - Number(timestamp))
    if (!Number.isFinite(skew) || skew > MAX_SKEW_SECONDS) {
      return NextResponse.json({ error: 'Stale timestamp.' }, { status: 401 })
    }

    const expected = createHmac('sha256', secret)
      .update(`${taskId}.${timestamp}`)
      .digest('base64')

    const a = Buffer.from(expected)
    const b = Buffer.from(signature)

    // timingSafeEqual throws on length mismatch, so guard before comparing.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
    }
  }

  recordCallback(taskId, payload)

  // Always 200 on an accepted callback: a non-2xx makes Kie retry.
  return NextResponse.json({ received: true })
}
