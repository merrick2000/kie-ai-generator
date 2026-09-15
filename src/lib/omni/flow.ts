/**
 * Making Omni voices and characters.
 *
 * Both endpoints answer in the request, so each function here is one call:
 * check, submit, store, record. Nothing waits and nothing is polled.
 */

import 'server-only'

import { callerIp, record } from '@/lib/activity'
import { createOmniAudio, createOmniCharacter, KieError } from '@/lib/kie/client'
import { explainUpstream } from '@/lib/kie/errors-upstream'
import { createLogger } from '@/lib/logger'
import {
  answerExcerpt,
  characterBody,
  checkCharacter,
  checkVoice,
  findOmniId,
  voiceBody,
  type CharacterDraft,
  type VoiceDraft,
} from './kie'
import {
  getOmniVoice,
  insertOmniCharacter,
  insertOmniVoice,
  newOmniId,
  type OmniCharacter,
  type OmniVoice,
} from './store'

const log = createLogger('omni')

export interface Actor {
  id: string
  email: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; status: number }

const refused = <T>(error: string, status = 400): Result<T> => ({ ok: false, error, status })

function upstream<T>(err: unknown, fallback: string): Result<T> {
  if (err instanceof KieError) return refused(explainUpstream(err.message) ?? fallback, err.clientStatus)
  log.error('omni call failed', { error: err })
  return refused(fallback, 500)
}

const trimmed = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t || null
}

export async function createVoice(actor: Actor, draft: VoiceDraft): Promise<Result<OmniVoice>> {
  const problem = checkVoice(draft)
  if (problem) return refused(problem)

  const body = voiceBody(draft)
  let kieAudioId: string
  try {
    const answer = await createOmniAudio(body)
    const id = findOmniId(answer, 'audio')
    if (!id) {
      log.warn('voice created without a recognisable id', { answer: answerExcerpt(answer, 800) })
      // The raw answer goes into the message on purpose: this has already
      // happened once with a voice that did exist, and the answer is the only
      // thing that says where the id went.
      return refused(`Kie accepted the voice but its answer has no id we recognise: ${answerExcerpt(answer)}`, 502)
    }
    kieAudioId = id
  } catch (err) {
    return upstream(err, 'Kie did not create the voice.')
  }

  const voice = await insertOmniVoice({
    id: newOmniId(),
    userId: actor.id,
    kieAudioId,
    name: body.name,
    baseVoice: body.audio_id,
    voiceDescription: body.voice_description ?? null,
    exampleDialogue: body.example_dialogue ?? null,
  })

  await record({
    kind: 'omni_voice_created',
    userId: actor.id,
    email: actor.email,
    summary: voice.name,
    meta: { voice: voice.id, base: voice.baseVoice },
    ip: await callerIp(),
  })

  return { ok: true, value: voice }
}

export async function createCharacter(actor: Actor, draft: CharacterDraft): Promise<Result<OmniCharacter>> {
  const problem = checkCharacter(draft)
  if (problem) return refused(problem)

  // Voices are picked by local id and sent by Kie id. Each has to belong to
  // this account: an id from someone else's list would otherwise let one user
  // borrow another's voice by guessing a row id.
  const localIds = Array.isArray(draft.voiceIds)
    ? [...new Set(draft.voiceIds.filter((v): v is string => typeof v === 'string' && v.length > 0))]
    : []

  const voices: OmniVoice[] = []
  for (const id of localIds) {
    const voice = await getOmniVoice(actor.id, id)
    if (!voice) return refused('One of the chosen voices is not on this account.', 404)
    voices.push(voice)
  }
  const kieAudioIds = voices.map((v) => v.kieAudioId)

  let answer: unknown
  try {
    answer = await createOmniCharacter(characterBody(draft, kieAudioIds))
  } catch (err) {
    return upstream(err, 'Kie did not create the character.')
  }

  const characterId = findOmniId(answer, 'character')
  if (!characterId) {
    log.warn('character created without a recognisable id', { answer: answerExcerpt(answer, 800) })
    return refused(`Kie accepted the character but its answer has no id we recognise: ${answerExcerpt(answer)}`, 502)
  }
  const data = ((answer as { data?: unknown })?.data ?? {}) as Record<string, unknown>

  const character = await insertOmniCharacter({
    id: newOmniId(),
    userId: actor.id,
    kieCharacterId: characterId,
    name: trimmed(draft.name) ?? trimmed(data.characterName ?? data.character_name) ?? null,
    description: String(draft.description).trim(),
    // Kie's own copy when it returns one: uploads expire within days, the
    // character's image should not.
    imageUrl: trimmed(data.imageUrl ?? data.image_url) ?? String(draft.portraitUrl).trim(),
    bodyImageUrl: trimmed(data.bodyImageUrl ?? data.body_image_url) ?? trimmed(draft.bodyUrl),
    voiceIds: voices.map((v) => v.id),
    kieAudioIds,
  })

  await record({
    kind: 'character_created',
    userId: actor.id,
    email: actor.email,
    summary: character.name ?? 'Unnamed character',
    meta: { character: character.id, voices: voices.length },
    ip: await callerIp(),
  })

  return { ok: true, value: character }
}

/** What the browser is told. The account id stays on the server. */
export const publicOmniVoice = (v: OmniVoice) => ({
  id: v.id,
  kieAudioId: v.kieAudioId,
  name: v.name,
  baseVoice: v.baseVoice,
  voiceDescription: v.voiceDescription,
  exampleDialogue: v.exampleDialogue,
  createdAt: v.createdAt,
})

export const publicOmniCharacter = (c: OmniCharacter) => ({
  id: c.id,
  kieCharacterId: c.kieCharacterId,
  name: c.name,
  description: c.description,
  imageUrl: c.imageUrl,
  bodyImageUrl: c.bodyImageUrl,
  voiceIds: c.voiceIds,
  createdAt: c.createdAt,
})
