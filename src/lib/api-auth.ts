/**
 * The signed-in user, for route handlers.
 *
 * Everything under /api/jobs and /api/projects reads and writes one person's
 * work, so each of them starts the same way. Centralising it means the check
 * cannot be forgotten in a new route, and the refusal reads the same
 * everywhere.
 */

import 'server-only'

import { NextResponse } from 'next/server'

import { currentUser, type CurrentUser } from '@/lib/auth'

export type Authorized =
  | { ok: true; user: CurrentUser }
  | { ok: false; response: NextResponse }

export async function requireUser(): Promise<Authorized> {
  const user = await currentUser()
  if (user) return { ok: true, user }

  return {
    ok: false,
    response: NextResponse.json(
      { error: 'Sign in to continue.', code: 'unauthenticated' },
      { status: 401 },
    ),
  }
}
