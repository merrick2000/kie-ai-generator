import { NextResponse } from 'next/server'

import { getModel } from '@/lib/kie/catalog'
import { KieError } from '@/lib/kie/client'
import { buildInput, validate } from '@/lib/kie/fields'
import { submitTask } from '@/lib/kie/tasks'
import { createLogger, since } from '@/lib/logger'
import { currentUser } from '@/lib/auth'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('generate')

/**
 * POST /api/kie/create
 *
 * Validates a submission against the catalog schema, then forwards it to Kie.
 * Validating here: not only in the browser, keeps a tampered client from
 * spending credits on a malformed job.
 */
async function handlePOST(req: Request) {
  const startedAt = Date.now()
  const user = await currentUser()

  let body: { modelId?: string; values?: Record<string, unknown> }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const model = body.modelId ? getModel(body.modelId) : undefined
  if (!model) {
    return NextResponse.json(
      { error: `Unknown model: ${body.modelId ?? '(none)'}` },
      { status: 400 },
    )
  }

  const values = body.values ?? {}
  const errors = validate(model.fields, values)
  if (errors.length) {
    log.warn('rejected invalid submission', {
      model: model.id,
      userId: user?.id,
      errors,
    })
    return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 })
  }

  const input = buildInput(model.fields, values)

  try {
    const { taskId, api } = await submitTask(model.id, input)

    log.info('submitted', {
      taskId,
      model: model.id,
      api,
      userId: user?.id,
      // The prompt is not logged: it is user content, and often very long.
      inputKeys: Object.keys(input).join(','),
      ms: since(startedAt),
    })

    return NextResponse.json({ taskId, api, modelId: model.id })
  } catch (err) {
    if (err instanceof KieError) {
      log.warn('submission refused upstream', {
        model: model.id,
        userId: user?.id,
        code: err.code,
        reason: err.message,
      })
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.clientStatus },
      )
    }

    log.error('submission failed', { model: model.id, userId: user?.id, error: err })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Submission failed.' },
      { status: 500 },
    )
  }
}

export const POST = withLogging(handlePOST)
