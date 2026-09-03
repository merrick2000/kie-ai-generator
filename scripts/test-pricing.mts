/**
 * Credit and cost formatting.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-pricing.mts
 */

import assert from 'node:assert/strict'

import {
  estimateFromReference,
  referencePrice,
  CREDIT_USD_RATE,
  creditsToUsd,
  describeEstimate,
  formatCost,
  formatUsd,
  recordCost,
} from '../src/lib/kie/pricing'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('conversion')

check('matches the two prices Kie publishes', () => {
  // Veo 3 Fast: 80 credits for $0.40. Veo 3 Quality: 400 for $2.00.
  assert.equal(creditsToUsd(80).toFixed(2), '0.40')
  assert.equal(creditsToUsd(400).toFixed(2), '2.00')
  assert.equal(CREDIT_USD_RATE, 0.005)
})

check('keeps sub-cent amounts legible', () => {
  // Rounding to two places would render a real charge as "$0.00".
  assert.equal(formatUsd(0.004), '$0.0040')
  assert.equal(formatUsd(0.35), '$0.350')
  assert.equal(formatUsd(2), '$2.00')
  assert.equal(formatUsd(0), '$0')
})

check('formats a full cost line', () => {
  assert.equal(formatCost(80), '80 credits ($0.400)')
})

console.log('\nobserved costs')

check('first observation becomes the baseline', () => {
  const c = recordCost(undefined, 80)
  assert.equal(c.averageCredits, 80)
  assert.equal(c.minCredits, 80)
  assert.equal(c.maxCredits, 80)
  assert.equal(c.samples, 1)
})

check('averages without keeping history', () => {
  let c = recordCost(undefined, 100)
  c = recordCost(c, 200)
  assert.equal(c.averageCredits, 150)
  assert.equal(c.samples, 2)
  c = recordCost(c, 300)
  assert.equal(c.averageCredits, 200)
})

check('tracks the spread, since options change the price', () => {
  let c = recordCost(undefined, 80)
  c = recordCost(c, 400)
  assert.equal(c.minCredits, 80)
  assert.equal(c.maxCredits, 400)
})

check('words a single run as a fact, not an average', () => {
  assert.match(describeEstimate(recordCost(undefined, 80)), /^Last run cost/)
})

check('quotes a range when the cost varies', () => {
  let c = recordCost(undefined, 80)
  c = recordCost(c, 400)
  assert.match(describeEstimate(c), /80 to 400 credits/)
})

check('quotes a single figure when it is stable', () => {
  let c = recordCost(undefined, 80)
  c = recordCost(c, 80)
  assert.match(describeEstimate(c), /^About 80 credits/)
})

console.log('\nreference prices')

check('prices video by the second, so duration changes the cost', () => {
  const short = estimateFromReference('kling/v3-turbo-text-to-video', { duration: 5 })
  const long = estimateFromReference('kling/v3-turbo-text-to-video', { duration: 15 })
  assert.ok(short && long)
  assert.equal(short!.usd.toFixed(2), '0.35')
  assert.equal(long!.usd.toFixed(2), '1.05')
  // A flat per-model figure would have quoted the same number for both.
  assert.ok(long!.usd > short!.usd * 2)
})

check('prices images per image and multiplies by the variant count', () => {
  const one = estimateFromReference('nano-banana-2', {})
  const four = estimateFromReference('gpt-image-2-text-to-image', { num_images: '4' })
  assert.equal(one!.usd.toFixed(2), '0.04')
  assert.equal(four!.usd.toFixed(2), '0.12')
})

check('prices speech by characters', () => {
  const est = estimateFromReference('elevenlabs/text-to-speech-multilingual-v2', {
    text: 'x'.repeat(2000),
  })
  assert.equal(est!.usd.toFixed(3), '0.140')
})

check('returns nothing rather than guessing', () => {
  // No published price for this model.
  assert.equal(estimateFromReference('z-image', {}), null)
  // Priced per second, but no duration chosen yet.
  assert.equal(estimateFromReference('bytedance/seedance-2', {}), null)
  // Priced per 1K characters, but nothing typed.
  assert.equal(estimateFromReference('elevenlabs/text-to-speech-turbo-2-5', { text: '' }), null)
})

check('only lists models Kie actually publishes', () => {
  assert.ok(referencePrice('veo3'))
  assert.equal(referencePrice('made-up/model'), undefined)
})

console.log(`\n${passed} passed`)
