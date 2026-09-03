'use client'

import { Check, Image as ImageIcon, Loader2, Music, Video, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import type { AssetField } from '@/lib/kie/fields'
import type { TaskAsset } from '@/lib/kie/tasks'
import { cn, proxied, timeAgo } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import { AssetView } from './AssetView'

/** Which asset kinds each field will accept. */
const ACCEPTS: Record<AssetField['kind'], TaskAsset['kind'][]> = {
  image: ['image'],
  images: ['image'],
  audio: ['audio'],
  video: ['video'],
  videos: ['video'],
}

const KIND_ICON = {
  image: ImageIcon,
  video: Video,
  audio: Music,
} as const

interface LibraryItem {
  asset: TaskAsset
  jobId: string
  modelName: string
  prompt: string
  createdAt: number
}

interface MediaLibraryPickerProps {
  field: AssetField
  /** How many more the field can still take. */
  room: number
  onCancel: () => void
  /** Receives public URLs, already re-hosted and safe to submit. */
  onPick: (urls: string[]) => void
}

/**
 * Pick previously generated media as a reference.
 *
 * Chaining a result into the next run otherwise means downloading it and
 * uploading it back, which is slow and pointless when Kie can fetch its own
 * URL server-side.
 *
 * Selected assets are re-hosted rather than passed through as-is: Kie's result
 * URLs are temporary, and a reference that expires mid-run fails with an
 * unhelpful "could not read your file".
 */
export function MediaLibraryPicker({
  field,
  room,
  onCancel,
  onPick,
}: MediaLibraryPickerProps) {
  const jobs = useStudio((s) => s.jobs)
  const [selected, setSelected] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)

  const wanted = ACCEPTS[field.kind]

  /** Every asset this field could take, newest first. */
  const items = useMemo<LibraryItem[]>(() => {
    const out: LibraryItem[] = []

    for (const job of jobs) {
      if (job.state !== 'success') continue
      for (const asset of job.assets) {
        if (!wanted.includes(asset.kind)) continue
        out.push({
          asset,
          jobId: job.id,
          modelName: job.modelName,
          prompt: job.promptPreview,
          createdAt: job.createdAt,
        })
      }
    }

    return out.sort((a, b) => b.createdAt - a.createdAt)
  }, [jobs, wanted])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, importing])

  const toggle = (url: string) => {
    setSelected((current) => {
      if (current.includes(url)) return current.filter((u) => u !== url)
      if (current.length >= room) {
        toast.error(
          room === 1
            ? 'This field takes one file. Deselect the other first.'
            : `You can add ${room} more.`,
        )
        return current
      }
      return [...current, url]
    })
  }

  /**
   * Re-host each pick through Kie so the reference outlives the original
   * result URL. Done sequentially: a handful of files is not worth the extra
   * failure modes of parallelism, and progress stays meaningful.
   */
  const confirm = async () => {
    if (!selected.length) return

    setImporting(true)
    setProgress(0)
    const ready: string[] = []

    try {
      for (const [index, url] of selected.entries()) {
        const res = await fetch('/api/kie/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl: url, fileName: `library-${field.kind}` }),
        })
        const data = (await res.json()) as { url?: string; error?: string }

        if (!res.ok || !data.url) {
          toast.error('Could not add one of the files', {
            description: data.error ?? 'It may have expired on Kie.ai.',
          })
          continue
        }

        ready.push(data.url)
        setProgress(Math.round(((index + 1) / selected.length) * 100))
      }

      if (ready.length) onPick(ready)
      else onCancel()
    } finally {
      setImporting(false)
      setProgress(0)
    }
  }

  const Icon = KIND_ICON[wanted[0]] ?? ImageIcon

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-void/80 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={importing ? undefined : onCancel} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose from your library"
        className="animate-rise relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-bright bg-surface shadow-2xl shadow-black/60"
      >
        <header className="rule flex shrink-0 items-start justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">Your library</h2>
            <p className="mt-0.5 text-[12px] text-ink-faint">
              {items.length} {wanted[0]}
              {items.length === 1 ? '' : 's'} from earlier runs
              {room > 1 ? ` · pick up to ${room}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={importing}
            aria-label="Close"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="grid size-11 place-items-center rounded-2xl border border-line bg-raised">
                <Icon className="size-5 text-ink-faint" />
              </div>
              <div>
                <p className="text-[14px] font-medium text-ink">
                  No {wanted[0]}s yet
                </p>
                <p className="mx-auto mt-1 max-w-xs text-[12px] leading-relaxed text-ink-faint">
                  Anything you generate shows up here, ready to reuse as a
                  reference.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((item) => {
                const isPicked = selected.includes(item.asset.url)
                const order = selected.indexOf(item.asset.url) + 1

                return (
                  <button
                    key={`${item.jobId}-${item.asset.url}`}
                    type="button"
                    onClick={() => toggle(item.asset.url)}
                    disabled={importing}
                    title={item.prompt || item.modelName}
                    className={cn(
                      'checkerboard group relative aspect-square overflow-hidden rounded-xl border transition-all',
                      isPicked
                        ? 'border-accent ring-2 ring-accent/30'
                        : 'border-line hover:border-line-bright',
                    )}
                  >
                    <AssetView asset={item.asset} />

                    {/* Order matters for models that treat the first image as
                        the subject, so the position is shown, not just a tick. */}
                    {isPicked && (
                      <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-black">
                        {room > 1 ? order : <Check className="size-3" />}
                      </span>
                    )}

                    <span
                      className={cn(
                        'pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4 text-left text-[10px] text-white/90',
                        'opacity-0 transition-opacity group-hover:opacity-100',
                        isPicked && 'opacity-100',
                      )}
                    >
                      {item.modelName} · {timeAgo(item.createdAt)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3">
            <p className="text-[12px] text-ink-faint">
              {importing
                ? `Adding… ${progress}%`
                : selected.length
                  ? `${selected.length} selected`
                  : 'Nothing selected'}
            </p>

            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={onCancel} disabled={importing}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void confirm()}
                disabled={!selected.length}
                loading={importing}
              >
                {!importing && <Check className="size-3.5" />}
                Add {selected.length || ''}
              </Button>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}

/** Shown while the picker mounts, so the button gives feedback immediately. */
export function PickerFallback() {
  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-void/80">
      <Loader2 className="size-5 animate-spin text-ink-faint" />
    </div>
  )
}
