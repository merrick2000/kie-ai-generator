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

export type VerifyResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

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
    return { ok: false, status: 401, error: 'Missing X-Webhook-Signature.' }
  }
  if (!timestamp) {
    return { ok: false, status: 401, error: 'Missing X-Webhook-Timestamp.' }
  }

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) {
    return { ok: false, status: 401, error: 'Malformed X-Webhook-Timestamp.' }
  }

  const skew = Math.abs(Date.now() / 1000 - sentAt)
  if (skew > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, error: 'Timestamp outside the accepted window.' }
  }

  const expected =
    'sha256=' +
    createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

  const received = Buffer.from(signature)
  const computed = Buffer.from(expected)

  // timingSafeEqual throws on a length mismatch, so guard before comparing.
  if (received.length !== computed.length || !timingSafeEqual(received, computed)) {
    return { ok: false, status: 401, error: 'Invalid signature.' }
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
  | { ok: false; error: string }

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
  if (!incoming) return { ok: false, error: 'Missing "article" in payload.' }

  const id = incoming.id?.trim()
  if (!id) return { ok: false, error: 'Article is missing "id".' }

  const title = incoming.title?.trim()
  if (!title) return { ok: false, error: 'Article is missing "title".' }

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
    return { ok: false, error: 'Article has neither "htmlContent" nor "content".' }
  }

  const html = sanitizeArticleHtml(rawHtml)
  const text = htmlToText(html)

  if (!text) {
    return { ok: false, error: 'Article body is empty once sanitised.' }
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
