import type { ModelApi } from '@/lib/kie/catalog'
import type { NormalizedTask, TaskAsset } from '@/lib/kie/tasks'
import type { KieTaskState } from '@/lib/kie/types'

/** A generation as the studio tracks it, from submission to archive. */
export interface Job {
  id: string
  taskId: string | null
  api: ModelApi
  modelId: string
  modelName: string
  /** Snapshot of the form at submit time, so a job can be re-run or restored. */
  values: Record<string, unknown>
  /** Denormalized for list rendering without a catalog lookup. */
  promptPreview: string
  output: 'image' | 'video' | 'audio' | 'text'
  state: KieTaskState
  progress: number
  assets: TaskAsset[]
  text?: string
  error?: string
  createdAt: number
  completedAt?: number
  costTimeMs?: number | null
  creditsConsumed?: number | null
  /** Set when the user pins a result to the library. */
  favorite?: boolean
}

export function jobFromTask(job: Job, task: NormalizedTask): Job {
  return {
    ...job,
    taskId: task.taskId || job.taskId,
    state: task.state,
    progress: task.progress,
    assets: task.assets.length ? task.assets : job.assets,
    text: task.text ?? job.text,
    error: task.error,
    costTimeMs: task.costTimeMs ?? job.costTimeMs,
    creditsConsumed: task.creditsConsumed ?? job.creditsConsumed,
    completedAt:
      task.state === 'success' || task.state === 'fail'
        ? (task.completedAt ?? Date.now())
        : job.completedAt,
  }
}
