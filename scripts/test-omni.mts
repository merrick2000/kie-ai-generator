/**
 * Gemini Omni voices and characters, reference audio, and Kling elements.
 *
 * Nothing here reaches Kie. What is held: the request bodies, the checks that
 * refuse before a request is spent, the storage scoping, and that the catalog
 * offers the new fields with the limits Kie documents.
 *
 *   DATABASE_URL=postgres://... bun --preload ./scripts/preload.ts scripts/test-omni.mts
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

const omni = await import('../src/lib/omni/kie')
const store = await import('../src/lib/omni/store')
const flow = await import('../src/lib/omni/flow')
const { getModel } = await import('../src/lib/kie/catalog')
const { buildInput, defaultsFor, validate } = await import('../src/lib/kie/fields')

const OWNER = 'omni-owner'
const STRANGER = 'omni-stranger'
for (const id of [OWNER, STRANGER]) {
  await db.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    id,
    `${id}@example.com`,
    'hash',
    Date.now(),
  ])
}
const actor = { id: OWNER, email: `${OWNER}@example.com` }

console.log('voices')

await check('thirty base voices, as Kie lists them', () => {
  assert.equal(omni.OMNI_BASE_VOICES.length, 30)
  assert.ok(omni.OMNI_BASE_VOICES.some((v) => v.value === 'sulafat'))
})

await check('a voice is refused before a request for what Kie would refuse', () => {
  assert.match(omni.checkVoice({ baseVoice: 'nobody', name: 'x' })!, /base voice/)
  assert.match(omni.checkVoice({ baseVoice: 'kore', name: '  ' })!, /name/)
  assert.match(omni.checkVoice({ baseVoice: 'kore', name: 'x', exampleDialogue: 'a'.repeat(121) })!, /example line/)
  assert.equal(omni.checkVoice({ baseVoice: 'kore', name: 'Narrator' }), null)
})

await check('the voice body uses Kie’s names and drops blanks', () => {
  assert.deepEqual(omni.voiceBody({ baseVoice: 'kore', name: ' Narrator ', voiceDescription: '  ', exampleDialogue: 'Hi' }), {
    audio_id: 'kore',
    name: 'Narrator',
    example_dialogue: 'Hi',
  })
})

console.log('\ncharacters')

await check('a character needs a description and a portrait', () => {
  assert.match(omni.checkCharacter({ description: '', portraitUrl: 'https://x/p.png' })!, /Describe/)
  assert.match(omni.checkCharacter({ description: 'd', portraitUrl: '' })!, /portrait/)
  assert.match(omni.checkCharacter({ description: 'd', portraitUrl: 'http://x/p.png' })!, /portrait/)
  assert.equal(omni.checkCharacter({ description: 'd', portraitUrl: 'https://x/p.png' }), null)
})

await check('the description goes out under both spellings Kie uses', () => {
  // The schema requires `descriptions`, the docs' example sends `description`.
  const body = omni.characterBody({ description: ' A pilot ', portraitUrl: 'https://x/p.png' }, [])
  assert.equal(body.descriptions, 'A pilot')
  assert.equal(body.description, 'A pilot')
  assert.ok(!('audio_ids' in body))
  assert.ok(!('character_name' in body))
})

await check('the portrait is first and the body second', () => {
  const body = omni.characterBody(
    { description: 'd', portraitUrl: 'https://x/face.png', bodyUrl: 'https://x/body.png', name: 'Maya' },
    ['kie-audio-1'],
  )
  assert.deepEqual(body.image_urls, ['https://x/face.png', 'https://x/body.png'])
  assert.deepEqual(body.audio_ids, ['kie-audio-1'])
  assert.equal(body.character_name, 'Maya')
})

console.log('\nstorage and ownership')

await check('voices and characters round-trip, scoped to their account', async () => {
  await store.insertOmniVoice({
    id: 'ov-1', userId: OWNER, kieAudioId: 'kie-a-1', name: 'Mine', baseVoice: 'kore',
    voiceDescription: null, exampleDialogue: null,
  })
  await store.insertOmniCharacter({
    id: 'oc-1', userId: OWNER, kieCharacterId: 'kie-c-1', name: 'Maya', description: 'd',
    imageUrl: 'https://x/p.png', bodyImageUrl: null, voiceIds: ['ov-1'], kieAudioIds: ['kie-a-1'],
  })

  assert.equal((await store.listOmniVoices(OWNER)).length, 1)
  assert.equal((await store.listOmniVoices(STRANGER)).length, 0)
  assert.equal(await store.getOmniCharacter(STRANGER, 'oc-1'), null)
  assert.equal(await store.deleteOmniCharacter(STRANGER, 'oc-1'), null)

  const saved = (await store.getOmniCharacter(OWNER, 'oc-1'))!
  assert.deepEqual(saved.voiceIds, ['ov-1'])
  assert.deepEqual(saved.kieAudioIds, ['kie-a-1'])
})

await check('nothing is sent for a voice Kie would refuse', async () => {
  const before = (await store.listOmniVoices(OWNER)).length
  const result = await flow.createVoice(actor, { baseVoice: 'nobody', name: 'x' })
  assert.equal(result.ok, false)
  assert.equal((await store.listOmniVoices(OWNER)).length, before)
})

await check('a character cannot borrow another account’s voice', async () => {
  await store.insertOmniVoice({
    id: 'ov-theirs', userId: STRANGER, kieAudioId: 'kie-a-theirs', name: 'Theirs', baseVoice: 'puck',
    voiceDescription: null, exampleDialogue: null,
  })
  const before = (await store.listOmniCharacters(OWNER)).length
  const result = await flow.createCharacter(actor, {
    description: 'd',
    portraitUrl: 'https://x/p.png',
    voiceIds: ['ov-theirs'],
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.status, 404)
  assert.equal((await store.listOmniCharacters(OWNER)).length, before)
})

await check('what the browser is told leaves out the account', async () => {
  const voice = flow.publicOmniVoice((await store.getOmniVoice(OWNER, 'ov-1'))!) as Record<string, unknown>
  const character = flow.publicOmniCharacter((await store.getOmniCharacter(OWNER, 'oc-1'))!) as Record<string, unknown>
  assert.ok(!('userId' in voice))
  assert.ok(!('userId' in character))
  assert.equal(voice.kieAudioId, 'kie-a-1')
})

console.log('\nthe catalog')

await check('both Gemini Omni video models take characters and voices', () => {
  for (const id of ['gemini-omni-video', 'google/gemini-omni-flash-1-1']) {
    const fields = getModel(id)!.fields
    const chars = fields.find((f) => f.name === 'character_ids') as { kind: string; source: string; maxItems: number }
    const voices = fields.find((f) => f.name === 'audio_ids') as { kind: string; source: string; maxItems: number }
    assert.equal(chars.kind, 'library')
    assert.equal(chars.source, 'omni-characters')
    assert.equal(chars.maxItems, 7)
    assert.equal(voices.source, 'omni-voices')
    assert.equal(voices.maxItems, 3)
  }
})

await check('Omni Flash refuses characters alongside a first frame, before Kie does', () => {
  const model = getModel('google/gemini-omni-flash-1-1')!
  const base = { ...defaultsFor(model.fields), prompt: 'a walk', duration: 5 }
  assert.deepEqual(validate(model.fields, { ...base, character_ids: ['c1'] }), [])
  const errors = validate(model.fields, { ...base, character_ids: ['c1'], first_frame_url: 'https://x/f.png' })
  assert.ok(errors.some((e) => /cannot be used together/.test(e)), JSON.stringify(errors))
})

await check('every Seedance 2 takes reference audio, with Kie’s limits', () => {
  const expected: Record<string, number> = {
    'bytedance/seedance-2': 3,
    'bytedance/seedance-2-fast': 3,
    'bytedance/seedance-2-mini': 3,
    'bytedance/seedance-2-5': 10,
  }
  for (const [id, max] of Object.entries(expected)) {
    const field = getModel(id)!.fields.find((f) => f.name === 'reference_audio_urls') as { kind: string; maxItems: number }
    assert.ok(field, `${id} has no reference audio`)
    assert.equal(field.kind, 'audios')
    assert.equal(field.maxItems, max, id)
  }
})

await check('reference audio is sent as a list', () => {
  const model = getModel('bytedance/seedance-2')!
  const input = buildInput(model.fields, {
    ...defaultsFor(model.fields),
    prompt: 'she speaks',
    reference_audio_urls: ['https://x/voice.wav', ''],
  })
  assert.deepEqual(input.reference_audio_urls, ['https://x/voice.wav'])
})

await check('Seedance 2.5 refuses reference audio with a first frame', () => {
  const model = getModel('bytedance/seedance-2-5')!
  const errors = validate(model.fields, {
    ...defaultsFor(model.fields),
    prompt: 'x',
    reference_audio_urls: ['https://x/v.wav'],
    first_frame_url: 'https://x/f.png',
  })
  assert.ok(errors.some((e) => /cannot be used together/.test(e)))
})

await check('Kling 3 Omni takes named characters with photos and audio', () => {
  for (const id of ['kling-3.0-omni/text-to-video', 'kling-3.0-omni/transformation']) {
    const model = getModel(id)!
    const elements = model.fields.find((f) => f.name === 'elements') as { kind: string; item: { name: string }[] }
    assert.equal(elements.kind, 'list', id)
    assert.deepEqual(elements.item.map((i) => i.name), ['name', 'description', 'element_input_urls', 'element_input_audio_urls'])

    const input = buildInput(model.fields, {
      ...defaultsFor(model.fields),
      prompt: '@maya walks in',
      elements: [
        { name: 'maya', description: 'short hair', element_input_urls: ['https://x/1.png', 'https://x/2.png'], element_input_audio_urls: ['https://x/v.wav'] },
        { name: '', description: '', element_input_urls: [], element_input_audio_urls: [] },
      ],
    })
    const sent = input.elements as Record<string, unknown>[]
    assert.equal(sent.length, 1, 'an empty row is not a character')
    assert.deepEqual(sent[0]!.element_input_audio_urls, ['https://x/v.wav'])
  }
})

await check('Kling 3 Omni text to video can now make sound', () => {
  const audio = getModel('kling-3.0-omni/text-to-video')!.fields.find((f) => f.name === 'audio')
  assert.equal(audio?.kind, 'toggle')
})

console.log(`\n${passed} checks passed`)
await db.close()
