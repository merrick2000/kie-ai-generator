'use client'

import { Music, Play } from 'lucide-react'
import NextImage from 'next/image'
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

/**
 * What width the browser should ask the optimiser for.
 *
 * `sizes` is not decoration: without it Next assumes the image spans the
 * viewport and serves a 1920px variant into a 300px tile, which is most of
 * the weight this change exists to remove.
 */
const GRID_SIZES = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px'
const FULL_SIZES = '100vw'

/**
 * An asset drawn through Next's image optimiser.
 *
 * Points at the provider's URL rather than at `/api/kie/proxy`. The optimiser
 * fetches it server side, so the CDN's missing CORS headers never reach the
 * browser, and what does reach it is a resized WebP rather than the original.
 * The proxy is still the download path, where the original is the point.
 */
function OptimisedImage({
  src,
  fit,
  className,
  onError,
}: {
  src: string
  fit: 'cover' | 'contain'
  className?: string
  onError: () => void
}) {
  /*
   * Optimisation is an enhancement, never a dependency.
   *
   * The optimiser fetches the origin itself and can fail on its own terms: a
   * slow CDN, a timeout, a format it cannot encode. None of that means the
   * asset is gone, so a failure here retries the original rather than showing
   * "asset expired" over a picture that is perfectly fine. Only when the
   * original fails too has anything actually been lost.
   */
  const [degraded, setDegraded] = useState(false)

  return (
    <span className={cn('relative block size-full', className)}>
      <NextImage
        // Keyed so React rebuilds the element rather than reusing the failed
        // one, which would keep its error state and never retry.
        key={degraded ? 'direct' : 'optimised'}
        src={src}
        alt=""
        fill
        sizes={fit === 'cover' ? GRID_SIZES : FULL_SIZES}
        className={fit === 'cover' ? 'object-cover' : 'object-contain'}
        onError={degraded ? onError : () => setDegraded(true)}
        // Lazy for thumbnails: the grid scrolls, and eagerly decoding a
        // hundred tiles is the other half of why it stuttered.
        loading={fit === 'cover' ? 'lazy' : 'eager'}
        unoptimized={degraded}
      />
    </span>
  )
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
  /** True once a grid video has replaced its poster. */
  const [playing, setPlaying] = useState(false)
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
    /*
     * In the grid, a poster stands in for the video until it is wanted.
     *
     * Every card used to mount a real <video preload="metadata">, so opening
     * the studio with thirty clips opened thirty connections before anything
     * was played. The poster is one small optimised image, and the video is
     * mounted on hover, which is the moment it is about to be watched.
     *
     * Only when a poster exists. Without one the element is the only thing
     * that can show a frame at all, so nothing changes there.
     */
    if (!controls && asset.poster && !playing) {
      return (
        <span
          className={cn('group/vid relative block size-full', className)}
          onMouseEnter={hoverPlay ? () => setPlaying(true) : undefined}
        >
          <NextImage
            src={asset.poster}
            alt=""
            fill
            sizes={GRID_SIZES}
            className={objectFit}
            loading="lazy"
            onError={() => setFailed(true)}
          />
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-9 place-items-center rounded-full bg-void/60 backdrop-blur-sm">
              <Play className="size-4 translate-x-px fill-ink text-ink" />
            </span>
          </span>
        </span>
      )
    }

    return (
      <video
        src={src}
        poster={asset.poster ? proxied(asset.poster) : undefined}
        className={cn('size-full', objectFit, className)}
        controls={controls}
        muted={!controls}
        loop
        playsInline
        preload={controls ? 'metadata' : 'auto'}
        autoPlay={playing}
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
                // Back to the poster, so leaving the card also releases the
                // connection rather than keeping it for the rest of the visit.
                if (asset.poster) setPlaying(false)
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
          <span className="absolute inset-0 block opacity-30">
            <NextImage
              src={asset.poster}
              alt=""
              fill
              sizes={GRID_SIZES}
              className="object-cover"
            />
          </span>
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
    <OptimisedImage
      src={asset.url}
      fit={fit}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
