/**
 * The origin this instance is reachable at.
 *
 * Needed wherever an absolute URL leaves the app: the link handed back to the
 * article publisher, the sitemap, robots.txt, and the callBackUrl given to
 * Kie. A relative path is useless to all of them.
 *
 * `NEXT_PUBLIC_APP_URL` is the canonical answer and should be set. It is the
 * only source that knows the public domain when it differs from the host the
 * container is addressed by, which is normal behind a proxy or a CDN.
 *
 * When it is unset, the origin is reconstructed from the forwarded headers so
 * a misconfigured deployment still returns something usable rather than a
 * bare path. That is a fallback, not a design: those headers are set by
 * whatever sits in front, so they are trusted only for building a display URL,
 * never for a redirect, a link in an email, or anything security-bearing.
 */

const DEV_ORIGIN = 'http://localhost:3400'

/** The configured origin, trailing slash removed, or null. */
export function configuredOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!raw) return null

  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}

/**
 * Origin derived from the request.
 *
 * Reads the headers a reverse proxy sets. `x-forwarded-host` wins over `host`
 * because behind a proxy `host` is the internal service name, which is not
 * reachable from outside.
 */
export function originFromRequest(req: Request): string | null {
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host')?.trim()

  if (!host) return null

  // Default to https: anything public is behind TLS, and getting this wrong
  // on a local address is harmless.
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')

  return `${proto}://${host}`
}

export interface AbsoluteUrlResult {
  url: string
  /** Where the origin came from, so a fallback can be logged once. */
  source: 'configured' | 'request' | 'default'
}

/**
 * Build an absolute URL for a path.
 *
 * Always returns an absolute URL. Callers hand this to other systems, and a
 * relative path there is a bug the receiving side cannot work around.
 */
export function absoluteUrl(path: string, req?: Request): AbsoluteUrlResult {
  const normalised = path.startsWith('/') ? path : `/${path}`

  const configured = configuredOrigin()
  if (configured) return { url: `${configured}${normalised}`, source: 'configured' }

  const derived = req ? originFromRequest(req) : null
  if (derived) return { url: `${derived}${normalised}`, source: 'request' }

  return { url: `${DEV_ORIGIN}${normalised}`, source: 'default' }
}

/** Just the origin, for the sitemap and robots.txt. */
export function publicOrigin(): string {
  return configuredOrigin() ?? DEV_ORIGIN
}
