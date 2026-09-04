/**
 * Text generation.
 *
 * Kie's language models do not go through the job API: they answer in the
 * same request, and each vendor keeps its own wire format rather than a
 * common one. There are four:
 *
 *   openai-chat        POST /{slug}/v1/chat/completions   (GPT 5.2, Gemini)
 *   openai-responses   POST /codex/v1/responses           (GPT 5.4 and later)
 *   grok-responses     POST /grok/v1/responses            (Grok)
 *   anthropic-messages POST /claude/v1/messages           (Claude)
 *
 * Everything that differs between them is contained here, so the rest of the
 * app sees the same "submit, get a result" shape it uses for images.
 */

import 'server-only'

import { KieError } from './client'
import { KIE_CODE } from './types'
import { createLogger, since } from '../logger'
import type { ChatEndpoint, ChatTransport } from './chat-types'

export type { ChatEndpoint, ChatTransport } from './chat-types'

const log = createLogger('chat')

const API_BASE = 'https://api.kie.ai'

/**
 * Generous, because these are the models that think before answering. A
 * high-effort reasoning request routinely runs past a minute, and cutting it
 * short wastes a call that was already paid for.
 */
const TIMEOUT_MS = 5 * 60 * 1000

export interface ChatRequest {
  prompt: string
  system?: string
  effort?: string
  webSearch?: boolean
  imageUrls?: string[]
  maxTokens?: number
}

export interface ChatResult {
  text: string
  creditsConsumed: number | null
  inputTokens: number | null
  outputTokens: number | null
  /** Wall-clock time of the upstream call. */
  costTimeMs: number
}

/* ────────────────────────────────────────────────────────────────────────────
 * Request building
 * ──────────────────────────────────────────────────────────────────────────*/

/** Where the request goes. Only two transports vary the path by model. */
function urlFor(endpoint: ChatEndpoint): string {
  switch (endpoint.transport) {
    case 'openai-responses':
      return `${API_BASE}/codex/v1/responses`
    case 'grok-responses':
      return `${API_BASE}/grok/v1/responses`
    case 'anthropic-messages':
      return `${API_BASE}/claude/v1/messages`
    case 'openai-chat':
      return `${API_BASE}/${endpoint.path ?? endpoint.model}/v1/chat/completions`
  }
}

/**
 * The user turn.
 *
 * Images use the same envelope for every media type on Kie: the `type` stays
 * `image_url` whether the file is a picture, a video, an audio track or a PDF,
 * and only the URL changes. That is their documented convention, not a
 * mistake to normalise away.
 */
function userContent(
  request: ChatRequest,
  endpoint: ChatEndpoint,
): string | Array<Record<string, unknown>> {
  const images = endpoint.vision ? (request.imageUrls ?? []).filter(Boolean) : []
  if (!images.length) return request.prompt

  return [
    { type: 'text', text: request.prompt },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ]
}

function buildBody(endpoint: ChatEndpoint, request: ChatRequest): Record<string, unknown> {
  // Always off. Streaming defaults to true on several of these endpoints, and
  // a job that is written to a database once has nothing to do with a stream.
  //
  // `model` is deliberately absent for openai-chat: there the model is the URL
  // path, and Kie's own examples for those endpoints send no model field. One
  // of their pages even lists a mismatched enum for it, so sending it would be
  // trusting a value their docs get wrong.
  const base: Record<string, unknown> =
    endpoint.transport === 'openai-chat'
      ? { stream: false }
      : { model: endpoint.model, stream: false }

  const effort =
    request.effort && endpoint.effortLevels?.includes(request.effort)
      ? request.effort
      : undefined

  switch (endpoint.transport) {
    case 'anthropic-messages':
      return {
        ...base,
        max_tokens: request.maxTokens ?? endpoint.maxTokens ?? 8192,
        ...(request.system ? { system: request.system } : {}),
        messages: [{ role: 'user', content: userContent(request, endpoint) }],
      }

    case 'openai-responses':
    case 'grok-responses':
      return {
        ...base,
        input: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          { role: 'user', content: request.prompt },
        ],
        ...(effort ? { reasoning: { effort } } : {}),
        // These two take the search tool bare, without an OpenAI function
        // wrapper, and reject a request that carries both kinds at once.
        ...(request.webSearch && endpoint.webSearch ? { tools: [{ type: 'web_search' }] } : {}),
      }

    case 'openai-chat':
      return {
        ...base,
        messages: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          { role: 'user', content: userContent(request, endpoint) },
        ],
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(request.webSearch && endpoint.webSearch && endpoint.webSearch !== 'native'
          ? { tools: [{ type: 'function', function: { name: endpoint.webSearch } }] }
          : {}),
      }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Response reading
 * ──────────────────────────────────────────────────────────────────────────*/

interface ChoiceShape {
  message?: { content?: unknown }
}

interface BlockShape {
  type?: string
  text?: string
  content?: unknown
}

/** Flatten one content value, which may be a string or a list of blocks. */
function readContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''

  return value
    .map((block) => {
      if (typeof block === 'string') return block
      const b = block as BlockShape
      if (typeof b.text === 'string') return b.text
      // Nested content shows up on tool results, which are not the answer but
      // are worth keeping rather than silently dropping.
      if (b.content) return readContent(b.content)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractText(transport: ChatTransport, payload: Record<string, unknown>): string {
  switch (transport) {
    case 'openai-chat': {
      const choices = payload.choices as ChoiceShape[] | undefined
      return readContent(choices?.[0]?.message?.content).trim()
    }

    case 'anthropic-messages':
      return readContent(payload.content).trim()

    case 'openai-responses':
    case 'grok-responses': {
      // The output list interleaves reasoning items with the message; only
      // the message carries the answer.
      const output = payload.output as BlockShape[] | undefined
      const messages = (output ?? []).filter((item) => item.type === 'message')
      const text = messages.map((item) => readContent(item.content)).join('\n').trim()
      // Some builds also mirror the answer here, which is cheaper to read.
      return text || readContent(payload.output_text).trim()
    }
  }
}

interface UsageShape {
  prompt_tokens?: number
  completion_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

function readUsage(payload: Record<string, unknown>): {
  inputTokens: number | null
  outputTokens: number | null
} {
  const usage = (payload.usage ?? {}) as UsageShape
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null,
  }
}

/**
 * The upstream error message, wherever this vendor happens to put it.
 *
 * Four formats means four places an explanation can hide, and "request
 * failed" instead of "your prompt was blocked" is the difference between a
 * fixable problem and a mystery.
 */
function readError(payload: Record<string, unknown>, status: number): string {
  const error = payload.error
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  if (typeof payload.msg === 'string' && payload.msg) return payload.msg
  if (typeof payload.message === 'string' && payload.message) return payload.message
  return `The model returned HTTP ${status}.`
}

/**
 * The failing code in a Kie envelope, or null when the body is a real answer.
 *
 * Only treated as an envelope when `code` is present and not success: a chat
 * completion has no `code` field of its own, so there is nothing to confuse
 * it with.
 */
function envelopeFailure(payload: Record<string, unknown>): number | null {
  const code = payload.code
  if (typeof code !== 'number') return null
  return code === KIE_CODE.SUCCESS ? null : code
}

/** HTTP status to report for an envelope code that arrived as a 200. */
function statusFor(code: number): number {
  switch (code) {
    case KIE_CODE.UNAUTHORIZED:
      return 401
    case KIE_CODE.INSUFFICIENT_CREDITS:
      return 402
    case KIE_CODE.RATE_LIMITED:
      return 429
    case KIE_CODE.VALIDATION_ERROR:
    case KIE_CODE.BAD_REQUEST:
      return 400
    default:
      return 502
  }
}

/** Kie's own envelope codes, so credit and auth failures explain themselves. */
function codeFor(status: number): number {
  switch (status) {
    case 401:
    case 403:
      return KIE_CODE.UNAUTHORIZED
    case 402:
      return KIE_CODE.INSUFFICIENT_CREDITS
    case 429:
      return KIE_CODE.RATE_LIMITED
    case 400:
    case 422:
      return KIE_CODE.VALIDATION_ERROR
    default:
      return KIE_CODE.SERVER_ERROR
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The call
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Run one text generation.
 *
 * The API key comes from the same resolution the rest of the client uses, so
 * this works both inside a request and under `runWithApiKey`.
 */
export async function generateText(
  endpoint: ChatEndpoint,
  request: ChatRequest,
  key: string,
): Promise<ChatResult> {
  const url = urlFor(endpoint)
  const body = buildBody(endpoint, request)
  const startedAt = Date.now()

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // The Anthropic-shaped endpoint documents its own auth headers. Kie
        // accepts the bearer token too, but sending both costs nothing and
        // survives them tightening it to the documented pair.
        ...(endpoint.transport === 'anthropic-messages'
          ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
          : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new KieError(
      timedOut
        ? `The model did not answer within ${TIMEOUT_MS / 60000} minutes.`
        : 'Could not reach the model.',
      KIE_CODE.SERVER_ERROR,
      504,
    )
  }

  const raw = await res.text()
  let payload: Record<string, unknown>

  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    // An HTML error page here is usually a gateway between us and the model.
    throw new KieError(
      `The model returned a non-JSON response (HTTP ${res.status}).`,
      codeFor(res.status),
      res.status,
    )
  }

  // Kie answers HTTP 200 with a failing `code` in the body on every one of
  // these endpoints, so the status alone says nothing. Checked and verified
  // against all four: an expired key comes back as 200 plus code 401, and
  // reading only `res.ok` turned that into "the model returned an empty
  // answer", which sends you looking at your prompt instead of your key.
  const envelope = envelopeFailure(payload)

  if (!res.ok || envelope) {
    const message = readError(payload, res.status)
    const code = envelope ?? codeFor(res.status)

    log.warn('model rejected the request', {
      model: endpoint.model,
      transport: endpoint.transport,
      status: res.status,
      code,
      reason: message,
      ms: since(startedAt),
    })
    throw new KieError(message, code, res.ok ? statusFor(code) : res.status)
  }

  const text = extractText(endpoint.transport, payload)
  const { inputTokens, outputTokens } = readUsage(payload)
  const credits = payload.credits_consumed

  if (!text) {
    // A 200 with nothing in it is almost always a safety stop, and saying so
    // beats showing an empty card.
    throw new KieError(
      'The model returned an empty answer. It may have refused the prompt.',
      KIE_CODE.SERVER_ERROR,
      502,
    )
  }

  const costTimeMs = since(startedAt)

  log.info('answered', {
    model: endpoint.model,
    transport: endpoint.transport,
    chars: text.length,
    inputTokens,
    outputTokens,
    ms: costTimeMs,
  })

  return {
    text,
    creditsConsumed: typeof credits === 'number' ? credits : null,
    inputTokens,
    outputTokens,
    costTimeMs,
  }
}

/**
 * Exported for the tests, which check the four request shapes and the four
 * ways an answer is buried without spending a credit on any of them.
 */
export const __internal = {
  buildBody,
  extractText,
  urlFor,
  readError,
  readUsage,
  envelopeFailure,
}
