'use client'

import { Download, Heart, RotateCw, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { jobLabel, type Job } from '@/lib/jobs/types'
import { creditsToUsd, formatCredits, formatUsd } from '@/lib/kie/pricing'
import { cn, formatDuration, proxied } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import { AssetView } from './AssetView'
import { Markdown } from './Markdown'

interface CompareViewProps {
  jobs: Job[]
  onClose: () => void
}

/**
 * Several results at once, at the same size.
 *
 * The gallery is for finding things; this is for choosing between them. Four
 * variations of one prompt differ in ways a grid hides, because a grid puts
 * them at arm's length from each other and never at matching size.
 *
 * Everything here acts on one result: keep it, run it again, download it,
 * throw it away. Judging a set and then having to go back to the grid to act
 * on the winner would defeat the point.
 */
export function CompareView({ jobs, onClose }: CompareViewProps) {
  const toggleFavorite = useStudio((s) => s.toggleFavorite)
  const removeJob = useStudio((s) => s.removeJob)
  const rerunJob = useStudio((s) => s.rerunJob)
  const toggleSelected = useStudio((s) => s.toggleSelected)

  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // Two side by side is the useful minimum; past four the tiles are too small
  // to judge anything, so they wrap onto a second row instead.
  const columns =
    jobs.length <= 1 ? 1 : jobs.length === 2 ? 2 : jobs.length <= 4 ? 2 : 3

  // The whole set has to be on screen at once. Tiles at a fixed aspect ratio
  // pushed four of them past the fold, which turns a comparison back into
  // scrolling past one picture at a time.
  const rows = Math.ceil(jobs.length / columns)
  const tileHeight = `calc((100dvh - 11rem) / ${rows})`

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-void/95 backdrop-blur-xl">
      <header className="rule flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            Comparing {jobs.length} result{jobs.length === 1 ? '' : 's'}
          </p>
          <p className="truncate text-[11px] text-ink-faint">
            Keep the one you want, run another, or drop the rest.
          </p>
        </div>

        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div
          className="grid gap-3 sm:gap-4"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {jobs.map((job) => {
            const asset = job.assets[0]

            return (
              <figure
                key={job.id}
                className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface"
              >
                <div
                  className="checkerboard relative flex min-h-[140px] items-center justify-center"
                  style={{ height: tileHeight }}
                >
                  {asset ? (
                    <AssetView asset={asset} fit="contain" controls className="max-h-full" />
                  ) : job.text ? (
                    <div className="max-h-full w-full overflow-y-auto p-4">
                      <Markdown className="text-[13px]">{job.text}</Markdown>
                    </div>
                  ) : (
                    <p className="px-6 text-center text-[12px] text-ink-faint">
                      {job.error ?? 'Nothing to show.'}
                    </p>
                  )}
                </div>

                <figcaption className="flex items-start gap-2 border-t border-line p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-ink">{jobLabel(job)}</p>
                    <p className="mt-0.5 truncate text-[10px] text-ink-faint">
                      {job.modelName}
                      {/* The seed is the whole reason two of these differ. */}
                      {typeof job.values.seed === 'number'
                        ? ` · seed ${job.values.seed}`
                        : ''}
                      {job.costTimeMs ? ` · ${formatDuration(job.costTimeMs)}` : ''}
                      {job.creditsConsumed
                        ? ` · ${formatCredits(job.creditsConsumed)} cr ${formatUsd(creditsToUsd(job.creditsConsumed))}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => void toggleFavorite(job.id)}
                      aria-label={job.favorite ? 'Unpin' : 'Keep this one'}
                      className={cn(
                        'grid size-7 place-items-center rounded-lg transition-colors hover:bg-overlay',
                        job.favorite ? 'text-accent' : 'text-ink-faint hover:text-ink',
                      )}
                    >
                      <Heart className={cn('size-3.5', job.favorite && 'fill-current')} />
                    </button>

                    <button
                      type="button"
                      disabled={busy === job.id}
                      onClick={async () => {
                        setBusy(job.id)
                        try {
                          await rerunJob(job.id)
                        } finally {
                          setBusy(null)
                        }
                      }}
                      aria-label="Run again"
                      title="Another attempt from these settings"
                      className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink disabled:opacity-50"
                    >
                      <RotateCw className={cn('size-3.5', busy === job.id && 'animate-spin')} />
                    </button>

                    {asset && (
                      <a
                        href={proxied(asset.url, {
                          download: true,
                          filename: `highfield-${job.id}`,
                        })}
                        aria-label="Download"
                        className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink"
                      >
                        <Download className="size-3.5" />
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        // Out of the comparison as well as the gallery, or the
                        // tile would linger with nothing behind it.
                        toggleSelected(job.id)
                        void removeJob(job.id)
                      }}
                      aria-label="Delete"
                      className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </figcaption>
              </figure>
            )
          })}
        </div>
      </div>
    </div>
  )
}
