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
      <header className="rule flex h-14 shrink-0 items-center justify-between gap-2 px-3 sm:gap-4 sm:px-4">
        {/* min-w-0 on both halves, or the switcher's long project names push
            the account button off the side of a phone. */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-black">
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

          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />

          <ProjectSwitcher />
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setInsightsOpen(true)}
            aria-label="Model insights"
            title="Which models actually work for you"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <BarChart3 className="size-4" />
          </button>

          {!configured ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] font-medium text-warn transition-colors hover:bg-warn/20 sm:px-2.5"
            >
              <AlertTriangle className="size-3.5" />
              <span className="hidden sm:inline">Add API key</span>
              <span className="sm:hidden">Key</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title={error ?? 'Kie.ai credit balance'}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors sm:px-2.5',
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
              {/* Signals whose key is being billed when several are possible.
                  Dropped on a phone, where the row has no space to spare and
                  Settings says the same thing. */}
              {session.source === 'env' && (
                <span className="hidden text-ink-faint sm:inline">shared</span>
              )}
            </button>
          )}

          {/* Hidden on a phone. It is a link out of the app, and it was what
              pushed the account button off the side of the screen. */}
          <a
            href="https://kie.ai/logs"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1 px-1 text-[11px] text-ink-faint transition-colors hover:text-ink sm:flex"
          >
            Logs
            <ExternalLink className="size-3" />
          </a>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Account and settings"
            title={session.user?.email ?? 'Settings'}
            // Square on a phone, where the avatar is hidden and only the
            // gear is left: px-1 around a 16px icon is a 24px wide target.
            className="flex size-8 shrink-0 items-center justify-center gap-2 rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink sm:h-8 sm:w-auto sm:px-1 sm:pr-1.5"
          >
            {session.user && (
              <span className="hidden size-6 shrink-0 place-items-center rounded-full bg-overlay text-[10px] font-semibold uppercase text-ink-muted sm:grid">
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
