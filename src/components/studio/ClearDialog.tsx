'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { useStudio } from '@/store/studio'

interface ClearDialogProps {
  onClose: () => void
}

/**
 * Confirms a history sweep.
 *
 * The button behind this used to delete on a single click, from a toolbar
 * where it sat beside Compare and above a row of filters, so "Clear" read as
 * "clear the filters" and the gallery emptied instead. It is irreversible:
 * the rows are gone from the database, not hidden.
 *
 * The count comes from the server rather than from the loaded page, because
 * the gallery is paginated and the sweep is not: it takes everything the
 * filter matches, including the pages nobody has scrolled to.
 */
export function ClearDialog({ onClose }: ClearDialogProps) {
  const activeProjectId = useStudio((s) => s.activeProjectId)
  const projects = useStudio((s) => s.projects)
  const clearHistory = useStudio((s) => s.clearHistory)

  const [count, setCount] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const project = projects.find((p) => p.id === activeProjectId)
  const wholeAccount = !activeProjectId

  useEffect(() => {
    const controller = new AbortController()
    const query = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : ''

    fetch(`/api/jobs/clearable${query}`, { signal: controller.signal, cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { count: number }) => setCount(data.count))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })

    return () => controller.abort()
  }, [activeProjectId])

  async function confirm() {
    setBusy(true)
    await clearHistory()
    setBusy(false)
    toast.success(
      count === null
        ? 'History cleared.'
        : `Deleted ${count} result${count === 1 ? '' : 's'}.`,
    )
    onClose()
  }

  const nothingToDo = count === 0

  return createPortal(
    <div className="fixed inset-0 z-[130] grid place-items-center bg-void/80 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete history"
        className="animate-rise relative w-full max-w-md overflow-hidden rounded-2xl border border-line-bright bg-surface shadow-2xl shadow-black/60"
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-danger/30 bg-danger/10 text-danger">
            <AlertTriangle className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink">Delete history</h2>
            <p className="mt-0.5 text-[12px] text-ink-faint">
              {wholeAccount
                ? 'Across every project, not just what is on screen.'
                : `In ${project?.name ?? 'this project'}.`}
            </p>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {failed ? (
              'Could not reach the server to count what this would remove.'
            ) : count === null ? (
              <span className="flex items-center gap-2 text-ink-faint">
                <Loader2 className="size-3.5 animate-spin" />
                Counting what this would remove…
              </span>
            ) : nothingToDo ? (
              'Nothing here can be deleted. Everything is either pinned or still running.'
            ) : (
              <>
                This permanently deletes{' '}
                <strong className="font-semibold text-danger">
                  {count.toLocaleString()} finished result{count === 1 ? '' : 's'}
                </strong>{' '}
                from the database. It cannot be undone, and the files themselves
                are not downloaded first.
              </>
            )}
          </p>

          {!nothingToDo && (
            <p className="rounded-xl border border-line bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-ink-faint">
              Pinned results stay. Anything still generating stays, because
              deleting it would abandon a task already being paid for upstream.
            </p>
          )}
        </div>

        <div className="rule flex items-center justify-end gap-2 px-5 py-3">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            disabled={nothingToDo || failed}
            onClick={() => void confirm()}
          >
            {count === null || nothingToDo
              ? 'Delete'
              : `Delete ${count.toLocaleString()}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
