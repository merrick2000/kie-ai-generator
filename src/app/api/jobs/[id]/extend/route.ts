import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { getJob } from '@/lib/jobs/store'
import { startGeneration } from '@/lib/jobs/runner'
import { getModel } from '@/lib/kie/catalog'
import { defaultsFor } from '@/lib/kie/fields'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/jobs/:id/extend
 *
 * Continue a finished clip past the ceiling of a single generation.
 *
 * Every video model caps one call: Veo at eight seconds, Grok at thirty.
 * Kie's way past that is a second request naming the *task id* of the first,
 * which means a longer clip can only be built from a shorter one that already
 * exists. So this is an action on a result rather than a model in the picker:
 * the task id is read from the job, never typed.
 *
 * Body: the extension model's own fields, minus the task id.
 * `{ "prompt": "the camera pulls back", "extend_times": 10 }`
 */
async function handlePOST(req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const job = await getJob(auth.user.id, id)
  if (!job) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const source = getModel(job.modelId)
  if (!source?.extend) {
    return NextResponse.json(
      { error: `${job.modelName} cannot be extended.`, code: 'not_extendable' },
      { status: 400 },
    )
  }

  // Kie extends a task, not a file, so a run that never reached the upstream
  // has nothing to continue from. Imported history is the common case: it has
  // a video but no task id, and the failure would otherwise be a confusing
  // rejection from Kie rather than a clear one from here.
  if (job.state !== 'success' || !job.taskId) {
    return NextResponse.json(
      {
        error:
          job.state === 'success'
            ? 'This result was imported, so Kie has no task to continue from.'
            : 'Only a finished result can be extended.',
        code: 'not_extendable',
      },
      { status: 400 },
    )
  }

  const target = getModel(source.extend.with)
  if (!target?.continuation) {
    return NextResponse.json(
      { error: `${source.extend.with} is no longer in the catalog.` },
      { status: 410 },
    )
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // An empty body is valid: everything but the prompt has a default, and
    // validation will say so if the prompt is what is missing.
  }

  const values = {
    ...defaultsFor(target.fields),
    ...body,
    // Last, so a caller cannot point the extension at somebody else's task by
    // putting a task id in the body.
    [target.continuation.taskIdField]: job.taskId,
  }

  const result = await startGeneration({
    userId: auth.user.id,
    modelId: target.id,
    values,
    // Kept with the clip it continues.
    projectId: job.projectId,
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
