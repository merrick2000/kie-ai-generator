'use client'

import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

interface Item {
  kieId: string
  name: string
  hint: string | null
  image: string | null
}

interface LibraryPickerProps {
  source: 'omni-voices' | 'omni-characters'
  max: number
  value: string[]
  onChange: (value: string[]) => void
}

/**
 * Picks saved Omni voices or characters.
 *
 * Fetched rather than declared, like the cloned voice: they belong to the
 * signed-in account. The value is the list of Kie ids the video model takes.
 */
export function LibraryPicker({ source, max, value, onChange }: LibraryPickerProps) {
  const [items, setItems] = useState<Item[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const url = source === 'omni-voices' ? '/api/omni/voices' : '/api/omni/characters'
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: { voices?: Record<string, string | null>[]; characters?: Record<string, string | null>[] }) => {
        const rows =
          source === 'omni-voices'
            ? (data.voices ?? []).map((v) => ({
                kieId: v.kieAudioId ?? '',
                name: v.name ?? 'Voice',
                hint: v.baseVoice ?? null,
                image: null,
              }))
            : (data.characters ?? []).map((c) => ({
                kieId: c.kieCharacterId ?? '',
                name: c.name ?? 'Unnamed character',
                hint: null,
                image: c.imageUrl ?? null,
              }))
        setItems(rows.filter((r) => r.kieId))
      })
      .catch(() => {
        if (!controller.signal.aborted) setItems([])
      })
    return () => controller.abort()
  }, [source])

  const noun = source === 'omni-voices' ? 'voice' : 'character'

  if (items === null) return <p className="text-[12px] text-ink-faint">Loading your {noun}s…</p>

  if (items.length === 0) {
    return (
      <p className="text-[12px] text-ink-faint">
        No {noun} yet.{' '}
        <a href="/characters" className="text-accent hover:underline">
          Make one
        </a>{' '}
        and it will appear here.
      </p>
    )
  }

  const selected = new Set(value)
  const full = selected.size >= max

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const on = selected.has(item.kieId)
          return (
            <button
              key={item.kieId}
              type="button"
              disabled={!on && full}
              onClick={() =>
                onChange(on ? value.filter((id) => id !== item.kieId) : [...value, item.kieId])
              }
              aria-pressed={on}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition-colors disabled:opacity-40',
                on
                  ? 'border-accent/50 bg-accent-glow text-ink'
                  : 'border-line bg-raised text-ink-muted hover:border-line-bright hover:text-ink',
              )}
            >
              {item.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt="" className="size-5 rounded object-cover" />
              )}
              {on && <Check className="size-3" />}
              {item.name}
              {item.hint && <span className="text-ink-faint">· {item.hint}</span>}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] tabular-nums text-ink-faint">
        {selected.size}/{max} selected
      </p>
    </div>
  )
}
