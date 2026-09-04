/**
 * Submitting a generation.
 *
 * One place decides what a submission means, so the HTTP route stays about
 * HTTP: it validates against the catalog, records the job before anything
 * leaves the building, and hands the rest to whichever transport the model
 * uses.
 *
 * Recording first is the important part. A task accepted upstream but never
 * written down is a charge with nothing to show for it, and no way to find
 * the result again.
 */

import 'server-only'

import { apiKeyForUser } from '@/lib/auth'
import { getModel, type ModelDef } from '@/lib/kie/catalog'
import { generateText } from '@/lib/kie/chat'
import { KieError, runWithApiKey } from '@/lib/kie/client'
import { buildInput, validate } from '@/lib/kie/fields'
import { nextPollDelay, nudge } from '@/lib/kie/reconciler'
import { submitTask } from '@/lib/kie/tasks'
import { createLogger, since } from '@/lib/logger'
import { touchProject } from '@/lib/projects/store'
import {
  attachTask,
  completeText,
  failJob,
  insertJob,
  markGenerating,
} from './store'
import type { Job } from './types'

const log = createLogger('generate')

/* ────────────────────────────────────────────────────────────────────────────
 * Reference routing
 * ──────────────────────────────────────────────────────────────────────────*/

export interface RouteResult {
  model: ModelDef
  values: Record<string, unknown>
  referenceCount: number
}

/**
 * Pick the model a submission should actually go to.
 *
 * Kie splits several models into a text-only slug and one that takes a
 * reference. Making the user choose between them means making them learn an
 * API detail, so the reference field is offered on the text variant and the
 * request is routed here when it is filled.
 */
export function resolveRoute(
  model: ModelDef,
  values: Record<string, unknown>,
): RouteResult {
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

/* ────────────────────────────────────────────────────────────────────────────
 * Project defaults
 * ──────────────────────────────────────────────────────────────────────────*/

export interface ProjectDefaults {
  promptPrefix?: string
  promptSuffix?: string
}

/**
 * Apply the project's standing instructions to a prompt.
 *
 * A project exists so a look does not have to be retyped on every run. The
 * pieces are joined with blank lines rather than spaces, since models read
 * them as separate paragraphs of direction.
 */
export function applyProjectPrompt(
  prompt: string,
  defaults: ProjectDefaults | undefined,
): string {
  if (!defaults) return prompt

  return [defaults.promptPrefix?.trim(), prompt.trim(), defaults.promptSuffix?.trim()]
    .filter(Boolean)
    .join('\n\n')
}

/* ────────────────────────────────────────────────────────────────────────────
 * Submission
 * ──────────────────────────────────────────────────────────────────────────*/

export type StartResult =
  | { ok: true; job: Job }
  | { ok: false; error: string; status: number; code?: number; errors?: string[] }

export interface StartInput {
  userId: string
  modelId: string
  values: Record<string, unknown>
  projectId: string | null
  /** Merged into the prompt, when the run belongs to a project. */
  projectDefaults?: ProjectDefaults
}

export async function startGeneration(input: StartInput): Promise<StartResult> {
  const startedAt = Date.now()
  const model = getModel(input.modelId)

  if (!model) {
    return { ok: false, error: `Unknown model: ${input.modelId}`, status: 400 }
  }

  // The project's prefix and suffix are part of the prompt from here on, so
  // what is validated, submitted and stored are all the same text.
  const values: Record<string, unknown> = { ...input.values }
  if (typeof values.prompt === 'string' && values.prompt.trim()) {
    values.prompt = applyProjectPrompt(values.prompt, input.projectDefaults)
  }

  const routed = resolveRoute(model, values)

  const errors = validate(routed.model.fields, routed.values)
  if (errors.length) {
    log.warn('rejected invalid submission', {
      model: model.id,
      userId: input.userId,
      errors,
    })
    return { ok: false, error: errors.join(' '), status: 400, errors }
  }

  const promptSource =
    (values.prompt as string) || (values.text as string) || (values.title as string) || ''

  const job = await insertJob({
    userId: input.userId,
    projectId: input.projectId,
    api: model.api,
    modelId: model.id,
    submittedModelId: routed.model.id === model.id ? null : routed.model.id,
    modelName: model.name,
    category: model.category,
    output: model.output,
    promptPreview: promptSource.trim(),
    values,
  })

  if (input.projectId) {
    // Ordering the switcher by recent activity is only useful if activity
    // updates it.
    void touchProject(input.userId, input.projectId).catch(() => undefined)
  }

  if (routed.model.id !== model.id) {
    log.info('routed to the reference variant', {
      jobId: job.id,
      from: model.id,
      to: routed.model.id,
      references: routed.referenceCount,
    })
  }

  if (model.api === 'chat') {
    return startChat(job, model, routed.values, input.userId, startedAt)
  }

  // Built against the target model's own fields, which drops anything it does
  // not accept: Kling takes an aspect ratio for text-to-video but derives it
  // from the image otherwise.
  const body = buildInput(routed.model.fields, routed.values)

  try {
    const { taskId } = await submitTask(routed.model.id, body)
    await attachTask(job.id, taskId, Date.now() + nextPollDelay(0))

    log.info('submitted', {
      jobId: job.id,
      taskId,
      model: routed.model.id,
      api: model.api,
      userId: input.userId,
      // The prompt is not logged: it is user content, and often very long.
      inputKeys: Object.keys(body).join(','),
      ms: since(startedAt),
    })

    // Poll now rather than on the next tick, which is most of the perceived
    // latency on a model that finishes in three seconds.
    nudge()

    return { ok: true, job: { ...job, taskId, state: 'queuing', progress: 8 } }
  } catch (err) {
    const message =
      err instanceof KieError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Submission failed.'

    await failJob(job.id, message)

    if (err instanceof KieError) {
      log.warn('submission refused upstream', {
        jobId: job.id,
        model: routed.model.id,
        userId: input.userId,
        code: err.code,
        reason: err.message,
      })
      return { ok: false, error: err.message, status: err.clientStatus, code: err.code }
    }

    log.error('submission failed', {
      jobId: job.id,
      model: routed.model.id,
      userId: input.userId,
      error: err,
    })
    return { ok: false, error: message, status: 500 }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Language models
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Run a text generation without making the caller wait for it.
 *
 * These models answer in the request, which would otherwise mean a browser
 * holding a connection open for minutes while a reasoning model thinks, and
 * losing the answer if it navigated away. The job row is the delivery
 * mechanism instead: the request returns immediately, the answer is written
 * when it arrives, and the studio picks it up on its next sync.
 */
async function startChat(
  job: Job,
  model: ModelDef,
  values: Record<string, unknown>,
  userId: string,
  startedAt: number,
): Promise<StartResult> {
  const endpoint = model.chat
  if (!endpoint) {
    await failJob(job.id, 'This model has no endpoint configured.')
    return { ok: false, error: 'This model has no endpoint configured.', status: 500 }
  }

  const key = await apiKeyForUser(userId)
  if (!key) {
    await failJob(job.id, 'No Kie.ai API key configured. Add one in Settings.')
    return {
      ok: false,
      error: 'No Kie.ai API key configured. Add one in Settings.',
      status: 401,
    }
  }

  const images = Array.isArray(values.image_urls)
    ? (values.image_urls as unknown[]).filter(
        (v): v is string => typeof v === 'string' && Boolean(v),
      )
    : []

  const request = {
    prompt: String(values.prompt ?? ''),
    system: typeof values.system === 'string' ? values.system.trim() : undefined,
    effort: typeof values.effort === 'string' ? values.effort : undefined,
    webSearch: values.web_search === true,
    imageUrls: images,
    maxTokens: typeof values.max_tokens === 'number' ? values.max_tokens : undefined,
  }

  await markGenerating(job.id)

  log.info('asking', {
    jobId: job.id,
    model: model.id,
    transport: endpoint.transport,
    userId,
    webSearch: request.webSearch,
    attachments: images.length,
    ms: since(startedAt),
  })

  // Deliberately not awaited. The promise is held by the process, not by the
  // request, so the answer still lands if the browser goes away.
  void runWithApiKey(key, () => generateText(endpoint, request, key))
    .then((result) =>
      completeText(job.id, result.text, result.creditsConsumed, result.costTimeMs),
    )
    .catch(async (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'The model could not answer.'
      log.warn('text generation failed', { jobId: job.id, model: model.id, reason: message })
      await failJob(job.id, message).catch(() => undefined)
    })

  return { ok: true, job: { ...job, state: 'generating', progress: 40 } }
}
