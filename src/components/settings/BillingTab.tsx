'use client'

import { CreditCard, ExternalLink, Info } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { useCredits } from '@/hooks/useCredits'
import { getModel } from '@/lib/kie/catalog'
import {
  CREDIT_USD_RATE,
  creditsToUsd,
  formatCredits,
  formatUsd,
} from '@/lib/kie/pricing'
import { useStudio } from '@/store/studio'

const TOP_UP_URL = 'https://kie.ai/billing'

/**
 * Spend and balance.
 *
 * Every figure here is measured, not estimated: the balance comes from Kie,
 * and each cost is the `creditsConsumed` that Kie reported for a completed
 * job. The only assumption is the credit-to-dollar rate.
 */
export function BillingTab() {
  const { credits, loading } = useCredits()
  const jobs = useStudio((s) => s.jobs)
  const costByModel = useStudio((s) => s.costByModel)

  const billed = jobs.filter((j) => (j.creditsConsumed ?? 0) > 0)
  const spent = billed.reduce((total, j) => total + (j.creditsConsumed ?? 0), 0)

  const perModel = Object.entries(costByModel)
    .map(([modelId, cost]) => ({
      modelId,
      name: getModel(modelId)?.name ?? modelId,
      ...cost,
    }))
    .sort((a, b) => b.averageCredits - a.averageCredits)

  const runsLeft =
    credits != null && perModel.length
      ? Math.floor(
          credits / Math.min(...perModel.map((m) => m.averageCredits)),
        )
      : null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Balance"
          value={loading && credits == null ? '·' : credits != null ? formatCredits(credits) : 'n/a'}
          sub={credits != null ? formatUsd(creditsToUsd(credits)) : 'Unavailable'}
        />
        <Stat
          label="Spent in history"
          value={formatCredits(spent)}
          sub={`${formatUsd(creditsToUsd(spent))} over ${billed.length} run${billed.length === 1 ? '' : 's'}`}
        />
      </div>

      {runsLeft != null && runsLeft < 1000 && (
        <p className="text-[12px] leading-relaxed text-ink-faint">
          At your cheapest model so far, roughly{' '}
          <strong className="font-semibold text-ink-muted">{runsLeft}</strong> more
          runs before the balance is gone.
        </p>
      )}

      <section>
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
          Cost per model
        </h3>

        {perModel.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12px] leading-relaxed text-ink-faint">
            Nothing measured yet. Costs appear here as models run, taken from
            what Kie.ai actually charged rather than a published list.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {perModel.map((m) => (
              <li
                key={m.modelId}
                className="flex items-baseline justify-between gap-3 bg-surface px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-ink">{m.name}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {m.samples} run{m.samples === 1 ? '' : 's'}
                    {m.maxCredits - m.minCredits > 0.01 &&
                      ` · ${formatCredits(m.minCredits)} to ${formatCredits(m.maxCredits)} cr`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[13px] tabular-nums text-ink">
                    {formatUsd(creditsToUsd(m.averageCredits))}
                  </span>
                  <span className="block text-[11px] tabular-nums text-ink-faint">
                    {formatCredits(m.averageCredits)} cr
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-line bg-raised p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface text-accent">
            <CreditCard className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">Adding credits</p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
              Kie.ai exposes no payment API, so credits cannot be bought from
              here. Top up on their site and the new balance shows up
              immediately.
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={() => window.open(TOP_UP_URL, '_blank', 'noopener,noreferrer')}
        >
          Top up on kie.ai
          <ExternalLink className="size-3.5" />
        </Button>
      </section>

      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Dollar amounts use {formatUsd(CREDIT_USD_RATE)} per credit. Kie
          adjusts pricing as upstream providers do, so set
          <code className="mx-1 font-mono">NEXT_PUBLIC_CREDIT_USD_RATE</code>
          if your rate differs. Credit figures are exact either way.
        </span>
      </p>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised p-3.5">
      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      <p className="mt-1 text-[20px] font-semibold tabular-nums leading-none text-ink">
        {value}
      </p>
      <p className="mt-1.5 text-[11px] text-ink-muted">{sub}</p>
    </div>
  )
}
