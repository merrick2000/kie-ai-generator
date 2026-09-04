'use client'

import { Copy, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { FieldShell, inputClass } from '@/components/ui/Field'
import { getModel } from '@/lib/kie/catalog'
import { PROJECT_COLORS, colorOf, type ProjectColor } from '@/lib/projects/colors'
import type { Project } from '@/lib/projects/store'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import { ModelPicker } from './ModelPicker'

interface ProjectDialogProps {
  /** Null creates a new one. */
  project: Project | null
  onClose: () => void
}

/**
 * Create or configure a project.
 *
 * The defaults are the reason projects exist rather than being tags: a brief,
 * a house style appended to every prompt, the model this kind of work is
 * usually done in. Without them a folder only tells you where something went,
 * not how to make the next one match.
 */
export function ProjectDialog({ project, onClose }: ProjectDialogProps) {
  const createProject = useStudio((s) => s.createProject)
  const updateProject = useStudio((s) => s.updateProject)
  const duplicateProject = useStudio((s) => s.duplicateProject)
  const deleteProject = useStudio((s) => s.deleteProject)
  const setActiveProject = useStudio((s) => s.setActiveProject)
  const counts = useStudio((s) => s.counts)

  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [color, setColor] = useState<string>(project?.color ?? 'amber')
  const [brief, setBrief] = useState(project?.settings.brief ?? '')
  const [prefix, setPrefix] = useState(project?.settings.promptPrefix ?? '')
  const [suffix, setSuffix] = useState(project?.settings.promptSuffix ?? '')
  const [modelId, setModelId] = useState(project?.settings.modelId ?? '')
  const [saving, setSaving] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const held = project ? (counts[project.id]?.runs ?? 0) : 0

  const duplicate = async (withJobs: boolean) => {
    if (!project) return

    setDuplicating(true)
    try {
      const result = await duplicateProject(project.id, { withJobs })
      if (!result) {
        toast.error('Could not duplicate the project.')
        return
      }

      setActiveProject(result.project.id)
      toast.success(`Duplicated as ${result.project.name}`, {
        description: withJobs
          ? `${result.copiedJobs} result${result.copiedJobs === 1 ? '' : 's'} copied across. Now working in it.`
          : 'The defaults came across, the work did not. Now working in it.',
      })
      onClose()
    } finally {
      setDuplicating(false)
    }
  }

  const save = async () => {
    if (!name.trim()) {
      toast.error('Give the project a name.')
      return
    }

    setSaving(true)
    try {
      const settings = {
        brief: brief.trim(),
        promptPrefix: prefix.trim(),
        promptSuffix: suffix.trim(),
        modelId: modelId.trim(),
      }

      if (project) {
        await updateProject(project.id, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          settings,
        })
        toast.success('Project updated')
      } else {
        const created = await createProject({
          name: name.trim(),
          description: description.trim(),
          color,
        })
        if (!created) {
          toast.error('Could not create the project.')
          return
        }
        // Saved in two steps so the defaults land on a project that exists.
        await updateProject(created.id, { settings })
        setActiveProject(created.id)
        toast.success('Project created', { description: `Now working in ${created.name}.` })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!project) return
    await deleteProject(project.id)
    toast.success('Project deleted', {
      description: 'Everything it held moved to All work rather than being removed.',
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-void/80 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={project ? 'Project settings' : 'New project'}
        className="animate-rise relative flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line-bright bg-surface shadow-2xl shadow-black/60"
      >
        <header className="rule flex shrink-0 items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-ink">
              {project ? project.name : 'New project'}
            </h2>
            {project && (
              <p className="mt-0.5 text-[12px] text-ink-faint">
                Rename it, change its defaults, duplicate or delete it.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <FieldShell label="Name" required htmlFor="project-name">
            <input
              id="project-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Autumn campaign"
              className={inputClass}
            />
          </FieldShell>

          <FieldShell label="Colour" description="How it is marked in the switcher.">
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setColor(option)}
                  aria-label={option}
                  aria-pressed={color === option}
                  className={cn(
                    'size-7 rounded-lg border-2 transition-transform',
                    color === option
                      ? 'border-ink scale-110'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ background: colorOf(option as ProjectColor) }}
                />
              ))}
            </div>
          </FieldShell>

          <FieldShell
            label="Description"
            htmlFor="project-description"
            description="One line, for your own reference."
          >
            <input
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Everything for the September launch"
              className={inputClass}
            />
          </FieldShell>

          <div className="rule" />

          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              Defaults
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
              Applied to every run started while this project is open, so a
              house style is set once instead of retyped.
            </p>
          </div>

          <FieldShell
            label="Brief"
            htmlFor="project-brief"
            description="Shown above the gallery. Notes for yourself, not sent to any model."
          >
            <textarea
              id="project-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={2}
              placeholder="Warm, editorial, no stock-photo faces."
              className={cn(inputClass, 'resize-y leading-relaxed')}
            />
          </FieldShell>

          <FieldShell
            label="Prompt prefix"
            htmlFor="project-prefix"
            description="Put in front of every prompt, as its own paragraph."
          >
            <textarea
              id="project-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              rows={2}
              placeholder="Shot on 35mm film, muted palette."
              className={cn(inputClass, 'resize-y leading-relaxed')}
            />
          </FieldShell>

          <FieldShell
            label="Prompt suffix"
            htmlFor="project-suffix"
            description="Added after every prompt."
          >
            <textarea
              id="project-suffix"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              rows={2}
              placeholder="No text, no watermark."
              className={cn(inputClass, 'resize-y leading-relaxed')}
            />
          </FieldShell>

          <FieldShell
            label="Default model"
            description="Selected when you switch into this project."
          >
            <ModelPicker
              modelId={modelId || ''}
              onSelect={setModelId}
              placeholder="Keep whatever is selected"
            />
            {modelId && (
              <button
                type="button"
                onClick={() => setModelId('')}
                className="mt-2 text-[11px] text-ink-faint underline-offset-2 transition-colors hover:text-ink hover:underline"
              >
                Clear, and keep {getModel(modelId)?.name ?? 'this model'} out of the defaults
              </button>
            )}
          </FieldShell>

          {project && (
            <>
              <div className="rule" />

              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                  Duplicate
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
                  The name, colour and every default above come across either
                  way. What differs is whether the work does.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={duplicating}
                    onClick={() => void duplicate(false)}
                  >
                    {!duplicating && <Copy className="size-3.5" />}
                    Settings only
                  </Button>

                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={held === 0}
                    loading={duplicating}
                    onClick={() => void duplicate(true)}
                    title={
                      held === 0
                        ? 'This project has nothing in it yet'
                        : 'Copies the finished results too'
                    }
                  >
                    {!duplicating && <Copy className="size-3.5" />}
                    Settings and {held} result{held === 1 ? '' : 's'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3">
          {project ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-ink-faint">Delete this project?</span>
                <Button size="sm" variant="danger" onClick={() => void remove()}>
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                title="The work inside moves to All work rather than being deleted"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
              {project ? 'Save' : 'Create'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
