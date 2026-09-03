import { NextResponse } from 'next/server'

import { KieError, getDownloadUrl } from '@/lib/kie/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/kie/download
 *
 * Exchanges a Kie temp URL for a signed link valid ~20 minutes. Only needed
 * for assets whose direct URL has expired; fresh results stream fine through
 * /api/kie/proxy.
 */
export async function POST(req: Request) {
  let url: string | undefined
  try {
    ;({ url } = (await req.json()) as { url?: string })
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!url) {
    return NextResponse.json({ error: 'url is required.' }, { status: 400 })
  }

  try {
    return NextResponse.json({ url: await getDownloadUrl(url) })
  } catch (err) {
    if (err instanceof KieError) {
      return NextResponse.json({ error: err.message }, { status: err.clientStatus })
    }
    return NextResponse.json({ error: 'Could not sign download URL.' }, { status: 500 })
  }
}
