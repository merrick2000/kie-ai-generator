'use client'

import { Check, ChevronDown, FolderOpen, Layers, Plus, Settings2 } from 'lucide-react'
import type { Project } from '@/lib/projects/store'
import { useEffect, useRef, useState } from 'react'

import { colorOf } from '@/lib/projects/colors'
import { cn } from '@/lib/utils'
import { selectActiveProject, useStudio } from '@/store/studio'
import { ProjectDialog } from './ProjectDialog'

/**
 * Which project the studio is working in.
 *
 * The active project does two jobs at once: it scopes the gallery, and it is
 * where new runs are filed. Keeping those together is what makes switching
 * feel like changing context rather than applying a filter.
 */
export function ProjectSwitcher() {
  const projects = useStudio((s) => s.projects)
  const counts = useStudio((s) => s.counts)
  const active = useStudio(selectActiveProject)
  const activeId = useStudio((s) => s.activeProjectId)
  const setActiveProject = useStudio((s) => s.setActiveProject)

  const [open, setOpen] = useState(false)
  // Null while closed. 'new' creates one; a project opens its settings, which
  // is where renaming, defaults and duplication live.
  const [editing, setEditing] = useState<'new' | Project | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const allRunning = Object.values(counts).reduce((n, c) => n + c.running, 0)

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex h-8 max-w-[220px] items-center gap-2 rounded-lg border border-line bg-raised pl-2 pr-1.5 text-[12px] transition-colors',
          'hover:border-line-bright',
          open && 'border-accent',
        )}
      >
        {active ? (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: colorOf(active.color) }}
            aria-hidden
          />
        ) : (
          <Layers className="size-3.5 shrink-0 text-ink-faint" />
        )}
        <span className="truncate font-medium text-ink">
          {active?.name ?? 'All work'}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-ink-faint transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="animate-rise absolute left-0 top-[calc(100%+6px)] z-50 w-72 overflow-hidden rounded-2xl border border-line-bright bg-surface shadow-2xl shadow-black/60">
          <div className="max-h-[min(50vh,360px)] overflow-y-auto p-1.5">
            <Row
              label="All work"
              hint={allRunning ? `${allRunning} running` : undefined}
              selected={activeId === null}
              icon={<Layers className="size-3.5 text-ink-faint" />}
              onClick={() => {
                setActiveProject(null)
                setOpen(false)
              }}
            />

            {projects.length > 0 && (
              <p className="px-2.5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                Projects
              </p>
            )}

            {projects.map((project) => {
              const count = counts[project.id]
              return (
                <Row
                  key={project.id}
                  label={project.name}
                  hint={
                    count?.running
                      ? `${count.running} running`
                      : count?.runs
                        ? `${count.runs}`
                        : undefined
                  }
                  selected={activeId === project.id}
                  icon={
                    <span
                      className="size-2 rounded-full"
                      style={{ background: colorOf(project.color) }}
                      aria-hidden
                    />
                  }
                  onClick={() => {
                    setActiveProject(project.id)
                    setOpen(false)
                  }}
                  // On the row itself, so renaming a project does not mean
                  // switching into it first.
                  onEdit={() => {
                    setEditing(project)
                    setOpen(false)
                  }}
                />
              )
            })}
          </div>

          <div className="border-t border-line p-1.5">
            <button
              type="button"
              onClick={() => {
                setEditing('new')
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Plus className="size-3.5" />
              New project
            </button>
          </div>
        </div>
      )}

      {editing && (
        <ProjectDialog
          project={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

interface RowProps {
  label: string
  hint?: string
  selected: boolean
  icon: React.ReactNode
  onClick: () => void
  /** Present on real projects, absent on "All work". */
  onEdit?: () => void
}

function Row({ label, hint, selected, icon, onClick, onEdit }: RowProps) {
  return (
    // A div rather than a button, because the settings control is itself a
    // button and one cannot be nested inside another.
    <div
      className={cn(
        'flex items-center gap-1 rounded-lg pr-1 transition-colors',
        selected ? 'bg-overlay' : 'hover:bg-raised',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-2.5 text-left sm:py-2"
      >
        <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{label}</span>
        {hint && (
          <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{hint}</span>
        )}
        {selected && <Check className="size-3.5 shrink-0 text-accent" />}
      </button>

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Settings for ${label}`}
          title="Rename, defaults, duplicate"
          // Always visible, not revealed on hover. A control you have to
          // discover by waving the mouse at a row is a control nobody finds,
          // and `text-ink-faint` is already quiet enough not to shout.
          className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink sm:size-7"
        >
          <Settings2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** Shown in the gallery when a project is open, so context is never implicit. */
export function ProjectBanner() {
  const active = useStudio(selectActiveProject)
  if (!active?.description && !active?.settings.brief) return null

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5">
      <FolderOpen
        className="mt-0.5 size-3.5 shrink-0"
        style={{ color: colorOf(active.color) }}
      />
      <p className="min-w-0 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-muted">
        {active.settings.brief || active.description}
      </p>
    </div>
  )
}
