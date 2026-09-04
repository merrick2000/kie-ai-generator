'use client'

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerUpRight,
  Download,
  Heart,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { getModel } from '@/lib/kie/catalog'
import { useReuseAsset, modelsAccepting } from '@/hooks/useReuseAsset'
import { formatCost } from '@/lib/kie/pricing'
import { cn, formatDuration, proxied } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import { jobLabel, type Job } from '@/lib/jobs/types'
import { AssetView } from './AssetView'
import { Markdown } from './Markdown'

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
  const renameJob = useStudio((s) => s.renameJob)
  const { reuse, working: reusing } = useReuseAsset()

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  const asset = job.assets[index]
  const model = getModel(job.modelId)
  const many = job.assets.length > 1

  /**
   * The settings worth showing back.
   *
   * Computed rather than filtered inline, because the section is hidden
   * entirely when it would be empty: a run with nothing but a prompt used to
   * render an empty box under a heading.
   */
  const parameters = useMemo(() => {
    if (!model) return []

    return model.fields.flatMap((field) => {
      const value = job.values[field.name]

      if (field.name === 'prompt' || field.name === 'text') return []
      if (value === '' || value == null) return []
      if (Array.isArray(value) && !value.length) return []

      const display = Array.isArray(value)
        ? `${value.length} file${value.length > 1 ? 's' : ''}`
        : typeof value === 'boolean'
          ? value
            ? 'On'
            : 'Off'
          : String(value)

      return [{ name: field.name, label: field.label, value: display }]
    })
  }, [model, job.values])

  const step = useCallback(
    (delta: number) =>
      setIndex((i) => (i + delta + job.assets.length) % job.assets.length),
    [job.assets.length],
  )

  useEffect(() => {
    if (renaming) nameRef.current?.select()
  }, [renaming])

  const commitRename = () => {
    setRenaming(false)
    const next = draft.trim()
    // Emptying the field restores the prompt as the label rather than
    // leaving the result nameless.
    if (next !== (job.title ?? '')) void renameJob(job.id, next || null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the name field has focus, Escape belongs to it.
      if (e.key === 'Escape' && renaming) return
      if (e.key === 'Escape') onClose()
      if (many && e.key === 'ArrowRight') step(1)
      if (many && e.key === 'ArrowLeft') step(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [many, onClose, step, renaming])

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

  const copyAnswer = () => {
    if (!job.text) return
    void navigator.clipboard.writeText(job.text)
    toast.success('Answer copied')
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-void/95 backdrop-blur-xl">
      <header className="rule flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          {renaming ? (
            <input
              ref={nameRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
              placeholder="Name this result"
              className="w-full max-w-md rounded border border-accent bg-raised px-1.5 py-0.5 text-sm text-ink focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(job.title ?? job.promptPreview.slice(0, 80))
                setRenaming(true)
              }}
              title="Rename"
              className="group flex max-w-full items-center gap-1.5"
            >
              <span className="truncate text-sm font-medium text-ink">
                {jobLabel(job)}
              </span>
              <Pencil className="size-3 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <p className="truncate text-[11px] text-ink-faint">
            {job.modelName}
            {model?.family ? ` · ${model.family}` : ''}
            {job.costTimeMs ? ` · ${formatDuration(job.costTimeMs)}` : ''}
            {job.creditsConsumed ? ` · ${formatCost(job.creditsConsumed)}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {job.state === 'success' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void toggleFavorite(job.id)}
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
            title="Load these settings back into the composer"
          >
            <RefreshCw className="size-4" />
            Settings
          </Button>

          {/*
            Chains this result into the next generation. Kie re-hosts it from
            its own URL, so the file never travels through the browser.
          */}
          {asset && modelsAccepting(asset.kind).length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              loading={reusing}
              onClick={async () => {
                if (await reuse(asset)) onClose()
              }}
              title="Use this result as a reference for a new generation"
            >
              {!reusing && <CornerUpRight className="size-4" />}
              Use as input
            </Button>
          )}
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
        <div
          className={cn(
            'relative flex min-h-0 flex-1 justify-center p-4',
            // An image is centred in whatever space it has. A page of prose
            // is not: it should start at the top and use the full height,
            // the way anything you read does.
            asset ? 'items-center' : 'items-stretch',
          )}
        >
          {asset ? (
            <AssetView asset={asset} fit="contain" controls className="max-h-full" />
          ) : job.text ? (
            // A language model's answer is prose, not a code block: readable
            // measure, real line height, and one obvious way to take it away.
            <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="rule flex shrink-0 items-center justify-between gap-3 px-4 py-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                  Answer
                </span>
                <div className="flex items-center gap-3 text-[11px] text-ink-faint">
                  <span className="tabular-nums">
                    {job.text.length.toLocaleString()} characters
                  </span>
                  <button
                    type="button"
                    onClick={copyAnswer}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-overlay hover:text-ink"
                  >
                    <Copy className="size-3" />
                    Copy
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {/* Models answer in markdown whether or not you ask them to,
                    so it is rendered rather than shown as its own source. */}
                <Markdown>{job.text}</Markdown>
              </div>
            </div>
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

          {(parameters.length > 0 || job.taskId) && (
            <section className="mb-5">
              <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                Parameters
              </h2>
              <dl className="space-y-1.5 rounded-xl border border-line bg-surface p-3">
                {parameters.map((row) => (
                  <div
                    key={row.name}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <dt className="shrink-0 text-[11px] text-ink-faint">{row.label}</dt>
                    <dd className="truncate text-right text-[12px] text-ink-muted">
                      {row.value}
                    </dd>
                  </div>
                ))}

                {job.taskId && (
                  <div
                    className={cn(
                      'flex items-baseline justify-between gap-3',
                      parameters.length > 0 && 'mt-2 border-t border-line pt-2',
                    )}
                  >
                    <dt className="shrink-0 text-[11px] text-ink-faint">Task ID</dt>
                    <dd className="truncate text-right font-mono text-[10px] text-ink-faint">
                      {job.taskId}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

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
              void removeJob(job.id)
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
