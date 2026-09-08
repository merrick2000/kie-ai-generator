/**
 * The admin gate, for route handlers.
 *
 * Two refusals, deliberately different. Not signed in gets 401 and the usual
 * prompt. Signed in but not an admin gets 404, not 403: a signed-in user who
 * is not an admin has no business learning that an admin surface exists here,
 * and 403 tells them exactly that.
 */

import 'server-only'

import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import type { CurrentUser } from '@/lib/auth'
import { isAdmin } from './index'

export type AdminAuthorized =
  | { ok: true; user: CurrentUser }
  | { ok: false; response: NextResponse }

export async function requireAdmin(): Promise<AdminAuthorized> {
  const auth = await requireUser()
  if (!auth.ok) return auth

  if (!(await isAdmin(auth.user))) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found.' }, { status: 404 }),
    }
  }

  return { ok: true, user: auth.user }
}
