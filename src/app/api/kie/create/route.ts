import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { startGeneration, valuesForRun } from '@/lib/jobs/runner'
import { getModel } from '@/lib/kie/catalog'
import type { Job } from '@/lib/jobs/types'
import { getProject } from '@/lib/projects/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Runs one request may start.
 *
 * Each is a real submission that spends real credits, so the ceiling is low
 * enough that a mistyped number cannot empty an account, and low enough to
 * stay well inside Kie's rate limit while they go out.
 */
const MAX_RUNS = 8

/**
 * POST /api/kie/create
 *
 * Starts one generation, or a batch of them, and answers with the jobs that
 * now own them.
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
    /** How many variations to start. Defaults to one. */
    count?: number
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

  const requested = Number(body.count)
  const count = Number.isFinite(requested)
    ? Math.min(MAX_RUNS, Math.max(1, Math.floor(requested)))
    : 1

  const model = getModel(body.modelId)
  const values = body.values ?? {}

  const jobs: Job[] = []
  let failure: Awaited<ReturnType<typeof startGeneration>> | null = null

  // Sequential, not parallel. Every run is a submission against the same Kie
  // rate limit, and eight at once is the fastest way to have most of them
  // come back as 429s.
  for (let index = 0; index < count; index++) {
    const result = await startGeneration({
      userId: auth.user.id,
      modelId: body.modelId,
      // A different seed each time, or a batch is one picture repeated.
      values: model ? valuesForRun(model, values, index) : values,
      projectId,
      projectDefaults,
    })

    if (result.ok) {
      jobs.push(result.job)
      continue
    }

    failure = result
    // The rest of the batch would fail the same way: a rejected prompt or an
    // empty balance does not improve on the next attempt.
    break
  }

  // Nothing started, so this is simply a failure.
  if (!jobs.length && failure && !failure.ok) {
    return NextResponse.json(
      { error: failure.error, code: failure.code, errors: failure.errors },
      { status: failure.status },
    )
  }

  // Some started and some did not. Answering 200 with what happened beats
  // an error that hides the runs already under way and being paid for.
  return NextResponse.json({
    jobs,
    requested: count,
    ...(failure && !failure.ok
      ? { partial: true, error: failure.error, code: failure.code }
      : {}),
  })
}

export const POST = withLogging(handlePOST)
