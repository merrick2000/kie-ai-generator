'use client'

import { Check, ChevronDown, Pin, Search, Sparkles, TrendingUp, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  CATEGORIES,
  MODELS,
  MODES,
  getModel,
  type ModelCategory,
  type ModelDef,
  type ModelMode,
} from '@/lib/kie/catalog'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store/studio'

interface ModelPickerProps {
  modelId: string
  onSelect: (modelId: string) => void
  /** Shown when nothing is selected. Used where the choice is optional. */
  placeholder?: string
}

/** Everything a person can actually choose. */
const LISTED = MODELS.filter((m) => !m.hidden)

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
  const pinned = useStudio((s) => s.pinnedModels)
  const togglePinned = useStudio((s) => s.togglePinnedModel)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ModelCategory | 'all'>('all')
  const [mode, setMode] = useState<ModelMode | 'all'>('all')
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

    return LISTED.filter((m) => {
      if (category !== 'all' && m.category !== category) return false
      if (mode !== 'all' && m.mode !== mode) return false
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        m.family.toLowerCase().includes(q) ||
        m.tagline.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.mode.includes(q)
      )
    })
  }, [category, mode, query])

  // Featured models lead each list; the rest keep catalog order.
  const ordered = useMemo(
    () => [...results].sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false)),
    [results],
  )

  /**
   * Only the modes that exist inside the chosen category.
   *
   * With sixty video models, "image to video" is the question people
   * actually have, and offering "text to audio" while Video is selected
   * would be a filter that always returns nothing.
   */
  const modes = useMemo(() => {
    const available = new Set(
      LISTED.filter((m) => category === 'all' || m.category === category).map((m) => m.mode),
    )
    return MODES.filter((m) => available.has(m.id))
  }, [category])

  const pinnedModels = useMemo(
    () => results.filter((m) => pinned.includes(m.id)),
    [results, pinned],
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
              // The listed count, not the catalog's. Hidden entries are the
              // sibling slugs a reference routes to, and counting them
              // promises models nobody can pick.
              placeholder={`Search ${LISTED.length} models…`}
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
                  onClick={() => {
                    setCategory(id)
                    setMode('all')
                  }}
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

          {modes.length > 1 && (
            <div className="rule flex gap-1 overflow-x-auto px-2 py-2 no-scrollbar">
              <button
                type="button"
                onClick={() => setMode('all')}
                className={cn(
                  'shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
                  mode === 'all'
                    ? 'bg-overlay text-ink'
                    : 'text-ink-faint hover:bg-raised hover:text-ink',
                )}
              >
                Any input
              </button>
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
                    mode === m.id
                      ? 'bg-overlay text-ink'
                      : 'text-ink-faint hover:bg-raised hover:text-ink',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          <div className="max-h-[min(52vh,420px)] overflow-y-auto p-1.5">
            {ordered.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-ink-faint">
                No model matches “{query}”.
              </p>
            )}

            {pinnedModels.length > 0 && !query && (
              <>
                <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  <Pin className="size-3" />
                  Pinned
                </p>
                {pinnedModels.map((m) => (
                  <Row
                    key={`pin-${m.id}`}
                    model={m}
                    selected={m.id === modelId}
                    pinned
                    onTogglePin={() => togglePinned(m.id)}
                    onSelect={() => {
                      onSelect(m.id)
                      setOpen(false)
                      setQuery('')
                    }}
                  />
                ))}
                <p className="px-2.5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Everything else
                </p>
              </>
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
                    pinned={pinned.includes(model.id)}
                    onTogglePin={() => togglePinned(model.id)}
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
                pinned={pinned.includes(m.id)}
                onTogglePin={() => togglePinned(m.id)}
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
  pinned?: boolean
  onTogglePin?: () => void
  /** Replaces the speed hint when there is something better to say. */
  note?: string
  onSelect: () => void
}

function Row({ model, selected, pinned, onTogglePin, note, onSelect }: RowProps) {
  return (
    // A row rather than a button, since the pin is a control of its own and
    // one button cannot live inside another.
    <div
      className={cn(
        'group/model flex items-start rounded-xl transition-colors',
        selected ? 'bg-overlay' : 'hover:bg-raised',
      )}
    >
    <button
      type="button"
      onClick={onSelect}
      className="flex min-w-0 flex-1 items-start gap-3 px-2.5 py-2.5 text-left"
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

      {onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${model.name}` : `Pin ${model.name}`}
          aria-pressed={pinned}
          title={pinned ? 'Unpin' : 'Keep at the top of this list'}
          className={cn(
            'mr-1.5 mt-2 grid size-7 shrink-0 place-items-center rounded-lg transition-all',
            pinned
              ? 'text-accent'
              : 'text-ink-faint opacity-0 hover:text-ink focus-visible:opacity-100 group-hover/model:opacity-100 max-sm:opacity-100',
          )}
        >
          <Pin className={cn('size-3.5', pinned && 'fill-current')} />
        </button>
      )}
    </div>
  )
}
