'use client'

import { Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

interface PriceRow {
  label: string
  modality: string
  provider: string
  credits: number
  unit: string
  usd: number
}

type Modality = 'all' | 'image' | 'video' | 'music' | 'chat'

const MODALITIES: Modality[] = ['all', 'image', 'video', 'music', 'chat']

/**
 * Kie's full price list, searchable.
 *
 * The studio can only show a pre-run cost for models with a verified pairing
 * to one of these rows, which is a minority of them. This is the escape
 * hatch: the real table, so a price can always be looked up rather than
 * guessed at.
 */
export function PriceTable() {
  const [rows, setRows] = useState<PriceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [modality, setModality] = useState<Modality>('all')

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch('/api/kie/pricing')
        const data = (await res.json()) as { rows?: PriceRow[]; error?: string }
        if (cancelled) return
        if (!res.ok || !data.rows) throw new Error(data.error ?? 'Could not load pricing.')
        setRows(data.rows)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load pricing.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()

    return rows.filter((r) => {
      if (modality !== 'all' && r.modality !== modality) return false
      if (!q) return true
      return (
        r.label.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q)
      )
    })
  }, [rows, query, modality])

  if (error) {
    return (
      <p className="rounded-xl border border-line px-4 py-6 text-center text-[12px] leading-relaxed text-ink-faint">
        {error} Prices are on{' '}
        <a
          href="https://kie.ai/pricing"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-2"
        >
          kie.ai/pricing
        </a>
        .
      </p>
    )
  }

  if (!rows) {
    return (
      <div className="flex items-center gap-2 py-8 text-[13px] text-ink-faint">
        <Loader2 className="size-4 animate-spin" />
        Loading Kie.ai prices…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2">
        <Search className="size-4 shrink-0 text-ink-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${rows.length} prices…`}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>

      <div className="flex gap-1">
        {MODALITIES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModality(m)}
            className={cn(
              'rounded-lg px-2.5 py-1 text-[12px] font-medium capitalize transition-colors',
              modality === m
                ? 'bg-accent text-black'
                : 'text-ink-faint hover:bg-raised hover:text-ink',
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="px-3 py-8 text-center text-[12px] text-ink-faint">
          Nothing matches that.
        </p>
      ) : (
        <ul className="max-h-[46vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {filtered.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              className="flex items-baseline justify-between gap-3 bg-surface px-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="block text-[12px] leading-snug text-ink">{r.label}</span>
                <span className="block text-[11px] text-ink-faint">
                  {r.provider || r.modality}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[12px] tabular-nums text-ink">
                  ${r.usd}
                </span>
                <span className="block text-[11px] tabular-nums text-ink-faint">
                  {r.credits} cr {r.unit.replace(/^per /, '/ ')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-ink-faint">
        Live from Kie.ai, cached for an hour. Dollar figures are theirs, not a
        conversion.
      </p>
    </div>
  )
}
