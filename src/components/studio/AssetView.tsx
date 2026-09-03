'use client'

import { Music } from 'lucide-react'
import { useState } from 'react'

import type { TaskAsset } from '@/lib/kie/tasks'
import { cn, proxied } from '@/lib/utils'

interface AssetViewProps {
  asset: TaskAsset
  /** `cover` for grid thumbnails, `contain` for the full viewer. */
  fit?: 'cover' | 'contain'
  /** Autoplay muted video previews on hover, as in a media library. */
  hoverPlay?: boolean
  controls?: boolean
  className?: string
}

/** Renders one generated asset, dispatching on its media kind. */
export function AssetView({
  asset,
  fit = 'cover',
  hoverPlay = false,
  controls = false,
  className,
}: AssetViewProps) {
  const [failed, setFailed] = useState(false)
  const src = proxied(asset.url)
  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain'

  if (failed) {
    return (
      <div
        className={cn(
          'grid size-full place-items-center bg-raised px-4 text-center text-[11px] text-ink-faint',
          className,
        )}
      >
        Asset expired or unreachable.
        <br />
        Kie links are temporary. Download results you want to keep.
      </div>
    )
  }

  if (asset.kind === 'video') {
    return (
      <video
        src={src}
        poster={asset.poster ? proxied(asset.poster) : undefined}
        className={cn('size-full', objectFit, className)}
        controls={controls}
        muted={!controls}
        loop
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        onMouseEnter={
          hoverPlay
            ? (e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => {})
            : undefined
        }
        onMouseLeave={
          hoverPlay
            ? (e) => {
                const el = e.currentTarget as HTMLVideoElement
                el.pause()
                el.currentTime = 0
              }
            : undefined
        }
      />
    )
  }

  if (asset.kind === 'audio') {
    return (
      <div
        className={cn(
          'relative flex size-full flex-col items-center justify-center gap-3 bg-raised p-4',
          className,
        )}
      >
        {asset.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxied(asset.poster)}
            alt=""
            className="absolute inset-0 size-full object-cover opacity-30"
          />
        ) : (
          <Music className="size-8 text-ink-faint" />
        )}
        <div className="relative w-full max-w-sm space-y-2">
          {asset.title && (
            <p className="truncate text-center text-[13px] font-medium text-ink">
              {asset.title}
            </p>
          )}
          <audio
            src={src}
            controls
            className="w-full"
            onError={() => setFailed(true)}
          />
        </div>
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn('size-full', objectFit, className)}
      onError={() => setFailed(true)}
    />
  )
}
