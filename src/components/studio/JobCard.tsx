'use client'

import {
  AlertCircle,
  Download,
  FolderInput,
  Heart,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { jobLabel, type Job } from '@/lib/jobs/types'
import { formatCredits, creditsToUsd, formatUsd } from '@/lib/kie/pricing'
import { colorOf } from '@/lib/projects/colors'
import { cn, proxied, timeAgo, truncate } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import { AssetView } from './AssetView'
import { stripMarkdown } from './Markdown'

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
  const renameJob = useStudio((s) => s.renameJob)
  const moveJob = useStudio((s) => s.moveJob)
  const projects = useStudio((s) => s.projects)

  const [menuOpen, setMenuOpen] = useState(false)
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

  const commitRename = () => {
    setRenaming(false)
    const next = draft.trim()
    // An emptied field means "go back to the prompt", not "name it nothing".
    if (next !== (job.title ?? '')) void renameJob(job.id, next || null)
  }

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
              className="grid size-6 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-danger"
            >
              <X className="size-3.5" />
            </button>
          )}

          {job.state === 'success' && (
            <button
              type="button"
              onClick={() => void toggleFavorite(job.id)}
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
              onClick={() => {
                setMenuOpen((v) => !v)
                setMovingOpen(false)
              }}
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
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
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
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger transition-colors hover:bg-raised"
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
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
    >
      {children}
    </button>
  )
}
