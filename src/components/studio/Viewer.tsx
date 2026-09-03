'use client'

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Heart,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { getModel } from '@/lib/kie/catalog'
import { cn, formatDuration, proxied } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import type { Job } from '@/store/types'
import { AssetView } from './AssetView'

interface ViewerProps {
  job: Job
  onClose: () => void
}

/** Full-screen result viewer with the run's parameters alongside. */
export function Viewer({ job, onClose }: ViewerProps) {
  const [index, setIndex] = useState(0)
  const toggleFavorite = useStudio((s) => s.toggleFavorite)
  const restoreJob = useStudio((s) => s.restoreJob)
  const removeJob = useStudio((s) => s.removeJob)

  const asset = job.assets[index]
  const model = getModel(job.modelId)
  const many = job.assets.length > 1

  const step = useCallback(
    (delta: number) =>
      setIndex((i) => (i + delta + job.assets.length) % job.assets.length),
    [job.assets.length],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (many && e.key === 'ArrowRight') step(1)
      if (many && e.key === 'ArrowLeft') step(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [many, onClose, step])

  // Lock background scroll while the overlay is open.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const copyPrompt = () => {
    const text = job.promptPreview || ''
    if (!text) return
    void navigator.clipboard.writeText(text)
    toast.success('Prompt copied')
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-void/95 backdrop-blur-xl">
      <header className="rule flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{job.modelName}</p>
          <p className="truncate text-[11px] text-ink-faint">
            {model?.family}
            {job.costTimeMs ? ` · ${formatDuration(job.costTimeMs)}` : ''}
            {job.creditsConsumed ? ` · ${job.creditsConsumed} credits` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {job.state === 'success' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toggleFavorite(job.id)}
              aria-label={job.favorite ? 'Unpin' : 'Pin to library'}
            >
              <Heart
                className={cn('size-4', job.favorite && 'fill-accent text-accent')}
              />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              restoreJob(job.id)
              onClose()
            }}
          >
            <RefreshCw className="size-4" />
            Reuse
          </Button>
          {asset && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                window.location.href = proxied(asset.url, {
                  download: true,
                  filename: `highfield-${job.id}-${index + 1}`,
                })
              }}
            >
              <Download className="size-4" />
              Download
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
          {asset ? (
            <AssetView asset={asset} fit="contain" controls className="max-h-full" />
          ) : job.text ? (
            <pre className="max-h-full overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-surface p-5 font-mono text-[13px] leading-relaxed text-ink-muted">
              {job.text}
            </pre>
          ) : (
            <p className="text-sm text-ink-faint">{job.error ?? 'Nothing to show.'}</p>
          )}

          {many && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous"
                className="absolute left-4 grid size-10 place-items-center rounded-full border border-line bg-surface/80 text-ink backdrop-blur transition-colors hover:border-line-bright"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next"
                className="absolute right-4 grid size-10 place-items-center rounded-full border border-line bg-surface/80 text-ink backdrop-blur transition-colors hover:border-line-bright"
              >
                <ChevronRight className="size-5" />
              </button>
              <span className="absolute bottom-4 rounded-full bg-surface/80 px-3 py-1 text-[11px] tabular-nums text-ink-muted backdrop-blur">
                {index + 1} / {job.assets.length}
              </span>
            </>
          )}
        </div>

        <aside className="w-full shrink-0 overflow-y-auto border-t border-line p-4 lg:w-80 lg:border-l lg:border-t-0">
          {job.promptPreview && (
            <section className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                  Prompt
                </h2>
                <button
                  type="button"
                  onClick={copyPrompt}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-faint transition-colors hover:bg-overlay hover:text-ink"
                >
                  <Copy className="size-3" />
                  Copy
                </button>
              </div>
              <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface p-3 text-[13px] leading-relaxed text-ink-muted">
                {job.promptPreview}
              </p>
            </section>
          )}

          <section className="mb-5">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              Parameters
            </h2>
            <dl className="space-y-1.5 rounded-xl border border-line bg-surface p-3">
              {model?.fields
                .filter((f) => {
                  const v = job.values[f.name]
                  if (f.name === 'prompt' || f.name === 'text') return false
                  if (v === '' || v == null) return false
                  if (Array.isArray(v) && !v.length) return false
                  return true
                })
                .map((f) => {
                  const v = job.values[f.name]
                  const display = Array.isArray(v)
                    ? `${v.length} file${v.length > 1 ? 's' : ''}`
                    : typeof v === 'boolean'
                      ? v
                        ? 'On'
                        : 'Off'
                      : String(v)
                  return (
                    <div key={f.name} className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-[11px] text-ink-faint">{f.label}</dt>
                      <dd className="truncate text-right text-[12px] text-ink-muted">
                        {display}
                      </dd>
                    </div>
                  )
                })}
              {job.taskId && (
                <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2">
                  <dt className="shrink-0 text-[11px] text-ink-faint">Task ID</dt>
                  <dd className="truncate text-right font-mono text-[10px] text-ink-faint">
                    {job.taskId}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {many && (
            <section className="mb-5">
              <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                Outputs
              </h2>
              <div className="grid grid-cols-4 gap-1.5">
                {job.assets.map((a, i) => (
                  <button
                    key={a.url}
                    type="button"
                    onClick={() => setIndex(i)}
                    className={cn(
                      'checkerboard aspect-square overflow-hidden rounded-lg border transition-colors',
                      i === index ? 'border-accent' : 'border-line hover:border-line-bright',
                    )}
                  >
                    <AssetView asset={a} />
                  </button>
                ))}
              </div>
            </section>
          )}

          <Button
            variant="danger"
            size="sm"
            className="w-full"
            onClick={() => {
              removeJob(job.id)
              onClose()
            }}
          >
            <Trash2 className="size-3.5" />
            Delete from history
          </Button>
        </aside>
      </div>
    </div>
  )
}
