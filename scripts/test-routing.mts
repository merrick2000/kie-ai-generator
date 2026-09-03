/**
 * Reference routing.
 *
 * Kie splits several models into a text-only slug and one that takes a
 * reference. The studio offers one entry and picks the slug, so this checks
 * the mapping is right for every pair rather than only the one that was
 * tested by hand.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-routing.mts
 */

import assert from 'node:assert/strict'

import { MODELS, getModel } from '../src/lib/kie/catalog'
import { buildInput, validate } from '../src/lib/kie/fields'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

const routed = MODELS.filter((m) => m.routeWithAssets)

console.log('routing')

check('every route points at a model that exists', () => {
  for (const model of routed) {
    const target = getModel(model.routeWithAssets!.modelId)
    assert.ok(target, `${model.id} routes to a missing model`)
  }
})

check('every source carries the field it routes from', () => {
  for (const model of routed) {
    const field = model.fields.find((f) => f.name === model.routeWithAssets!.from)
    assert.ok(field, `${model.id} has no ${model.routeWithAssets!.from} field`)
    // It has to be optional, or the text-only path stops working.
    assert.notEqual(field!.required, true, `${model.id}'s reference must be optional`)
  }
})

check('every target carries the field it routes to', () => {
  for (const model of routed) {
    const route = model.routeWithAssets!
    const target = getModel(route.modelId)!
    const field = target.fields.find((f) => f.name === route.to)
    assert.ok(field, `${target.id} has no ${route.to} field`)
  }
})

check('reference limits match what the target accepts', () => {
  for (const model of routed) {
    const route = model.routeWithAssets!
    const source = model.fields.find((f) => f.name === route.from)!
    const target = getModel(route.modelId)!.fields.find((f) => f.name === route.to)!

    const sourceMax = 'maxItems' in source ? (source.maxItems ?? 1) : 1
    const targetMax = 'maxItems' in target ? (target.maxItems ?? 1) : 1

    // Offering more slots than the model accepts would fail at submission.
    assert.ok(
      sourceMax <= targetMax,
      `${model.id} offers ${sourceMax} references but ${route.modelId} takes ${targetMax}`,
    )
  }
})

check('every routed target is hidden from the picker', () => {
  for (const model of routed) {
    const target = getModel(model.routeWithAssets!.modelId)!
    assert.equal(target.hidden, true, `${target.id} would appear twice in the list`)
  }
})

check('no hidden model is left unreachable', () => {
  const reachable = new Set(routed.map((m) => m.routeWithAssets!.modelId))
  for (const model of MODELS.filter((m) => m.hidden)) {
    assert.ok(reachable.has(model.id), `${model.id} is hidden but nothing routes to it`)
  }
})

console.log('\ninput mapping')

check('text-only submissions stay on the text model', () => {
  const model = getModel('gpt-image-2-text-to-image')!
  const values = { prompt: 'a quiet street', resolution: '1K', reference_images: [] }

  assert.deepEqual(validate(model.fields, values), [])
  const input = buildInput(model.fields, values)
  // An empty reference list must not reach the request.
  assert.ok(!('reference_images' in input))
  assert.equal(input.prompt, 'a quiet street')
})

check('a filled reference validates against the target model', () => {
  const target = getModel('gpt-image-2-image-to-image')!
  const values = { prompt: 'make it snowy', image_urls: ['https://cdn.test/a.png'] }

  assert.deepEqual(validate(target.fields, values), [])
  const input = buildInput(target.fields, values)
  assert.deepEqual(input.image_urls, ['https://cdn.test/a.png'])
})

check('drops fields the target does not accept', () => {
  // Kling takes an aspect ratio for text-to-video and derives it from the
  // image otherwise, so carrying it over would be rejected.
  const source = getModel('kling/v3-turbo-text-to-video')!
  const target = getModel('kling/v3-turbo-image-to-video')!

  assert.ok(source.fields.some((f) => f.name === 'aspect_ratio'))
  assert.ok(!target.fields.some((f) => f.name === 'aspect_ratio'))

  const input = buildInput(target.fields, {
    prompt: 'pan across the room',
    aspect_ratio: '16:9',
    duration: 5,
    resolution: '720p',
    image_urls: ['https://cdn.test/a.png'],
  })
  assert.ok(!('aspect_ratio' in input), 'aspect_ratio must not be sent')
  assert.equal(input.duration, '5')
})

check('single-valued targets receive one url, not a list', () => {
  // wan, pixverse and minimax take a single image field.
  for (const id of ['wan/2-7-image-to-video', 'pixverse/image-to-video', 'minimax-h3/image-to-video']) {
    const target = getModel(id)!
    const field = target.fields.find((f) => ['image_url', 'first_frame_url'].includes(f.name))!
    assert.equal(field.kind, 'image', `${id} should take a single image`)
  }
})

console.log(`\n${passed} passed`)
