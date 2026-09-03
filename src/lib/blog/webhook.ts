/**
 * Article webhook verification and parsing.
 *
 * Kept out of the route handler so both can be tested directly, without an
 * HTTP server.
 *
 * Contract, as specified by the publisher:
 *   signature = "sha256=" + HMAC-SHA256(secret, `${timestamp}.${JSON.stringify(body)}`)
 *   headers   = X-Webhook-Signature, X-Webhook-Timestamp, X-Webhook-Event
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  htmlToText,
  readingMinutes,
  sanitizeArticleHtml,
  slugify,
} from './sanitize'
import type { ArticleInput } from './store'

export const WEBHOOK_HEADERS = {
  SIGNATURE: 'x-webhook-signature',
  TIMESTAMP: 'x-webhook-timestamp',
  EVENT: 'x-webhook-event',
} as const

/**
 * How far a timestamp may be from now.
 *
 * Bounds replay of a captured, validly-signed delivery while leaving room for
 * clock skew between the sender and this host.
 */
export const MAX_SKEW_SECONDS = 5 * 60

/**
 * Machine-readable failure codes.
 *
 * The sender should branch on these rather than on the message text, which is
 * written for a human reading a log and may be reworded.
 */
export type WebhookErrorCode =
  | 'webhook_not_configured'
  | 'missing_signature'
  | 'missing_timestamp'
  | 'malformed_timestamp'
  | 'timestamp_out_of_window'
  | 'invalid_signature'
  | 'invalid_token'
  | 'invalid_json'
  | 'missing_article'
  | 'missing_id'
  | 'missing_title'
  | 'missing_body'
  | 'empty_body'
  | 'storage_failed'

export interface WebhookFailure {
  code: WebhookErrorCode
  /** One sentence describing what was wrong. */
  error: string
  /** What the sender should do about it. */
  hint: string
  /** True when sending the same request again could succeed. */
  retryable: boolean
  status: number
}

export type VerifyResult = { ok: true } | ({ ok: false } & WebhookFailure)

/**
 * Verify a delivery.
 *
 * `rawBody` must be the exact bytes received. Re-serialising the parsed object
 * would produce different JSON (key order, whitespace) and the signature would
 * never match.
 */
export function verifyWebhook(
  rawBody: string,
  headers: {
    signature?: string | null
    timestamp?: string | null
  },
  secret: string,
): VerifyResult {
  const { signature, timestamp } = headers

  if (!signature) {
    return {
      ok: false,
      status: 401,
      code: 'missing_signature',
      error: 'The X-Webhook-Signature header is missing.',
      hint: 'Send sha256=<hex> where hex is HMAC-SHA256 of `${timestamp}.${rawBody}`.',
      retryable: false,
    }
  }
  if (!timestamp) {
    return {
      ok: false,
      status: 401,
      code: 'missing_timestamp',
      error: 'The X-Webhook-Timestamp header is missing.',
      hint: 'Send the Unix time in seconds, the same value used to build the signature.',
      retryable: false,
    }
  }

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) {
    return {
      ok: false,
      status: 401,
      code: 'malformed_timestamp',
      error: `X-Webhook-Timestamp is not a number (got "${timestamp.slice(0, 40)}").`,
      hint: 'Send Unix seconds, for example 1788447300, not milliseconds or an ISO date.',
      retryable: false,
    }
  }

  const skew = Math.round(Date.now() / 1000 - sentAt)
  if (Math.abs(skew) > MAX_SKEW_SECONDS) {
    return {
      ok: false,
      status: 401,
      code: 'timestamp_out_of_window',
      // The direction and size of the drift is the whole diagnosis: ahead
      // means a fast sender clock, far behind means a replay or a slow queue.
      error: `Timestamp is ${Math.abs(skew)}s ${skew > 0 ? 'behind' : 'ahead of'} this server, outside the ${MAX_SKEW_SECONDS}s window.`,
      hint:
        skew > MAX_SKEW_SECONDS
          ? 'Sign and send in one step rather than reusing an older timestamp, and check the sender clock.'
          : 'The sender clock is ahead of this server. Check NTP on both.',
      retryable: true,
    }
  }

  const expected =
    'sha256=' +
    createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

  const received = Buffer.from(signature)
  const computed = Buffer.from(expected)

  // timingSafeEqual throws on a length mismatch, so guard before comparing.
  if (received.length !== computed.length || !timingSafeEqual(received, computed)) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_signature',
      error: 'The signature does not match this payload.',
      hint:
        'Sign the exact bytes you send: HMAC-SHA256(secret, `${timestamp}.${rawBody}`), ' +
        'hex encoded, prefixed with "sha256=". Re-serialising the JSON changes the bytes.',
      retryable: false,
    }
  }

  return { ok: true }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Payload
 * ──────────────────────────────────────────────────────────────────────────*/

export interface WebhookPayload {
  event?: string
  article?: {
    id?: string
    title?: string
    content?: string
    htmlContent?: string
    coverImageUrl?: string
    coverImageAlt?: string
    keyword?: string
    language?: string
    seo?: {
      title?: string
      description?: string
      slug?: string
      keywords?: string[]
    }
    metaDescription?: string
  }
  project?: { id?: string; name?: string }
  timestamp?: string | number
}

export type ParseResult =
  | { ok: true; article: ArticleInput }
  | { ok: false; code: WebhookErrorCode; error: string; hint: string }

/** Longest excerpt shown on a card before it is cut at a word boundary. */
const EXCERPT_LENGTH = 200

/**
 * Turn a delivery into a storable article.
 *
 * The body is sanitised here, on the way in, so nothing unsafe is ever
 * persisted and no later rendering path has to remember to filter it.
 */
export function parseArticle(payload: WebhookPayload): ParseResult {
  const incoming = payload.article
  if (!incoming) {
    return {
      ok: false,
      code: 'missing_article',
      error: 'The payload has no "article" object.',
      hint: 'Expected shape: { event, article: { id, title, htmlContent, ... }, project, timestamp }.',
    }
  }

  const id = incoming.id?.trim()
  if (!id) {
    return {
      ok: false,
      code: 'missing_id',
      error: 'The article has no "id".',
      hint: 'Send a stable id per article. Resending the same id updates the article rather than duplicating it.',
    }
  }

  const title = incoming.title?.trim()
  if (!title) {
    return {
      ok: false,
      code: 'missing_title',
      error: 'The article has no "title".',
      hint: 'A title is required: it becomes the page heading and the fallback slug.',
    }
  }

  // Prefer the rich body; fall back to wrapping the plain text so an article
  // that only carries `content` still renders as paragraphs.
  const rawHtml =
    incoming.htmlContent?.trim() ||
    (incoming.content?.trim()
      ? incoming.content
          .trim()
          .split(/\n{2,}/)
          .map((para) => `<p>${escapeHtml(para.trim())}</p>`)
          .join('\n')
      : '')

  if (!rawHtml) {
    return {
      ok: false,
      code: 'missing_body',
      error: 'The article has neither "htmlContent" nor "content".',
      hint: 'Send the rendered article in "htmlContent", or plain text in "content".',
    }
  }

  const html = sanitizeArticleHtml(rawHtml)
  const text = htmlToText(html)

  if (!text) {
    return {
      ok: false,
      code: 'empty_body',
      error: 'The article body is empty once sanitised.',
      // This is the confusing one to debug from the sending side, so it says
      // exactly why a non-empty payload can end up empty here.
      hint:
        'Incoming HTML is filtered to an allowlist before storage. A body made only of ' +
        'scripts, styles, iframes or empty tags leaves nothing to publish. Send real ' +
        'paragraph markup: p, h2, ul, blockquote, img, a.',
    }
  }

  const seo = incoming.seo ?? {}
  const slug = slugify(seo.slug?.trim() || title)

  const excerpt =
    seo.description?.trim() ||
    incoming.metaDescription?.trim() ||
    truncateAtWord(text, EXCERPT_LENGTH)

  // The publisher sends seconds; everything stored here is milliseconds.
  const publishedAt = toMillis(payload.timestamp) ?? Date.now()

  return {
    ok: true,
    article: {
      id,
      slug,
      title,
      html,
      excerpt,
      coverImageUrl: httpUrlOrNull(incoming.coverImageUrl),
      coverImageAlt: incoming.coverImageAlt?.trim() || null,
      keyword: incoming.keyword?.trim() || null,
      language: (incoming.language?.trim() || 'en').slice(0, 12),
      seoTitle: seo.title?.trim() || null,
      seoDescription:
        seo.description?.trim() || incoming.metaDescription?.trim() || null,
      seoKeywords: Array.isArray(seo.keywords)
        ? seo.keywords.filter((k): k is string => typeof k === 'string').slice(0, 25)
        : [],
      projectId: payload.project?.id?.trim() || null,
      projectName: payload.project?.name?.trim() || null,
      readingMinutes: readingMinutes(text),
      publishedAt,
    },
  }
}

/** Reject anything that is not an http(s) URL, so no javascript: reaches src. */
function httpUrlOrNull(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Accepts seconds or milliseconds and normalises to milliseconds. */
function toMillis(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  // Anything below this is far too small to be milliseconds since 1970.
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n)
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
