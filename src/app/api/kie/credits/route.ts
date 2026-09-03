import { NextResponse } from 'next/server'

import { KieError, getCredits, hasApiKey } from '@/lib/kie/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/kie/credits, balance plus whether the server is configured. */
export async function GET() {
  if (!(await hasApiKey())) {
    return NextResponse.json({ configured: false, credits: null })
  }

  try {
    const credits = await getCredits()
    return NextResponse.json({ configured: true, credits })
  } catch (err) {
    if (err instanceof KieError) {
      return NextResponse.json(
        { configured: true, credits: null, error: err.message },
        { status: err.clientStatus },
      )
    }
    return NextResponse.json(
      { configured: true, credits: null, error: 'Could not read credit balance.' },
      { status: 500 },
    )
  }
}
