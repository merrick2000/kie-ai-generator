'use client'

import { cn } from '@/lib/utils'
import { creditsToUsd, formatCredits, formatUsd } from '@/lib/kie/pricing'
import type { Overview } from './types'

interface StatProps {
  label: string
  value: string
  hint?: string
  tone?: 'normal' | 'good' | 'warn' | 'danger'
}

function Stat({ label, value, hint, tone = 'normal' }: StatProps) {
  return (
    <div className="rounded-[--radius-card] border border-line bg-raised px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={cn(
          'mt-1 font-mono text-2xl tabular-nums',
          tone === 'good' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  )
}

/**
 * Fourteen days of runs as bars.
 *
 * Days with nothing in them are drawn as gaps rather than skipped, because a
 * quiet stretch is the shape worth seeing and a chart that omits it shows
 * steady use that never happened.
 */
function DailyBars({ daily }: { daily: Overview['daily'] }) {
  const byDay = new Map(daily.map((d) => [d.day, d]))
  const days: { day: string; runs: number; credits: number }[] = []

  for (let i = 13; i >= 0; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const key = date.toISOString().slice(0, 10)
    days.push(byDay.get(key) ?? { day: key, runs: 0, credits: 0 })
  }

  const peak = Math.max(1, ...days.map((d) => d.runs))

  return (
    <div className="rounded-[--radius-card] border border-line bg-raised p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-wide text-ink-faint">
          Runs, last 14 days
        </p>
        <p className="font-mono text-[11px] text-ink-faint">peak {peak}</p>
      </div>

      <div className="mt-3 flex h-24 items-end gap-1">
        {days.map((d) => (
          <div key={d.day} className="group/bar relative flex-1">
            <div
              className={cn(
                'w-full rounded-sm transition-colors',
                d.runs > 0 ? 'bg-accent/70 group-hover/bar:bg-accent' : 'bg-line',
              )}
              // A day with one run still needs to be visible, so the floor is
              // 2px rather than a proportional height that rounds to nothing.
              style={{ height: d.runs > 0 ? `${Math.max(8, (d.runs / peak) * 96)}px` : '2px' }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-overlay px-1.5 py-0.5 font-mono text-[10px] text-ink group-hover/bar:block">
              {d.day.slice(5)} · {d.runs}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopModels({ models }: { models: Overview['topModels'] }) {
  const peak = Math.max(1, ...models.map((m) => m.runs))

  return (
    <div className="rounded-[--radius-card] border border-line bg-raised p-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">
        Most used, last 7 days
      </p>

      {models.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-faint">Nothing has run this week.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {models.map((m) => (
            <li key={m.modelId} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-[13px]" title={m.modelId}>
                {m.name}
              </span>
              <span className="relative h-1.5 flex-1 rounded-full bg-line">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-accent"
                  style={{ width: `${(m.runs / peak) * 100}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-ink-muted">
                {m.runs}
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-faint">
                {formatUsd(creditsToUsd(m.credits))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function StatGrid({ overview }: { overview: Overview }) {
  const { users, runs, spend, security } = overview

  const successRate =
    runs.successRateWeek == null ? '—' : `${Math.round(runs.successRateWeek * 100)}%`

  return (
    <div className="space-y-3">
      {/*
        Two grids rather than one of nine, because nine cards across six
        columns leaves half a row of empty space that reads as a rendering
        fault. Split at the seam that was already there: what is happening,
        then what it costs.
      */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Accounts"
          value={users.total.toLocaleString()}
          hint={users.newWeek > 0 ? `+${users.newWeek} this week` : 'none this week'}
          tone={users.newDay > 0 ? 'good' : 'normal'}
        />
        <Stat
          label="Active this week"
          value={users.activeWeek.toLocaleString()}
          hint="accounts that ran something"
        />
        <Stat
          label="Runs today"
          value={runs.day.toLocaleString()}
          hint={`${runs.total.toLocaleString()} all time`}
        />
        <Stat
          label="Running now"
          value={runs.running.toLocaleString()}
          hint="not yet finished"
          tone={runs.running > 0 ? 'good' : 'normal'}
        />
        <Stat
          label="Failed today"
          value={runs.failedDay.toLocaleString()}
          hint={`${successRate} succeeded this week`}
          tone={runs.failedDay > 0 ? 'danger' : 'normal'}
        />
        <Stat
          label="Refused sign-ins"
          value={security.failedSigninsDay.toLocaleString()}
          hint={`${security.activeSessions} live sessions`}
          // A handful is somebody mistyping. A pile is somebody guessing.
          tone={security.failedSigninsDay >= 10 ? 'danger' : security.failedSigninsDay > 0 ? 'warn' : 'normal'}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Spent today"
          value={formatUsd(creditsToUsd(spend.dayCredits))}
          hint={`${formatCredits(spend.dayCredits)} credits`}
        />
        <Stat
          label="Spent this week"
          value={formatUsd(creditsToUsd(spend.weekCredits))}
          hint={`${formatCredits(spend.weekCredits)} credits`}
        />
        <Stat
          label="Spent all time"
          value={formatUsd(creditsToUsd(spend.totalCredits))}
          hint={`${formatCredits(spend.totalCredits)} credits`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <DailyBars daily={overview.daily} />
        <TopModels models={overview.topModels} />
      </div>
    </div>
  )
}
