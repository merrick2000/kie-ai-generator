import { NextResponse } from 'next/server'

import type { ModelApi } from '@/lib/kie/catalog'
import { KieError } from '@/lib/kie/client'
import { pollTask } from '@/lib/kie/tasks'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_APIS: ModelApi[] = ['market', 'veo', 'suno']

/** GET /api/kie/status?taskId=…&api=market&modelId=… */
async function handleGET(req: Request) {
  const url = new URL(req.url)
  const taskId = url.searchParams.get('taskId')
  const api = (url.searchParams.get('api') ?? 'market') as ModelApi
  const modelId = url.searchParams.get('modelId') ?? undefined

  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required.' }, { status: 400 })
  }
  if (!VALID_APIS.includes(api)) {
    return NextResponse.json({ error: `Unknown api: ${api}` }, { status: 400 })
  }

  try {
    const task = await pollTask(taskId, api, modelId)
    return NextResponse.json(task)
  } catch (err) {
    if (err instanceof KieError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.clientStatus },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Status check failed.' },
      { status: 500 },
    )
  }
}

export const GET = withLogging(handleGET)
