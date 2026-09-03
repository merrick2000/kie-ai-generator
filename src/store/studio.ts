'use client'

/**
 * Studio state.
 *
 * Jobs are persisted to IndexedDB rather than localStorage: a busy session
 * accumulates hundreds of records with long prompts, which outgrows the 5MB
 * localStorage ceiling.
 */

import { del, get, set } from 'idb-keyval'
import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

import { DEFAULT_MODEL_ID, getModel } from '@/lib/kie/catalog'
import { defaultsFor } from '@/lib/kie/fields'
import { recordCost, type ModelCost } from '@/lib/kie/pricing'
import type { NormalizedTask } from '@/lib/kie/tasks'
import { uid } from '@/lib/utils'
import { jobFromTask, type Job } from './types'

const idbStorage: StateStorage = {
  getItem: async (name) => (await get<string>(name)) ?? null,
  setItem: async (name, value) => set(name, value),
  removeItem: async (name) => del(name),
}

/** Cap history so IndexedDB does not grow without bound. */
const MAX_JOBS = 300

interface StudioState {
  modelId: string
  /** Form values, keyed by model id, so switching models is non-destructive. */
  formsByModel: Record<string, Record<string, unknown>>
  jobs: Job[]
  /** Job currently open in the viewer, or null for the grid. */
  focusedJobId: string | null
  hydrated: boolean
  /**
   * What each model has actually charged, keyed by model id.
   *
   * Learned from completed jobs rather than hardcoded: Kie publishes no
   * per-model price through the API, and a stale table would quote numbers
   * that are quietly wrong.
   */
  costByModel: Record<string, ModelCost>

  selectModel: (modelId: string) => void
  setValue: (name: string, value: unknown) => void
  setValues: (values: Record<string, unknown>) => void
  resetForm: () => void
  currentValues: () => Record<string, unknown>

  addJob: (job: Omit<Job, 'id' | 'createdAt'>) => Job
  updateJob: (id: string, patch: Partial<Job>) => void
  applyTask: (id: string, task: NormalizedTask) => void
  failJob: (id: string, error: string) => void
  removeJob: (id: string) => void
  toggleFavorite: (id: string) => void
  clearHistory: () => void

  focusJob: (id: string | null) => void
  /** Load a past job's settings back into the composer. */
  restoreJob: (id: string) => void
}

function initialValues(modelId: string): Record<string, unknown> {
  const model = getModel(modelId)
  return model ? defaultsFor(model.fields) : {}
}

export const useStudio = create<StudioState>()(
  persist(
    (setState, getState) => ({
      modelId: DEFAULT_MODEL_ID,
      formsByModel: { [DEFAULT_MODEL_ID]: initialValues(DEFAULT_MODEL_ID) },
      jobs: [],
      focusedJobId: null,
      hydrated: false,
      costByModel: {},

      selectModel: (modelId) =>
        setState((s) => ({
          modelId,
          formsByModel: s.formsByModel[modelId]
            ? s.formsByModel
            : { ...s.formsByModel, [modelId]: initialValues(modelId) },
        })),

      setValue: (name, value) =>
        setState((s) => ({
          formsByModel: {
            ...s.formsByModel,
            [s.modelId]: { ...(s.formsByModel[s.modelId] ?? {}), [name]: value },
          },
        })),

      setValues: (values) =>
        setState((s) => ({
          formsByModel: {
            ...s.formsByModel,
            [s.modelId]: { ...(s.formsByModel[s.modelId] ?? {}), ...values },
          },
        })),

      resetForm: () =>
        setState((s) => ({
          formsByModel: { ...s.formsByModel, [s.modelId]: initialValues(s.modelId) },
        })),

      currentValues: () => {
        const s = getState()
        return s.formsByModel[s.modelId] ?? initialValues(s.modelId)
      },

      addJob: (partial) => {
        const job: Job = { ...partial, id: uid(), createdAt: Date.now() }
        setState((s) => ({ jobs: [job, ...s.jobs].slice(0, MAX_JOBS) }))
        return job
      },

      updateJob: (id, patch) =>
        setState((s) => ({
          jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
        })),

      applyTask: (id, task) =>
        setState((s) => {
          const jobs = s.jobs.map((j) => (j.id === id ? jobFromTask(j, task) : j))

          // Only a successful run with a reported charge teaches us anything.
          const job = jobs.find((j) => j.id === id)
          const credits = task.creditsConsumed
          if (!job || task.state !== 'success' || !credits || credits <= 0) {
            return { jobs }
          }

          return {
            jobs,
            costByModel: {
              ...s.costByModel,
              [job.modelId]: recordCost(s.costByModel[job.modelId], credits),
            },
          }
        }),

      failJob: (id, error) =>
        setState((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id ? { ...j, state: 'fail', progress: 100, error, completedAt: Date.now() } : j,
          ),
        })),

      removeJob: (id) =>
        setState((s) => ({
          jobs: s.jobs.filter((j) => j.id !== id),
          focusedJobId: s.focusedJobId === id ? null : s.focusedJobId,
        })),

      toggleFavorite: (id) =>
        setState((s) => ({
          jobs: s.jobs.map((j) => (j.id === id ? { ...j, favorite: !j.favorite } : j)),
        })),

      // Favorites are the user's explicit "keep this" signal, so a clear
      // sweeps everything else and leaves them.
      clearHistory: () =>
        setState((s) => ({ jobs: s.jobs.filter((j) => j.favorite), focusedJobId: null })),

      focusJob: (id) => setState({ focusedJobId: id }),

      restoreJob: (id) => {
        const job = getState().jobs.find((j) => j.id === id)
        if (!job) return
        setState((s) => ({
          modelId: job.modelId,
          formsByModel: { ...s.formsByModel, [job.modelId]: { ...job.values } },
          focusedJobId: null,
        }))
      },
    }),
    {
      name: 'highfield-studio',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({
        modelId: s.modelId,
        formsByModel: s.formsByModel,
        jobs: s.jobs,
        costByModel: s.costByModel,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // A job left mid-flight by a reload can never resume: the poller is
        // gone. Mark it failed rather than leaving a permanent spinner.
        state.jobs = state.jobs.map((j) =>
          j.state === 'waiting' || j.state === 'queuing' || j.state === 'generating'
            ? { ...j, state: 'fail' as const, error: 'Interrupted by a page reload.', progress: 100 }
            : j,
        )
        state.hydrated = true
      },
    },
  ),
)

/**
 * Selector helpers, kept out of components to avoid re-render churn.
 *
 * Each returns a stored reference or a primitive. A selector that builds a
 * new array or object per call hands Zustand a different snapshot every
 * render, which React reports as "Maximum update depth exceeded".
 */
export const selectFocusedJob = (s: StudioState) =>
  s.focusedJobId ? (s.jobs.find((j) => j.id === s.focusedJobId) ?? null) : null

/** Credits charged across every completed job still in history. */
export const selectSpentCredits = (s: StudioState) =>
  s.jobs.reduce((total, job) => total + (job.creditsConsumed ?? 0), 0)

/** How many generations are still in flight. A count, not the list. */
export const selectActiveCount = (s: StudioState) =>
  s.jobs.reduce(
    (total, job) => (job.state !== 'success' && job.state !== 'fail' ? total + 1 : total),
    0,
  )
