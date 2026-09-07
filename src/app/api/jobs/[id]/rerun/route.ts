import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { getJob } from '@/lib/jobs/store'
import { startGeneration, valuesForRun } from '@/lib/jobs/runner'
import { getModel } from '@/lib/kie/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/jobs/:id/rerun
 *
 * Run a result again with its own settings.
 *
 * The alternative was three clicks and a context switch: open the card menu,
 * load the settings back into the composer, then press Generate. Repeating a
 * run is the most common thing anyone does with a result they nearly like, so
 * it is worth one click.
 *
 * The seed moves. Repeating a run with the same seed returns the same
 * picture, which is a copy rather than another attempt. Send
 * `{ "identical": true }` when a byte-for-byte repeat is what you want, which
 * is occasionally useful when a run failed for a reason that has since been
 * fixed.
 */
async function handlePOST(req: Request, context: Context) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const job = await getJob(auth.user.id, id)
  if (!job) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const model = getModel(job.modelId)
  if (!model) {
    return NextResponse.json(
      { error: `${job.modelName} is no longer in the catalog.` },
      { status: 410 },
    )
  }

  let body: { identical?: boolean } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    // An empty body means the usual thing: run it again, differently.
  }

  // The prompt stored on the job already has the project's prefix and suffix
  // folded in, so they are not applied a second time here.
  const result = await startGeneration({
    userId: auth.user.id,
    modelId: job.modelId,
    values: body.identical ? job.values : valuesForRun(model, job.values, 1),
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
