import { NextResponse } from 'next/server'

import { getModel, type ModelDef } from '@/lib/kie/catalog'
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
 * Pick the model a submission should actually go to.
 *
 * Returns the original model untouched when there is no route, or when the
 * reference field was left empty.
 */
function resolveRoute(
  model: ModelDef,
  values: Record<string, unknown>,
): { model: ModelDef; values: Record<string, unknown>; referenceCount: number } {
  const route = model.routeWithAssets
  if (!route) return { model, values, referenceCount: 0 }

  const raw = values[route.from]
  const references = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === 'string' && Boolean(v))
    : typeof raw === 'string' && raw
      ? [raw]
      : []

  if (!references.length) return { model, values, referenceCount: 0 }

  const target = getModel(route.modelId)
  if (!target) {
    // A broken route should not lose the request; fall back to the original.
    log.error('route target is missing from the catalog', {
      from: model.id,
      to: route.modelId,
    })
    return { model, values, referenceCount: 0 }
  }

  // The target field may be single-valued, so hand it one URL rather than a
  // list it would reject.
  const targetField = target.fields.find((f) => f.name === route.to)
  const wantsList = targetField?.kind === 'images' || targetField?.kind === 'videos'

  const { [route.from]: _dropped, ...rest } = values

  return {
    model: target,
    values: { ...rest, [route.to]: wantsList ? references : references[0] },
    referenceCount: references.length,
  }
}

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

  // Kie splits several models into a text-only slug and one that takes a
  // reference. Filling the optional reference field routes the submission to
  // the second, so the user never has to know which slug to pick.
  const routed = resolveRoute(model, values)

  if (routed.model.id !== model.id) {
    log.info('routed to the reference variant', {
      from: model.id,
      to: routed.model.id,
      references: routed.referenceCount,
    })
  }

  const errors = validate(routed.model.fields, routed.values)
  if (errors.length) {
    log.warn('rejected invalid submission', {
      model: model.id,
      userId: user?.id,
      errors,
    })
    return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 })
  }

  // Built against the target model's own fields, which drops anything it does
  // not accept: Kling takes an aspect ratio for text-to-video but derives it
  // from the image otherwise.
  const input = buildInput(routed.model.fields, routed.values)

  try {
    const { taskId, api } = await submitTask(routed.model.id, input)

    log.info('submitted', {
      taskId,
      model: routed.model.id,
      api,
      userId: user?.id,
      // The prompt is not logged: it is user content, and often very long.
      inputKeys: Object.keys(input).join(','),
      ms: since(startedAt),
    })

    // The studio keeps tracking under the model the user chose, so history
    // and cost stay attached to one entry rather than splitting in two.
    return NextResponse.json({ taskId, api, modelId: model.id })
  } catch (err) {
    if (err instanceof KieError) {
      log.warn('submission refused upstream', {
        model: routed.model.id,
        userId: user?.id,
        code: err.code,
        reason: err.message,
      })
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.clientStatus },
      )
    }

    log.error('submission failed', { model: routed.model.id, userId: user?.id, error: err })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Submission failed.' },
      { status: 500 },
    )
  }
}

export const POST = withLogging(handlePOST)
