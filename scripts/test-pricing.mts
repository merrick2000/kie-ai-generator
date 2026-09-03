/**
 * Credit and cost formatting.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-pricing.mts
 */

import assert from 'node:assert/strict'

import {
  estimateFromReference,
  hasPublishedPrice,
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

console.log('\npublished prices')

check('prices Kling by the second and by resolution', () => {
  // Verified against Kie's table: 18 cr/s at 720P, 22.5 cr/s at 1080P.
  const short = estimateFromReference('kling/v3-turbo-text-to-video', {
    duration: 5,
    resolution: '720p',
  })
  const long = estimateFromReference('kling/v3-turbo-text-to-video', {
    duration: 15,
    resolution: '1080p',
  })
  assert.equal(short!.credits, 90)
  assert.equal(long!.credits, 337.5)
  // A flat per-model figure would have quoted the same for both.
  assert.ok(long!.credits > short!.credits * 3)
})

check('prices Nano Banana 2 by resolution', () => {
  assert.equal(estimateFromReference('nano-banana-2', { resolution: '1K' })!.credits, 8)
  assert.equal(estimateFromReference('nano-banana-2', { resolution: '2K' })!.credits, 12)
  assert.equal(estimateFromReference('nano-banana-2', { resolution: '4K' })!.credits, 18)
})

check('prices Seedream by its quality switch', () => {
  // "basic" is 1K at 7 cr, "high" is 2K at 14 cr.
  assert.equal(
    estimateFromReference('seedream/5-pro-text-to-image', { quality: 'basic' })!.credits,
    7,
  )
  assert.equal(
    estimateFromReference('seedream/5-pro-text-to-image', { quality: 'high' })!.credits,
    14,
  )
})

check('prices Veo by tier and resolution together', () => {
  const fast = estimateFromReference('veo3', { model: 'veo3_fast', resolution: '720p' })
  const quality = estimateFromReference('veo3', { model: 'veo3', resolution: '4k' })
  assert.equal(fast!.credits, 60)
  assert.equal(quality!.credits, 380)
})

check('multiplies image count', () => {
  const four = estimateFromReference('flux-2/pro-text-to-image', {
    resolution: '1K',
    num_images: '4',
  })
  assert.equal(four!.credits, 20)
})

check('prices speech by characters', () => {
  const est = estimateFromReference('elevenlabs/text-to-speech-multilingual-v2', {
    text: 'x'.repeat(2000),
  })
  assert.equal(est!.credits, 24)
})

check('returns nothing rather than guessing', () => {
  // No verified pairing for this model.
  assert.equal(estimateFromReference('recraft/remove-background', {}), null)
  // Priced per second, but no duration chosen yet.
  assert.equal(estimateFromReference('kling/v3-turbo-text-to-video', { resolution: '720P' }), null)
  // Priced per 1K characters, but nothing typed.
  assert.equal(estimateFromReference('elevenlabs/text-to-speech-turbo-2-5', { text: '' }), null)
})

check('prices Seedance by resolution and reference video', () => {
  // Kie charges less when a reference video is supplied: 41 vs 25 cr/s at 720p.
  const plain = estimateFromReference('bytedance/seedance-2', {
    resolution: '720p',
    duration: 5,
  })
  const withRef = estimateFromReference('bytedance/seedance-2', {
    resolution: '720p',
    duration: 5,
    reference_video_urls: ['https://x.test/a.mp4'],
  })
  assert.equal(plain!.credits, 205)
  assert.equal(withRef!.credits, 125)

  // 4K is an order of magnitude dearer than 480p.
  const uhd = estimateFromReference('bytedance/seedance-2', { resolution: '4k', duration: 5 })
  assert.equal(uhd!.credits, 1040)
})

check('prices Ideogram by rendering speed', () => {
  const turbo = estimateFromReference('ideogram/v3-text-to-image', { rendering_speed: 'TURBO' })
  const quality = estimateFromReference('ideogram/v3-text-to-image', { rendering_speed: 'QUALITY' })
  assert.equal(turbo!.credits, 3.5)
  assert.equal(quality!.credits, 10)
  // Character costs several times more than plain generation.
  assert.equal(estimateFromReference('ideogram/character', { rendering_speed: 'QUALITY' })!.credits, 24)
})

check('prices Hailuo by duration and resolution together', () => {
  assert.equal(
    estimateFromReference('hailuo/2-3-image-to-video-pro', { duration: '6', resolution: '768P' })!.credits,
    45,
  )
  assert.equal(
    estimateFromReference('hailuo/2-3-image-to-video-pro', { duration: '6', resolution: '1080P' })!.credits,
    80,
  )
  // 10s at 1080p is not offered, so no price is invented for it.
  assert.equal(
    estimateFromReference('hailuo/2-3-image-to-video-pro', { duration: '10', resolution: '1080P' }),
    null,
  )
})

check('quotes no total when the duration is not a form field', () => {
  // Motion control and lip sync take their length from the uploaded video or
  // audio, so nothing in the form says how long the output will be.
  assert.equal(estimateFromReference('kling-3.0/motion-control', { mode: 'std' }), null)
  assert.equal(estimateFromReference('omnihuman-1-5', {}), null)

  // The per-second rate is still known, which is what the price table shows.
  assert.ok(hasPublishedPrice('kling-3.0/motion-control'))
  assert.ok(hasPublishedPrice('omnihuman-1-5'))
})

check('prices Wan and MiniMax per second by resolution', () => {
  assert.equal(
    estimateFromReference('wan/2-7-text-to-video', { resolution: '720p', duration: 5 })!.credits,
    80,
  )
  assert.equal(
    estimateFromReference('wan/2-7-text-to-video', { resolution: '1080p', duration: 5 })!.credits,
    120,
  )
  assert.equal(
    estimateFromReference('minimax-h3/text-to-video', { resolution: '2K', duration: 6 })!.credits,
    78,
  )
})

check('leaves models with no matchable row unpriced', () => {
  // Documented as absent in pricing.ts, each for a stated reason.
  for (const id of [
    'seedream/5-lite-text-to-image',
    'bytedance/seedream-v4-text-to-image',
    'gpt-image/1-5-text-to-image',
    'grok-imagine/text-to-video',
    'kling/ai-avatar-pro',
    'kling/v3-omni-text-to-video',
    'infinitalk/from-audio',
    'elevenlabs/audio-isolation',
    'recraft/remove-background',
    'bytedance/v1-pro-image-to-video',
  ]) {
    assert.equal(hasPublishedPrice(id), false, `${id} must stay unpriced`)
  }
})

check('only claims models with a verified pairing', () => {
  assert.ok(hasPublishedPrice('veo3'))
  assert.ok(hasPublishedPrice('nano-banana-2'))
  // Fuzzy matching wrongly paired these two, so neither is listed.
  assert.equal(hasPublishedPrice('seedream/5-lite-text-to-image'), false)
  assert.equal(hasPublishedPrice('made-up/model'), false)
})

console.log(`\n${passed} passed`)
