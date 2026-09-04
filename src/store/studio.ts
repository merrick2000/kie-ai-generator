'use client'

/**
 * Studio state.
 *
 * The jobs here are a view of what the server holds, not the record itself.
 * That inversion is the point: generations used to live in IndexedDB, owned
 * by the tab that started them, so a reload abandoned anything in flight and
 * the credits already spent went with it. Now the server owns the lifecycle
 * and this store mirrors it.
 *
 * What still lives locally is what only makes sense locally: the model in the
 * composer, the half-filled form beside it, and which project is open.
 */

import { del, get, set } from 'idb-keyval'
import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

import { DEFAULT_MODEL_ID, getModel, type ModelCategory } from '@/lib/kie/catalog'
import { defaultsFor } from '@/lib/kie/fields'
import type { ModelCost } from '@/lib/kie/pricing'
import type { Job } from '@/lib/jobs/types'
import type { ModelUsage, UsageTotals } from '@/lib/jobs/store'
import type { Project, ProjectSettings } from '@/lib/projects/store'

const idbStorage: StateStorage = {
  getItem: async (name) => (await get<string>(name)) ?? null,
  setItem: async (name, value) => set(name, value),
  removeItem: async (name) => del(name),
}

export type GalleryStatus = 'all' | 'running' | 'success' | 'fail'
export type GallerySort = 'newest' | 'oldest' | 'cost'

export interface Filters {
  search: string
  category: ModelCategory | 'all'
  status: GalleryStatus
  favoriteOnly: boolean
  sort: GallerySort
}

export const DEFAULT_FILTERS: Filters = {
  search: '',
  category: 'all',
  status: 'all',
  favoriteOnly: false,
  sort: 'newest',
}

export type ProjectCounts = Record<
  string,
  { runs: number; running: number; credits: number }
>

/** How many jobs one page of the gallery holds. */
const PAGE_SIZE = 120

interface StudioState {
  /* Composer */
  modelId: string
  /** Form values, keyed by model id, so switching models is non-destructive. */
  formsByModel: Record<string, Record<string, unknown>>

  /* Workspace */
  projects: Project[]
  counts: ProjectCounts
  /** null is "All work": the gallery shows everything, new runs stay unfiled. */
  activeProjectId: string | null

  /* Gallery */
  jobs: Job[]
  filters: Filters
  focusedJobId: string | null
  loading: boolean
  /** True while an extra page is on its way. */
  loadingMore: boolean
  /** Whether the server has more beyond what is on screen. */
  hasMore: boolean
  hydrated: boolean
  /** Newest `updatedAt` seen, so the sync loop can ask for only what changed. */
  syncedAt: number

  /**
   * Every finished result, regardless of what the gallery is filtered to.
   *
   * The reference picker draws on it, and it must not go empty because a
   * search is active or a project is open: a reference is chosen from
   * everything you have made, not from what happens to be on screen.
   */
  library: Job[]

  /* Usage */
  usage: ModelUsage[]
  totals: UsageTotals | null

  selectModel: (modelId: string) => void
  setValue: (name: string, value: unknown) => void
  setValues: (values: Record<string, unknown>) => void
  resetForm: () => void
  currentValues: () => Record<string, unknown>

  setFilter: (patch: Partial<Filters>) => void
  clearFilters: () => void
  setActiveProject: (id: string | null) => void

  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  sync: () => Promise<void>
  loadProjects: () => Promise<void>
  loadUsage: () => Promise<void>
  loadLibrary: () => Promise<void>

  createProject: (input: {
    name: string
    description?: string
    color?: string
  }) => Promise<Project | null>
  updateProject: (
    id: string,
    patch: {
      name?: string
      description?: string | null
      color?: string | null
      settings?: ProjectSettings
      archived?: boolean
    },
  ) => Promise<void>
  deleteProject: (id: string) => Promise<void>

  renameJob: (id: string, title: string | null) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  moveJob: (id: string, projectId: string | null) => Promise<void>
  removeJob: (id: string) => Promise<void>
  /** Defaults to the open project; 'all' sweeps the whole account. */
  clearHistory: (scope?: 'project' | 'all') => Promise<void>

  focusJob: (id: string | null) => void
  /** Load a past job's settings back into the composer. */
  restoreJob: (id: string) => void
}

function initialValues(modelId: string): Record<string, unknown> {
  const model = getModel(modelId)
  return model ? defaultsFor(model.fields) : {}
}

/** Query string for the gallery's current view. */
function galleryQuery(state: StudioState, offset = 0): string {
  const params = new URLSearchParams({
    // One more than a page, so the answer itself says whether there is
    // another page rather than needing a second count query.
    limit: String(PAGE_SIZE + 1),
    counts: offset ? 'false' : 'true',
  })

  if (offset) params.set('offset', String(offset))

  if (state.activeProjectId) params.set('projectId', state.activeProjectId)
  if (state.filters.category !== 'all') params.set('category', state.filters.category)
  if (state.filters.status !== 'all') params.set('status', state.filters.status)
  if (state.filters.favoriteOnly) params.set('favorite', 'true')
  if (state.filters.search.trim()) params.set('search', state.filters.search.trim())
  if (state.filters.sort !== 'newest') params.set('sort', state.filters.sort)

  return params.toString()
}

/** Merge changed jobs into the list, keeping its order. */
function mergeJobs(current: Job[], changed: Job[]): Job[] {
  if (!changed.length) return current

  const byId = new Map(changed.map((job) => [job.id, job]))
  return current.map((job) => byId.get(job.id) ?? job)
}

export const useStudio = create<StudioState>()(
  persist(
    (setState, getState) => ({
      modelId: DEFAULT_MODEL_ID,
      formsByModel: { [DEFAULT_MODEL_ID]: initialValues(DEFAULT_MODEL_ID) },

      projects: [],
      counts: {},
      activeProjectId: null,

      jobs: [],
      library: [],
      filters: DEFAULT_FILTERS,
      focusedJobId: null,
      loading: false,
      loadingMore: false,
      hasMore: false,
      hydrated: false,
      syncedAt: 0,

      usage: [],
      totals: null,

      /* ── Composer ───────────────────────────────────────────────────── */

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

      /* ── View ───────────────────────────────────────────────────────── */

      setFilter: (patch) => {
        setState((s) => ({ filters: { ...s.filters, ...patch } }))
        void getState().refresh()
      },

      clearFilters: () => {
        setState({ filters: DEFAULT_FILTERS })
        void getState().refresh()
      },

      setActiveProject: (id) => {
        setState({ activeProjectId: id, focusedJobId: null })

        // A project can pre-select the model it is usually worked in, which is
        // most of what makes switching to one feel like changing context.
        const project = getState().projects.find((p) => p.id === id)
        const preferred = project?.settings.modelId
        if (preferred && getModel(preferred)) getState().selectModel(preferred)

        void getState().refresh()
      },

      /* ── Server sync ────────────────────────────────────────────────── */

      refresh: async () => {
        setState({ loading: true })
        try {
          const res = await fetch(`/api/jobs?${galleryQuery(getState())}`, {
            cache: 'no-store',
          })
          if (!res.ok) return

          const data = (await res.json()) as {
            jobs: Job[]
            counts?: ProjectCounts
            syncedAt: number
          }

          setState((s) => ({
            jobs: data.jobs.slice(0, PAGE_SIZE),
            hasMore: data.jobs.length > PAGE_SIZE,
            counts: data.counts ?? s.counts,
            // Never move the mark backwards. A filtered read can return an
            // older newest-row than an unfiltered sync already saw, and
            // rewinding would replay changes that were already applied.
            syncedAt: Math.max(s.syncedAt, data.syncedAt),
            hydrated: true,
          }))
        } catch {
          // Offline or mid-deploy. The next tick tries again, and the list
          // that is already on screen stays usable.
        } finally {
          setState({ loading: false })
        }
      },

      /**
       * Fetch the next page and append it.
       *
       * The gallery is one long list rather than numbered pages: history is
       * read by scrolling back through it, and a page number is a worse
       * answer to "where was that thing from last week" than simply
       * continuing.
       */
      loadMore: async () => {
        const state = getState()
        if (state.loadingMore || !state.hasMore) return

        setState({ loadingMore: true })
        try {
          const res = await fetch(
            `/api/jobs?${galleryQuery(state, state.jobs.length)}`,
            { cache: 'no-store' },
          )
          if (!res.ok) return

          const data = (await res.json()) as { jobs: Job[] }

          setState((s) => {
            // Guards against a job arriving twice when something was inserted
            // between the two reads and shifted the offset.
            const known = new Set(s.jobs.map((job) => job.id))
            const added = data.jobs
              .slice(0, PAGE_SIZE)
              .filter((job) => !known.has(job.id))

            return { jobs: [...s.jobs, ...added], hasMore: data.jobs.length > PAGE_SIZE }
          })
        } catch {
          // The button stays, so this is retried by pressing it again.
        } finally {
          setState({ loadingMore: false })
        }
      },

      /**
       * Pull only what changed.
       *
       * Runs on a short interval while anything is generating, so it has to
       * stay cheap: usually the answer is an empty list, and at most it is
       * the handful of jobs currently moving.
       */
      sync: async () => {
        const { syncedAt } = getState()
        if (!syncedAt) return getState().refresh()

        try {
          const res = await fetch(`/api/jobs?updatedSince=${syncedAt}&limit=100`, {
            cache: 'no-store',
          })
          if (!res.ok) return

          const data = (await res.json()) as { jobs: Job[]; syncedAt: number }
          if (!data.jobs.length) return

          const known = new Set(getState().jobs.map((job) => job.id))
          const unknown = data.jobs.some((job) => !known.has(job.id))

          // A job this view has never seen may or may not belong in it, and
          // deciding that here would mean reimplementing the server's filter
          // in the browser. Asking again is cheaper than getting it wrong.
          if (unknown) {
            await getState().refresh()
            return
          }

          setState((s) => ({
            jobs: mergeJobs(s.jobs, data.jobs),
            syncedAt: Math.max(s.syncedAt, data.syncedAt),
          }))

          // A run that just finished changes what the model has cost, and a
          // successful one adds something the reference picker can use.
          if (data.jobs.some((job) => job.state === 'success' || job.state === 'fail')) {
            void getState().loadUsage()
          }
          if (data.jobs.some((job) => job.state === 'success')) {
            void getState().loadLibrary()
          }
        } catch {
          // Same as refresh: a failed tick is not worth surfacing.
        }
      },

      loadProjects: async () => {
        try {
          const res = await fetch('/api/projects', { cache: 'no-store' })
          if (!res.ok) return
          const data = (await res.json()) as { projects: Project[]; counts: ProjectCounts }
          setState({ projects: data.projects, counts: data.counts })
        } catch {
          // Non-fatal: the studio works without the project list.
        }
      },

      loadLibrary: async () => {
        try {
          const res = await fetch('/api/jobs?status=success&limit=300', {
            cache: 'no-store',
          })
          if (!res.ok) return
          const data = (await res.json()) as { jobs: Job[] }
          setState({ library: data.jobs })
        } catch {
          // The picker falls back to uploading, which always works.
        }
      },

      loadUsage: async () => {
        try {
          const res = await fetch('/api/stats/models', { cache: 'no-store' })
          if (!res.ok) return
          const data = (await res.json()) as { models: ModelUsage[]; totals: UsageTotals }
          setState({ usage: data.models, totals: data.totals })
        } catch {
          // Statistics are an aid, never a dependency.
        }
      },

      /* ── Projects ───────────────────────────────────────────────────── */

      createProject: async (input) => {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        if (!res.ok) return null

        const { project } = (await res.json()) as { project: Project }
        setState((s) => ({ projects: [project, ...s.projects] }))
        return project
      },

      updateProject: async (id, patch) => {
        const res = await fetch(`/api/projects/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) return

        const { project } = (await res.json()) as { project: Project }
        setState((s) => ({
          projects: s.projects.map((p) => (p.id === project.id ? project : p)),
        }))
      },

      deleteProject: async (id) => {
        const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
        if (!res.ok) return

        setState((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
        }))
        // The work it held is now unfiled rather than gone, so the gallery
        // has to be re-read to show it in its new place.
        await getState().refresh()
      },

      /* ── Jobs ───────────────────────────────────────────────────────── */

      renameJob: async (id, title) => {
        // Applied locally first: a rename that waits for a round trip feels
        // like the field ignored you.
        setState((s) => ({
          jobs: s.jobs.map((j) => (j.id === id ? { ...j, title } : j)),
        }))
        await fetch(`/api/jobs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        }).catch(() => undefined)
      },

      toggleFavorite: async (id) => {
        const job = getState().jobs.find((j) => j.id === id)
        if (!job) return

        const favorite = !job.favorite
        setState((s) => ({
          jobs: s.jobs.map((j) => (j.id === id ? { ...j, favorite } : j)),
        }))

        await fetch(`/api/jobs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favorite }),
        }).catch(() => undefined)
      },

      moveJob: async (id, projectId) => {
        await fetch(`/api/jobs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        }).catch(() => undefined)

        // Moving a job may take it out of the current view, so the list is
        // re-read rather than patched in place.
        await getState().refresh()
        void getState().loadProjects()
      },

      removeJob: async (id) => {
        setState((s) => ({
          jobs: s.jobs.filter((j) => j.id !== id),
          focusedJobId: s.focusedJobId === id ? null : s.focusedJobId,
        }))
        await fetch(`/api/jobs/${id}`, { method: 'DELETE' }).catch(() => undefined)
        void getState().loadProjects()
      },

      clearHistory: async (scope = 'project') => {
        const { activeProjectId } = getState()
        const target = scope === 'all' ? null : activeProjectId
        const query = target ? `?projectId=${target}` : ''
        await fetch(`/api/jobs${query}`, { method: 'DELETE' }).catch(() => undefined)
        await getState().refresh()
        void getState().loadProjects()
      },

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
      // Only the things that are genuinely local. Jobs are deliberately
      // absent: persisting them would recreate the stale-copy problem this
      // rewrite exists to remove.
      partialize: (s) => ({
        modelId: s.modelId,
        formsByModel: s.formsByModel,
        activeProjectId: s.activeProjectId,
        filters: s.filters,
      }),
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

export const selectActiveProject = (s: StudioState) =>
  s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null

/** How many generations are still in flight. A count, not the list. */
export const selectActiveCount = (s: StudioState) =>
  s.jobs.reduce(
    (total, job) => (job.state !== 'success' && job.state !== 'fail' ? total + 1 : total),
    0,
  )

/** Credits charged across every job in the current view. */
export const selectSpentCredits = (s: StudioState) =>
  s.jobs.reduce((total, job) => total + (job.creditsConsumed ?? 0), 0)

/**
 * What a model has actually charged here, in the shape the pricing helpers
 * expect. Measured, so it always beats a published estimate.
 */
export function costFromUsage(usage: ModelUsage | undefined): ModelCost | undefined {
  if (!usage || !usage.credits || !usage.succeeded) return undefined

  return {
    averageCredits: usage.credits / usage.succeeded,
    minCredits: usage.minCredits ?? usage.credits / usage.succeeded,
    maxCredits: usage.maxCredits ?? usage.credits / usage.succeeded,
    samples: usage.succeeded,
    lastSeenAt: usage.lastUsedAt,
  }
}
