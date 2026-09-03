/**
 * Request logging for route handlers.
 *
 * Wrapping the handler rather than logging inside each one means every route
 * reports method, path, status and duration in the same shape, and no failure
 * can escape without a line explaining it.
 *
 * A Next middleware would be the obvious place for this, except that it runs
 * before the handler and so never sees the response status, which is the field
 * most worth having.
 */

import 'server-only'

import { NextResponse } from 'next/server'

import { createLogger, since } from './logger'

const log = createLogger('http')

/** Requests slower than this are logged as warnings. */
const SLOW_MS = 3_000

/**
 * Who sent the request.
 *
 * Behind Dokploy, a reverse proxy or any CDN, the socket address is the proxy,
 * so the forwarded headers are the only way to know where a delivery actually
 * came from. Read in the order proxies set them.
 */
function callerIp(req: Request): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim()
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('cf-connecting-ip') ??
    undefined
  )
}

/**
 * Wrap a route handler.
 *
 * The signature is passed through untouched, so wiring a route is a one-line
 * change and the handler keeps whatever arguments Next gives it.
 */
export function withLogging<T extends unknown[]>(
  handler: (req: Request, ...rest: T) => Promise<Response>,
): (req: Request, ...rest: T) => Promise<Response> {
  return async (req: Request, ...rest: T) => {
    const startedAt = Date.now()
    // Query strings carry task ids, asset URLs and signed download links, so
    // only the path is logged.
    const path = new URL(req.url).pathname

    const base = {
      method: req.method,
      path,
      ip: callerIp(req),
      // Identifies the sender when several services post to the same endpoint.
      agent: req.headers.get('user-agent')?.slice(0, 80) ?? undefined,
    }

    try {
      const res = await handler(req, ...rest)
      const ms = since(startedAt)
      const context = { ...base, status: res.status, ms }

      if (res.status >= 500) log.error('request failed', context)
      else if (res.status >= 400) log.warn('request rejected', context)
      else if (ms > SLOW_MS) log.warn('slow request', context)
      // Deliberately info, not debug. Production runs at info by default, and
      // a request that leaves no trace at all is the one impossible to
      // support: "we sent it and nothing happened" needs an answer.
      else log.info('request', context)

      return res
    } catch (err) {
      log.error('unhandled error in handler', {
        ...base,
        ms: since(startedAt),
        error: err,
      })

      // Answer in JSON rather than rethrowing. Next would return its own HTML
      // error page, which an API client cannot parse and which says nothing
      // about what went wrong.
      return NextResponse.json(
        {
          ok: false,
          error: 'The server hit an unexpected error handling this request.',
          code: 'internal_error',
          hint: 'This is a fault on our side. Retry with backoff; if it persists, quote the time of this request.',
          retryable: true,
        },
        { status: 500 },
      )
    }
  }
}
