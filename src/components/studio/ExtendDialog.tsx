'use client'

import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { getModel } from '@/lib/kie/catalog'
import { defaultsFor, validate } from '@/lib/kie/fields'
import type { Job } from '@/lib/jobs/types'
import { useStudio } from '@/store/studio'
import { FieldRenderer } from './FieldRenderer'

interface ExtendDialogProps {
  job: Job
  onClose: () => void
}

/**
 * Continue a finished clip.
 *
 * The form is the extension model's own field list, rendered through the same
 * renderer as the composer, minus the one field nobody can fill: the task id,
 * which the server reads off the job being extended.
 */
export function ExtendDialog({ job, onClose }: ExtendDialogProps) {
  const extendJob = useStudio((s) => s.extendJob)

  const source = getModel(job.modelId)
  const target = source?.extend ? getModel(source.extend.with) : undefined

  const fields = useMemo(
    () =>
      target
        ? target.fields.filter(
            (f) => f.name !== target.continuation?.taskIdField && !f.advanced,
          )
        : [],
    [target],
  )

  const [values, setValues] = useState<Record<string, unknown>>(() =>
    target ? defaultsFor(target.fields) : {},
  )
  const [busy, setBusy] = useState(false)

  // Mounted only in the browser: `document` does not exist during the server
  // render, and the portal needs it.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!target || !mounted) return null

  // The task id is missing from `values` on purpose, so it is excluded from
  // the check here too rather than reported as a field the user forgot.
  const problems = validate(fields, values)

  async function submit() {
    setBusy(true)
    const next = await extendJob(job.id, values)
    setBusy(false)

    if (!next) {
      toast.error('The continuation was refused. Check the gallery for why.')
      return
    }

    toast.success('Continuing the clip.')
    onClose()
  }

  /*
   * Portalled to the body rather than rendered in place.
   *
   * The card this opens from carries a transform for its entry animation, and
   * a transformed ancestor becomes the containing block for `position: fixed`.
   * Left where it sits, the dialog is laid out against the card and clipped by
   * its `overflow-hidden`, which is exactly what it looked like: a modal
   * folded into a 300px tile.
   */
  return createPortal(
    <div className="fixed inset-0 z-[120] grid place-items-center bg-void/80 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Extend this clip"
        className="animate-rise relative flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line-bright bg-surface shadow-2xl shadow-black/60"
      >
        <header className="rule flex shrink-0 items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-ink">Extend this clip</h2>
            <p className="mt-0.5 truncate text-[12px] text-ink-faint">
              {job.modelName} continued by {target.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {fields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
            />
          ))}

          <p className="text-[12px] leading-relaxed text-ink-faint">
            The continuation is billed as a new run and arrives as its own
            result, so the original stays where it is.
          </p>
        </div>

        <footer className="rule flex shrink-0 items-center justify-end gap-2 px-5 py-3">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={problems.length > 0}
            title={problems[0]}
            onClick={() => void submit()}
          >
            Extend
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
