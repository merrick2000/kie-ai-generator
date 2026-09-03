/**
 * Server-side Kie.ai client.
 *
 * This module is import-restricted to the server: it reads KIE_API_KEY and
 * must never reach the browser bundle. Route handlers under /api/kie proxy
 * every call so the key stays here.
 */

import 'server-only'

import { currentApiKey } from '@/lib/auth'

import {
  KIE_CODE,
  type CreateTaskData,
  type CreateTaskRequest,
  type KieEnvelope,
  type KieResultJson,
  type RecordInfoData,
  type SunoGenerateRequest,
  type SunoRecordInfoData,
  type UploadResultData,
  type VeoGenerateRequest,
  type VeoRecordInfoData,
} from './types'

const API_BASE = 'https://api.kie.ai'
const UPLOAD_BASE = 'https://kieai.redpandaai.co'

/** Thrown for any non-success Kie response, carrying the upstream code. */
export class KieError extends Error {
  readonly code: number
  readonly httpStatus: number

  constructor(message: string, code: number, httpStatus = 500) {
    super(message)
    this.name = 'KieError'
    this.code = code
    this.httpStatus = httpStatus
  }

  /** Map a Kie code onto the status this app should return to its client. */
  get clientStatus(): number {
    switch (this.code) {
      case KIE_CODE.UNAUTHORIZED:
        return 401
      case KIE_CODE.INSUFFICIENT_CREDITS:
        return 402
      case KIE_CODE.NOT_FOUND:
        return 404
      case KIE_CODE.VALIDATION_ERROR:
      case KIE_CODE.BAD_REQUEST:
        return 400
      case KIE_CODE.RATE_LIMITED:
        return 429
      default:
        return this.httpStatus >= 400 ? this.httpStatus : 502
    }
  }
}

/**
 * Resolve the key for the current request.
 *
 * The signed-in user's own key wins over the deployment's fallback, so one
 * instance can serve many people each billing their own Kie account.
 */
async function apiKey(): Promise<string> {
  const key = (await currentApiKey()) || process.env.KIE_API_KEY?.trim()

  if (!key) {
    throw new KieError(
      'No Kie.ai API key configured. Add one in Settings.',
      KIE_CODE.UNAUTHORIZED,
      401,
    )
  }
  return key
}

/** True when this request can reach Kie, without throwing. */
export async function hasApiKey(): Promise<boolean> {
  if (await currentApiKey()) return true
  return Boolean(process.env.KIE_API_KEY?.trim())
}

/** Where the active key came from, drives the Settings copy. */
export async function keySource(): Promise<'user' | 'env' | 'none'> {
  if (await currentApiKey()) return 'user'
  return process.env.KIE_API_KEY?.trim() ? 'env' : 'none'
}

/**
 * Check a key without storing it.
 *
 * Hits the credits endpoint, which is the cheapest authenticated call and
 * doubles as a useful "here is your balance" confirmation on the setup screen.
 */
export async function verifyKey(
  candidate: string,
): Promise<{ ok: true; credits: number } | { ok: false; error: string }> {
  const key = candidate.trim()
  if (!key) return { ok: false, error: 'Enter an API key.' }

  try {
    const res = await fetch(`${API_BASE}/api/v1/chat/credit`, {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    const payload = (await res.json().catch(() => ({}))) as {
      code?: number
      msg?: string
      data?: number
    }

    const code = payload.code ?? res.status
    if (code === KIE_CODE.UNAUTHORIZED) {
      return { ok: false, error: 'Kie.ai rejected this key. Check it and try again.' }
    }
    if (!res.ok || code !== KIE_CODE.SUCCESS) {
      return { ok: false, error: payload.msg || `Kie.ai returned ${code}.` }
    }

    return { ok: true, credits: typeof payload.data === 'number' ? payload.data : 0 }
  } catch {
    return { ok: false, error: 'Could not reach Kie.ai. Check your connection.' }
  }
}

/**
 * Base URL used to build `callBackUrl`. Webhooks only work when the app is
 * publicly reachable, so this is optional, polling covers the rest.
 */
export function callbackUrl(): string | undefined {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return undefined
  }
  return `${origin}/api/kie/callback`
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transport
 * ──────────────────────────────────────────────────────────────────────────*/

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  base?: string
  /** Retry idempotent reads on transient upstream failures. */
  retries?: number
  signal?: AbortSignal
}

async function request<T>(
  path: string,
  { method = 'GET', body, base = API_BASE, retries = 0, signal }: RequestOptions = {},
): Promise<T> {
  const url = `${base}${path}`
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${await apiKey()}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal,
      })

      const text = await res.text()
      let payload: KieEnvelope<T>

      try {
        payload = text ? (JSON.parse(text) as KieEnvelope<T>) : ({} as KieEnvelope<T>)
      } catch {
        throw new KieError(
          `Kie returned a non-JSON response (HTTP ${res.status}).`,
          res.status,
          res.status,
        )
      }

      // Kie signals failure in the body `code`, which can disagree with the
      // HTTP status, check both.
      const code = payload?.code ?? res.status
      if (!res.ok || code !== KIE_CODE.SUCCESS) {
        throw new KieError(
          payload?.msg || `Kie request failed (HTTP ${res.status}).`,
          code,
          res.status,
        )
      }

      return payload.data
    } catch (err) {
      lastError = err
      // Only retry transient conditions, and never the last attempt.
      const retryable =
        err instanceof KieError
          ? err.code === KIE_CODE.SERVER_ERROR || err.code === KIE_CODE.RATE_LIMITED
          : true
      if (!retryable || attempt === retries) break
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
    }
  }

  if (lastError instanceof KieError) throw lastError
  throw new KieError(
    lastError instanceof Error ? lastError.message : 'Kie request failed.',
    KIE_CODE.SERVER_ERROR,
    502,
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Market job API
 * ──────────────────────────────────────────────────────────────────────────*/

export function createTask(body: CreateTaskRequest, signal?: AbortSignal) {
  return request<CreateTaskData>('/api/v1/jobs/createTask', {
    method: 'POST',
    body,
    signal,
  })
}

export function getTask(taskId: string, signal?: AbortSignal) {
  return request<RecordInfoData>(
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { retries: 2, signal },
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Veo 3.1
 * ──────────────────────────────────────────────────────────────────────────*/

export function createVeoTask(body: VeoGenerateRequest, signal?: AbortSignal) {
  return request<CreateTaskData>('/api/v1/veo/generate', {
    method: 'POST',
    body,
    signal,
  })
}

export function getVeoTask(taskId: string, signal?: AbortSignal) {
  return request<VeoRecordInfoData>(
    `/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
    { retries: 2, signal },
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Suno
 * ──────────────────────────────────────────────────────────────────────────*/

export function createSunoTask(body: SunoGenerateRequest, signal?: AbortSignal) {
  return request<CreateTaskData>('/api/v1/generate', {
    method: 'POST',
    body,
    signal,
  })
}

export function getSunoTask(taskId: string, signal?: AbortSignal) {
  return request<SunoRecordInfoData>(
    `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    { retries: 2, signal },
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Common utilities
 * ──────────────────────────────────────────────────────────────────────────*/

export function getCredits(signal?: AbortSignal) {
  return request<number>('/api/v1/chat/credit', { retries: 1, signal })
}

/** Exchange a Kie temp URL for a signed download link (valid ~20 minutes). */
export function getDownloadUrl(url: string, signal?: AbortSignal) {
  return request<string>('/api/v1/common/download-url', {
    method: 'POST',
    body: { url },
    signal,
  })
}

/* ────────────────────────────────────────────────────────────────────────────
 * File upload
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Upload a file to Kie's CDN so a model can consume it as a URL.
 *
 * Uses the stream endpoint, which handles large files without the ~33% base64
 * overhead. Returns the public `fileUrl`.
 */
export async function uploadFile(
  file: File,
  uploadPath = 'highfield',
): Promise<UploadResultData> {
  const form = new FormData()
  form.append('file', file)
  form.append('uploadPath', uploadPath)

  const res = await fetch(`${UPLOAD_BASE}/api/file-stream-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await apiKey()}` },
    body: form,
    cache: 'no-store',
  })

  const text = await res.text()
  let payload: { success?: boolean; code?: number; msg?: string; data?: UploadResultData }

  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new KieError(`Upload failed: non-JSON response (HTTP ${res.status}).`, res.status, res.status)
  }

  const code = payload.code ?? res.status
  if (!res.ok || code !== KIE_CODE.SUCCESS || !payload.data?.fileUrl) {
    throw new KieError(payload.msg || 'File upload failed.', code, res.status)
  }

  return payload.data
}

/** Upload from a remote URL, letting Kie fetch it server-side. */
export async function uploadFromUrl(
  fileUrl: string,
  uploadPath = 'highfield',
): Promise<UploadResultData> {
  const res = await fetch(`${UPLOAD_BASE}/api/file-url-upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileUrl, uploadPath }),
    cache: 'no-store',
  })

  const payload = (await res.json().catch(() => ({}))) as {
    code?: number
    msg?: string
    data?: UploadResultData
  }

  const code = payload.code ?? res.status
  if (!res.ok || code !== KIE_CODE.SUCCESS || !payload.data?.fileUrl) {
    throw new KieError(payload.msg || 'Remote upload failed.', code, res.status)
  }

  return payload.data
}

/* ────────────────────────────────────────────────────────────────────────────
 * Result parsing
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * `resultJson` arrives as a JSON string. Some models nest it one level deeper
 * or return a bare array, so parsing stays permissive.
 */
export function parseResultJson(raw: string | null | undefined): KieResultJson {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { resultUrls: parsed.filter((v) => typeof v === 'string') }
    if (parsed && typeof parsed === 'object') return parsed as KieResultJson
    return {}
  } catch {
    return {}
  }
}

/** Pull every media URL out of a decoded result, in a stable order. */
export function extractUrls(result: KieResultJson): string[] {
  const urls: string[] = []

  const push = (v: unknown) => {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) urls.push(v)
    else if (Array.isArray(v)) v.forEach(push)
  }

  push(result.resultUrls)

  // Some endpoints only populate frame fields (e.g. return_last_frame).
  if (!urls.length) {
    push(result.firstFrameUrl)
    push(result.lastFrameUrl)
  }

  // Last resort: scan any remaining string/array values for media URLs.
  if (!urls.length) {
    for (const [key, value] of Object.entries(result)) {
      if (key === 'resultObject') continue
      push(value)
    }
  }

  return Array.from(new Set(urls))
}
