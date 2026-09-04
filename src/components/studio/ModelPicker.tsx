'use client'

import { Check, ChevronDown, Search, Sparkles, TrendingUp, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  CATEGORIES,
  MODELS,
  getModel,
  type ModelCategory,
  type ModelDef,
} from '@/lib/kie/catalog'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store/studio'

interface ModelPickerProps {
  modelId: string
  onSelect: (modelId: string) => void
  /** Shown when nothing is selected. Used where the choice is optional. */
  placeholder?: string
}

/** A model needs this many runs here before it counts as one you rely on. */
const HABIT_THRESHOLD = 2

/** How many to surface at the top before the full catalog. */
const SHORTLIST = 6

const SPEED_LABEL: Record<ModelDef['speed'], string> = {
  fast: 'Fast',
  balanced: 'Balanced',
  slow: 'Deep',
}

const SPEED_TONE: Record<ModelDef['speed'], string> = {
  fast: 'text-ok',
  balanced: 'text-warn',
  slow: 'text-ink-faint',
}

export function ModelPicker({ modelId, onSelect, placeholder }: ModelPickerProps) {
  const usage = useStudio((s) => s.usage)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ModelCategory | 'all'>('all')
  const panelRef = useRef<HTMLDivElement>(null)

  const active = getModel(modelId)

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()

    return MODELS.filter((m) => {
      // Variants reached by filling a reference field are not listed
      // separately; showing both would present one model as two.
      if (m.hidden) return false
      if (category !== 'all' && m.category !== category) return false
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        m.family.toLowerCase().includes(q) ||
        m.tagline.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.mode.includes(q)
      )
    })
  }, [category, query])

  // Featured models lead each list; the rest keep catalog order.
  const ordered = useMemo(
    () => [...results].sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false)),
    [results],
  )

  /**
   * The models this account actually reaches for.
   *
   * Fifty-odd entries is too many to choose from cold, and the catalog's own
   * idea of what is good says nothing about what works here. Ranked by runs,
   * with failures counted against them, so a model that keeps erroring does
   * not climb the list by being tried repeatedly.
   */
  const shortlist = useMemo(() => {
    if (!usage.length) return []

    const ranked = [...usage]
      .filter((u) => u.runs >= HABIT_THRESHOLD && getModel(u.modelId))
      .sort((a, b) => b.succeeded - a.succeeded || b.runs - a.runs)
      .slice(0, SHORTLIST)

    const visible = new Set(results.map((m) => m.id))
    return ranked
      .filter((u) => visible.has(u.modelId))
      .map((u) => ({ model: getModel(u.modelId)!, usage: u }))
  }, [results, usage])

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border border-line bg-raised px-3 py-2.5 text-left transition-colors',
          'hover:border-line-bright',
          open && 'border-accent',
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-overlay text-accent">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {active?.name ?? placeholder ?? 'Select a model'}
          </span>
          <span className="block truncate text-[11px] text-ink-faint">
            {active ? `${active.family} · ${active.tagline}` : 'Browse the catalog'}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-ink-faint transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="animate-rise absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-line-bright bg-surface shadow-2xl shadow-black/60">
          <div className="rule flex items-center gap-2 px-3 py-2.5">
            <Search className="size-4 shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${MODELS.length} models…`}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-ink-faint hover:text-ink"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="rule flex gap-1 overflow-x-auto px-2 py-2 no-scrollbar">
            {(['all', ...CATEGORIES.map((c) => c.id)] as const).map((id) => {
              const label = id === 'all' ? 'All' : CATEGORIES.find((c) => c.id === id)!.label
              const isActive = category === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCategory(id)}
                  className={cn(
                    'shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-black'
                      : 'text-ink-faint hover:bg-raised hover:text-ink',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div className="max-h-[min(52vh,420px)] overflow-y-auto p-1.5">
            {ordered.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-ink-faint">
                No model matches “{query}”.
              </p>
            )}

            {shortlist.length > 0 && !query && (
              <>
                <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  <TrendingUp className="size-3" />
                  Your most used
                </p>
                {shortlist.map(({ model, usage: stats }) => (
                  <Row
                    key={`top-${model.id}`}
                    model={model}
                    selected={model.id === modelId}
                    note={`${stats.succeeded} run${stats.succeeded === 1 ? '' : 's'} here`}
                    onSelect={() => {
                      onSelect(model.id)
                      setOpen(false)
                      setQuery('')
                    }}
                  />
                ))}
                <p className="px-2.5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Everything
                </p>
              </>
            )}

            {ordered.map((m) => (
              <Row
                key={m.id}
                model={m}
                selected={m.id === modelId}
                onSelect={() => {
                  onSelect(m.id)
                  setOpen(false)
                  setQuery('')
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface RowProps {
  model: ModelDef
  selected: boolean
  /** Replaces the speed hint when there is something better to say. */
  note?: string
  onSelect: () => void
}

function Row({ model, selected, note, onSelect }: RowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
        selected ? 'bg-overlay' : 'hover:bg-raised',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{model.name}</span>
          {model.featured && (
            <span className="shrink-0 rounded bg-accent-glow px-1 text-[9px] font-semibold uppercase tracking-wide text-accent">
              Top
            </span>
          )}
          {model.badges?.map((b) => (
            <span
              key={b}
              className="shrink-0 rounded bg-overlay px-1 text-[9px] font-medium uppercase tracking-wide text-ink-faint"
            >
              {b}
            </span>
          ))}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
          {model.tagline}
        </span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
          <span>{model.family}</span>
          <span aria-hidden>·</span>
          {note ? (
            <span className="text-accent">{note}</span>
          ) : (
            <span className={SPEED_TONE[model.speed]}>{SPEED_LABEL[model.speed]}</span>
          )}
        </span>
      </span>
      {selected && <Check className="mt-1 size-4 shrink-0 text-accent" />}
    </button>
  )
}
