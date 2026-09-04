/**
 * Reconciler pacing and submission shaping.
 *
 * The loop itself needs a database and an upstream; these are the decisions
 * it makes on its own, which are the ones worth pinning down: how often to
 * ask, how long to back off, and what a submission looks like by the time it
 * leaves.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-reconciler.mts
 */

import assert from 'node:assert/strict'

import { errorBackoff, nextPollDelay } from '../src/lib/kie/reconciler'
import { applyProjectPrompt, resolveRoute } from '../src/lib/jobs/runner'
import { getModel } from '../src/lib/kie/catalog'
import { KIE_POLL_BUDGET } from '../src/lib/rate-limiter'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('\npolling cadence')

check('a young job is polled tightly', () => {
  // A small image is often done in three seconds; anything slower than this
  // feels like the app has not noticed.
  assert.equal(nextPollDelay(0), 2_000)
  assert.equal(nextPollDelay(14_000), 2_000)
})

check('the interval loosens as the job ages', () => {
  const points = [0, 30_000, 120_000, 600_000].map(nextPollDelay)

  for (let i = 1; i < points.length; i++) {
    assert.ok(
      points[i] >= points[i - 1],
      `the interval got shorter with age: ${points.join(', ')}`,
    )
  }
  // A ten-minute video should not still be asked every two seconds.
  assert.ok(nextPollDelay(600_000) >= 4 * nextPollDelay(0))
})

check('the interval is bounded', () => {
  // However long a render takes, a finished result should not sit unnoticed
  // for minutes.
  assert.ok(nextPollDelay(60 * 60_000) <= 30_000)
})

check('the slowest cadence still fits the account budget', () => {
  // Sustained throughput of the bucket, in requests per second.
  const perSecond = KIE_POLL_BUDGET.capacity / (KIE_POLL_BUDGET.windowMs / 1000)
  // One job at its tightest interval must not need more than the whole
  // budget on its own.
  assert.ok(1000 / nextPollDelay(0) <= perSecond)
})

console.log('\nbackoff')

check('backoff grows with consecutive failures', () => {
  const first = errorBackoff(1)
  const third = errorBackoff(3)

  assert.ok(third > first, 'a flapping upstream is being hammered at a fixed rate')
  assert.ok(first >= 1_000, 'the first retry is too eager')
})

check('backoff is capped', () => {
  // Otherwise a long outage pushes the next attempt past the job's deadline,
  // and it fails without ever being asked about again.
  assert.ok(errorBackoff(20) <= 60_000)
})

console.log('\nproject defaults')

check('a prefix and suffix wrap the prompt as paragraphs', () => {
  const out = applyProjectPrompt('a lighthouse', {
    promptPrefix: 'Shot on 35mm film.',
    promptSuffix: 'No text.',
  })
  // Blank lines, because models read these as separate pieces of direction
  // rather than one run-on sentence.
  assert.equal(out, 'Shot on 35mm film.\n\na lighthouse\n\nNo text.')
})

check('an absent default leaves the prompt untouched', () => {
  assert.equal(applyProjectPrompt('a lighthouse', undefined), 'a lighthouse')
  assert.equal(applyProjectPrompt('a lighthouse', {}), 'a lighthouse')
})

check('blank defaults do not add empty paragraphs', () => {
  const out = applyProjectPrompt('a lighthouse', { promptPrefix: '   ', promptSuffix: '' })
  assert.equal(out, 'a lighthouse')
})

console.log('\nreference routing')

check('an empty reference keeps the text-only model', () => {
  const model = getModel('gpt-image-2-text-to-image')!
  const routed = resolveRoute(model, { prompt: 'a cat', reference_images: [] })

  assert.equal(routed.model.id, model.id)
  assert.equal(routed.referenceCount, 0)
})

check('a filled reference switches to the sibling slug', () => {
  const model = getModel('gpt-image-2-text-to-image')!
  const routed = resolveRoute(model, {
    prompt: 'a cat',
    reference_images: ['https://example.com/a.png'],
  })

  assert.equal(routed.model.id, 'gpt-image-2-image-to-image')
  assert.equal(routed.referenceCount, 1)
  // The source field must not travel with it: the target does not know it.
  assert.equal('reference_images' in routed.values, false)
})

check('a single-valued target gets one URL, not a list', () => {
  const model = getModel('wan/2-7-text-to-video')!
  const route = model.routeWithAssets!
  const routed = resolveRoute(model, {
    prompt: 'a cat',
    [route.from]: ['https://example.com/a.png'],
  })

  const target = getModel(route.modelId)!.fields.find((f) => f.name === route.to)!
  if (target.kind === 'image' || target.kind === 'video' || target.kind === 'audio') {
    assert.equal(typeof routed.values[route.to], 'string')
  } else {
    assert.ok(Array.isArray(routed.values[route.to]))
  }
})

check('a chat model is never routed', () => {
  const model = getModel('chat/claude-opus-5')!
  assert.equal(model.routeWithAssets, undefined)

  const routed = resolveRoute(model, { prompt: 'hello' })
  assert.equal(routed.model.id, model.id)
})

console.log(`\n${passed} checks passed`)
