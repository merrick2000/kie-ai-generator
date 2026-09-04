import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { projectCounts } from '@/lib/jobs/store'
import { createProject, listProjects } from '@/lib/projects/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/projects — the switcher's list, with a run count on each. */
async function handleGET(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const includeArchived =
    new URL(req.url).searchParams.get('includeArchived') === 'true'

  const [projects, counts] = await Promise.all([
    listProjects(auth.user.id, includeArchived),
    projectCounts(auth.user.id),
  ])

  return NextResponse.json({ projects, counts })
}

/** POST /api/projects */
async function handlePOST(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: { name?: string; description?: string; color?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Give the project a name.' }, { status: 400 })
  }

  const project = await createProject(auth.user.id, {
    name: body.name,
    description: body.description,
    color: body.color,
  })

  return NextResponse.json({ project }, { status: 201 })
}

export const GET = withLogging(handleGET)
export const POST = withLogging(handlePOST)
