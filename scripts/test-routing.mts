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
import { alertDescription } from '../src/hooks/useCompletionAlerts'
import { explainUpstream } from '../src/lib/kie/errors-upstream'
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

check('a continuation sends its durations the way Kie wants them', () => {
  // Kie documents extend_times as a number and refuses one, answering
  // "extend_times it must be a string". Every other duration in this API is
  // a string, so the schema is the outlier and this is the regression guard.
  const model = getModel('grok-imagine/extend')!
  const input = buildInput(model.fields, {
    ...defaultsFor(model.fields),
    prompt: 'the camera keeps moving',
    task_id: 'source-task',
    extend_times: '10',
  })

  assert.equal(typeof input.extend_times, 'string', 'extend_times must be a string')
  assert.equal(input.extend_times, '10')
  assert.equal(typeof input.extend_at, 'string', 'extend_at must be a string')
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

console.log('\nlength limits')

check('text past a model’s limit is refused before it is submitted', () => {
  // The counter above the box turned red and nothing else happened, so the
  // request went to Kie and came back rejected.
  const model = getModel('veo3')!
  const field = model.fields.find((f) => f.name === 'prompt')!
  const limit = (field as { maxLength?: number }).maxLength!

  assert.deepEqual(validate(model.fields, { prompt: 'a'.repeat(limit) }), [])

  const [problem] = validate(model.fields, { prompt: 'a'.repeat(limit + 12) })
  assert.match(problem ?? '', /12 characters over/)
})

check('the limit is checked on optional fields too', () => {
  // The old loop skipped anything not required, and a project's prompt suffix
  // is folded in after the box has already accepted the text.
  const optional = MODELS.find((m) =>
    m.fields.some(
      (f) => !f.required && 'maxLength' in f && typeof f.maxLength === 'number',
    ),
  )!
  const field = optional.fields.find(
    (f) => !f.required && 'maxLength' in f && typeof f.maxLength === 'number',
  )! as { name: string; maxLength: number }

  const errors = validate(optional.fields, {
    [field.name]: 'a'.repeat(field.maxLength + 1),
  })
  assert.ok(
    errors.some((e) => /over the/.test(e)),
    `${optional.id}.${field.name} accepted text past its limit`,
  )
})

console.log('\ncompletion alerts')

check('a toast repeats enough of a prompt to recognise it, and no more', () => {
  // The description was the whole prompt, so a long one turned the toast into
  // a column of text from the top of the screen to the bottom.
  const prompt = 'une image dune femme tenant ce produit entre les mains '.repeat(20)
  const line = alertDescription({
    title: null,
    promptPreview: prompt,
    modelName: 'Seedream 5 Pro',
    state: 'success',
    error: null,
  })

  assert.ok(line.length <= 110, `a toast line of ${line.length} characters is a paragraph`)
  assert.ok(line.endsWith('…'), 'a cut line has to say it was cut')
  assert.ok(prompt.startsWith(line.slice(0, 40)), 'it is the start of the prompt')
})

check('a failure shows the reason rather than the prompt', () => {
  const line = alertDescription({
    title: null,
    promptPreview: 'a quiet street',
    modelName: 'Veo 3.1',
    state: 'fail',
    error: 'The provider refused this.',
  })
  assert.equal(line, 'The provider refused this.')
})

check('a long failure reason is cut too', () => {
  const line = alertDescription({
    title: null,
    promptPreview: 'x',
    modelName: 'Veo 3.1',
    state: 'fail',
    error: 'because '.repeat(60),
  })
  assert.ok(line.length <= 110)
})

console.log('\nupstream refusals')

check('a bare provider code is explained, and kept', () => {
  const out = explainUpstream('PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED')!
  // The sentence is what a person reads; the code is what they would quote to
  // support, so neither is thrown away.
  assert.match(out, /recognisable person/)
  assert.match(out, /PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED/)
})

check('an unfamiliar message is passed through untouched', () => {
  // A wrong paraphrase is worse than an unfamiliar string.
  const raw = 'Something nobody has seen before'
  assert.equal(explainUpstream(raw), raw)
})

check('nothing in, nothing out', () => {
  assert.equal(explainUpstream(null), null)
  assert.equal(explainUpstream(''), null)
  assert.equal(explainUpstream('   '), null)
})

console.log(`\n${passed} passed`)
