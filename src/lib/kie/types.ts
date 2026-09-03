/**
 * Kie.ai API, wire types.
 *
 * Reference: https://docs.kie.ai
 *
 * Kie exposes three distinct API surfaces, all Bearer-authenticated against
 * https://api.kie.ai:
 *
 *   1. The unified "Market" job API , POST /api/v1/jobs/createTask
 *                                      GET  /api/v1/jobs/recordInfo?taskId=
 *      Covers the vast majority of models (image, video, audio, chat).
 *
 *   2. Dedicated legacy APIs with bespoke shapes, Veo 3.1, Suno, Runway,
 *      4o-image, Flux Kontext. Each has its own create + query endpoints.
 *
 *   3. Common utilities, credits, signed download URLs.
 *
 * File uploads live on a separate host: https://kieai.redpandaai.co
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Envelope
 * ──────────────────────────────────────────────────────────────────────────*/

/** Every Kie endpoint wraps its payload in this envelope. */
export interface KieEnvelope<T> {
  code: number
  msg: string
  data: T
}

/**
 * Documented Kie response codes.
 *
 * Note: `code` lives in the JSON body and does not always mirror the HTTP
 * status, so it must be checked independently of `response.ok`.
 */
export const KIE_CODE = {
  SUCCESS: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  INSUFFICIENT_CREDITS: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
} as const

/* ────────────────────────────────────────────────────────────────────────────
 * Market job API
 * ──────────────────────────────────────────────────────────────────────────*/

/** Lifecycle of a Kie generation task. */
export type KieTaskState =
  | 'waiting'
  | 'queuing'
  | 'generating'
  | 'success'
  | 'fail'

export const TERMINAL_STATES: readonly KieTaskState[] = ['success', 'fail']

export function isTerminal(state: KieTaskState): boolean {
  return TERMINAL_STATES.includes(state)
}

/** POST /api/v1/jobs/createTask */
export interface CreateTaskRequest {
  model: string
  input: Record<string, unknown>
  callBackUrl?: string
}

export interface CreateTaskData {
  taskId: string
}

/**
 * GET /api/v1/jobs/recordInfo
 *
 * `param` and `resultJson` arrive as JSON-encoded *strings*, not objects, so
 * they must be parsed defensively (see `parseResultJson`).
 */
export interface RecordInfoData {
  taskId: string
  model: string
  state: KieTaskState
  param?: string
  resultJson?: string
  failCode?: string | number | null
  failMsg?: string | null
  costTime?: number | null
  completeTime?: number | null
  createTime?: number | null
  updateTime?: number | null
  /** 0–100. Only some models (e.g. sora2) report granular progress. */
  progress?: number | null
  creditsConsumed?: number | null
}

/** Decoded shape of `RecordInfoData.resultJson`. */
export interface KieResultJson {
  resultUrls?: string[]
  firstFrameUrl?: string[] | string
  lastFrameUrl?: string[] | string
  /** Chat / text models return a structured object instead of URLs. */
  resultObject?: unknown
  [key: string]: unknown
}

/* ────────────────────────────────────────────────────────────────────────────
 * Dedicated APIs
 * ──────────────────────────────────────────────────────────────────────────*/

/** POST /api/v1/veo/generate */
export interface VeoGenerateRequest {
  prompt: string
  imageUrls?: string[]
  model?: 'veo3' | 'veo3_fast' | 'veo3_lite'
  generationType?:
    | 'TEXT_2_VIDEO'
    | 'FIRST_AND_LAST_FRAMES_2_VIDEO'
    | 'REFERENCE_2_VIDEO'
  aspect_ratio?: '16:9' | '9:16' | 'Auto'
  resolution?: '720p' | '1080p' | '4k'
  duration?: 4 | 6 | 8
  watermark?: string
  enableTranslation?: boolean
  callBackUrl?: string
}

/** GET /api/v1/veo/record-info */
export interface VeoRecordInfoData {
  taskId: string
  paramJson?: string
  completeTime?: number | null
  response?: {
    taskId?: string
    resultUrls?: string[]
    originUrls?: string[] | null
    resolution?: string
  } | null
  successFlag: number
  errorCode?: number | null
  errorMessage?: string | null
  createTime?: number | null
  fallbackFlag?: boolean
}

/**
 * Veo reports completion through an integer flag rather than a state string.
 * 0 = generating, 1 = success, 2/3 = failed.
 */
export const VEO_FLAG = {
  GENERATING: 0,
  SUCCESS: 1,
  FAILED: 2,
  CREATE_FAILED: 3,
} as const

/** POST /api/v1/generate (Suno) */
export interface SunoGenerateRequest {
  prompt: string
  customMode: boolean
  instrumental: boolean
  model: 'V4' | 'V4_5' | 'V4_5PLUS' | 'V4_5ALL' | 'V5' | 'V5_5'
  callBackUrl?: string
  style?: string
  title?: string
  negativeTags?: string
  vocalGender?: 'm' | 'f'
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  personaId?: string
  personaModel?: 'style_persona' | 'voice_persona'
  duration?: number
}

/** One track inside a Suno result. */
export interface SunoClip {
  id: string
  audio_url?: string
  source_audio_url?: string
  stream_audio_url?: string
  image_url?: string
  prompt?: string
  model_name?: string
  title?: string
  tags?: string
  createTime?: string
  duration?: number
}

/** GET /api/v1/generate/record-info (Suno) */
export interface SunoRecordInfoData {
  taskId: string
  parentMusicId?: string
  param?: string
  response?: { taskId?: string; sunoData?: SunoClip[] } | null
  status?:
    | 'PENDING'
    | 'TEXT_SUCCESS'
    | 'FIRST_SUCCESS'
    | 'SUCCESS'
    | 'CREATE_TASK_FAILED'
    | 'GENERATE_AUDIO_FAILED'
    | 'CALLBACK_EXCEPTION'
    | 'SENSITIVE_WORD_ERROR'
  type?: string
  errorCode?: number | null
  errorMessage?: string | null
}

/* ────────────────────────────────────────────────────────────────────────────
 * File upload API (separate host)
 * ──────────────────────────────────────────────────────────────────────────*/

export interface UploadResultData {
  fileId: string
  fileName: string
  originalName?: string
  fileSize: number
  mimeType: string
  uploadPath?: string
  /** Public URL to hand back to a generation endpoint. */
  fileUrl: string
  downloadUrl?: string
  uploadTime?: string
  /** Kie retains uploads for ~3 days. */
  expiresAt?: string
}

/* ────────────────────────────────────────────────────────────────────────────
 * Webhook callbacks
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Payload POSTed to `callBackUrl` on task completion. Signed with
 * `X-Webhook-Signature` = base64(HMAC-SHA256(`${taskId}.${timestamp}`)).
 */
export interface KieCallbackPayload {
  taskId?: string
  code: number
  msg: string
  data?: {
    task_id?: string
    taskId?: string
    callbackType?: string
    state?: KieTaskState
    resultJson?: string
    info?: unknown
    [key: string]: unknown
  }
}

export const WEBHOOK_HEADERS = {
  TIMESTAMP: 'x-webhook-timestamp',
  SIGNATURE: 'x-webhook-signature',
} as const
