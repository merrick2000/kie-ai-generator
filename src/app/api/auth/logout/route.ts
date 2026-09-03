import { NextResponse } from 'next/server'

import { signOut } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  await signOut()
  return NextResponse.json({ ok: true })
}
