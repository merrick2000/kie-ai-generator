'use client'

/**
 * Bringing the old browser history across.
 *
 * Before generations moved to the server, every result this account had ever
 * made lived in IndexedDB under `highfield-studio`, owned by one browser.
 * That record is still there after the upgrade, and it holds work nobody
 * wants to lose.
 *
 * So it is read once, sent to the server, and filed into a project. The old
 * entry is never deleted: if the import fails halfway, or the server rejects
 * something, the original is still sitting where it was.
 */

import { get, set } from 'idb-keyval'

import { getModel } from '@/lib/kie/catalog'
import type { TaskAsset } from '@/lib/kie/tasks'
import type { ModelCategory } from '@/lib/kie/catalog'

/** Where the previous build kept its state. Read-only from here on. */
const LEGACY_KEY = 'highfield-studio'

/** Records that the import has run, so it does not repeat every load. */
const MARKER_KEY = 'highfield-legacy-import'

/** Sent per request, so one big history does not become one huge body. */
const CHUNK = 60

/** The shape the old store persisted. Every field is treated as untrusted. */
interface LegacyJob {
  id?: unknown
  taskId?: unknown
  api?: unknown
  modelId?: unknown
  modelName?: unknown
  values?: unknown
  promptPreview?: unknown
  output?: unknown
  state?: unknown
  progress?: unknown
  assets?: unknown
  text?: unknown
  error?: unknown
  createdAt?: unknown
  completedAt?: unknown
  costTimeMs?: unknown
  creditsConsumed?: unknown
  favorite?: unknown
}

/** What the import endpoint accepts. */
export interface ImportableJob {
  id: string
  taskId: string | null
  api: string
  modelId: string
  modelName: string
  category: ModelCategory
  output: 'image' | 'video' | 'audio' | 'text'
  promptPreview: string
  values: Record<string, unknown>
  state: string
  assets: TaskAsset[]
  text: string | null
  error: string | null
  favorite: boolean
  creditsConsumed: number | null
  costTimeMs: number | null
  createdAt: number
  completedAt: number | null
}

export interface LegacyDraft {
  modelId?: string
  formsByModel?: Record<string, Record<string, unknown>>
}

export interface LegacyRecord {
  jobs: ImportableJob[]
  draft: LegacyDraft
}

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const numOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * Everything the old record holds, in a shape the server will accept.
 *
 * Written defensively because this data was persisted by an older build and
 * has been sitting in a browser since: a field that changed shape, or a row
 * half-written by a crashed tab, must not stop the rest from coming across.
 */
function readJob(raw: LegacyJob): ImportableJob | null {
  const id = str(raw.id)
  const modelId = str(raw.modelId)
  if (!id || !modelId) return null

  const model = getModel(modelId)

  // A model that has since been removed from the catalog still had its run,
  // so it is imported under a sensible guess rather than dropped.
  const output = (['image', 'video', 'audio', 'text'] as const).includes(
    raw.output as 'image',
  )
    ? (raw.output as ImportableJob['output'])
    : (model?.output ?? 'image')

  const assets = Array.isArray(raw.assets)
    ? (raw.assets as TaskAsset[]).filter(
        (asset) => asset && typeof asset === 'object' && typeof asset.url === 'string',
      )
    : []

  return {
    id,
    taskId: typeof raw.taskId === 'string' ? raw.taskId : null,
    api: str(raw.api, 'market'),
    modelId,
    modelName: str(raw.modelName, model?.name ?? modelId),
    category: model?.category ?? (output === 'text' ? 'text' : (output as ModelCategory)),
    output,
    promptPreview: str(raw.promptPreview).slice(0, 2000),
    values:
      raw.values && typeof raw.values === 'object'
        ? (raw.values as Record<string, unknown>)
        : {},
    state: str(raw.state, 'success'),
    assets,
    text: typeof raw.text === 'string' ? raw.text : null,
    error: typeof raw.error === 'string' ? raw.error : null,
    favorite: raw.favorite === true,
    creditsConsumed: numOrNull(raw.creditsConsumed),
    costTimeMs: numOrNull(raw.costTimeMs),
    createdAt: numOrNull(raw.createdAt) ?? Date.now(),
    completedAt: numOrNull(raw.completedAt),
  }
}

/** Read the old record without touching it. Null when there is nothing there. */
export async function readLegacyRecord(): Promise<LegacyRecord | null> {
  let stored: unknown
  try {
    stored = await get(LEGACY_KEY)
  } catch {
    // A browser with IndexedDB blocked has nothing to migrate anyway.
    return null
  }

  if (!stored) return null

  let parsed: unknown = stored
  if (typeof stored === 'string') {
    try {
      parsed = JSON.parse(stored)
    } catch {
      return null
    }
  }

  // Zustand wraps the persisted slice in `{ state, version }`.
  const state = (parsed as { state?: unknown })?.state
  if (!state || typeof state !== 'object') return null

  const slice = state as { jobs?: unknown; modelId?: unknown; formsByModel?: unknown }
  const rawJobs = Array.isArray(slice.jobs) ? (slice.jobs as LegacyJob[]) : []

  const jobs = rawJobs.flatMap((raw) => {
    const job = readJob(raw)
    return job ? [job] : []
  })

  return {
    jobs,
    draft: {
      modelId: typeof slice.modelId === 'string' ? slice.modelId : undefined,
      formsByModel:
        slice.formsByModel && typeof slice.formsByModel === 'object'
          ? (slice.formsByModel as Record<string, Record<string, unknown>>)
          : undefined,
    },
  }
}

interface Marker {
  importedAt: number
  imported: number
}

async function readMarker(): Promise<Marker | null> {
  try {
    return (await get<Marker>(MARKER_KEY)) ?? null
  } catch {
    return null
  }
}

export interface ImportOutcome {
  /** How many rows the server created. */
  imported: number
  /** Already present, so left alone. */
  skipped: number
  projectName: string
  draft: LegacyDraft
}

/**
 * Move the old history to the server, once.
 *
 * Idempotent twice over: a marker stops it running again on this device, and
 * the server keys each row on the account plus its original id, so a second
 * attempt, or the same history opened on a second device, adds nothing.
 */
export async function importLegacyHistory(): Promise<ImportOutcome | null> {
  if (await readMarker()) return null

  const record = await readLegacyRecord()
  if (!record) return null

  if (!record.jobs.length) {
    // Nothing to move, but there is no reason to look again either.
    await set(MARKER_KEY, { importedAt: Date.now(), imported: 0 }).catch(() => undefined)
    return null
  }

  let imported = 0
  let skipped = 0
  let projectName = ''

  // Oldest first, so the gallery's order matches the order they were made.
  const ordered = [...record.jobs].sort((a, b) => a.createdAt - b.createdAt)

  for (let i = 0; i < ordered.length; i += CHUNK) {
    const res = await fetch('/api/jobs/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: ordered.slice(i, i + CHUNK) }),
    })

    if (!res.ok) {
      // No marker is written, so this is retried on the next load rather than
      // leaving half the history stranded in a browser.
      return imported ? { imported, skipped, projectName, draft: record.draft } : null
    }

    const data = (await res.json()) as {
      imported: number
      skipped: number
      projectName: string
    }
    imported += data.imported
    skipped += data.skipped
    projectName = data.projectName
  }

  await set(MARKER_KEY, { importedAt: Date.now(), imported }).catch(() => undefined)

  // The old record is deliberately left in place. It costs a few megabytes
  // and it is the only copy of anything the server refused.
  return { imported, skipped, projectName, draft: record.draft }
}
