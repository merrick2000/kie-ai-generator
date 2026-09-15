/** Omni voice and character storage. Repository functions only. */

import 'server-only'

import { randomBytes } from 'node:crypto'

import { getDb } from '@/lib/db'

export interface OmniVoice {
  id: string
  userId: string
  kieAudioId: string
  name: string
  baseVoice: string
  voiceDescription: string | null
  exampleDialogue: string | null
  createdAt: number
}

export interface OmniCharacter {
  id: string
  userId: string
  kieCharacterId: string
  name: string | null
  description: string
  imageUrl: string
  bodyImageUrl: string | null
  voiceIds: string[]
  kieAudioIds: string[]
  createdAt: number
}

interface VoiceRow {
  id: string
  user_id: string
  kie_audio_id: string
  name: string
  base_voice: string
  voice_description: string | null
  example_dialogue: string | null
  created_at: number | string
}

interface CharacterRow {
  id: string
  user_id: string
  kie_character_id: string
  name: string | null
  description: string
  image_url: string
  body_image_url: string | null
  voice_ids: string
  kie_audio_ids: string
  created_at: number | string
}

export function newOmniId(): string {
  return randomBytes(12).toString('base64url')
}

const ids = (raw: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

const toVoice = (r: VoiceRow): OmniVoice => ({
  id: r.id,
  userId: r.user_id,
  kieAudioId: r.kie_audio_id,
  name: r.name,
  baseVoice: r.base_voice,
  voiceDescription: r.voice_description,
  exampleDialogue: r.example_dialogue,
  createdAt: Number(r.created_at),
})

const toCharacter = (r: CharacterRow): OmniCharacter => ({
  id: r.id,
  userId: r.user_id,
  kieCharacterId: r.kie_character_id,
  name: r.name,
  description: r.description,
  imageUrl: r.image_url,
  bodyImageUrl: r.body_image_url,
  voiceIds: ids(r.voice_ids),
  kieAudioIds: ids(r.kie_audio_ids),
  createdAt: Number(r.created_at),
})

/* Voices ------------------------------------------------------------------ */

export async function insertOmniVoice(v: Omit<OmniVoice, 'createdAt'>): Promise<OmniVoice> {
  const db = await getDb()
  await db.run(
    `INSERT INTO omni_voices (id, user_id, kie_audio_id, name, base_voice, voice_description, example_dialogue, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.id, v.userId, v.kieAudioId, v.name, v.baseVoice, v.voiceDescription, v.exampleDialogue, Date.now()],
  )
  const saved = await getOmniVoice(v.userId, v.id)
  if (!saved) throw new Error('A voice was written and could not be read back.')
  return saved
}

export async function getOmniVoice(userId: string, id: string): Promise<OmniVoice | null> {
  const db = await getDb()
  const row = await db.get<VoiceRow>('SELECT * FROM omni_voices WHERE id = ? AND user_id = ?', [id, userId])
  return row ? toVoice(row) : null
}

export async function listOmniVoices(userId: string): Promise<OmniVoice[]> {
  const db = await getDb()
  const rows = await db.all<VoiceRow>(
    'SELECT * FROM omni_voices WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  )
  return rows.map(toVoice)
}

export async function deleteOmniVoice(userId: string, id: string): Promise<OmniVoice | null> {
  const db = await getDb()
  const existing = await getOmniVoice(userId, id)
  if (!existing) return null
  await db.run('DELETE FROM omni_voices WHERE id = ? AND user_id = ?', [id, userId])
  return existing
}

/* Characters -------------------------------------------------------------- */

export async function insertOmniCharacter(c: Omit<OmniCharacter, 'createdAt'>): Promise<OmniCharacter> {
  const db = await getDb()
  await db.run(
    `INSERT INTO omni_characters (id, user_id, kie_character_id, name, description, image_url, body_image_url, voice_ids, kie_audio_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      c.id,
      c.userId,
      c.kieCharacterId,
      c.name,
      c.description,
      c.imageUrl,
      c.bodyImageUrl,
      JSON.stringify(c.voiceIds),
      JSON.stringify(c.kieAudioIds),
      Date.now(),
    ],
  )
  const saved = await getOmniCharacter(c.userId, c.id)
  if (!saved) throw new Error('A character was written and could not be read back.')
  return saved
}

export async function getOmniCharacter(userId: string, id: string): Promise<OmniCharacter | null> {
  const db = await getDb()
  const row = await db.get<CharacterRow>('SELECT * FROM omni_characters WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ])
  return row ? toCharacter(row) : null
}

export async function listOmniCharacters(userId: string): Promise<OmniCharacter[]> {
  const db = await getDb()
  const rows = await db.all<CharacterRow>(
    'SELECT * FROM omni_characters WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  )
  return rows.map(toCharacter)
}

export async function deleteOmniCharacter(userId: string, id: string): Promise<OmniCharacter | null> {
  const db = await getDb()
  const existing = await getOmniCharacter(userId, id)
  if (!existing) return null
  await db.run('DELETE FROM omni_characters WHERE id = ? AND user_id = ?', [id, userId])
  return existing
}
