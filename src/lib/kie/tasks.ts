/**
 * Transport adapter.
 *
 * The studio speaks one language: submit a job, poll a normalized status.
 * Behind it, Kie exposes three unrelated shapes (market jobs, Veo, Suno).
 * Everything that differs between them is contained in this file.
 */

import 'server-only'

import {
  createSunoTask,
  createTask,
  createVeoTask,
  extractUrls,
  getSunoTask,
  getTask,
  getVeoTask,
  parseResultJson,
  callbackUrl,
} from './client'
import { getModel, type ModelApi } from './catalog'
import {
  VEO_FLAG,
  type KieTaskState,
  type SunoGenerateRequest,
  type VeoGenerateRequest,
} from './types'

/** A single produced asset. */
export interface TaskAsset {
  url: string
  kind: 'image' | 'video' | 'audio'
  /** Poster frame, when the provider gives one (Suno cover art, video thumb). */
  poster?: string
  title?: string
  durationSec?: number
}

/** The normalized status every transport resolves to. */
export interface NormalizedTask {
  taskId: string
  state: KieTaskState
  /** 0–100 when known, otherwise inferred from state. */
  progress: number
  assets: TaskAsset[]
  /** Free-form text output (chat models). */
  text?: string
  error?: string
  errorCode?: string | number | null
  costTimeMs?: number | null
  creditsConsumed?: number | null
  createdAt?: number | null
  completedAt?: number | null
}

/* ────────────────────────────────────────────────────────────────────────────
 * Submission
 * ──────────────────────────────────────────────────────────────────────────*/

export interface SubmitResult {
  taskId: string
  api: ModelApi
}

/**
 * Submit a generation.
 *
 * `input` is the already-validated body built from the model's field
 * descriptors; this function only reshapes it for the target transport.
 */
export async function submitTask(
  modelId: string,
  input: Record<string, unknown>,
): Promise<SubmitResult> {
  const model = getModel(modelId)
  if (!model) throw new Error(`Unknown model: ${modelId}`)

  const cb = callbackUrl()

  switch (model.api) {
    case 'veo': {
      const body = toVeoRequest(input, cb)
      const { taskId } = await createVeoTask(body)
      return { taskId, api: 'veo' }
    }
    case 'suno': {
      const body = toSunoRequest(input, cb)
      const { taskId } = await createSunoTask(body)
      return { taskId, api: 'suno' }
    }
    case 'market':
    default: {
      const { taskId } = await createTask({
        model: model.id,
        input,
        ...(cb ? { callBackUrl: cb } : {}),
      })
      return { taskId, api: 'market' }
    }
  }
}

/**
 * Veo takes its parameters at the top level rather than under `input`, and
 * infers `generationType` from how many images were supplied.
 */
function toVeoRequest(
  input: Record<string, unknown>,
  cb: string | undefined,
): VeoGenerateRequest {
  const imageUrls = Array.isArray(input.imageUrls)
    ? (input.imageUrls as string[]).filter(Boolean)
    : []

  const generationType: VeoGenerateRequest['generationType'] =
    imageUrls.length >= 2
      ? 'FIRST_AND_LAST_FRAMES_2_VIDEO'
      : imageUrls.length === 1
        ? 'REFERENCE_2_VIDEO'
        : 'TEXT_2_VIDEO'

  const duration = Number(input.duration)

  return {
    prompt: String(input.prompt ?? ''),
    ...(imageUrls.length ? { imageUrls } : {}),
    model: (input.model as VeoGenerateRequest['model']) ?? 'veo3_fast',
    generationType,
    aspect_ratio: (input.aspect_ratio as VeoGenerateRequest['aspect_ratio']) ?? '16:9',
    resolution: (input.resolution as VeoGenerateRequest['resolution']) ?? '720p',
    ...(duration === 4 || duration === 6 || duration === 8 ? { duration } : {}),
    ...(input.watermark ? { watermark: String(input.watermark) } : {}),
    enableTranslation: input.enableTranslation !== false,
    ...(cb ? { callBackUrl: cb } : {}),
  }
}

/**
 * Suno is also top-level, and rejects custom-mode fields when customMode is
 * off: so they are stripped rather than sent empty.
 */
function toSunoRequest(
  input: Record<string, unknown>,
  cb: string | undefined,
): SunoGenerateRequest {
  const customMode = input.customMode !== false
  const model = (input.model as SunoGenerateRequest['model']) ?? 'V5'

  const body: SunoGenerateRequest = {
    prompt: String(input.prompt ?? ''),
    customMode,
    instrumental: Boolean(input.instrumental),
    model,
    // Suno's docs mark callBackUrl required; fall back to a discard endpoint
    // when the app has no public origin so submission still succeeds.
    callBackUrl: cb ?? 'https://example.com/callback',
  }

  if (customMode) {
    if (input.style) body.style = String(input.style)
    if (input.title) body.title = String(input.title).slice(0, 80)
    // Duration control exists on v5.5 only.
    if (model === 'V5_5' && input.duration != null) {
      body.duration = Number(input.duration)
    }
  }

  if (input.negativeTags) body.negativeTags = String(input.negativeTags)
  if (input.vocalGender === 'm' || input.vocalGender === 'f') {
    body.vocalGender = input.vocalGender
  }
  for (const k of ['styleWeight', 'weirdnessConstraint', 'audioWeight'] as const) {
    if (input[k] != null) body[k] = Number(input[k])
  }

  return body
}

/* ────────────────────────────────────────────────────────────────────────────
 * Polling
 * ──────────────────────────────────────────────────────────────────────────*/

export async function pollTask(
  taskId: string,
  api: ModelApi,
  modelId?: string,
): Promise<NormalizedTask> {
  switch (api) {
    case 'veo':
      return normalizeVeo(await getVeoTask(taskId), taskId)
    case 'suno':
      return normalizeSuno(await getSunoTask(taskId), taskId)
    case 'market':
    default:
      return normalizeMarket(await getTask(taskId), modelId)
  }
}

/** State → coarse progress, used when the provider reports none. */
function impliedProgress(state: KieTaskState): number {
  switch (state) {
    case 'waiting':
      return 5
    case 'queuing':
      return 15
    case 'generating':
      return 55
    case 'success':
      return 100
    case 'fail':
      return 100
  }
}

function normalizeMarket(
  data: Awaited<ReturnType<typeof getTask>>,
  modelId?: string,
): NormalizedTask {
  const state = (data.state ?? 'waiting') as KieTaskState
  const result = parseResultJson(data.resultJson)
  const urls = extractUrls(result)
  const model = modelId ? getModel(modelId) : getModel(data.model ?? '')

  const assets: TaskAsset[] = urls.map((url) => ({
    url,
    kind: assetKind(url, model?.output),
  }))

  // Chat and analysis models return an object instead of media.
  let text: string | undefined
  if (result.resultObject != null) {
    text =
      typeof result.resultObject === 'string'
        ? result.resultObject
        : JSON.stringify(result.resultObject, null, 2)
  }

  return {
    taskId: data.taskId,
    state,
    progress:
      typeof data.progress === 'number' && data.progress > 0
        ? Math.min(100, data.progress)
        : impliedProgress(state),
    assets,
    text,
    error: state === 'fail' ? data.failMsg || 'Generation failed.' : undefined,
    errorCode: data.failCode ?? null,
    costTimeMs: data.costTime ?? null,
    creditsConsumed: data.creditsConsumed ?? null,
    createdAt: data.createTime ?? null,
    completedAt: data.completeTime ?? null,
  }
}

function normalizeVeo(
  data: Awaited<ReturnType<typeof getVeoTask>>,
  taskId: string,
): NormalizedTask {
  const flag = data.successFlag
  const state: KieTaskState =
    flag === VEO_FLAG.SUCCESS
      ? 'success'
      : flag === VEO_FLAG.FAILED || flag === VEO_FLAG.CREATE_FAILED
        ? 'fail'
        : 'generating'

  const urls = (data.response?.resultUrls ?? []).filter(Boolean)

  return {
    taskId: data.taskId || taskId,
    state,
    progress: impliedProgress(state),
    assets: urls.map((url) => ({ url, kind: 'video' as const })),
    error: state === 'fail' ? data.errorMessage || 'Veo generation failed.' : undefined,
    errorCode: data.errorCode ?? null,
    createdAt: data.createTime ?? null,
    completedAt: data.completeTime ?? null,
  }
}

function normalizeSuno(
  data: Awaited<ReturnType<typeof getSunoTask>>,
  taskId: string,
): NormalizedTask {
  const status = data.status ?? 'PENDING'
  const clips = data.response?.sunoData ?? []

  const failed =
    status === 'CREATE_TASK_FAILED' ||
    status === 'GENERATE_AUDIO_FAILED' ||
    status === 'CALLBACK_EXCEPTION' ||
    status === 'SENSITIVE_WORD_ERROR'

  // FIRST_SUCCESS means one of two tracks is playable, surface it early
  // rather than making the user wait for the pair.
  const state: KieTaskState = failed
    ? 'fail'
    : status === 'SUCCESS'
      ? 'success'
      : 'generating'

  // flatMap rather than map+filter: a clip without a playable URL contributes
  // nothing, and this keeps the array element type free of null.
  const assets: TaskAsset[] = clips.flatMap((c) => {
    const url = c.audio_url || c.source_audio_url || c.stream_audio_url
    if (!url) return []
    return [
      {
        url,
        kind: 'audio' as const,
        poster: c.image_url,
        title: c.title,
        durationSec: c.duration,
      },
    ]
  })

  const progress =
    status === 'SUCCESS'
      ? 100
      : status === 'FIRST_SUCCESS'
        ? 80
        : status === 'TEXT_SUCCESS'
          ? 40
          : 15

  return {
    taskId: data.taskId || taskId,
    state,
    progress: failed ? 100 : progress,
    assets,
    error: failed ? data.errorMessage || `Suno task ${status}.` : undefined,
    errorCode: data.errorCode ?? null,
  }
}

/** Infer how to render a URL, preferring the extension over the model hint. */
function assetKind(
  url: string,
  fallback: 'image' | 'video' | 'audio' | 'text' = 'image',
): 'image' | 'video' | 'audio' {
  const path = url.split('?')[0].toLowerCase()
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(path)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(path)) return 'audio'
  if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/.test(path)) return 'image'
  return fallback === 'text' ? 'image' : fallback
}
