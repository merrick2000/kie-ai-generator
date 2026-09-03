/**
 * In-memory record of webhook callbacks.
 *
 * This is a single-process cache, deliberately: it only ever accelerates a
 * poll that would have succeeded anyway. Behind multiple instances a callback
 * may land on a node the poller does not hit, and the studio simply falls back
 * to polling Kie directly. Swap for Redis if you need cross-instance delivery.
 */

import type { KieCallbackPayload } from './types'

interface Entry {
  payload: KieCallbackPayload
  receivedAt: number
}

const store = new Map<string, Entry>()

const TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 500

export function recordCallback(taskId: string, payload: KieCallbackPayload): void {
  store.set(taskId, { payload, receivedAt: Date.now() })
  prune()
}

export function readCallback(taskId: string): KieCallbackPayload | undefined {
  const entry = store.get(taskId)
  if (!entry) return undefined
  if (Date.now() - entry.receivedAt > TTL_MS) {
    store.delete(taskId)
    return undefined
  }
  return entry.payload
}

function prune(): void {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now - entry.receivedAt > TTL_MS) store.delete(key)
  }
  // Bound memory even if traffic outpaces the TTL.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}
