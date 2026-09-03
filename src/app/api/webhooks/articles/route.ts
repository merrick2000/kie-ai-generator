import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

import { parseArticle, verifyWebhook, WEBHOOK_HEADERS, type WebhookPayload } from '@/lib/blog/webhook'
import { upsertArticle } from '@/lib/blog/store'
import { createLogger, since } from '@/lib/logger'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('webhook')

/**
 * POST /api/webhooks/articles
 *
 * Receives published articles from the upstream content service and stores
 * them for the public blog.
 *
 * Ordering matters here: the signature is checked against the raw body before
 * the JSON is parsed, and the body is sanitised before it is stored. Neither
 * step can be skipped by a later code path.
 */
async function handlePOST(req: Request) {
  const startedAt = Date.now()
  const secret = process.env.ARTICLE_WEBHOOK_SECRET?.trim()

  if (!secret) {
    // Refusing is safer than accepting unsigned articles: this endpoint writes
    // HTML that is served to every visitor.
    log.error('rejected: ARTICLE_WEBHOOK_SECRET is not configured')
    return NextResponse.json(
      { error: 'Webhook is not configured on this instance.' },
      { status: 503 },
    )
  }

  // The exact bytes as received. Re-serialising the parsed object would change
  // the JSON and the signature would never match.
  const rawBody = await req.text()

  const verification = verifyWebhook(
    rawBody,
    {
      signature: req.headers.get(WEBHOOK_HEADERS.SIGNATURE),
      timestamp: req.headers.get(WEBHOOK_HEADERS.TIMESTAMP),
    },
    secret,
  )

  if (!verification.ok) {
    log.warn('rejected delivery', {
      reason: verification.error,
      // Useful for spotting a clock drift or a stale secret on the sender.
      timestamp: req.headers.get(WEBHOOK_HEADERS.TIMESTAMP),
      bytes: rawBody.length,
    })
    return NextResponse.json({ error: verification.error }, { status: verification.status })
  }

  // Optional second factor. Only enforced when configured, so the endpoint
  // works with senders that do not set it.
  const expectedToken = process.env.ARTICLE_WEBHOOK_TOKEN?.trim()
  if (expectedToken) {
    const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (provided !== expectedToken) {
      return NextResponse.json({ error: 'Invalid bearer token.' }, { status: 401 })
    }
  }

  let payload: WebhookPayload
  try {
    payload = JSON.parse(rawBody) as WebhookPayload
  } catch {
    return NextResponse.json({ error: 'Body is not valid JSON.' }, { status: 400 })
  }

  const event = payload.event ?? req.headers.get(WEBHOOK_HEADERS.EVENT)
  if (event && event !== 'article.published') {
    // Acknowledged rather than refused: an unknown event is not a failure the
    // sender should retry.
    log.info('ignored unknown event', { event })
    return NextResponse.json({ ok: true, ignored: event })
  }

  const parsed = parseArticle(payload)
  if (!parsed.ok) {
    log.warn('unusable payload', { reason: parsed.error, articleId: payload.article?.id })
    return NextResponse.json({ error: parsed.error }, { status: 422 })
  }

  try {
    const { article, created } = await upsertArticle(parsed.article)

    // The blog is statically cached; refresh the two paths this touches.
    revalidatePath('/blog')
    revalidatePath(`/blog/${article.slug}`)

    const url = publicUrl(`/blog/${article.slug}`)

    log.info(created ? 'article published' : 'article updated', {
      slug: article.slug,
      title: article.title,
      project: article.projectName,
      ms: since(startedAt),
    })

    // The publisher stores this to link back to the live article.
    return NextResponse.json(
      { ok: true, created, slug: article.slug, url },
      { status: created ? 201 : 200 },
    )
  } catch (err) {
    log.error('could not store article', { error: err, ms: since(startedAt) })
    // A 5xx tells the sender to retry, which is correct for a transient
    // database problem.
    return NextResponse.json({ error: 'Could not store the article.' }, { status: 500 })
  }
}

function publicUrl(path: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  return origin ? `${origin}${path}` : path
}

export const POST = withLogging(handlePOST)
