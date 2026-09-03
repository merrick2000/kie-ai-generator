'use client'

import { cn } from '@/lib/utils'

interface RatioPickerProps {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}

/**
 * Aspect ratios shown as scaled tiles.
 *
 * Reading "21:9" is slower than seeing the shape, and tiles make the extreme
 * ratios some models expose immediately legible.
 */
/** Tile box the ratio previews are fitted into, in pixels. */
const TILE_W = 36
const TILE_H = 24

/**
 * Scale a ratio to fit the tile.
 *
 * The preview needs explicit pixel dimensions: an empty element with only
 * `aspect-ratio` and max-width/height resolves to zero and renders nothing.
 */
function tileSize(ratio: string): { width: number; height: number } {
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return { width: TILE_H, height: TILE_H }

  const r = w / h
  return r > TILE_W / TILE_H
    ? { width: TILE_W, height: Math.round(TILE_W / r) }
    : { width: Math.round(TILE_H * r), height: TILE_H }
}

export function RatioPicker({ value, options, onChange }: RatioPickerProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = opt.value === value
        const auto = opt.value === 'auto' || opt.value === 'Auto' || opt.value === 'adaptive'

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            title={opt.label}
            className={cn(
              'flex min-w-[52px] flex-col items-center gap-1.5 rounded-xl border px-2 py-2 transition-all duration-150',
              active
                ? 'border-accent bg-accent-glow'
                : 'border-line bg-raised hover:border-line-bright',
            )}
          >
            <span className="grid h-6 w-9 place-items-center">
              {auto ? (
                <span
                  className={cn(
                    'text-[10px] font-semibold',
                    active ? 'text-accent' : 'text-ink-faint',
                  )}
                >
                  AUTO
                </span>
              ) : (
                <span
                  style={tileSize(opt.value)}
                  className={cn(
                    'block rounded-[3px] border',
                    active ? 'border-accent bg-accent/20' : 'border-ink-faint',
                  )}
                />
              )}
            </span>
            <span
              className={cn(
                'text-[10px] font-medium tabular-nums',
                active ? 'text-accent' : 'text-ink-faint',
              )}
            >
              {auto ? '·' : opt.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
