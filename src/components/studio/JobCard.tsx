'use client'

import {
  AlertCircle,
  Check,
  Download,
  FolderInput,
  Heart,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCw,
  StepForward,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { getModel } from '@/lib/kie/catalog'
import { jobLabel, type Job } from '@/lib/jobs/types'
import { formatCredits, creditsToUsd, formatUsd } from '@/lib/kie/pricing'
import { colorOf } from '@/lib/projects/colors'
import { cn, proxied, timeAgo, truncate } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import { AssetView } from './AssetView'
import { ExtendDialog } from './ExtendDialog'
import { stripMarkdown } from './Markdown'

interface JobCardProps {
  job: Job
  onOpen: () => void
  onCancel?: (id: string) => void
  /** True once anything is selected, which is when the boxes stay visible. */
  selecting: boolean
  selected: boolean
  onToggleSelected: () => void
}

const STATE_LABEL: Record<Job['state'], string> = {
  waiting: 'Queued',
  queuing: 'Queued',
  generating: 'Generating',
  success: 'Done',
  fail: 'Failed',
}

export function JobCard({
  job,
  onOpen,
  onCancel,
  selecting,
  selected,
  onToggleSelected,
}: JobCardProps) {
  const removeJob = useStudio((s) => s.removeJob)
  const toggleFavorite = useStudio((s) => s.toggleFavorite)
  const restoreJob = useStudio((s) => s.restoreJob)
  const renameJob = useStudio((s) => s.renameJob)
  const moveJob = useStudio((s) => s.moveJob)
  const rerunJob = useStudio((s) => s.rerunJob)
  const [extending, setExtending] = useState(false)

  /*
   * Only a finished run that Kie still has a task for can be continued. An
   * imported result has the video but no task id, so the button would open a
   * dialog whose only possible outcome is a refusal.
   */
  const canExtend =
    job.state === 'success' &&
    Boolean(job.taskId) &&
    Boolean(getModel(job.modelId)?.extend)
  const projects = useStudio((s) => s.projects)

  const [menuOpen, setMenuOpen] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [movingOpen, setMovingOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  const running = job.state !== 'success' && job.state !== 'fail'
  const primary = job.assets[0]
  const extra = job.assets.length - 1
  const label = jobLabel(job)

  const startRename = () => {
    setDraft(job.title ?? job.promptPreview.slice(0, 80))
    setRenaming(true)
    setMenuOpen(false)
  }

  const runAgain = async () => {
    setRerunning(true)
    try {
      const next = await rerunJob(job.id)
      if (next) {
        toast.success('Running again', {
          description: 'Same settings, a different seed.',
        })
      }
    } finally {
      setRerunning(false)
    }
  }

  const commitRename = () => {
    setRenaming(false)
    const next = draft.trim()
    // An emptied field means "go back to the prompt", not "name it nothing".
    if (next !== (job.title ?? '')) void renameJob(job.id, next || null)
  }

  return (
    <div
      className={cn(
        'group animate-rise relative overflow-hidden rounded-2xl border bg-surface transition-colors',
        selected ? 'border-accent' : 'border-line hover:border-line-bright',
      )}
    >
      {/*
        The checkbox sits above the thumbnail rather than inside its button,
        so picking results to compare never opens one by accident.
      */}
      <button
        type="button"
        onClick={onToggleSelected}
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? 'Remove from comparison' : 'Add to comparison'}
        className={cn(
          'absolute left-2 top-2 z-10 grid size-6 place-items-center rounded-md border transition-all',
          selected
            ? 'border-accent bg-accent text-black'
            : 'border-line-bright bg-void/70 text-transparent backdrop-blur hover:border-ink-faint',
          // Out of the way until there is a reason for it.
          selecting || selected
            ? 'opacity-100'
            : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
        )}
      >
        <Check className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={onOpen}
        disabled={!primary && !job.text && job.state !== 'fail'}
        className="checkerboard relative block aspect-square w-full overflow-hidden disabled:cursor-default"
      >
        {primary ? (
          <AssetView asset={primary} hoverPlay />
        ) : job.text ? (
          // A language model's result has no thumbnail, so the opening of the
          // answer is the thumbnail. Markers are stripped rather than
          // rendered: headings and bullets at this size are noise, but
          // leaving `###` and `**` in the preview is worse.
          <div className="flex size-full flex-col gap-2 bg-raised p-3 text-left">
            <Type className="size-3.5 shrink-0 text-ink-faint" />
            <p className="line-clamp-[9] whitespace-pre-wrap text-[11px] leading-relaxed text-ink-muted">
              {stripMarkdown(job.text)}
            </p>
          </div>
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
          {renaming ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
              placeholder="Name this result"
              className="w-full rounded border border-accent bg-raised px-1 py-0.5 text-[12px] text-ink focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onDoubleClick={startRename}
              onClick={onOpen}
              title={job.title ? `${job.title}\n${job.promptPreview}` : job.promptPreview}
              className="flex w-full items-center gap-1 text-left"
            >
              <span className="truncate text-[12px] text-ink">{label}</span>
              <Pencil
                className="size-2.5 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </button>
          )}

          <p className="mt-0.5 truncate text-[10px] text-ink-faint">
            {job.modelName} · {timeAgo(job.createdAt)}
            {job.creditsConsumed
              ? ` · ${formatCredits(job.creditsConsumed)} cr ${formatUsd(creditsToUsd(job.creditsConsumed))}`
              : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {running && onCancel && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              aria-label="Remove from the gallery"
              title="Remove from the gallery. The task still runs on kie.ai."
              className="grid size-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-danger sm:size-6"
            >
              <X className="size-3.5" />
            </button>
          )}

          {(job.state === 'success' || job.state === 'fail') && (
            <button
              type="button"
              onClick={() => void runAgain()}
              disabled={rerunning}
              aria-label="Run again"
              title="Run again with the same settings and a new seed"
              className="grid size-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink disabled:opacity-50 sm:size-6"
            >
              <RotateCw className={cn('size-3.5', rerunning && 'animate-spin')} />
            </button>
          )}

          {canExtend && (
            <button
              type="button"
              onClick={() => setExtending(true)}
              aria-label="Extend"
              title="Continue this clip past the length one generation allows"
              className="grid size-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink sm:size-6"
            >
              <StepForward className="size-3.5" />
            </button>
          )}

          {job.state === 'success' && (
            <button
              type="button"
              onClick={() => void toggleFavorite(job.id)}
              aria-label={job.favorite ? 'Unpin' : 'Pin to library'}
              className={cn(
                // Bigger on touch. 24px is a fine mouse target and a poor
                // thumb one, and these sit side by side on a card.
                'grid size-8 place-items-center rounded-lg transition-colors hover:bg-overlay sm:size-6',
                job.favorite ? 'text-accent' : 'text-ink-faint hover:text-ink',
              )}
            >
              <Heart className={cn('size-3.5', job.favorite && 'fill-current')} />
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMenuOpen((v) => !v)
                setMovingOpen(false)
              }}
              aria-label="More actions"
              className="grid size-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink sm:size-6"
            >
              <MoreHorizontal className="size-3.5" />
            </button>

            {menuOpen && (
              <>
                {/* Click-away layer; keeps the menu logic free of listeners. */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => {
                    setMenuOpen(false)
                    setMovingOpen(false)
                  }}
                  aria-hidden
                />
                <div className="animate-rise absolute bottom-full right-0 z-50 mb-1 w-48 overflow-hidden rounded-xl border border-line-bright bg-overlay py-1 shadow-2xl shadow-black/60">
                  {movingOpen ? (
                    <>
                      <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                        Move to
                      </p>
                      <MenuItem
                        onClick={() => {
                          void moveJob(job.id, null)
                          setMenuOpen(false)
                        }}
                      >
                        <span className="size-2 rounded-full bg-line-bright" aria-hidden />
                        No project
                      </MenuItem>
                      {projects.map((project) => (
                        <MenuItem
                          key={project.id}
                          onClick={() => {
                            void moveJob(job.id, project.id)
                            setMenuOpen(false)
                          }}
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ background: colorOf(project.color) }}
                            aria-hidden
                          />
                          <span className="truncate">{project.name}</span>
                        </MenuItem>
                      ))}
                      {projects.length === 0 && (
                        <p className="px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
                          No projects yet. Create one from the switcher above.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <MenuItem onClick={startRename}>
                        <Pencil className="size-3.5" />
                        Rename
                      </MenuItem>

                      <MenuItem
                        onClick={() => {
                          restoreJob(job.id)
                          setMenuOpen(false)
                        }}
                      >
                        <RefreshCw className="size-3.5" />
                        Reuse settings
                      </MenuItem>

                      <MenuItem onClick={() => setMovingOpen(true)}>
                        <FolderInput className="size-3.5" />
                        Move to project
                      </MenuItem>

                      {primary && (
                        <a
                          href={proxied(primary.url, {
                            download: true,
                            filename: `highfield-${job.id}`,
                          })}
                          onClick={() => setMenuOpen(false)}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] text-ink-muted transition-colors hover:bg-raised hover:text-ink sm:py-1.5"
                        >
                          <Download className="size-3.5" />
                          Download
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          void removeJob(job.id)
                          setMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] text-danger transition-colors hover:bg-raised sm:py-1.5"
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {extending && (
        <ExtendDialog job={job} onClose={() => setExtending(false)} />
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] text-ink-muted transition-colors hover:bg-raised hover:text-ink sm:py-1.5"
    >
      {children}
    </button>
  )
}
