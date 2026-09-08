'use client'

import { Check, Minus } from 'lucide-react'

import { creditsToUsd, formatUsd } from '@/lib/kie/pricing'
import { cn, timeAgo } from '@/lib/utils'
import type { AdminUser } from './types'

/** Anyone quiet for longer than this reads as gone rather than idle. */
const DORMANT_MS = 14 * 24 * 60 * 60 * 1000

interface UsersTableProps {
  users: AdminUser[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function UsersTable({ users, selectedId, onSelect }: UsersTableProps) {
  if (users.length === 0) {
    return (
      <p className="rounded-[--radius-card] border border-line bg-raised p-6 text-center text-[13px] text-ink-faint">
        No accounts yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-[--radius-card] border border-line bg-raised">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5 font-medium">Account</th>
            <th className="px-4 py-2.5 font-medium">Joined</th>
            <th className="px-4 py-2.5 font-medium">Last seen</th>
            <th className="px-4 py-2.5 text-right font-medium">Runs</th>
            <th className="px-4 py-2.5 text-right font-medium">Failed</th>
            <th className="px-4 py-2.5 text-right font-medium">Spent</th>
            <th className="px-4 py-2.5 text-right font-medium">Projects</th>
            <th className="px-4 py-2.5 text-center font-medium">Key</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-line">
          {users.map((user) => {
            const dormant =
              user.lastSeenAt != null && Date.now() - user.lastSeenAt > DORMANT_MS
            const selected = user.id === selectedId

            return (
              <tr
                key={user.id}
                onClick={() => onSelect(selected ? null : user.id)}
                className={cn(
                  'cursor-pointer transition-colors',
                  selected ? 'bg-overlay' : 'hover:bg-overlay/60',
                )}
                // Clicking a row filters the feed to that account, so it needs
                // to be reachable and announced like the control it is.
                aria-selected={selected}
                title={selected ? 'Show everything again' : `Show only ${user.email}`}
              >
                <td className="px-4 py-2.5">
                  <span className="block truncate text-ink">{user.email}</span>
                  <span className="block font-mono text-[11px] text-ink-faint">{user.id}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">
                  {timeAgo(user.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {user.lastSeenAt == null ? (
                    <span className="text-ink-faint">never</span>
                  ) : (
                    <>
                      <span className={cn(dormant ? 'text-ink-faint' : 'text-ink-muted')}>
                        {timeAgo(user.lastSeenAt)}
                      </span>
                      <span className="block text-[11px] text-ink-faint">
                        {user.lastAction}
                      </span>
                    </>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-muted">
                  {user.runs.toLocaleString()}
                </td>
                <td
                  className={cn(
                    'px-4 py-2.5 text-right font-mono tabular-nums',
                    user.failedRuns > 0 ? 'text-danger' : 'text-ink-faint',
                  )}
                >
                  {user.failedRuns.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-muted">
                  {formatUsd(creditsToUsd(user.credits))}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-faint">
                  {user.projects}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {user.hasApiKey ? (
                    <Check className="mx-auto size-3.5 text-ok" aria-label="has a Kie key" />
                  ) : (
                    <Minus
                      className="mx-auto size-3.5 text-ink-faint"
                      aria-label="no Kie key"
                    />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
