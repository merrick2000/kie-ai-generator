'use client'

import { Images, Link2, Loader2, Plus, X } from 'lucide-react'
import { useCallback, useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { useUpload } from '@/hooks/useUpload'
import { useStudio } from '@/store/studio'
import { MediaLibraryPicker } from './MediaLibraryPicker'
import type { AssetField } from '@/lib/kie/fields'
import { cn, proxied } from '@/lib/utils'

interface AssetInputProps {
  field: AssetField
  value: string | string[]
  onChange: (value: string | string[]) => void
}

const ACCEPT: Record<string, string> = {
  image: 'image/*',
  images: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
  videos: 'video/*',
}

/**
 * Upload, drag-drop or paste-a-URL control.
 *
 * Models only accept URLs, so local files are pushed to Kie's CDN first and
 * the returned public URL is what lands in the form value.
 */
export function AssetInput({ field, value, onChange }: AssetInputProps) {
  const multiple = field.kind === 'images' || field.kind === 'videos'
  const urls = multiple ? ((value as string[]) ?? []) : value ? [value as string] : []
  const max = multiple ? (field.maxItems ?? 10) : 1
  const full = urls.length >= max

  const { upload, uploadUrl, uploading, progress } = useUpload()
  const [dragging, setDragging] = useState(false)
  const [urlMode, setUrlMode] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')

  // Only offer the library when there is actually something in it that this
  // field could take, otherwise the button leads to an empty dialog.
  const libraryCount = useStudio((s) => {
    const wanted =
      field.kind === 'audio' ? 'audio' : field.kind.startsWith('video') ? 'video' : 'image'
    return s.library.reduce(
      (total, job) =>
        job.state === 'success'
          ? total + job.assets.filter((a) => a.kind === wanted).length
          : total,
      0,
    )
  })
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = useCallback(
    (next: string[]) => onChange(multiple ? next.slice(0, max) : (next[0] ?? '')),
    [multiple, max, onChange],
  )

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const room = max - urls.length
      if (room <= 0) {
        toast.error(`Limit reached. ${max} file${max > 1 ? 's' : ''} max.`)
        return
      }

      const list = Array.from(files).slice(0, room)

      // Size checks live in the hook, which knows how to report them.
      const uploaded = await upload(list, { maxSizeMb: field.maxSizeMb })
      if (uploaded.length) commit([...urls, ...uploaded.map((u) => u.url)])
    },
    [commit, field.maxSizeMb, max, upload, urls],
  )

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const addUrl = useCallback(async () => {
    const raw = urlDraft.trim()
    if (!raw) return
    if (!/^https?:\/\//.test(raw)) {
      toast.error('Enter a full http(s) URL.')
      return
    }
    // Re-host through Kie so the asset stays reachable for the whole job and
    // is not blocked by the origin's hotlink rules.
    const asset = await uploadUrl(raw)
    if (asset) {
      commit([...urls, asset.url])
      setUrlDraft('')
      setUrlMode(false)
    }
  }, [commit, uploadUrl, urlDraft, urls])

  const remove = (index: number) => commit(urls.filter((_, i) => i !== index))

  const isVisual = field.kind === 'image' || field.kind === 'images'
  const isVideo = field.kind === 'video' || field.kind === 'videos'

  return (
    <div className="space-y-2.5">
      {urls.length > 0 && (
        <div
          className={cn(
            'grid gap-2',
            multiple ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-1',
          )}
        >
          {urls.map((url, i) => (
            <div
              key={`${url}-${i}`}
              className={cn(
                'group relative overflow-hidden rounded-xl border border-line bg-raised',
                multiple ? 'aspect-square' : 'aspect-video',
              )}
            >
              {isVisual && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={proxied(url)}
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                />
              )}
              {isVideo && (
                <video
                  src={proxied(url)}
                  className="size-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              )}
              {field.kind === 'audio' && (
                <div className="flex size-full items-center px-3">
                  <audio src={proxied(url)} controls className="w-full" />
                </div>
              )}

              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove"
                className={cn(
                  'absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-lg',
                  'bg-black/70 text-white backdrop-blur transition-opacity',
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!full && (
        <>
          {urlMode ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addUrl()
                  }
                  if (e.key === 'Escape') setUrlMode(false)
                }}
                placeholder="https://…"
                className="h-9 flex-1 rounded-lg border border-line bg-raised px-3 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
              <Button size="sm" onClick={() => void addUrl()} loading={uploading}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setUrlMode(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'relative flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-3 transition-colors',
                dragging
                  ? 'border-accent bg-accent-glow'
                  : 'border-line bg-raised/50 hover:border-line-bright',
              )}
            >
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-ink transition-colors hover:text-accent disabled:opacity-60"
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                  {uploading && progress.total > 0
                    ? `${progress.percent}%${
                        progress.total > 1 ? ` · ${progress.done}/${progress.total} files` : ''
                      }${progress.currentName ? ` · ${progress.currentName}` : ''}`
                    : `${field.accepts ?? 'Any file'}${
                        field.maxSizeMb ? ` · ${field.maxSizeMb}MB max` : ''
                      }${multiple ? ` · ${urls.length}/${max}` : ''}`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {libraryCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setLibraryOpen(true)}
                    disabled={uploading}
                    title="Reuse something you already generated"
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink-faint transition-colors hover:bg-overlay hover:text-ink disabled:opacity-50"
                  >
                    <Images className="size-3.5" />
                    Library
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setUrlMode(true)}
                  disabled={uploading}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink-faint transition-colors hover:bg-overlay hover:text-ink disabled:opacity-50"
                >
                  <Link2 className="size-3.5" />
                  URL
                </button>
              </div>

              {uploading && progress.total > 0 && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-xl bg-line">
                  <span
                    className="block h-full bg-accent transition-[width] duration-200 ease-out"
                    style={{ width: `${progress.percent}%` }}
                  />
                </span>
              )}
            </div>
          )}

          {libraryOpen && (
            <MediaLibraryPicker
              field={field}
              room={max - urls.length}
              onCancel={() => setLibraryOpen(false)}
              onPick={(picked) => {
                commit([...urls, ...picked])
                setLibraryOpen(false)
              }}
            />
          )}

          <input
            ref={inputRef}
            type="file"
            hidden
            multiple={multiple}
            accept={ACCEPT[field.kind]}
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </>
      )}
    </div>
  )
}
