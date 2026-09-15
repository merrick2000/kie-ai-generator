/**
 * Voice storage. Repository functions only, so the flow never writes SQL.
 */

import 'server-only'

import { randomBytes } from 'node:crypto'

import { getDb } from '@/lib/db'
import type { SqlValue } from '@/lib/db/types'
import type { VoiceStatus } from './kie'

export interface Voice {
  id: string
  userId: string
  name: string
  description: string | null
  style: string | null
  language: string
  singerSkillLevel: string | null
  sourceUrl: string
  vocalStartS: number
  vocalEndS: number
  phraseTaskId: string | null
  phrase: string | null
  verifyUrl: string | null
  createTaskId: string | null
  regenerateTaskId: string | null
  voiceId: string | null
  checkTaskId: string | null
  available: boolean | null
  status: VoiceStatus
  error: string | null
  consentAt: number
  createdAt: number
  updatedAt: number
}

interface VoiceRow {
  id: string
  user_id: string
  name: string
  description: string | null
  style: string | null
  language: string
  singer_skill_level: string | null
  source_url: string
  vocal_start_s: number | string
  vocal_end_s: number | string
  phrase_task_id: string | null
  phrase: string | null
  verify_url: string | null
  create_task_id: string | null
  regenerate_task_id: string | null
  voice_id: string | null
  check_task_id: string | null
  available: boolean | null
  status: string
  error: string | null
  consent_at: number | string
  created_at: number | string
  updated_at: number | string
}

/** Field name to column, for the columns a patch may change. */
const COLUMNS = {
  name: 'name',
  description: 'description',
  style: 'style',
  language: 'language',
  singerSkillLevel: 'singer_skill_level',
  phraseTaskId: 'phrase_task_id',
  phrase: 'phrase',
  verifyUrl: 'verify_url',
  createTaskId: 'create_task_id',
  regenerateTaskId: 'regenerate_task_id',
  voiceId: 'voice_id',
  checkTaskId: 'check_task_id',
  available: 'available',
  status: 'status',
  error: 'error',
} as const

export type VoicePatch = Partial<Pick<Voice, keyof typeof COLUMNS>>

function toVoice(row: VoiceRow): Voice {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    style: row.style,
    language: row.language,
    singerSkillLevel: row.singer_skill_level,
    sourceUrl: row.source_url,
    vocalStartS: Number(row.vocal_start_s),
    vocalEndS: Number(row.vocal_end_s),
    phraseTaskId: row.phrase_task_id,
    phrase: row.phrase,
    verifyUrl: row.verify_url,
    createTaskId: row.create_task_id,
    regenerateTaskId: row.regenerate_task_id,
    voiceId: row.voice_id,
    checkTaskId: row.check_task_id,
    available: row.available,
    status: row.status as VoiceStatus,
    error: row.error,
    consentAt: Number(row.consent_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function newVoiceId(): string {
  return randomBytes(12).toString('base64url')
}

export type NewVoice = Omit<
  Voice,
  | 'createdAt'
  | 'updatedAt'
  | 'phrase'
  | 'verifyUrl'
  | 'createTaskId'
  | 'regenerateTaskId'
  | 'voiceId'
  | 'checkTaskId'
  | 'available'
  | 'error'
>

export async function insertVoice(voice: NewVoice): Promise<Voice> {
  const db = await getDb()
  const now = Date.now()

  await db.run(
    `INSERT INTO voices (
       id, user_id, name, description, style, language, singer_skill_level,
       source_url, vocal_start_s, vocal_end_s, phrase_task_id, status,
       consent_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      voice.id,
      voice.userId,
      voice.name,
      voice.description,
      voice.style,
      voice.language,
      voice.singerSkillLevel,
      voice.sourceUrl,
      voice.vocalStartS,
      voice.vocalEndS,
      voice.phraseTaskId,
      voice.status,
      voice.consentAt,
      now,
      now,
    ],
  )

  const saved = await getVoice(voice.userId, voice.id)
  if (!saved) throw new Error('A voice was written and could not be read back.')
  return saved
}

/** Scoped to the account, so one user can never read another's voice. */
export async function getVoice(userId: string, id: string): Promise<Voice | null> {
  const db = await getDb()
  const row = await db.get<VoiceRow>('SELECT * FROM voices WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ])
  return row ? toVoice(row) : null
}

export async function listVoices(userId: string): Promise<Voice[]> {
  const db = await getDb()
  const rows = await db.all<VoiceRow>(
    'SELECT * FROM voices WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  )
  return rows.map(toVoice)
}

export async function updateVoice(
  userId: string,
  id: string,
  patch: VoicePatch,
): Promise<Voice | null> {
  const db = await getDb()
  const sets: string[] = []
  const params: SqlValue[] = []

  for (const [key, column] of Object.entries(COLUMNS) as [keyof VoicePatch, string][]) {
    if (!(key in patch)) continue
    sets.push(`${column} = ?`)
    params.push((patch[key] ?? null) as SqlValue)
  }

  sets.push('updated_at = ?')
  params.push(Date.now(), id, userId)

  await db.run(`UPDATE voices SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params)
  return getVoice(userId, id)
}

export async function deleteVoice(userId: string, id: string): Promise<boolean> {
  const db = await getDb()
  const existing = await getVoice(userId, id)
  if (!existing) return false
  await db.run('DELETE FROM voices WHERE id = ? AND user_id = ?', [id, userId])
  return true
}
