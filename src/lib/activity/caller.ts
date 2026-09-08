/**
 * Where a request came from, for the activity trail.
 *
 * Behind a proxy the socket address is the proxy, so the forwarded headers are
 * the only useful answer. Same order `api-logging` reads them in, kept here
 * separately because that module wraps handlers and this one is called from
 * inside auth, where there is no handler to wrap.
 */

import 'server-only'

import { headers } from 'next/headers'

export async function callerIp(): Promise<string | null> {
  try {
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')
    if (forwarded) return forwarded.split(',')[0]?.trim() || null
    return h.get('x-real-ip') ?? h.get('cf-connecting-ip') ?? null
  } catch {
    // `headers()` throws outside a request, which is where the reconciler
    // lives. An event with no address is still worth keeping.
    return null
  }
}
