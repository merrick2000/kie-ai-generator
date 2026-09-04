'use client'

import { AlertTriangle, BarChart3, Coins, ExternalLink, Settings } from 'lucide-react'
import { useState } from 'react'

import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { useCredits } from '@/hooks/useCredits'
import { useSession } from '@/hooks/useSession'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import { InsightsPanel } from './InsightsPanel'
import { ProjectSwitcher } from './ProjectSwitcher'

/** Warn before a long video job fails on an empty balance. */
const LOW_CREDIT_THRESHOLD = 200

export function TopBar() {
  const { configured, credits, loading, error } = useCredits()
  const session = useSession()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const selectModel = useStudio((s) => s.selectModel)

  const low = credits != null && credits < LOW_CREDIT_THRESHOLD

  return (
    <>
      <header className="rule flex h-14 shrink-0 items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-black">
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
              <path
                d="M3 12.5 8 3l5 9.5H3Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="text-[13px] font-semibold tracking-tight text-ink">
              Highfield
            </p>
            <p className="text-[10px] text-ink-faint">Powered by Kie.ai</p>
          </div>

          <span className="mx-1 h-5 w-px bg-line" aria-hidden />

          <ProjectSwitcher />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setInsightsOpen(true)}
            aria-label="Model insights"
            title="Which models actually work for you"
            className="grid size-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <BarChart3 className="size-4" />
          </button>

          {!configured ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1 text-[11px] font-medium text-warn transition-colors hover:bg-warn/20"
            >
              <AlertTriangle className="size-3.5" />
              Add API key
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title={error ?? 'Kie.ai credit balance'}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors',
                low
                  ? 'border-warn/30 bg-warn/10 text-warn hover:bg-warn/20'
                  : 'border-line bg-raised text-ink-muted hover:border-line-bright hover:text-ink',
              )}
            >
              <Coins className="size-3.5" />
              {loading && credits == null
                ? '·'
                : credits != null
                  ? credits.toLocaleString()
                  : 'n/a'}
              {/* Signals whose key is being billed when several are possible. */}
              {session.source === 'env' && (
                <span className="text-ink-faint">shared</span>
              )}
            </button>
          )}

          <a
            href="https://kie.ai/logs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 px-1 text-[11px] text-ink-faint transition-colors hover:text-ink"
          >
            Logs
            <ExternalLink className="size-3" />
          </a>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Account and settings"
            title={session.user?.email ?? 'Settings'}
            className="flex h-8 items-center gap-2 rounded-lg pl-1 pr-1.5 text-ink-faint transition-colors hover:bg-raised hover:text-ink"
          >
            {session.user && (
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-overlay text-[10px] font-semibold uppercase text-ink-muted">
                {session.user.email.slice(0, 2)}
              </span>
            )}
            <Settings className="size-4" />
          </button>
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {insightsOpen && (
        <InsightsPanel
          onClose={() => setInsightsOpen(false)}
          onPickModel={selectModel}
        />
      )}
    </>
  )
}
