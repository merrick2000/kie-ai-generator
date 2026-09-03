'use client'

import {
  AlertCircle,
  Download,
  Heart,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'

import { cn, proxied, timeAgo, truncate } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import type { Job } from '@/store/types'
import { AssetView } from './AssetView'

interface JobCardProps {
  job: Job
  onOpen: () => void
  onCancel?: (id: string) => void
}

const STATE_LABEL: Record<Job['state'], string> = {
  waiting: 'Queued',
  queuing: 'Queued',
  generating: 'Generating',
  success: 'Done',
  fail: 'Failed',
}

export function JobCard({ job, onOpen, onCancel }: JobCardProps) {
  const removeJob = useStudio((s) => s.removeJob)
  const toggleFavorite = useStudio((s) => s.toggleFavorite)
  const restoreJob = useStudio((s) => s.restoreJob)
  const [menuOpen, setMenuOpen] = useState(false)

  const running = job.state !== 'success' && job.state !== 'fail'
  const primary = job.assets[0]
  const extra = job.assets.length - 1

  return (
    <div
      className={cn(
        'group animate-rise relative overflow-hidden rounded-2xl border border-line bg-surface transition-colors',
        'hover:border-line-bright',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!primary && !job.text}
        className="checkerboard relative block aspect-square w-full overflow-hidden disabled:cursor-default"
      >
        {primary ? (
          <AssetView asset={primary} hoverPlay />
        ) : job.state === 'fail' ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-raised px-5 text-center">
            <AlertCircle className="size-5 text-danger" />
            <p className="text-[11px] leading-relaxed text-ink-faint">
              {truncate(job.error ?? 'Generation failed.', 110)}
            </p>
          </div>
        ) : (
          <div className="skeleton flex size-full flex-col items-center justify-center gap-3">
            <div className="relative grid size-9 place-items-center">
              <span className="animate-pulse-ring absolute inset-0 rounded-full" />
              <span className="size-2 rounded-full bg-accent" />
            </div>
            <p className="text-[11px] font-medium text-ink-muted">
              {STATE_LABEL[job.state]}
            </p>
          </div>
        )}

        {extra > 0 && (
          <span className="absolute bottom-2 right-2 rounded-lg bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            +{extra}
          </span>
        )}

        {running && (
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-line">
            <span
              className="block h-full bg-accent transition-[width] duration-700 ease-out"
              style={{ width: `${job.progress}%` }}
            />
          </span>
        )}
      </button>

      <div className="flex items-start gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-ink">
            {job.promptPreview || job.modelName}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-ink-faint">
            {job.modelName} · {timeAgo(job.createdAt)}
            {job.creditsConsumed ? ` · ${job.creditsConsumed} cr` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {running && onCancel && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              aria-label="Stop tracking"
              title="Stop tracking"
              className="grid size-6 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-danger"
            >
              <X className="size-3.5" />
            </button>
          )}

          {job.state === 'success' && (
            <button
              type="button"
              onClick={() => toggleFavorite(job.id)}
              aria-label={job.favorite ? 'Unpin' : 'Pin to library'}
              className={cn(
                'grid size-6 place-items-center rounded-lg transition-colors hover:bg-overlay',
                job.favorite ? 'text-accent' : 'text-ink-faint hover:text-ink',
              )}
            >
              <Heart className={cn('size-3.5', job.favorite && 'fill-current')} />
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More actions"
              className="grid size-6 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink"
            >
              <MoreHorizontal className="size-3.5" />
            </button>

            {menuOpen && (
              <>
                {/* Click-away layer; keeps the menu logic free of listeners. */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                  aria-hidden
                />
                <div className="animate-rise absolute bottom-full right-0 z-50 mb-1 w-40 overflow-hidden rounded-xl border border-line-bright bg-overlay py-1 shadow-2xl shadow-black/60">
                  <button
                    type="button"
                    onClick={() => {
                      restoreJob(job.id)
                      setMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
                  >
                    <RefreshCw className="size-3.5" />
                    Reuse settings
                  </button>

                  {primary && (
                    <a
                      href={proxied(primary.url, {
                        download: true,
                        filename: `highfield-${job.id}`,
                      })}
                      onClick={() => setMenuOpen(false)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
                    >
                      <Download className="size-3.5" />
                      Download
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      removeJob(job.id)
                      setMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger transition-colors hover:bg-raised"
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
