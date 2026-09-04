import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { deleteJob, getJob, patchJob } from '@/lib/jobs/store'
import { getProject } from '@/lib/projects/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/** GET /api/jobs/:id */
async function handleGET(_req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const job = await getJob(auth.user.id, id)
  if (!job) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  return NextResponse.json({ job })
}

/**
 * PATCH /api/jobs/:id
 *
 * Renaming, pinning and filing. A result is worth keeping only if it can be
 * found again, and "a photorealistic portrait of…" truncated to forty
 * characters is not a name.
 */
async function handlePATCH(req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params

  let body: { title?: string | null; favorite?: boolean; projectId?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  // Same check as on submission: a job must not be filed into a project this
  // account does not own.
  if (body.projectId) {
    const project = await getProject(auth.user.id, body.projectId)
    if (!project) return NextResponse.json({ error: 'Unknown project.' }, { status: 404 })
  }

  const job = await patchJob(auth.user.id, id, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.favorite !== undefined ? { favorite: Boolean(body.favorite) } : {}),
    ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
  })

  if (!job) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({ job })
}

/** DELETE /api/jobs/:id */
async function handleDELETE(_req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params
  await deleteJob(auth.user.id, id)
  return NextResponse.json({ deleted: true })
}

export const GET = withLogging(handleGET)
export const PATCH = withLogging(handlePATCH)
export const DELETE = withLogging(handleDELETE)
