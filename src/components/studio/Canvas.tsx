'use client'

import { ImageIcon, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { useGeneration } from '@/hooks/useGeneration'
import { useStudio, selectFocusedJob } from '@/store/studio'
import { JobCard } from './JobCard'
import { Viewer } from './Viewer'

type Filter = 'all' | 'running' | 'done' | 'pinned'

/** The results area: a filterable grid of every generation this session. */
export function Canvas() {
  const jobs = useStudio((s) => s.jobs)
  const focusJob = useStudio((s) => s.focusJob)
  const focused = useStudio(selectFocusedJob)
  const clearHistory = useStudio((s) => s.clearHistory)
  const hydrated = useStudio((s) => s.hydrated)
  const { cancel } = useGeneration()

  const [filter, setFilter] = useState<Filter>('all')

  const visible = useMemo(() => {
    switch (filter) {
      case 'running':
        return jobs.filter((j) => j.state !== 'success' && j.state !== 'fail')
      case 'done':
        return jobs.filter((j) => j.state === 'success')
      case 'pinned':
        return jobs.filter((j) => j.favorite)
      default:
        return jobs
    }
  }, [filter, jobs])

  const runningCount = jobs.filter(
    (j) => j.state !== 'success' && j.state !== 'fail',
  ).length

  return (
    <div className="flex h-full flex-col">
      <div className="rule flex shrink-0 items-center justify-between gap-3 px-4 py-2.5">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All${jobs.length ? ` ${jobs.length}` : ''}` },
            { value: 'running', label: `Running${runningCount ? ` ${runningCount}` : ''}` },
            { value: 'done', label: 'Done' },
            { value: 'pinned', label: 'Pinned' },
          ]}
          className="w-auto"
        />

        {jobs.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={clearHistory}
            title="Clear everything except pinned results"
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!hydrated && jobs.length === 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton aspect-square rounded-2xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {visible.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onOpen={() => focusJob(job.id)}
                onCancel={cancel}
              />
            ))}
          </div>
        )}
      </div>

      {focused && <Viewer job={focused} onClose={() => focusJob(null)} />}
    </div>
  )
}

function EmptyState({ filter }: { filter: Filter }) {
  const copy: Record<Filter, { title: string; body: string }> = {
    all: {
      title: 'Nothing generated yet',
      body: 'Pick a model on the left, describe what you want, and hit Generate.',
    },
    running: {
      title: 'No active generations',
      body: 'Jobs appear here while they queue and render.',
    },
    done: {
      title: 'No finished results',
      body: 'Completed generations collect here.',
    },
    pinned: {
      title: 'Nothing pinned',
      body: 'Pin a result to keep it when you clear history.',
    },
  }

  const { title, body } = copy[filter]

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
