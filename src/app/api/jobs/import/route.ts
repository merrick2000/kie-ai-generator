import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import { importJobs, type ImportableJob } from '@/lib/jobs/store'
import { DEFAULT_PROJECT_NAME, findOrCreateProject } from '@/lib/projects/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** One request's worth. The client already chunks; this is the backstop. */
const MAX_JOBS = 200

const CATEGORIES = ['image', 'video', 'audio', 'text', 'utility']
const OUTPUTS = ['image', 'video', 'audio', 'text']

/**
 * POST /api/jobs/import
 *
 * Takes the history a browser was holding from before generations lived on
 * the server, and files it into the account's default project.
 *
 * Safe to call repeatedly. Each row is keyed on the account plus its original
 * id, so a second run, or the same history opened on a second device, adds
 * nothing and overwrites nothing.
 */
async function handlePOST(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  let body: { jobs?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!Array.isArray(body.jobs)) {
    return NextResponse.json({ error: 'jobs must be an array.' }, { status: 400 })
  }

  if (body.jobs.length > MAX_JOBS) {
    return NextResponse.json(
      { error: `Send at most ${MAX_JOBS} at a time.` },
      { status: 413 },
    )
  }

  // This data has been sitting in a browser and arrives over the wire, so it
  // is checked here rather than trusted: a bad row is dropped, and the rest
  // of somebody's history still comes across.
  const jobs: ImportableJob[] = []

  for (const raw of body.jobs) {
    if (!raw || typeof raw !== 'object') continue
    const job = raw as Record<string, unknown>

    const id = typeof job.id === 'string' ? job.id : ''
    const modelId = typeof job.modelId === 'string' ? job.modelId : ''
    if (!id || !modelId) continue

    const category = typeof job.category === 'string' ? job.category : ''
    const output = typeof job.output === 'string' ? job.output : ''

    jobs.push({
      id,
      taskId: typeof job.taskId === 'string' ? job.taskId : null,
      api: typeof job.api === 'string' ? job.api : 'market',
      modelId,
      modelName: typeof job.modelName === 'string' ? job.modelName : modelId,
      category: CATEGORIES.includes(category) ? category : 'image',
      output: OUTPUTS.includes(output) ? output : 'image',
      promptPreview: typeof job.promptPreview === 'string' ? job.promptPreview : '',
      values:
        job.values && typeof job.values === 'object'
          ? (job.values as Record<string, unknown>)
          : {},
      state: typeof job.state === 'string' ? job.state : 'success',
      assets: Array.isArray(job.assets) ? job.assets : [],
      text: typeof job.text === 'string' ? job.text : null,
      error: typeof job.error === 'string' ? job.error : null,
      favorite: job.favorite === true,
      creditsConsumed: typeof job.creditsConsumed === 'number' ? job.creditsConsumed : null,
      costTimeMs: typeof job.costTimeMs === 'number' ? job.costTimeMs : null,
      createdAt: typeof job.createdAt === 'number' ? job.createdAt : Date.now(),
      completedAt: typeof job.completedAt === 'number' ? job.completedAt : null,
    })
  }

  // Created on the first chunk and reused by the rest, so one import does not
  // scatter a history across several identically named projects.
  const project = await findOrCreateProject(auth.user.id, DEFAULT_PROJECT_NAME, {
    description: 'Everything made before results moved to the server.',
    color: 'slate',
  })

  const { imported, skipped } = await importJobs(auth.user.id, project.id, jobs)

  return NextResponse.json({
    imported,
    skipped,
    projectId: project.id,
    projectName: project.name,
  })
}

export const POST = withLogging(handlePOST)
