/**
 * Projects.
 *
 * A project is a folder with opinions: it groups runs, and it carries the
 * defaults a piece of work keeps repeating. Without it every generation is a
 * loose file in one endless list, and the settings that define a look have to
 * be retyped each time.
 */

import 'server-only'

import { randomBytes } from 'node:crypto'

import { getDb } from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { PROJECT_COLORS } from './colors'

const log = createLogger('projects')

/**
 * Per-project defaults.
 *
 * Every field is optional and unknown keys are preserved on write, so adding
 * a knob later does not need a migration or a backfill.
 */
export interface ProjectSettings {
  /** Pre-selected when the project is opened. */
  modelId?: string
  /** Prepended to every prompt submitted inside the project. */
  promptPrefix?: string
  /** Appended to every prompt. Useful for a house style. */
  promptSuffix?: string
  /** Applied to models that expose an aspect ratio. */
  aspectRatio?: string
  /** Applied to models that expose a resolution. */
  resolution?: string
  /** Free-form notes, shown in the project header. */
  brief?: string
}

export interface Project {
  id: string
  name: string
  description: string | null
  color: string | null
  settings: ProjectSettings
  archived: boolean
  createdAt: number
  updatedAt: number
}

interface ProjectRow {
  id: string
  name: string
  description: string | null
  color: string | null
  settings: string
  archived: boolean
  created_at: number | string
  updated_at: number | string
}

function num(value: number | string | null): number {
  if (value === null) return 0
  return typeof value === 'number' ? value : Number(value)
}

function toProject(row: ProjectRow): Project {
  let settings: ProjectSettings = {}
  try {
    settings = row.settings ? (JSON.parse(row.settings) as ProjectSettings) : {}
  } catch {
    // A malformed settings blob should not hide the project itself.
    settings = {}
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    settings,
    archived: Boolean(row.archived),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  }
}

const COLUMNS = 'id, name, description, color, settings, archived, created_at, updated_at'

function safeColor(value: unknown): string | null {
  return typeof value === 'string' && (PROJECT_COLORS as readonly string[]).includes(value)
    ? value
    : null
}

export async function listProjects(
  userId: string,
  includeArchived = false,
): Promise<Project[]> {
  const db = await getDb()
  const rows = await db.all<ProjectRow>(
    `SELECT ${COLUMNS} FROM projects
      WHERE user_id = ?${includeArchived ? '' : ' AND archived = FALSE'}
      ORDER BY archived ASC, updated_at DESC`,
    [userId],
  )
  return rows.map(toProject)
}

export async function getProject(userId: string, id: string): Promise<Project | null> {
  const db = await getDb()
  const row = await db.get<ProjectRow>(
    `SELECT ${COLUMNS} FROM projects WHERE id = ? AND user_id = ?`,
    [id, userId],
  )
  return row ? toProject(row) : null
}

export interface ProjectInput {
  name: string
  description?: string | null
  color?: string | null
  settings?: ProjectSettings
}

export async function createProject(
  userId: string,
  input: ProjectInput,
): Promise<Project> {
  const db = await getDb()
  const now = Date.now()
  const id = randomBytes(9).toString('base64url')

  await db.run(
    `INSERT INTO projects (id, user_id, name, description, color, settings, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, FALSE, ?, ?)`,
    [
      id,
      userId,
      input.name.trim().slice(0, 120),
      input.description?.trim().slice(0, 1000) || null,
      safeColor(input.color),
      JSON.stringify(input.settings ?? {}),
      now,
      now,
    ],
  )

  log.info('project created', { userId, projectId: id, name: input.name })

  const project = await getProject(userId, id)
  if (!project) throw new Error('Project vanished immediately after insert.')
  return project
}

/**
 * The project an account's older work belongs to.
 *
 * Looked up by name rather than kept as a flag on the row: if someone renames
 * or deletes it, the next import makes a fresh one instead of failing, and
 * nothing about the app depends on this project being special.
 */
export const DEFAULT_PROJECT_NAME = 'Default project'

export async function findOrCreateProject(
  userId: string,
  name: string,
  input: Omit<ProjectInput, 'name'> = {},
): Promise<Project> {
  const db = await getDb()

  const existing = await db.get<ProjectRow>(
    `SELECT ${COLUMNS} FROM projects WHERE user_id = ? AND name = ? ORDER BY created_at ASC`,
    [userId, name],
  )
  if (existing) return toProject(existing)

  return createProject(userId, { name, ...input })
}

export interface ProjectPatch {
  name?: string
  description?: string | null
  color?: string | null
  /** Merged into the stored settings rather than replacing them. */
  settings?: ProjectSettings
  archived?: boolean
}

export async function updateProject(
  userId: string,
  id: string,
  patch: ProjectPatch,
): Promise<Project | null> {
  const existing = await getProject(userId, id)
  if (!existing) return null

  const db = await getDb()

  const merged: ProjectSettings = patch.settings
    ? { ...existing.settings, ...patch.settings }
    : existing.settings

  // Merging, then dropping the blanks: clearing a default is done by sending
  // an empty string, which should remove the key rather than store "".
  for (const [key, value] of Object.entries(merged)) {
    if (value === '' || value === null || value === undefined) {
      delete merged[key as keyof ProjectSettings]
    }
  }

  await db.run(
    `UPDATE projects
        SET name = ?, description = ?, color = ?, settings = ?, archived = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
    [
      patch.name?.trim().slice(0, 120) || existing.name,
      patch.description === undefined
        ? existing.description
        : patch.description?.trim().slice(0, 1000) || null,
      patch.color === undefined ? existing.color : safeColor(patch.color),
      JSON.stringify(merged),
      patch.archived ?? existing.archived,
      Date.now(),
      id,
      userId,
    ],
  )

  return getProject(userId, id)
}

/**
 * Copy a project.
 *
 * Two things get copied and one is optional. The settings always do, since
 * that is what a project is for: a brief and a house style worth reusing on
 * the next campaign. The work inside is a choice, because "same setup, fresh
 * start" and "a variant of this, keeping what is already here" are both
 * things people want, and guessing wrong is annoying either way.
 */
export async function duplicateProject(
  userId: string,
  id: string,
  options: { name?: string; withJobs: boolean },
): Promise<{ project: Project; copiedJobs: number } | null> {
  const source = await getProject(userId, id)
  if (!source) return null

  const copy = await createProject(userId, {
    name: options.name?.trim() || `${source.name} copy`,
    description: source.description,
    color: source.color,
    settings: source.settings,
  })

  if (!options.withJobs) return { project: copy, copiedJobs: 0 }

  const db = await getDb()

  // Copied inside the database rather than read out and written back: the
  // rows carry prompts and asset lists, and a project of any size would mean
  // moving all of it through the app for no reason.
  //
  // New ids, and `favorite` deliberately reset: a copy is a starting point,
  // not a second claim on the same pinned results.
  const rows = await db.all<{ id: string }>(
    `INSERT INTO jobs (
       id, user_id, project_id, task_id, api, model_id, submitted_model_id,
       model_name, category, output, title, prompt_preview, values_json,
       state, progress, assets_json, text, error, favorite,
       credits_consumed, cost_time_ms, created_at, updated_at, completed_at,
       next_poll_at
     )
     SELECT
       substr(md5(random()::text || id), 1, 20), user_id, ?, task_id, api,
       model_id, submitted_model_id, model_name, category, output, title,
       prompt_preview, values_json, state, progress, assets_json, text, error,
       FALSE, credits_consumed, cost_time_ms, created_at, ?, completed_at, ?
       FROM jobs
      WHERE user_id = ? AND project_id = ? AND state IN ('success', 'fail')
      RETURNING id`,
    [copy.id, Date.now(), Number.MAX_SAFE_INTEGER, userId, source.id],
  )

  log.info('project duplicated', {
    userId,
    from: source.id,
    to: copy.id,
    copiedJobs: rows.length,
  })

  return { project: copy, copiedJobs: rows.length }
}

/**
 * Delete a project.
 *
 * The jobs inside it survive: the schema sets their project_id to null, so
 * deleting a folder never destroys work. They reappear under "Unfiled".
 */
export async function deleteProject(userId: string, id: string): Promise<boolean> {
  const db = await getDb()
  const existing = await getProject(userId, id)
  if (!existing) return false

  await db.run('DELETE FROM projects WHERE id = ? AND user_id = ?', [id, userId])
  log.info('project deleted', { userId, projectId: id })
  return true
}

/** Bump updated_at, so the switcher orders by recent activity. */
export async function touchProject(userId: string, id: string): Promise<void> {
  const db = await getDb()
  await db.run(
    'UPDATE projects SET updated_at = ? WHERE id = ? AND user_id = ?',
    [Date.now(), id, userId],
  )
}
