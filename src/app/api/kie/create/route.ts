import { NextResponse } from 'next/server'

import { getModel } from '@/lib/kie/catalog'
import { KieError } from '@/lib/kie/client'
import { buildInput, validate } from '@/lib/kie/fields'
import { submitTask } from '@/lib/kie/tasks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/kie/create
 *
 * Validates a submission against the catalog schema, then forwards it to Kie.
 * Validating here: not only in the browser, keeps a tampered client from
 * spending credits on a malformed job.
 */
export async function POST(req: Request) {
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
    return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 })
  }

  const input = buildInput(model.fields, values)

  try {
    const { taskId, api } = await submitTask(model.id, input)
    return NextResponse.json({ taskId, api, modelId: model.id })
  } catch (err) {
    if (err instanceof KieError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.clientStatus },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Submission failed.' },
      { status: 500 },
    )
  }
}
