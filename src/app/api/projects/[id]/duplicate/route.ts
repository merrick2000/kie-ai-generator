import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { duplicateProject } from '@/lib/projects/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/projects/:id/duplicate
 *
 * Copies a project's name, colour and defaults. `withJobs` also copies the
 * finished work inside it, which is the difference between "same setup,
 * fresh start" and "a variant of this".
 */
async function handlePOST(req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params

  let body: { name?: string; withJobs?: boolean } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    // An empty body is a valid request: copy the settings, nothing else.
  }

  const result = await duplicateProject(auth.user.id, id, {
    name: body.name,
    withJobs: body.withJobs === true,
  })

  if (!result) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  return NextResponse.json(
    { project: result.project, copiedJobs: result.copiedJobs },
    { status: 201 },
  )
}

export const POST = withLogging(handlePOST)
