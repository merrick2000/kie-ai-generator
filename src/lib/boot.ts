/**
 * What has to be true before this process is useful.
 *
 * Chiefly: the reconciler is running. Without it a generation is only carried
 * forward while somebody has the tab open, which is the failure this whole
 * layer exists to remove.
 *
 * Next's `instrumentation.ts` looks like the right hook and is not: it is
 * compiled for the Edge runtime as well as Node, and webpack traces its
 * imports for both even behind a `NEXT_RUNTIME` guard, so the Postgres driver
 * and `node:crypto` end up in a build that cannot have them. In development
 * that failed compile takes down every page.
 *
 * So it is started from the Node-only graph instead, on the first request
 * that arrives. In practice that is immediate: the container's health check
 * alone is enough, and any page load does it too.
 */

import 'server-only'

import { getDb, isConfigured } from '@/lib/db'
import { startReconciler } from '@/lib/kie/reconciler'
import { createLogger } from '@/lib/logger'

const log = createLogger('boot')

/** Held so concurrent first requests do not each start their own loop. */
let booting: Promise<void> | null = null

async function start(): Promise<void> {
  // `next build` renders pages in a process that then exits. Opening a pool
  // and starting a poll loop there would be pointless at best, and at worst
  // would have a build machine claiming and polling a live user's jobs.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  if (!isConfigured()) {
    log.warn('DATABASE_URL is not set, so generations cannot be tracked')
    return
  }

  try {
    // Opening the pool also applies the migrations and verifies the schema,
    // which is worth doing before a request depends on it.
    await getDb()
  } catch (err) {
    log.error('could not reach the database at startup', { error: err })
    // Cleared so the next request retries rather than being stuck with a
    // process that gave up on a database that was briefly unreachable.
    booting = null
    return
  }

  startReconciler()
}

/**
 * Idempotent. Safe to call on every request, and cheap after the first.
 */
export function ensureBooted(): Promise<void> {
  if (!booting) booting = start()
  return booting
}
