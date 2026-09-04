import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { startGeneration } from '@/lib/jobs/runner'
import { getProject } from '@/lib/projects/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/kie/create
 *
 * Starts a generation and answers with the job that now owns it.
 *
 * The response is not the result. The job is recorded server-side and carried
 * to completion there, so the browser is free to reload, navigate away or
 * close entirely without stranding a task that is already being paid for.
 */
async function handlePOST(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: {
    modelId?: string
    values?: Record<string, unknown>
    projectId?: string | null
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body.modelId) {
    return NextResponse.json({ error: 'modelId is required.' }, { status: 400 })
  }

  // Checked rather than trusted: the id comes from the client, and a run must
  // not be filed into somebody else's project.
  let projectId: string | null = null
  let projectDefaults: { promptPrefix?: string; promptSuffix?: string } | undefined

  if (body.projectId) {
    const project = await getProject(auth.user.id, body.projectId)
    if (!project) {
      return NextResponse.json({ error: 'Unknown project.' }, { status: 404 })
    }
    projectId = project.id
    projectDefaults = {
      promptPrefix: project.settings.promptPrefix,
      promptSuffix: project.settings.promptSuffix,
    }
  }

  const result = await startGeneration({
    userId: auth.user.id,
    modelId: body.modelId,
    values: body.values ?? {},
    projectId,
    projectDefaults,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code, errors: result.errors },
      { status: result.status },
    )
  }

  return NextResponse.json({ job: result.job })
}

export const POST = withLogging(handlePOST)
