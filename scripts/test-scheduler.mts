/**
 * Rate limiter and poll scheduler.
 *
 * These are the pieces that decide whether many concurrent generations stay
 * inside Kie's 20-per-10s limit or collapse into 429s, so the budget is
 * measured rather than assumed.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-scheduler.mts
 */

import assert from 'node:assert/strict'

import { KIE_ACCOUNT_LIMIT, KIE_POLL_BUDGET, TokenBucket } from '../src/lib/rate-limiter'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('token bucket')

await check('starts full and empties at capacity', () => {
  const b = new TokenBucket({ capacity: 5, windowMs: 1000 })
  for (let i = 0; i < 5; i++) assert.equal(b.tryTake(), true, `take ${i + 1}`)
  assert.equal(b.tryTake(), false, 'sixth take must be refused')
})

await check('refills continuously, not in steps', async () => {
  const b = new TokenBucket({ capacity: 10, windowMs: 1000 })
  for (let i = 0; i < 10; i++) b.tryTake()
  assert.equal(b.tryTake(), false)

  // A tenth of the window should return about one token, not zero and not all.
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(b.tryTake(), true, 'one token should be back')
  assert.equal(b.tryTake(), false, 'but not the whole allowance')
})

await check('reports how long to wait', () => {
  const b = new TokenBucket({ capacity: 10, windowMs: 1000 })
  for (let i = 0; i < 10; i++) b.tryTake()
  const wait = b.waitTime()
  assert.ok(wait > 0 && wait <= 120, `expected a short wait, got ${wait}ms`)
})

await check('take() resolves once a token frees up', async () => {
  const b = new TokenBucket({ capacity: 2, windowMs: 300 })
  b.tryTake()
  b.tryTake()
  const startedAt = Date.now()
  await b.take()
  assert.ok(Date.now() - startedAt >= 100, 'must have actually waited')
})

console.log('\nbudget under load')

await check('holds ten concurrent pollers inside the Kie limit', async () => {
  const bucket = new TokenBucket(KIE_POLL_BUDGET)
  const issuedAt: number[] = []

  // Ten jobs all wanting to poll, sampled often enough that the limiter, not
  // the loop, is what paces them.
  const start = Date.now()
  while (Date.now() - start < 3000) {
    for (let job = 0; job < 10; job++) {
      if (bucket.tryTake()) issuedAt.push(Date.now())
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  // The real invariant is a sliding window, not an average: extrapolating a
  // short sample counts the initial burst as if it were the steady rate.
  let worst = 0
  for (const t of issuedAt) {
    const inWindow = issuedAt.filter((o) => o >= t && o < t + KIE_POLL_BUDGET.windowMs).length
    worst = Math.max(worst, inWindow)
  }

  assert.ok(
    worst <= KIE_ACCOUNT_LIMIT.capacity,
    `worst 10s window issued ${worst}, must stay at or under ${KIE_ACCOUNT_LIMIT.capacity}`,
  )
  assert.ok(issuedAt.length > 0, 'and must not stall completely')
  console.log(`      ${issuedAt.length} polls in 3s, worst 10s window ${worst}/${KIE_ACCOUNT_LIMIT.capacity}`)
})

await check('worst case stays under the limit even from a full bucket', () => {
  // Burst of `capacity` plus a full window of refill is the theoretical peak.
  const peak = KIE_POLL_BUDGET.capacity * 2
  assert.ok(
    peak <= KIE_ACCOUNT_LIMIT.capacity,
    `peak of ${peak} would breach the ${KIE_ACCOUNT_LIMIT.capacity} limit`,
  )
})

await check('still polls a lone job promptly', () => {
  // One job at a 1.5s interval is 0.67 req/s; the sustained budget must cover it.
  const sustainedPerSecond = KIE_POLL_BUDGET.capacity / (KIE_POLL_BUDGET.windowMs / 1000)
  assert.ok(sustainedPerSecond >= 1 / 1.5, `sustained ${sustainedPerSecond}/s is too slow for one job`)
})

await check('budget leaves headroom for submissions', () => {
  // The poll budget is deliberately below the account limit so a new
  // generation or an upload can still get through while polls run.
  assert.ok(KIE_POLL_BUDGET.capacity < 20, 'poll budget must sit under the account limit')
})

console.log(`\n${passed} passed`)
