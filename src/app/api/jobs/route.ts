import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api-auth'
import { withLogging } from '@/lib/api-logging'
import {
  clearJobs,
  latestUpdatedAt,
  listJobs,
  projectCounts,
  type JobQuery,
} from '@/lib/jobs/store'
import type { ModelCategory } from '@/lib/kie/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CATEGORIES: ModelCategory[] = ['image', 'video', 'audio', 'text', 'utility']

/**
 * GET /api/jobs
 *
 * The studio's view of its own work. Two modes:
 *
 *   - a full read, filtered and searched, for the gallery
 *   - `?updatedSince=` for the sync loop, which asks often and should get
 *     nothing back when nothing changed
 *
 * The second is why the whole list is not simply re-sent every two seconds:
 * a session with hundreds of results would move megabytes for no reason.
 */
async function handleGET(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const params = new URL(req.url).searchParams
  const query: JobQuery = {}

  const project = params.get('projectId')
  // "unfiled" is a real filter, distinct from "any project", so it needs a
  // spelling of its own: an absent parameter cannot express it.
  if (project === 'unfiled') query.projectId = null
  else if (project) query.projectId = project

  const category = params.get('category')
  if (category && CATEGORIES.includes(category as ModelCategory)) {
    query.category = category as ModelCategory
  }

  const status = params.get('status')
  if (status === 'running' || status === 'success' || status === 'fail') {
    query.status = status
  }

  if (params.get('favorite') === 'true') query.favorite = true

  const search = params.get('search')
  if (search) query.search = search.slice(0, 200)

  const modelId = params.get('modelId')
  if (modelId) query.modelId = modelId

  const sort = params.get('sort')
  if (sort === 'oldest' || sort === 'cost' || sort === 'newest') query.sort = sort

  const updatedSince = Number(params.get('updatedSince'))
  if (Number.isFinite(updatedSince) && updatedSince > 0) query.updatedSince = updatedSince

  const limit = Number(params.get('limit'))
  if (Number.isFinite(limit) && limit > 0) query.limit = limit

  const offset = Number(params.get('offset'))
  if (Number.isFinite(offset) && offset > 0) query.offset = offset

  const [jobs, syncedAt] = await Promise.all([
    listJobs(auth.user.id, query),
    // Account-wide, deliberately. Deriving it from the rows above would let a
    // filtered read leave the mark behind a job the filter excluded, and the
    // client would then re-fetch that same job on every tick forever.
    latestUpdatedAt(auth.user.id),
  ])

  // The sync loop does not need counters on every pass.
  const counts = params.get('counts') === 'true'
    ? await projectCounts(auth.user.id)
    : undefined

  return NextResponse.json({ jobs, counts, syncedAt })
}

/**
 * DELETE /api/jobs
 *
 * Sweeps finished, unpinned work. Running jobs stay: deleting one abandons a
 * task that is still being paid for upstream.
 */
async function handleDELETE(req: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const project = new URL(req.url).searchParams.get('projectId')
  const removed = await clearJobs(auth.user.id, {
    projectId: project === 'unfiled' ? null : project || undefined,
  })

  return NextResponse.json({ removed })
}

export const GET = withLogging(handleGET)
export const DELETE = withLogging(handleDELETE)
