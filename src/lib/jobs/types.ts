/**
 * The shape a generation has everywhere: database row, API payload, store
 * entry, rendered card.
 *
 * Deliberately free of `server-only`, since the browser holds the same
 * objects the server sends. Nothing secret belongs in here.
 */

import type { ModelCategory } from '@/lib/kie/catalog'
import type { TaskAsset } from '@/lib/kie/tasks'
import type { KieTaskState } from '@/lib/kie/types'

export type JobApi = 'market' | 'veo' | 'suno' | 'chat'

export interface Job {
  id: string
  projectId: string | null
  /** Null until the upstream accepts it, and always null for chat models. */
  taskId: string | null
  api: JobApi
  /** The model the user picked, which owns the history entry. */
  modelId: string
  /** What was actually submitted, when a reference routed it elsewhere. */
  submittedModelId: string | null
  modelName: string
  category: ModelCategory
  output: 'image' | 'video' | 'audio' | 'text'
  /** User-given name. Falls back to the prompt in listings. */
  title: string | null
  promptPreview: string
  /** Snapshot of the form at submit time, so a run can be repeated. */
  values: Record<string, unknown>
  state: KieTaskState
  progress: number
  assets: TaskAsset[]
  text: string | null
  error: string | null
  favorite: boolean
  creditsConsumed: number | null
  costTimeMs: number | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

/** True while the job is still expected to change. */
export function isRunning(job: Pick<Job, 'state'>): boolean {
  return job.state !== 'success' && job.state !== 'fail'
}

/** What a listing shows as the job's name. */
export function jobLabel(job: Pick<Job, 'title' | 'promptPreview' | 'modelName'>): string {
  return job.title?.trim() || job.promptPreview.trim() || job.modelName
}
