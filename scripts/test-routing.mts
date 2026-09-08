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
import { buildInput, defaultsFor, validate } from '../src/lib/kie/fields'

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
  // Two ways in now: a reference routes to a sibling slug, and a finished
  // result is continued by an extension model. Either counts; neither does
  // means the entry exists and nothing can ever submit it.
  const reachable = new Set([
    ...routed.map((m) => m.routeWithAssets!.modelId),
    ...MODELS.filter((m) => m.extend).map((m) => m.extend!.with),
  ])
  for (const model of MODELS.filter((m) => m.hidden)) {
    assert.ok(reachable.has(model.id), `${model.id} is hidden but nothing reaches it`)
  }
})

console.log('\nextension')

const extendable = MODELS.filter((m) => m.extend)

check('every model that can be extended names one that exists', () => {
  for (const model of extendable) {
    const target = getModel(model.extend!.with)
    assert.ok(target, `${model.id} extends with a missing model`)
    assert.ok(
      target!.continuation,
      `${target!.id} is used as an extension but is not marked as one`,
    )
  }
})

check('an extension carries the field that receives the source task', () => {
  for (const model of extendable) {
    const target = getModel(model.extend!.with)!
    const field = target.fields.find((f) => f.name === target.continuation!.taskIdField)
    assert.ok(field, `${target.id} has no ${target.continuation!.taskIdField} field`)
    // Filled from the job, so it must be required: a continuation submitted
    // without one is a request Kie refuses.
    assert.equal(field!.required, true, `${target.id}'s source task must be required`)
  }
})

check('only a video model is extended, and only into a video', () => {
  for (const model of extendable) {
    const target = getModel(model.extend!.with)!
    assert.equal(model.output, 'video', `${model.id} is not a video model`)
    assert.equal(target.output, 'video', `${target.id} does not produce video`)
  }
})

check('every extension model is hidden', () => {
  for (const model of MODELS.filter((m) => m.continuation)) {
    // Its required task id cannot be typed from memory, so offering it in the
    // picker is offering a form nobody can complete.
    assert.equal(model.hidden, true, `${model.id} would appear in the picker`)
  }
})

check('a continuation validates once the task id is filled in', () => {
  for (const model of MODELS.filter((m) => m.continuation)) {
    const values = {
      ...defaultsFor(model.fields),
      prompt: 'the camera pulls back to reveal the whole street',
      [model.continuation!.taskIdField]: 'task-from-the-source-run',
    }

    assert.deepEqual(
      validate(model.fields, values),
      [],
      `${model.id} rejects a continuation the Extend action would build`,
    )

    const input = buildInput(model.fields, values)
    assert.equal(input[model.continuation!.taskIdField], 'task-from-the-source-run')
  }
})

check('a continuation is refused when nothing says what to continue', () => {
  for (const model of MODELS.filter((m) => m.continuation)) {
    const values = { ...defaultsFor(model.fields), prompt: 'keep going' }
    assert.notDeepEqual(
      validate(model.fields, values),
      [],
      `${model.id} accepts a continuation with no source task`,
    )
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
  // `input_urls`, not `image_urls`: that is the name Kie's schema uses, and
  // sending the other one had every edit refused.
  const values = { prompt: 'make it snowy', input_urls: ['https://cdn.test/a.png'] }

  assert.deepEqual(validate(target.fields, values), [])
  const input = buildInput(target.fields, values)
  assert.deepEqual(input.input_urls, ['https://cdn.test/a.png'])
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

check('a route lands on a field the target really has', () => {
  // The mapping is checked against every route rather than a hand-picked
  // three, because pointing at a field the target does not declare is
  // exactly the mistake that had four edit models refusing every request.
  for (const model of MODELS) {
    const route = model.routeWithAssets
    if (!route) continue

    const target = getModel(route.modelId)
    assert.ok(target, `${model.id} routes to a missing model`)

    const field = target!.fields.find((f) => f.name === route.to)
    assert.ok(field, `${model.id} routes to ${route.modelId}.${route.to}, which does not exist`)

    // The router hands a list to a list field and one URL to a single one.
    assert.ok(
      ['image', 'images', 'video', 'videos', 'audio'].includes(field!.kind),
      `${route.modelId}.${route.to} is not an asset field`,
    )
  }
})

console.log(`\n${passed} passed`)
