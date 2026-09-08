'use client'

import {
  ChevronDown,
  Columns2,
  ImageIcon,
  Loader2,
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { CATEGORIES, type ModelCategory } from '@/lib/kie/catalog'
import { useGeneration } from '@/hooks/useGeneration'
import { cn } from '@/lib/utils'
import {
  comparedJobs,
  selectActiveCount,
  selectFocusedJob,
  useStudio,
  type GallerySort,
  type GalleryStatus,
} from '@/store/studio'
import { CompareView } from './CompareView'
import { JobCard } from './JobCard'
import { ProjectBanner } from './ProjectSwitcher'
import { Viewer } from './Viewer'

const STATUSES: { value: GalleryStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Done' },
  { value: 'fail', label: 'Failed' },
]

const SORTS: { value: GallerySort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'cost', label: 'Most expensive' },
]

/** Typing should not fire a query per keystroke. */
const SEARCH_DEBOUNCE_MS = 280

/**
 * Two columns on a phone, then as many as fit.
 *
 * `auto-fill` alone gives one enormous card on a 390px screen, because the
 * 200px minimum leaves no room for a second. Two smaller thumbnails are more
 * useful than one big one when the point is scanning what you have made.
 */
/** Below this many results, saying "all N shown" is noise rather than news. */
const PAGE_HINT = 24

const GRID =
  'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]'

interface CanvasProps {
  /** Whether the composer pane is showing. */
  composerOpen: boolean
  onOpenComposer: () => void
  /**
   * False on a phone, where the composer is reached from a button of its own
   * rather than from the corner of this toolbar.
   */
  showComposerButton: boolean
}

/** The results area: everything this account has made, searchable. */
export function Canvas({
  composerOpen,
  onOpenComposer,
  showComposerButton,
}: CanvasProps) {
  const jobs = useStudio((s) => s.jobs)
  const filters = useStudio((s) => s.filters)
  const setFilter = useStudio((s) => s.setFilter)
  const clearFilters = useStudio((s) => s.clearFilters)
  const focusJob = useStudio((s) => s.focusJob)
  const focused = useStudio(selectFocusedJob)
  const clearHistory = useStudio((s) => s.clearHistory)
  const hydrated = useStudio((s) => s.hydrated)
  const loading = useStudio((s) => s.loading)
  const loadingMore = useStudio((s) => s.loadingMore)
  const hasMore = useStudio((s) => s.hasMore)
  const loadMore = useStudio((s) => s.loadMore)
  const total = useStudio((s) => s.total)

  /*
   * Loads the next page when the end of the list comes into view.
   *
   * The button below stays: an observer that never fires, because the browser
   * restored a scroll position past it or the list is shorter than the
   * viewport, would otherwise leave no way forward at all.
   */
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      // Fires a screenful early, so the next page is usually already there by
      // the time the bottom is reached.
      { rootMargin: '600px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadMore, jobs.length])
  const running = useStudio(selectActiveCount)

  const selectedIds = useStudio((s) => s.selectedJobIds)
  // Derived here rather than in a selector: a selector that builds an array
  // gives Zustand a new snapshot every render and the page stops responding.
  const compared = useMemo(() => comparedJobs(jobs, selectedIds), [jobs, selectedIds])
  const comparing = useStudio((s) => s.comparing)
  const toggleSelected = useStudio((s) => s.toggleSelected)
  const selectJobs = useStudio((s) => s.selectJobs)
  const clearSelection = useStudio((s) => s.clearSelection)
  const setComparing = useStudio((s) => s.setComparing)

  const { cancel } = useGeneration()

  const [showFilters, setShowFilters] = useState(false)
  // Local, so the input stays responsive while the query is in flight.
  const [search, setSearch] = useState(filters.search)

  useEffect(() => {
    if (search === filters.search) return
    const id = setTimeout(() => setFilter({ search }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [search, filters.search, setFilter])

  const narrowed =
    filters.category !== 'all' ||
    filters.status !== 'all' ||
    filters.favoriteOnly ||
    filters.sort !== 'newest' ||
    Boolean(filters.search)

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="rule flex shrink-0 flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
        {showComposerButton && !composerOpen && (
          <button
            type="button"
            onClick={onOpenComposer}
            aria-label="Show the composer"
            className="order-first grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-raised text-ink-faint transition-colors hover:border-line-bright hover:text-ink"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        )}

        {/*
          A full row of its own on a phone. Sharing one row with the filter
          button, the count and Clear left it 121px wide, which is not a field
          anyone can type a prompt fragment into.
        */}
        <label className="order-first flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 transition-colors focus-within:border-accent sm:order-none sm:h-8 sm:w-auto sm:max-w-xs sm:flex-1">
          <Search className="size-3.5 shrink-0 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts, names, models…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="shrink-0 text-ink-faint transition-colors hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors',
            narrowed
              ? 'border-accent/40 bg-accent-glow text-accent'
              : 'border-line bg-raised text-ink-muted hover:border-line-bright hover:text-ink',
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          Filters
        </button>

        <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
          {loading && !jobs.length ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <>
              {/*
                The filter's total, not how much of it has been fetched.
                Saying "120 results" over a history of three hundred reads as
                a number that is wrong rather than a page that is partial.
              */}
              {Math.max(total, jobs.length).toLocaleString()} result
              {Math.max(total, jobs.length) === 1 ? '' : 's'}
              {running > 0 && <span className="text-accent"> · {running} running</span>}
            </>
          )}
        </span>

        <span className="flex-1" />

        {jobs.length > 0 && selectedIds.length === 0 && (
          <Button
            size="sm"
            variant="ghost"
            title="Pick the four most recent results to compare"
            onClick={() => selectJobs(jobs.slice(0, 4).map((j) => j.id))}
          >
            <Columns2 className="size-3.5" />
            Compare
          </Button>
        )}

        {jobs.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void clearHistory()}
            title="Delete finished, unpinned results. Running jobs and pinned ones stay."
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        )}
      </div>

      {showFilters && (
        <div className="rule flex shrink-0 flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
          <Chip
            active={filters.category === 'all'}
            onClick={() => setFilter({ category: 'all' })}
          >
            Everything
          </Chip>
          {CATEGORIES.map((category) => (
            <Chip
              key={category.id}
              active={filters.category === category.id}
              onClick={() => setFilter({ category: category.id as ModelCategory })}
            >
              {category.label}
            </Chip>
          ))}

          <span className="mx-1 h-4 w-px bg-line" aria-hidden />

          {STATUSES.map((status) => (
            <Chip
              key={status.value}
              active={filters.status === status.value}
              onClick={() => setFilter({ status: status.value })}
            >
              {status.label}
            </Chip>
          ))}

          <span className="mx-1 h-4 w-px bg-line" aria-hidden />

          <Chip
            active={filters.favoriteOnly}
            onClick={() => setFilter({ favoriteOnly: !filters.favoriteOnly })}
          >
            Pinned only
          </Chip>

          {/* The native chevron sits at its own size and makes the control
              taller than the chips beside it, so it is drawn here instead. */}
          <div className="relative">
            <select
              value={filters.sort}
              onChange={(e) => setFilter({ sort: e.target.value as GallerySort })}
              aria-label="Sort results"
              className="h-7 appearance-none rounded-lg bg-raised pl-2.5 pr-7 text-[12px] font-medium text-ink-faint transition-colors hover:bg-overlay hover:text-ink focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>
                  {sort.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
          </div>

          {narrowed && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                clearFilters()
              }}
              className="text-[12px] text-ink-faint underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              Reset
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24 sm:p-4 sm:pb-4">
        <ProjectBanner />

        {!hydrated ? (
          <div className={GRID}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton aspect-square rounded-2xl" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState narrowed={narrowed} />
        ) : (
          <>
            <div className={GRID}>
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onOpen={() => focusJob(job.id)}
                  onCancel={cancel}
                  selecting={selectedIds.length > 0}
                  selected={selectedIds.includes(job.id)}
                  onToggleSelected={() => toggleSelected(job.id)}
                />
              ))}
            </div>

            {/* The history is one long list rather than numbered pages: it is
                read by scrolling back through it, and a page number is a
                worse answer to "where was that thing from last week". */}
            <div ref={sentinel} className="mt-4 flex flex-col items-center gap-2">
              {hasMore && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={loadingMore}
                  onClick={() => void loadMore()}
                >
                  Load older results
                </Button>
              )}

              {total > jobs.length ? (
                <p className="text-[11px] tabular-nums text-ink-faint">
                  {jobs.length.toLocaleString()} of {total.toLocaleString()}
                </p>
              ) : (
                jobs.length > PAGE_HINT && (
                  <p className="text-[11px] tabular-nums text-ink-faint">
                    All {jobs.length.toLocaleString()} shown
                  </p>
                )
              )}
            </div>
          </>
        )}
      </div>

      {/*
        A bar rather than a permanent toolbar: selection is a mode people
        enter for a moment and leave, and a control that is always there for
        something rarely done is clutter.
      */}
      {selectedIds.length > 0 && !comparing && (
        <div className="animate-rise pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-line-bright bg-overlay/95 py-1.5 pl-4 pr-1.5 shadow-2xl shadow-black/50 backdrop-blur">
            <span className="text-[12px] tabular-nums text-ink">
              {selectedIds.length} selected
            </span>

            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              className="rounded-full"
            >
              Clear
            </Button>

            <Button
              size="sm"
              variant="primary"
              className="rounded-full"
              disabled={selectedIds.length < 2}
              title={
                selectedIds.length < 2
                  ? 'Pick at least two to compare them'
                  : 'Side by side, at matching size'
              }
              onClick={() => setComparing(true)}
            >
              <Columns2 className="size-3.5" />
              Compare
            </Button>
          </div>
        </div>
      )}

      {comparing && compared.length > 0 && (
        <CompareView jobs={compared} onClose={() => setComparing(false)} />
      )}

      {focused && <Viewer job={focused} onClose={() => focusJob(null)} />}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-7 shrink-0 rounded-lg px-2.5 text-[12px] font-medium transition-colors',
        active
          ? 'bg-accent text-black'
          : 'bg-raised text-ink-faint hover:bg-overlay hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function EmptyState({ narrowed }: { narrowed: boolean }) {
  const { title, body } = narrowed
    ? {
        title: 'Nothing matches',
        body: 'Try a different search, or reset the filters to see everything again.',
      }
    : {
        title: 'Nothing generated yet',
        // Deliberately not "on the left": on a phone the composer is a sheet
        // reached from the Create button, and there is no left.
        body: 'Pick a model, describe what you want, and hit Generate.',
      }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="grid size-12 place-items-center rounded-2xl border border-line bg-surface">
        <ImageIcon className="size-5 text-ink-faint" />
      </div>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-ink-faint">{body}</p>
      </div>
    </div>
  )
}
