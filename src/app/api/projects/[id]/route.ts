import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import {
  deleteProject,
  getProject,
  updateProject,
  type ProjectSettings,
} from '@/lib/projects/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

async function handleGET(_req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const project = await getProject(auth.user.id, id)
  if (!project) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  return NextResponse.json({ project })
}

/**
 * PATCH /api/projects/:id
 *
 * `settings` is merged rather than replaced, so a client that only knows
 * about the prompt prefix cannot wipe the defaults it has never heard of.
 */
async function handlePATCH(req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params

  let body: {
    name?: string
    description?: string | null
    color?: string | null
    settings?: ProjectSettings
    archived?: boolean
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const project = await updateProject(auth.user.id, id, body)
  if (!project) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  return NextResponse.json({ project })
}

/**
 * DELETE /api/projects/:id
 *
 * The work inside survives and moves to Unfiled. Deleting a folder should
 * never destroy what it held.
 */
async function handleDELETE(_req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const deleted = await deleteProject(auth.user.id, id)
  if (!deleted) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  return NextResponse.json({ deleted: true })
}

export const GET = withLogging(handleGET)
export const PATCH = withLogging(handlePATCH)
export const DELETE = withLogging(handleDELETE)
