'use client'

import { BarChart3, X } from 'lucide-react'
import { useMemo } from 'react'

import { CATEGORIES, getModel, type ModelCategory } from '@/lib/kie/catalog'
import type { ModelUsage } from '@/lib/jobs/store'
import { creditsToUsd, formatCredits, formatUsd } from '@/lib/kie/pricing'
import { cn, formatDuration } from '@/lib/utils'
import { useStudio } from '@/store/studio'

interface InsightsPanelProps {
  onClose: () => void
  /** Picking a model here selects it and closes the panel. */
  onPickModel?: (modelId: string) => void
}

/**
 * What has actually worked here.
 *
 * The catalog lists fifty-odd models and says nothing about which of them
 * suit this account. This does: runs, how many came back, what they charged
 * and how long they took, ranked inside each kind of work so an image model
 * is never compared against a video one.
 */
export function InsightsPanel({ onClose, onPickModel }: InsightsPanelProps) {
  const usage = useStudio((s) => s.usage)
  const totals = useStudio((s) => s.totals)

  const byCategory = useMemo(() => {
    const groups = new Map<ModelCategory, ModelUsage[]>()

    for (const entry of usage) {
      const list = groups.get(entry.category) ?? []
      list.push(entry)
      groups.set(entry.category, list)
    }

    for (const list of groups.values()) {
      // Successes first, because a model that fails half the time is not the
      // one you reach for however often it was tried.
      list.sort((a, b) => b.succeeded - a.succeeded || b.runs - a.runs)
    }

    return groups
  }, [usage])

  const successRate =
    totals && totals.runs > 0 ? Math.round((totals.succeeded / totals.runs) * 100) : null

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-void/80 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Model insights"
        className="animate-rise relative flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-bright bg-surface shadow-2xl shadow-black/60"
      >
        <header className="rule flex shrink-0 items-start justify-between gap-3 px-5 py-3.5">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <BarChart3 className="size-4 text-accent" />
              What you actually use
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-faint">
              Measured from your own runs, not from the catalog.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!usage.length ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="grid size-11 place-items-center rounded-2xl border border-line bg-raised">
                <BarChart3 className="size-5 text-ink-faint" />
              </div>
              <div>
                <p className="text-[14px] font-medium text-ink">Nothing to rank yet</p>
                <p className="mx-auto mt-1 max-w-xs text-[12px] leading-relaxed text-ink-faint">
                  Once a few generations have finished, the models that work
                  for you show up here.
                </p>
              </div>
            </div>
          ) : (
            <>
              {totals && (
                <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Stat label="Runs" value={String(totals.runs)} />
                  <Stat
                    label="Succeeded"
                    value={successRate != null ? `${successRate}%` : '·'}
                    sub={`${totals.succeeded} of ${totals.runs}`}
                  />
                  <Stat
                    label="Spent"
                    value={formatCredits(totals.credits)}
                    sub={formatUsd(creditsToUsd(totals.credits))}
                  />
                  <Stat label="Models tried" value={String(totals.models)} />
                </div>
              )}

              <div className="space-y-6">
                {CATEGORIES.map((category) => {
                  const list = byCategory.get(category.id)
                  if (!list?.length) return null

                  const best = list[0].succeeded || 1
                  // A bar comparing one model against itself always fills the
                  // row, which reads as a highlight rather than a measurement.
                  const comparable = list.length > 1

                  return (
                    <section key={category.id}>
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                          {category.label}
                        </h3>
                        <span className="text-[11px] text-ink-faint">
                          {category.description}
                        </span>
                      </div>

                      <ul className="space-y-1">
                        {list.slice(0, 8).map((entry) => {
                          const model = getModel(entry.modelId)
                          const failRate =
                            entry.runs > 0 ? entry.failed / entry.runs : 0

                          return (
                            <li key={entry.modelId}>
                              <button
                                type="button"
                                disabled={!model || !onPickModel}
                                onClick={() => {
                                  if (model && onPickModel) {
                                    onPickModel(model.id)
                                    onClose()
                                  }
                                }}
                                className={cn(
                                  'relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-line bg-raised px-3 py-2 text-left transition-colors',
                                  model && onPickModel
                                    ? 'hover:border-line-bright'
                                    : 'cursor-default',
                                )}
                              >
                                {/* A bar rather than a number: the shape of
                                    the list is the point, not the exact count. */}
                                {comparable && (
                                  <span
                                    aria-hidden
                                    className="absolute inset-y-0 left-0 bg-accent-glow"
                                    style={{
                                      width: `${Math.round((entry.succeeded / best) * 100)}%`,
                                    }}
                                  />
                                )}

                                <span className="relative min-w-0 flex-1">
                                  <span className="block truncate text-[13px] text-ink">
                                    {model?.name ?? entry.modelName}
                                  </span>
                                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-ink-faint">
                                    <span>
                                      {entry.succeeded} ok
                                      {entry.failed > 0 && (
                                        <span
                                          className={cn(
                                            failRate > 0.25 ? 'text-danger' : 'text-warn',
                                          )}
                                        >
                                          {' '}
                                          · {entry.failed} failed
                                        </span>
                                      )}
                                    </span>
                                    {entry.avgMs != null && (
                                      <span>· {formatDuration(entry.avgMs)} avg</span>
                                    )}
                                  </span>
                                </span>

                                <span className="relative shrink-0 text-right">
                                  <span className="block text-[12px] tabular-nums text-ink-muted">
                                    {formatCredits(entry.credits)} cr
                                  </span>
                                  <span className="block text-[10px] tabular-nums text-ink-faint">
                                    {formatUsd(creditsToUsd(entry.credits))} total
                                  </span>
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised p-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </p>
      <p className="mt-1 text-[18px] font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">{sub}</p>}
    </div>
  )
}
