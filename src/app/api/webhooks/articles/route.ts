import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

import { withLogging } from '@/lib/api-logging'
import { upsertArticle } from '@/lib/blog/store'
import {
  parseArticle,
  verifyWebhook,
  WEBHOOK_HEADERS,
  type WebhookErrorCode,
  type WebhookPayload,
} from '@/lib/blog/webhook'
import { createLogger, since } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('webhook')

/**
 * Every reply carries the same shape, so the sender can branch on `code` and
 * report `deliveryId` when something needs chasing down.
 *
 * `error` stays a plain string because that is what most webhook senders
 * surface in their own UI without any mapping.
 */
interface FailureBody {
  ok: false
  error: string
  code: WebhookErrorCode
  hint: string
  /** True when sending the same request again could succeed. */
  retryable: boolean
  deliveryId: string
}

function fail(
  deliveryId: string,
  status: number,
  body: Omit<FailureBody, 'ok' | 'deliveryId'>,
): NextResponse {
  return NextResponse.json({ ok: false, deliveryId, ...body } satisfies FailureBody, {
    status,
  })
}

/**
 * POST /api/webhooks/articles
 *
 * Receives published articles from the upstream content service.
 *
 * Ordering matters: the signature is checked against the raw body before the
 * JSON is parsed, and the body is sanitised before it is stored. Neither step
 * can be skipped by a later code path.
 *
 * Each delivery gets an id that appears in every log line it produces and in
 * the response, so a report of "article 14 never arrived" can be traced
 * without guessing.
 */
async function handlePOST(req: Request) {
  const startedAt = Date.now()
  const deliveryId = randomBytes(4).toString('hex')

  const event = req.headers.get(WEBHOOK_HEADERS.EVENT) ?? undefined
  const rawBody = await req.text()

  // Carried on every line below, so one delivery can be followed end to end.
  const delivery = log.child({ deliveryId })

  delivery.debug('received', {
    event,
    bytes: rawBody.length,
    hasSignature: Boolean(req.headers.get(WEBHOOK_HEADERS.SIGNATURE)),
  })

  const secret = process.env.ARTICLE_WEBHOOK_SECRET?.trim()

  if (!secret) {
    // Refusing beats accepting unsigned articles: this endpoint writes HTML
    // that is then served to every visitor.
    delivery.error('refused: ARTICLE_WEBHOOK_SECRET is not set on this instance')
    return fail(deliveryId, 503, {
      code: 'webhook_not_configured',
      error: 'This instance has no webhook secret configured.',
      hint: 'Set ARTICLE_WEBHOOK_SECRET on the server, then retry.',
      retryable: true,
    })
  }

  const verification = verifyWebhook(
    rawBody,
    {
      signature: req.headers.get(WEBHOOK_HEADERS.SIGNATURE),
      timestamp: req.headers.get(WEBHOOK_HEADERS.TIMESTAMP),
    },
    secret,
  )

  if (!verification.ok) {
    delivery.warn('rejected', {
      code: verification.code,
      reason: verification.error,
      // The timestamp is the usual culprit and is not sensitive.
      timestamp: req.headers.get(WEBHOOK_HEADERS.TIMESTAMP),
      bytes: rawBody.length,
      ms: since(startedAt),
    })
    return fail(deliveryId, verification.status, {
      code: verification.code,
      error: verification.error,
      hint: verification.hint,
      retryable: verification.retryable,
    })
  }

  // Optional second factor, only enforced when configured.
  const expectedToken = process.env.ARTICLE_WEBHOOK_TOKEN?.trim()
  if (expectedToken) {
    const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (provided !== expectedToken) {
      delivery.warn('rejected: bearer token mismatch', {
        provided: provided ? 'present but wrong' : 'absent',
      })
      return fail(deliveryId, 401, {
        code: 'invalid_token',
        error: 'The bearer token is missing or incorrect.',
        hint: 'This instance also requires `Authorization: Bearer <ARTICLE_WEBHOOK_TOKEN>`.',
        retryable: false,
      })
    }
  }

  let payload: WebhookPayload
  try {
    payload = JSON.parse(rawBody) as WebhookPayload
  } catch (err) {
    delivery.warn('rejected: body is not valid JSON', {
      bytes: rawBody.length,
      // The opening characters usually reveal an HTML error page or a
      // double-encoded string.
      starts: rawBody.slice(0, 60),
    })
    return fail(deliveryId, 400, {
      code: 'invalid_json',
      error: `The body is not valid JSON: ${err instanceof Error ? err.message : 'parse failed'}.`,
      hint: 'Send the JSON object directly, not a string containing JSON, and set Content-Type: application/json.',
      retryable: false,
    })
  }

  const resolvedEvent = payload.event ?? event
  if (resolvedEvent && resolvedEvent !== 'article.published') {
    // Acknowledged rather than refused: an unknown event is not a failure the
    // sender should retry.
    delivery.info('ignored unknown event', { event: resolvedEvent })
    return NextResponse.json({ ok: true, ignored: resolvedEvent, deliveryId })
  }

  const parsed = parseArticle(payload)
  if (!parsed.ok) {
    delivery.warn('rejected: unusable article', {
      code: parsed.code,
      reason: parsed.error,
      articleId: payload.article?.id,
      title: payload.article?.title,
    })
    return fail(deliveryId, 422, {
      code: parsed.code,
      error: parsed.error,
      hint: parsed.hint,
      retryable: false,
    })
  }

  try {
    const { article, created } = await upsertArticle(parsed.article)

    // The blog is statically cached; refresh the two paths this touches.
    revalidatePath('/blog')
    revalidatePath(`/blog/${article.slug}`)

    const url = publicUrl(`/blog/${article.slug}`)

    delivery.info(created ? 'published' : 'updated', {
      articleId: article.id,
      slug: article.slug,
      title: article.title,
      language: article.language,
      readingMinutes: article.readingMinutes,
      project: article.projectName ?? undefined,
      // Worth seeing: a large gap between the two means the sanitiser removed
      // a lot, which is usually a sign the sender shipped markup we strip.
      htmlBytes: article.html.length,
      ms: since(startedAt),
    })

    return NextResponse.json(
      { ok: true, created, slug: article.slug, url, deliveryId },
      { status: created ? 201 : 200 },
    )
  } catch (err) {
    delivery.error('could not store article', {
      error: err,
      articleId: parsed.article.id,
      slug: parsed.article.slug,
      ms: since(startedAt),
    })
    // A 5xx tells the sender to retry, which is right for a transient
    // database problem.
    return fail(deliveryId, 500, {
      code: 'storage_failed',
      error: 'The article could not be stored.',
      hint: 'A problem on our side, not with your payload. Retry with backoff.',
      retryable: true,
    })
  }
}

function publicUrl(path: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  return origin ? `${origin}${path}` : path
}

export const POST = withLogging(handlePOST)
