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
import { applyProjectPrompt, resolveRoute, valuesForRun } from '../src/lib/jobs/runner'
import { MODELS, getModel } from '../src/lib/kie/catalog'
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

console.log('\nvariations')

check('the first run is left exactly as submitted', () => {
  const model = getModel('google/nano-banana-edit')!
  const values = { prompt: 'a fox', seed: 42 }
  // Same object, so nothing about a single run changes behaviour.
  assert.equal(valuesForRun(model, values, 0), values)
})

check('an explicit seed is walked forward, not thrown away', () => {
  const model = getModel('bytedance/seedream-v4-text-to-image')!
  assert.ok(model.fields.some((f) => f.name === 'seed'))

  // A batch started from a result you liked stays anchored to it.
  assert.equal(valuesForRun(model, { seed: 1000 }, 1).seed, 1001)
  assert.equal(valuesForRun(model, { seed: 1000 }, 3).seed, 1003)
})

check('a seed near the ceiling wraps rather than overflowing', () => {
  const model = getModel('bytedance/seedream-v4-text-to-image')!
  const seed = valuesForRun(model, { seed: 2_147_483_646 }, 4).seed as number

  assert.ok(seed >= 0 && seed < 2_147_483_647, `seed out of range: ${seed}`)
})

check('a blank seed is filled in, differently each run', () => {
  const model = getModel('bytedance/seedream-v4-text-to-image')!

  const seeds = new Set(
    Array.from({ length: 6 }, (_, i) => valuesForRun(model, { seed: '' }, i + 1).seed),
  )
  // Four runs of one prompt with one seed would be four copies of the same
  // picture, which is not what anyone means by a variation.
  assert.ok(seeds.size > 1, 'every run got the same seed')

  for (const seed of seeds) {
    assert.equal(typeof seed, 'number')
    assert.ok((seed as number) >= 0 && (seed as number) < 2_147_483_647)
  }
})

check('a model with no seed field is left alone', () => {
  const model = getModel('google/nano-banana')!
  assert.equal(model.fields.some((f) => f.name === 'seed'), false)

  const values = { prompt: 'a fox' }
  // Inventing a field the model does not accept would fail the request.
  assert.deepEqual(valuesForRun(model, values, 2), values)
})

check('the other values are carried through untouched', () => {
  const model = getModel('bytedance/seedream-v4-text-to-image')!
  const out = valuesForRun(model, { prompt: 'a fox', image_size: 'square_hd' }, 1)

  assert.equal(out.prompt, 'a fox')
  assert.equal(out.image_size, 'square_hd')
})

console.log('\nnative variant counts')

check('only models whose schema documents one declare it', () => {
  // Checked against all 177 market model pages: seven take a count, and
  // ideogram/v3-text-to-image is not one of them, whatever its siblings do.
  const withCount = MODELS.filter((m) =>
    m.fields.some((f) => f.name === 'num_images' || f.name === 'max_images'),
  ).map((m) => m.id)

  assert.deepEqual(withCount.sort(), [
    'bytedance/seedream-v4-edit',
    'bytedance/seedream-v4-text-to-image',
    'ideogram/character',
  ])
})

console.log(`\n${passed} checks passed`)
