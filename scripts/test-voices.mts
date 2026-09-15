/**
 * Voice cloning, against a real Postgres.
 *
 * Nothing here reaches Kie. What can be held without a key is held: that the
 * request bodies use the documented names, that a result is found wherever it
 * lands, that nothing is sent without consent, that one account cannot touch
 * another's voice, and that Suno is given the voice the way Kie documents.
 *
 *   DATABASE_URL=postgres://... bun --preload ./scripts/preload.ts scripts/test-voices.mts
 */

import assert from 'node:assert/strict'

import { createPostgresClient } from '../src/lib/db/postgres'
import { migrate } from '../src/lib/db/schema'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

const db = createPostgresClient(url)
;(globalThis as Record<string, unknown>).__highfieldDb = Promise.resolve(db)

await db.run('DROP SCHEMA public CASCADE')
await db.run('CREATE SCHEMA public')
await migrate(db)

const kie = await import('../src/lib/voices/kie')
const store = await import('../src/lib/voices/store')
const flow = await import('../src/lib/voices/flow')
const { toSunoRequest } = await import('../src/lib/kie/tasks')
const { getModel } = await import('../src/lib/kie/catalog')
const { buildInput, defaultsFor } = await import('../src/lib/kie/fields')

const OWNER = 'voice-owner'
const STRANGER = 'voice-stranger'
for (const id of [OWNER, STRANGER]) {
  await db.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    id,
    `${id}@example.com`,
    'hash',
    Date.now(),
  ])
}

console.log('request bodies')

await check('step one uses the names Kie documents', () => {
  assert.deepEqual(
    kie.phraseInput({ sourceUrl: 'https://x/a.wav', startS: 0, endS: 12, language: 'fr' }),
    { voice_url: 'https://x/a.wav', vocal_start_s: 0, vocal_end_s: 12, language: 'fr' },
  )
})

await check('step two sends the original task and drops blanks', () => {
  const input = kie.createInput({
    phraseTaskId: 'phrase-1',
    verifyUrl: 'https://x/reading.wav',
    name: 'Studio voice',
    description: '   ',
    style: 'soul',
    singerSkillLevel: 'advanced',
  })
  assert.deepEqual(input, {
    task_id: 'phrase-1',
    verify_url: 'https://x/reading.wav',
    voice_name: 'Studio voice',
    style: 'soul',
    singer_skill_level: 'advanced',
  })
})

await check('a singer level Kie does not list is not sent', () => {
  const input = kie.createInput({
    phraseTaskId: 'p',
    verifyUrl: 'https://x/r.wav',
    name: 'n',
    singerSkillLevel: 'legendary',
  })
  assert.ok(!('singer_skill_level' in input))
})

await check('the sample stretch is checked before it costs a request', () => {
  assert.equal(kie.checkSegment(0, 10), null)
  assert.match(kie.checkSegment(1.5, 10)!, /whole seconds/)
  assert.match(kie.checkSegment(-1, 10)!, /before the beginning/)
  assert.match(kie.checkSegment(10, 10)!, /after its start/)
  assert.match(kie.checkSegment(12, 4)!, /after its start/)
})

console.log('\nreading a result wherever it lands')

await check('the documented callback shape', () => {
  const r = kie.readVoiceResult(JSON.stringify({ data: { validateInfo: 'Harmonies fill the air' } }))
  assert.equal(r.phrase, 'Harmonies fill the air')
})

await check('flat, snake_case and nested in a list', () => {
  assert.equal(kie.readVoiceResult('{"validateInfo":"a"}').phrase, 'a')
  assert.equal(kie.readVoiceResult('{"validate_info":"b"}').phrase, 'b')
  assert.equal(kie.readVoiceResult('{"items":[{"voice_id":"voice_9"}]}').voiceId, 'voice_9')
})

await check('an unavailable voice is reported as false, not missing', () => {
  // A `false` skipped as falsy would read as "no answer" and be asked again
  // forever, which is the one mistake this parser must not make.
  assert.equal(kie.readVoiceResult('{"isAvailable":false}').available, false)
  assert.equal(kie.readVoiceResult('{"is_available":true}').available, true)
})

await check('nothing usable in, nothing out', () => {
  assert.deepEqual(kie.readVoiceResult(null), {})
  assert.deepEqual(kie.readVoiceResult(''), {})
  assert.deepEqual(kie.readVoiceResult('not json'), {})
  assert.deepEqual(kie.readVoiceResult('{"resultUrls":["https://x/y.mp3"]}'), {})
  assert.deepEqual(kie.readVoiceResult('{"validateInfo":"   "}'), {})
})

console.log('\nstarting a voice')

const actor = { id: OWNER, email: `${OWNER}@example.com` }
const valid = {
  name: 'Studio voice',
  sourceUrl: 'https://tempfile.aiquickdraw.com/voice.wav',
  startS: 0,
  endS: 12,
  language: 'fr',
  consent: true,
}

await check('nothing is sent without consent', async () => {
  // These all refuse before a request is built, so no key is involved and no
  // row may be written.
  for (const consent of [false, undefined, 'yes', 1]) {
    const result = await flow.startVoice(actor, { ...valid, consent })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /permission/)
  }
  assert.equal((await store.listVoices(OWNER)).length, 0)
})

await check('a bad sample, language or source is refused up front', async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ startS: 8, endS: 3 }, /after its start/],
    [{ language: 'xx' }, /language/],
    [{ sourceUrl: 'http://insecure/voice.wav' }, /recording/],
    [{ sourceUrl: '' }, /recording/],
    [{ name: '   ' }, /name/],
  ]
  for (const [override, message] of cases) {
    const result = await flow.startVoice(actor, { ...valid, ...override })
    assert.equal(result.ok, false, JSON.stringify(override))
    if (!result.ok) assert.match(result.error, message)
  }
  assert.equal((await store.listVoices(OWNER)).length, 0)
})

console.log('\nstorage')

const base = {
  userId: OWNER,
  name: 'Kept',
  description: null,
  style: null,
  language: 'fr',
  singerSkillLevel: null,
  sourceUrl: 'https://x/a.wav',
  vocalStartS: 0,
  vocalEndS: 12,
  phraseTaskId: 'phrase-1',
  status: 'phrase_pending' as const,
  consentAt: Date.now(),
}

await check('a voice round-trips with its consent stamp', async () => {
  const saved = await store.insertVoice({ ...base, id: 'v-1' })
  assert.equal(saved.name, 'Kept')
  assert.equal(saved.vocalEndS, 12)
  assert.equal(saved.available, null)
  assert.ok(saved.consentAt > 0)
})

await check('one account cannot read, change or delete another’s voice', async () => {
  assert.equal(await store.getVoice(STRANGER, 'v-1'), null)
  assert.equal((await store.listVoices(STRANGER)).length, 0)
  assert.equal(await store.updateVoice(STRANGER, 'v-1', { status: 'ready' }), null)
  assert.equal(await store.deleteVoice(STRANGER, 'v-1'), false)
  assert.equal((await store.getVoice(OWNER, 'v-1'))!.status, 'phrase_pending')
})

await check('a patch changes only what it names', async () => {
  const before = (await store.getVoice(OWNER, 'v-1'))!
  await new Promise((r) => setTimeout(r, 5))
  const after = (await store.updateVoice(OWNER, 'v-1', { phrase: 'Read me', status: 'phrase_ready' }))!
  assert.equal(after.phrase, 'Read me')
  assert.equal(after.status, 'phrase_ready')
  assert.equal(after.name, before.name)
  assert.equal(after.phraseTaskId, before.phraseTaskId)
  assert.ok(after.updatedAt > before.updatedAt)
})

await check('what the browser is told leaves out the internals', async () => {
  const shown = flow.publicVoice((await store.getVoice(OWNER, 'v-1'))!) as Record<string, unknown>
  for (const hidden of ['userId', 'phraseTaskId', 'createTaskId', 'regenerateTaskId', 'checkTaskId', 'consentAt']) {
    assert.ok(!(hidden in shown), `${hidden} reached the browser`)
  }
  assert.equal(shown.phrase, 'Read me')
})

await check('only voices Kie is working on are polled', async () => {
  const v = (await store.getVoice(OWNER, 'v-1'))!
  assert.equal(flow.isWaiting({ ...v, status: 'phrase_pending' }), true)
  assert.equal(flow.isWaiting({ ...v, status: 'creating' }), true)
  // Waiting on a person costs no requests.
  assert.equal(flow.isWaiting({ ...v, status: 'phrase_ready' }), false)
  assert.equal(flow.isWaiting({ ...v, status: 'failed' }), false)
  assert.equal(flow.isWaiting({ ...v, status: 'ready', available: true }), false)
  // Ready but unchecked is checked once; an error stops the checking.
  assert.equal(flow.isWaiting({ ...v, status: 'ready', available: null, error: null }), true)
  assert.equal(flow.isWaiting({ ...v, status: 'ready', available: null, error: 'x' }), false)
})

await check('a verification needs a phrase to have been read', async () => {
  await store.insertVoice({ ...base, id: 'v-2', status: 'phrase_pending' })
  const result = await flow.verifyVoice(actor, 'v-2', 'https://x/reading.wav')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /no phrase/)
})

await check('deleting is scoped and final', async () => {
  assert.equal(await store.deleteVoice(OWNER, 'v-2'), true)
  assert.equal(await store.getVoice(OWNER, 'v-2'), null)
})

console.log('\nusing a voice in Suno')

const sunoBody = (values: Record<string, unknown>) => {
  const model = getModel('suno')!
  return toSunoRequest(buildInput(model.fields, { ...defaultsFor(model.fields), ...values }), undefined)
}

await check('Suno offers only versions Kie still runs', () => {
  const version = getModel('suno')!.fields.find((f) => f.name === 'model') as {
    options: { value: string }[]
    default: string
  }
  assert.deepEqual(version.options.map((o) => o.value), ['V6', 'V6_MINI', 'V6_WILD'])
  assert.equal(version.default, 'V6')
})

await check('a cloned voice becomes a voice persona', () => {
  const body = sunoBody({ prompt: 'la la', style: 'soul', title: 'T', voiceId: 'voice_42' })
  assert.equal(body.personaId, 'voice_42')
  assert.equal(body.personaModel, 'voice_persona')
})

await check('no voice, no persona', () => {
  const body = sunoBody({ prompt: 'la la', style: 'soul', title: 'T', voiceId: '' })
  assert.ok(!('personaId' in body))
  assert.ok(!('personaModel' in body))
})

await check('outside custom mode the voice is not sent', () => {
  // Kie documents personaId as custom-mode only.
  const body = sunoBody({ prompt: 'a song about rain', customMode: false, voiceId: 'voice_42' })
  assert.ok(!('personaId' in body))
})

await check('duration is sent on V6, which it was not before', () => {
  const body = sunoBody({ prompt: 'x', style: 's', title: 't', duration: 90 })
  assert.equal(body.duration, 90)
})

await check('a request with no version falls back to one Kie still runs', () => {
  // It used to fall back to V5, which Kie has discontinued, turning a missing
  // field into a refusal instead of a song.
  const body = toSunoRequest({ prompt: 'x', customMode: false }, undefined)
  assert.equal(body.model, 'V6')
})

console.log(`\n${passed} checks passed`)
await db.close()
