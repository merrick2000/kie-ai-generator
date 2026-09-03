/**
 * Request logging for route handlers.
 *
 * Wrapping the handler rather than logging inside each one means every route
 * reports method, path, status and duration in the same shape, and an
 * unhandled throw cannot escape without a line explaining it.
 *
 * A Next middleware would be the obvious place for this, except that it runs
 * before the handler and so never sees the response status, which is the field
 * most worth having.
 */

import 'server-only'

import { createLogger, since } from './logger'

const log = createLogger('http')

/** Requests slower than this are logged as warnings. */
const SLOW_MS = 3_000

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
    const base = { method: req.method, path }

    try {
      const res = await handler(req, ...rest)
      const ms = since(startedAt)
      const context = { ...base, status: res.status, ms }

      if (res.status >= 500) log.error('request failed', context)
      else if (res.status >= 400) log.warn('request rejected', context)
      else if (ms > SLOW_MS) log.warn('slow request', context)
      else log.debug('request', context)

      return res
    } catch (err) {
      // Without this the failure surfaces as an opaque 500 from Next with
      // nothing in the log to explain it.
      log.error('unhandled error in handler', { ...base, ms: since(startedAt), error: err })
      throw err
    }
  }
}
